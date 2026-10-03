// Builds the Express application. Dependencies (database, AI service, ...)
// are passed in, so tests can create an app with an in-memory database and a
// test AI provider without touching real services.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createReviewModel } from './models/reviewModel.js';
import { createCodeActionModel } from './models/codeActionModel.js';
import { createUserModel } from './models/userModel.js';
import { createSessionModel } from './models/sessionModel.js';
import { createUsageModel } from './models/usageModel.js';
import { createVerificationModel } from './models/verificationModel.js';
import { createRateLimitModel } from './models/rateLimitModel.js';
import { createSecurityEventModel } from './models/securityEventModel.js';
import { createEmailService } from './services/emailService.js';
import { createAuthService } from './services/authService.js';
import { createUsageService } from './services/usageService.js';
import { createReviewService } from './services/reviewService.js';
import { createCodeActionService } from './services/codeActionService.js';
import { createReviewController } from './controllers/reviewController.js';
import { createHealthController } from './controllers/healthController.js';
import { createAuthController } from './controllers/authController.js';
import { createReviewRoutes } from './routes/reviewRoutes.js';
import { createHealthRoutes } from './routes/healthRoutes.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createAuthMiddleware, createSameOriginGuard } from './middleware/auth.js';
import { createRateLimiters } from './middleware/rateLimiter.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

// emailService can be passed in (tests use one that keeps the messages in memory).
export function createApp({ db, aiReviewService, config, analyzeCode, emailService = createEmailService(config.email) }) {
  const app = express();

  const reviewModel = createReviewModel(db);
  const codeActionModel = createCodeActionModel(db);
  const aiTimeBudgetMs = config.ai?.timeBudgetMs || 0;
  const usageService = createUsageService({ usageModel: createUsageModel(db) });
  const rateLimitModel = createRateLimitModel(db);
  const authService = createAuthService({
    userModel: createUserModel(db),
    sessionModel: createSessionModel(db),
    verificationModel: createVerificationModel(db),
    securityEventModel: createSecurityEventModel(db),
    rateLimitModel,
    emailService,
    settings: { ...config.auth, defaultUserTokens: config.usage.defaultUserTokens },
  });
  const reviewService = createReviewService({ reviewModel, codeActionModel, aiReviewService, usageService, analyzeCode, aiTimeBudgetMs });
  const codeActionService = createCodeActionService({
    reviewModel, codeActionModel, aiReviewService, usageService, analyzeCode, ...(aiTimeBudgetMs ? { timeBudgetMs: aiTimeBudgetMs } : {}),
  });
  const { requireAuth } = createAuthMiddleware({ authService });
  const { apiLimiter, reviewLimiter, codeActionLimiter, authLimiter, otpLimiter } = createRateLimiters(config.rateLimit, rateLimitModel);

  // ---- security & parsing middleware
  app.disable('x-powered-by');
  // Behind a hosting proxy (Render, Railway, ...) this makes rate limiting use the real client IP.
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  // Security headers: Content-Security-Policy (only our own scripts), no framing by
  // other sites, no MIME sniffing, HTTPS only (HSTS), no referrer, no device features.
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });
  // Only the configured front-end origins may call the API from a browser (never "*").
  app.use(cors({ origin: config.clientOrigins, methods: ['GET', 'POST', 'DELETE'] }));
  app.use(express.json({ limit: config.limits.jsonBodyLimit }));
  app.use(requestLogger);
  app.use('/api', apiLimiter);
  app.use('/api', createSameOriginGuard({ clientOrigins: config.clientOrigins, allowLocalhost: !config.auth.cookieSecure }));

  // ---- routes
  app.use('/api/health', createHealthRoutes(createHealthController({ db, aiReviewService, limits: config.limits })));
  app.use('/api/auth', createAuthRoutes({
    controller: createAuthController({ authService, usageService, cookieSecure: config.auth.cookieSecure }),
    requireAuth,
    authLimiter,
    otpLimiter,
  }));
  // Everything under /api/reviews needs a logged-in user.
  app.use('/api/reviews', requireAuth, createReviewRoutes({
    controller: createReviewController(reviewService, codeActionService, usageService),
    reviewLimiter,
    codeActionLimiter,
    limits: config.limits,
  }));

  // ---- production: the same server also serves the built React app
  //      (client/dist), so the whole application is one web service.
  const clientDist = config.clientDistPath;
  if (clientDist && fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false }));
    // Any other non-API path is a React route (e.g. /reviews/5).
    app.get(/^\/(?!api(\/|$)).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // ---- errors (must be registered last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
