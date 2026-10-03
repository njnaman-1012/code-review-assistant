// Rate limiting protects the server, the e-mail quota and the AI quota from abuse.
//
// The limits for logins, codes and AI requests are counted in the database
// (table rate_limits): a serverless host runs many short-lived instances, and
// a counter kept in memory would start at zero in each of them. The general
// API limit is only a flood guard and stays in memory (no database write per request).
import { createHash } from 'node:crypto';
import rateLimit from 'express-rate-limit';

// A store for express-rate-limit on top of models/rateLimitModel.js.
function createDatabaseStore(rateLimitModel, name) {
  let windowMs = 60_000;
  const keyOf = (key) => `${name}:${createHash('sha256').update(String(key)).digest('hex')}`;
  return {
    localKeys: false, // the counters are shared by all server instances
    init(options) {
      windowMs = options.windowMs;
    },
    async increment(key) {
      const { hits, resetAt } = await rateLimitModel.hit(keyOf(key), windowMs);
      return { totalHits: hits, resetTime: new Date(resetAt) };
    },
    async decrement(key) {
      await rateLimitModel.undo(keyOf(key));
    },
    async resetKey(key) {
      await rateLimitModel.reset(keyOf(key));
    },
  };
}

export function createRateLimiters(
  { windowMs, maxRequests, maxReviews, maxCodeActions = maxReviews, maxAuthAttempts = 30, maxOtpRequests = 30 },
  rateLimitModel,
) {
  // name: counter name in the database (none = in memory); perUser: count per logged-in user instead of per IP address.
  function limiter({ name, limit, message, perUser = false }) {
    return rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { success: false, error: { code: 'RATE_LIMITED', message } },
      ...(name && rateLimitModel ? { store: createDatabaseStore(rateLimitModel, name) } : {}),
      ...(perUser ? { keyGenerator: (req) => `user-${req.user.id}` } : {}),
    });
  }

  return {
    apiLimiter: limiter({
      limit: maxRequests,
      message: 'Too many requests. Please wait a few minutes and try again.',
    }),
    // Slows down password guessing and mass registration.
    authLimiter: limiter({
      name: 'auth',
      limit: maxAuthAttempts,
      message: 'Too many login or registration attempts. Please wait a few minutes and try again.',
    }),
    // Entering and requesting one-time codes.
    otpLimiter: limiter({
      name: 'otp',
      limit: maxOtpRequests,
      message: 'Too many attempts. Please wait a few minutes and try again.',
    }),
    // AI requests are limited per user (the routes need a login), so one
    // account cannot flood the AI service and users behind one network do not block each other.
    reviewLimiter: limiter({
      name: 'review',
      perUser: true,
      limit: maxReviews,
      message: `You can run at most ${maxReviews} reviews every 15 minutes. Please wait and try again.`,
    }),
    // "Fix / Correct Code" and "Improve Code" also call the AI service.
    codeActionLimiter: limiter({
      name: 'code-action',
      perUser: true,
      limit: maxCodeActions,
      message: `You can generate corrected or improved code at most ${maxCodeActions} times every 15 minutes. Please wait and try again.`,
    }),
  };
}
