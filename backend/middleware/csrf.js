// Cross-site request forgery defence for the routes that rely on a cookie (/api/auth).
// Routes that use the Bearer access token do not need it: a forged cross-site request
// cannot attach a token that lives only in the SPA's memory.
//
// Three layers:
//   1. the refresh cookie is SameSite=Strict, so browsers do not send it cross-site
//   2. if the browser states an Origin, it must be one of our front-end origins
//   3. a custom header must be present; a cross-site form cannot set one, and a cross-site
//      script would first need a CORS preflight that only allow-listed origins pass
const ApiError = require('../utils/ApiError');
const { config } = require('../config/env');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfGuard(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !config.clientOrigins.includes(origin)) {
    req.log?.warn({ path: req.path }, 'request from a disallowed origin blocked');
    return next(ApiError.forbidden('This request was blocked because it did not come from the FinTrack app'));
  }
  if (!req.get('x-requested-with')) {
    return next(ApiError.forbidden('This request was blocked because it did not come from the FinTrack app'));
  }
  return next();
}

module.exports = { csrfGuard };
