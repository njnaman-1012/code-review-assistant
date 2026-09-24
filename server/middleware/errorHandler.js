// Central error handling. Users get a friendly message and an error code;
// stack traces and internal details stay in the server log.
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res, next) {
  next(new AppError(`Route ${req.method} ${req.originalUrl} does not exist.`, 404, 'NOT_FOUND'));
}

// Express recognises error handlers by their four parameters.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let error = err;

  // Errors produced by express.json()
  if (err.type === 'entity.parse.failed') {
    error = new AppError('The request body is not valid JSON.', 400, 'INVALID_JSON');
  } else if (err.type === 'entity.too.large') {
    error = new AppError('The request is too large. Please submit a smaller file.', 413, 'PAYLOAD_TOO_LARGE');
  } else if (!(err instanceof AppError)) {
    const isDatabaseError = typeof err.code === 'string' && err.code.startsWith('SQLITE');
    logger.error('Unhandled error', { message: err.message, stack: err.stack });
    error = isDatabaseError
      ? new AppError('A database error occurred. Please try again.', 500, 'DATABASE_ERROR')
      : new AppError('Something went wrong on the server. Please try again.', 500, 'INTERNAL_ERROR');
  }

  res.status(error.statusCode).json({
    success: false,
    error: { code: error.code, message: error.message },
  });
}
