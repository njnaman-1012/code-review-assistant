// Validates POST /api/reviews before any analysis runs.
import { AppError } from '../utils/AppError.js';
import { normalizeLanguage, SUPPORTED_LANGUAGES } from '../utils/constants.js';

export function createReviewValidator({ maxCodeChars, maxCodeLines }) {
  return function validateReviewRequest(req, res, next) {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return next(new AppError('Request body must be JSON with "language" and "code" fields.', 400, 'INVALID_INPUT'));
    }

    const { language, code } = body;

    if (typeof code !== 'string' || code.trim() === '') {
      return next(new AppError('Please enter or upload some code to review.', 400, 'EMPTY_CODE'));
    }

    if (typeof language !== 'string' || language.trim() === '') {
      return next(new AppError('Please select a programming language.', 400, 'LANGUAGE_REQUIRED'));
    }
    const normalizedLanguage = normalizeLanguage(language);
    if (!normalizedLanguage) {
      const supported = Object.values(SUPPORTED_LANGUAGES).map((l) => l.label).join(', ');
      return next(new AppError(`"${language}" is not supported yet. Supported languages: ${supported}.`, 400, 'UNSUPPORTED_LANGUAGE'));
    }

    if (code.length > maxCodeChars) {
      return next(new AppError(
        `The code is too large (${code.length.toLocaleString()} characters). The maximum is ${maxCodeChars.toLocaleString()} characters.`,
        413,
        'CODE_TOO_LARGE',
      ));
    }
    const lineCount = code.split('\n').length;
    if (lineCount > maxCodeLines) {
      return next(new AppError(`The code has ${lineCount} lines. The maximum is ${maxCodeLines} lines.`, 413, 'CODE_TOO_LARGE'));
    }

    if (code.includes('\u0000')) {
      return next(new AppError('The submitted content looks like a binary file, not source code.', 400, 'INVALID_INPUT'));
    }

    req.reviewInput = { language: normalizedLanguage, code };
    return next();
  };
}

// Validates the :id route parameter.
export function validateIdParam(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return next(new AppError('Review ID must be a positive whole number.', 400, 'INVALID_ID'));
  }
  req.reviewId = id;
  return next();
}
