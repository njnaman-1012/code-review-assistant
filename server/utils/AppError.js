// An expected, user-facing error. The message is safe to show to the user;
// the error handler never sends stack traces or internal details.
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Raised by the AI layer. The review service catches it and falls back
// to a static-analysis-only review instead of failing the whole request.
export class AiServiceError extends Error {
  constructor(code, userMessage, cause) {
    super(userMessage);
    this.name = 'AiServiceError';
    this.code = code;
    this.userMessage = userMessage;
    if (cause) this.cause = cause;
  }
}
