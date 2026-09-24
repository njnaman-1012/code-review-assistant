// Rate limiting protects the server (and the paid AI API) from abuse.
import rateLimit from 'express-rate-limit';

function limiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message } },
  });
}

export function createRateLimiters({ windowMs, maxRequests, maxReviews, maxCodeActions = maxReviews }) {
  return {
    apiLimiter: limiter({
      windowMs,
      limit: maxRequests,
      message: 'Too many requests. Please wait a few minutes and try again.',
    }),
    reviewLimiter: limiter({
      windowMs,
      limit: maxReviews,
      message: `You can run at most ${maxReviews} reviews every 15 minutes. Please wait and try again.`,
    }),
    // "Fix / Correct Code" and "Improve Code" also call the AI service.
    codeActionLimiter: limiter({
      windowMs,
      limit: maxCodeActions,
      message: `You can generate corrected or improved code at most ${maxCodeActions} times every 15 minutes. Please wait and try again.`,
    }),
  };
}
