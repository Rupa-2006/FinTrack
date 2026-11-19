// An error the client is allowed to see. Anything that is not an ApiError is treated as an
// internal failure and answered with a generic 500 by the error handler.
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'The request is invalid', details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static validation(details) {
    return new ApiError(400, 'VALIDATION_ERROR', 'Some fields are invalid', details);
  }

  static unauthorized(message = 'Authentication is required') {
    return new ApiError(401, 'UNAUTHENTICATED', message);
  }

  static forbidden(message = 'You do not have permission to do this') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  // Also used for resources that exist but belong to someone else, so ids cannot be probed.
  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message, details) {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static locked(message = 'This account is temporarily locked') {
    return new ApiError(423, 'ACCOUNT_LOCKED', message);
  }

  static tooManyRequests(message = 'Too many requests. Please try again later.') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static serviceUnavailable(message = 'The service is temporarily unavailable') {
    return new ApiError(503, 'SERVICE_UNAVAILABLE', message);
  }
}

module.exports = ApiError;
