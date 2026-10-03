// USAGE SERVICE - the AI token allowance of each user.
//
//   before an AI request:  estimate the tokens it needs ─► reserve them
//                          (not enough left ─► TOKEN_LIMIT_REACHED, the AI is not called)
//   after the AI request:  replace the reservation with the tokens really used,
//                          write the usage log, return the new balance
//
// The balance lives only in the database. Nothing sent by the browser (body,
// query, headers, cookies, local storage) can change it.
import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/AppError.js';
import { estimateTokens } from '../utils/tokenEstimate.js';
import { logger } from '../utils/logger.js';

export const TOKEN_LIMIT_MESSAGE = 'You have reached your AI usage limit. Please wait for your allowance to reset or contact the administrator.';

// The instructions sent with every request and a minimal answer.
const REQUEST_OVERHEAD_TOKENS = 1500;

function toPublicUsage(usage) {
  const percentRemaining = usage.allocated > 0 ? Math.round((usage.remaining / usage.allocated) * 1000) / 10 : 0;
  return { ...usage, percentRemaining };
}

export function createUsageService({ usageModel }) {
  return {
    // { allocated, used, remaining, percentRemaining }
    async getUsage(userId) {
      const usage = await usageModel.findByUser(userId);
      return toPublicUsage(usage ?? { allocated: 0, used: 0, remaining: 0 });
    },

    // Runs one AI request (`run`) for a user and charges the tokens it used.
    // `run` resolves to an object with `tokensUsed`; an error thrown by it may
    // also carry `tokensUsed` (failed attempts still cost tokens).
    async runMetered({ userId, feature, code }, run) {
      const estimate = estimateTokens(code) + REQUEST_OVERHEAD_TOKENS;
      if (!(await usageModel.reserve(userId, estimate))) {
        logger.warn('AI request blocked: token allowance used up', { userId, feature });
        throw new AppError(TOKEN_LIMIT_MESSAGE, 429, 'TOKEN_LIMIT_REACHED');
      }

      let tokensUsed = 0;
      try {
        const result = await run();
        tokensUsed = result?.tokensUsed ?? 0;
        return result;
      } catch (error) {
        tokensUsed = error?.tokensUsed ?? 0;
        throw error;
      } finally {
        try {
          await usageModel.settle({ userId, reserved: estimate, tokensUsed, requestId: randomUUID(), feature });
        } catch (error) {
          // The reservation stays deducted, so the user can never gain tokens from a failed update.
          logger.error('Could not record AI token usage', { userId, feature, error: error.message });
        }
      }
    },
  };
}
