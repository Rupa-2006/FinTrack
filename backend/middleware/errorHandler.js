// Central error handling. Every failure leaves the API in the same shape:
//
//   { success: false, error: { code, message, details?, requestId } }
//
// Only ApiError messages (written for clients) are sent. Anything else is logged with its
// stack and answered with a generic 500, so SQL errors, file paths and stack traces never
// reach the browser.
const ApiError = require('../utils/ApiError');

function notFound(req, _res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.path}`));
}

function normalize(err) {
  if (err instanceof ApiError) return err;
  // Errors raised by express.json()
  if (err?.type === 'entity.parse.failed') return new ApiError(400, 'INVALID_JSON', 'The request body is not valid JSON');
  if (err?.type === 'entity.too.large') return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
  if (err?.expose === true && err.status >= 400 && err.status < 500) {
    return new ApiError(err.status, 'BAD_REQUEST', 'The request could not be processed');
  }
  return null;
}

// Express recognises an error handler by its four parameters, so _next must stay.
function errorHandler(err, req, res, _next) {
  const known = normalize(err);
  const status = known ? known.status : 500;

  if (!known) {
    req.log?.error(
      { err: { name: err?.name, code: err?.code, message: err?.message, stack: err?.stack } },
      'unhandled error'
    );
  }

  if (res.headersSent) return res.end();

  const error = {
    code: known ? known.code : 'INTERNAL_ERROR',
    message: known ? known.message : 'Something went wrong on our side. Please try again.',
    requestId: req.id,
  };
  if (known?.details) error.details = known.details;
  return res.status(status).json({ success: false, error });
}

module.exports = { errorHandler, notFound };
