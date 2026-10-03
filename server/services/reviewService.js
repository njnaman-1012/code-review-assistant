// REVIEW SERVICE - orchestrates the complete review pipeline:
//
//   validated input ─► Language Detector ─► Static Analyzer ─► AI Review Engine
//                                                               │ (optional, may fail)
//        Database ◄── Review Aggregator ◄── re-analysis of improved code
//
// Every review belongs to one user (userId comes from the login session).
// The AI review is charged to that user's token allowance; with no tokens
// left the AI is not called and the review contains the automated checks only.
import { checkLanguageMatch } from './languageDetector.js';
import { analyzeCode as defaultAnalyzer } from './staticAnalysis/index.js';
import { aggregateReview } from './reviewAggregator.js';
import { AppError, AiServiceError } from '../utils/AppError.js';
import { AI_STATUS } from '../utils/constants.js';
import { TOKEN_LIMIT_MESSAGE } from './usageService.js';
import { logger } from '../utils/logger.js';

// Messages shown to users. Internal details (which AI provider or model was
// used, why it failed, configuration hints) go to the server log only.
const CHECKS_ONLY = 'The results below come from the automated code checks only.';
const PUBLIC_AI_MESSAGES = {
  AI_RATE_LIMITED: `The AI review service is busy right now. ${CHECKS_ONLY} Please try again in a minute.`,
  AI_TIMEOUT: `The AI review took too long to respond. ${CHECKS_ONLY} Please try again in a minute.`,
  AI_TRUNCATED: `The AI review could not finish for code of this length. ${CHECKS_ONLY} Try a shorter program.`,
};
const DEFAULT_AI_MESSAGE = `The AI review is temporarily unavailable. ${CHECKS_ONLY} Please try again later.`;

const NO_CODE_ACTIONS = { correct: null, improve: null };

// aiTimeBudgetMs: total time the AI may use for one review (0 = no limit; 240 s on Vercel).
export function createReviewService({
  reviewModel, codeActionModel, aiReviewService, usageService, analyzeCode = defaultAnalyzer, aiTimeBudgetMs = 0,
}) {
  // A review is returned together with its generated corrected / improved code.
  const withCodeActions = async (review) => ({
    ...review,
    codeActions: codeActionModel ? await codeActionModel.findByReview(review.id) : NO_CODE_ACTIONS,
  });

  async function runAiReview({ userId, language, code, staticResult }) {
    const { provider, model, unavailableReason } = aiReviewService.info();
    if (!aiReviewService.isAvailable()) {
      logger.warn('AI review skipped', { reason: unavailableReason });
      return {
        aiResult: null,
        ai: { status: AI_STATUS.UNAVAILABLE, message: `The AI review is not available right now. ${CHECKS_ONLY}`, provider, model },
      };
    }
    try {
      const deadline = aiTimeBudgetMs ? Date.now() + aiTimeBudgetMs : undefined;
      const aiResult = await usageService.runMetered(
        { userId, feature: 'review', code },
        () => aiReviewService.reviewCode({ language, code, staticResult, deadline }),
      );
      if (aiResult.failedProviders?.length) {
        logger.warn('AI review answered after failover', { provider: aiResult.provider, failed: aiResult.failedProviders });
      }
      return {
        aiResult,
        ai: { status: AI_STATUS.COMPLETED, message: null, provider: aiResult.provider ?? provider, model: aiResult.model },
      };
    } catch (error) {
      if (error instanceof AppError && error.code === 'TOKEN_LIMIT_REACHED') {
        return {
          aiResult: null,
          ai: { status: AI_STATUS.UNAVAILABLE, message: `${TOKEN_LIMIT_MESSAGE} ${CHECKS_ONLY}`, provider: null, model: null },
        };
      }
      if (!(error instanceof AiServiceError)) throw error;
      logger.warn('AI review failed, continuing with static analysis only', { code: error.code, detail: error.userMessage });
      return {
        aiResult: null,
        ai: { status: AI_STATUS.FAILED, message: PUBLIC_AI_MESSAGES[error.code] ?? DEFAULT_AI_MESSAGE, provider, model },
      };
    }
  }

  return {
    async createReview({ language, code, userId }) {
      const languageCheck = checkLanguageMatch(code, language);
      const staticResult = await analyzeCode(code, language);
      const { aiResult, ai } = await runAiReview({ userId, language, code, staticResult });

      // Measure the improved code with the same static analyzer (original vs improved).
      let improvedStaticResult = null;
      if (aiResult?.review.improvedCode.trim()) {
        improvedStaticResult = await analyzeCode(aiResult.review.improvedCode, language);
      }

      const review = aggregateReview({ language, code, staticResult, languageCheck, aiResult, ai, improvedStaticResult });
      try {
        return await withCodeActions(await reviewModel.create({ ...review, userId }));
      } catch (error) {
        logger.error('Failed to save review', { error: error.message });
        throw new AppError('The review was generated but could not be saved to the database.', 500, 'DATABASE_ERROR');
      }
    },

    async listReviews({ userId, limit, offset }) {
      const [reviews, total] = await Promise.all([reviewModel.findAll({ userId, limit, offset }), reviewModel.count(userId)]);
      return { reviews, total };
    },

    // A review of another user is reported as "not found", like one that does not exist.
    async getReview(id, userId) {
      const review = await reviewModel.findById(id, userId);
      if (!review) throw new AppError(`Review #${id} was not found.`, 404, 'REVIEW_NOT_FOUND');
      return withCodeActions(review);
    },

    async deleteReview(id, userId) {
      if (!(await reviewModel.deleteById(id, userId))) throw new AppError(`Review #${id} was not found.`, 404, 'REVIEW_NOT_FOUND');
    },
  };
}
