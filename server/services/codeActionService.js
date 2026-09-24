// CODE ACTION SERVICE - "Fix / Correct Code" and "Improve Code" for a saved review.
//
//   saved review (original code + issues + static analysis + AI review)
//        │
//        ▼
//   AI Review Engine: correctCode() / improveCode()
//        │   every answer is checked before it is accepted:
//        │   valid JSON ─► complete file (no snippet/patch/placeholder)
//        │   ─► same language ─► no syntax errors (same static analyzer)
//        │   (a failed check means: ask again / try the next provider)
//        ▼
//   code_actions table ─► the complete corrected / improved code for the UI
//
// The original code of the review is never modified.
import { analyzeCode as defaultAnalyzer } from './staticAnalysis/index.js';
import { checkLanguageMatch } from './languageDetector.js';
import { findIncompleteCode } from './ai/codeCompleteness.js';
import { CODE_ACTIONS } from '../models/codeActionModel.js';
import { AppError, AiServiceError } from '../utils/AppError.js';
import { SUPPORTED_LANGUAGES, normalizeLanguage } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

// Stop starting new AI attempts after this long (the browser waits up to 10 minutes).
const DEFAULT_TIME_BUDGET_MS = 5 * 60 * 1000;

// Messages shown to users. Which AI provider failed, and why, goes to the log only.
const TRY_AGAIN = 'Your original code and the review are unchanged. Please try again.';
const PUBLIC_ERRORS = {
  AI_NOT_CONFIGURED: [503, 'The AI service is not available right now, so the code cannot be generated. Please try again later.'],
  AI_RATE_LIMITED: [503, `The AI service is busy right now. ${TRY_AGAIN}`],
  AI_TIMEOUT: [504, `Generating the complete code took too long. ${TRY_AGAIN}`],
  AI_TRUNCATED: [502, 'The AI could not return the complete code for a program of this length. Try again, or review a shorter program.'],
  AI_INCOMPLETE_CODE: [502, `The AI did not return the complete source code (only part of it, or code with errors), so it was not shown. ${TRY_AGAIN}`],
  AI_EMPTY_CODE: [502, `The AI returned an empty answer. ${TRY_AGAIN}`],
  AI_INVALID_RESPONSE: [502, `The AI returned an answer in an unexpected format. ${TRY_AGAIN}`],
  AI_WRONG_LANGUAGE: [502, `The AI returned code in a different programming language. ${TRY_AGAIN}`],
};
const DEFAULT_PUBLIC_ERROR = [503, `The AI service is temporarily unavailable. ${TRY_AGAIN}`];

function toPublicError(error) {
  const [status, message] = PUBLIC_ERRORS[error.code] ?? DEFAULT_PUBLIC_ERROR;
  return new AppError(message, status, PUBLIC_ERRORS[error.code] ? error.code : 'AI_UNAVAILABLE');
}

// Keep the file ending the same way as the user's file.
function matchTrailingNewline(code, original) {
  const trimmed = code.replace(/\s+$/, '');
  return original.endsWith('\n') ? `${trimmed}\n` : trimmed;
}

export function createCodeActionService({
  reviewModel, codeActionModel, aiReviewService, analyzeCode = defaultAnalyzer, timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
}) {
  const running = new Set(); // "reviewId:action" pairs being generated right now

  // Rejects answers that are not a complete, valid source file in the right
  // language. Returns the static re-check of the generated code.
  async function verifyGeneratedCode({ review, language, action, generated }) {
    const reason = findIncompleteCode({ original: review.originalCode, generated, action });
    if (reason) throw new AiServiceError('AI_INCOMPLETE_CODE', `the returned code is not the complete file: ${reason}`);

    if (checkLanguageMatch(generated, language).mismatch) {
      throw new AiServiceError('AI_WRONG_LANGUAGE', `the returned code does not look like ${SUPPORTED_LANGUAGES[language].label}`);
    }

    const analysis = await analyzeCode(generated, language);
    if (!analysis.syntaxValid) {
      const syntaxError = analysis.issues.find((issue) => issue.type === 'Syntax Error');
      throw new AiServiceError(
        'AI_INCOMPLETE_CODE',
        `the returned code has a syntax error${syntaxError ? ` at line ${syntaxError.line}` : ''} - it may be incomplete`,
      );
    }
    return {
      syntaxValid: true,
      staticIssueCount: analysis.issues.length,
      originalStaticIssueCount: review.staticAnalysis?.issueCount ?? null,
      totalLines: analysis.metrics.totalLines,
      originalTotalLines: review.staticAnalysis?.metrics?.totalLines ?? null,
    };
  }

  return {
    // { correct: CodeAction | null, improve: CodeAction | null }
    async listForReview(reviewId) {
      return codeActionModel.findByReview(reviewId);
    },

    async generate(reviewId, action) {
      if (!CODE_ACTIONS.includes(action)) throw new AppError('Unknown code action.', 400, 'INVALID_ACTION');

      const review = await reviewModel.findById(reviewId);
      if (!review) throw new AppError(`Review #${reviewId} was not found.`, 404, 'REVIEW_NOT_FOUND');

      const language = normalizeLanguage(review.language);
      if (!language) {
        throw new AppError('Code generation is not supported for the language of this review.', 400, 'UNSUPPORTED_LANGUAGE');
      }
      if (!aiReviewService.isAvailable()) {
        logger.warn(`Code ${action} skipped`, { reason: aiReviewService.info().unavailableReason });
        throw toPublicError(new AiServiceError('AI_NOT_CONFIGURED', 'no provider'));
      }

      const key = `${reviewId}:${action}`;
      if (running.has(key)) {
        throw new AppError('This code is already being generated. Please wait for it to finish.', 409, 'ACTION_IN_PROGRESS');
      }
      running.add(key);
      try {
        const operation = action === 'correct' ? aiReviewService.correctCode : aiReviewService.improveCode;
        let result;
        try {
          result = await operation({
            language,
            code: review.originalCode,
            review,
            deadline: Date.now() + timeBudgetMs,
            verify: (generated) => verifyGeneratedCode({ review, language, action, generated }),
          });
        } catch (error) {
          if (!(error instanceof AiServiceError)) throw error;
          logger.warn(`Code ${action} failed`, { reviewId, code: error.code, detail: error.userMessage });
          throw toPublicError(error);
        }
        if (result.failedProviders?.length) {
          logger.warn(`Code ${action} answered after failover`, { provider: result.provider, failed: result.failedProviders });
        }

        const saved = await codeActionModel.save({
          reviewId,
          action,
          code: matchTrailingNewline(result.code, review.originalCode),
          changes: result.changes,
          summary: result.summary,
          checks: result.checks,
          aiProvider: result.provider,
          aiModel: result.model,
        });
        return { reviewId, language, ...saved };
      } finally {
        running.delete(key);
      }
    },
  };
}
