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
import { createReviewService } from './services/reviewService.js';
import { createCodeActionService } from './services/codeActionService.js';
import { createReviewController } from './controllers/reviewController.js';
import { createHealthController } from './controllers/healthController.js';
import { createReviewRoutes } from './routes/reviewRoutes.js';
import { createHealthRoutes } from './routes/healthRoutes.js';
import { createRateLimiters } from './middleware/rateLimiter.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp({ db, aiReviewService, config, analyzeCode }) {
  const app = express();

  const reviewModel = createReviewModel(db);
  const codeActionModel = createCodeActionModel(db);
  const aiTimeBudgetMs = config.ai?.timeBudgetMs || 0;
  const reviewService = createReviewService({ reviewModel, codeActionModel, aiReviewService, analyzeCode, aiTimeBudgetMs });
  const codeActionService = createCodeActionService({
    reviewModel, codeActionModel, aiReviewService, analyzeCode, ...(aiTimeBudgetMs ? { timeBudgetMs: aiTimeBudgetMs } : {}),
  });
  const { apiLimiter, reviewLimiter, codeActionLimiter } = createRateLimiters(config.rateLimit);

  // ---- security & parsing middleware
  app.disable('x-powered-by');
  // Behind a hosting proxy (Render, Railway, ...) this makes rate limiting use the real client IP.
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cors({ origin: config.clientOrigins, methods: ['GET', 'POST', 'DELETE'] }));
  app.use(express.json({ limit: config.limits.jsonBodyLimit }));
  app.use(requestLogger);
  app.use('/api', apiLimiter);

  // ---- routes
  app.use('/api/health', createHealthRoutes(createHealthController({ db, aiReviewService, limits: config.limits })));
  app.use('/api/reviews', createReviewRoutes({
    controller: createReviewController(reviewService, codeActionService),
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
