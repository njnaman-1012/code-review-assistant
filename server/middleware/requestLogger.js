// Logs method, path, status and duration only - never the request body,
// so submitted code and secrets are not written to the logs.
import { logger } from '../utils/logger.js';

export function requestLogger(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
}
