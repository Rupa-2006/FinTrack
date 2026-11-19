// Rate limiting. One general limiter for the whole API plus a factory for stricter limits
// on sensitive endpoints (login, registration, password reset, assistant), added in later phases.
// Counters are kept in memory per process, which is correct for a single instance; a shared
// store (Redis) is the upgrade path when the API runs on several instances.
const { rateLimit } = require('express-rate-limit');
const ApiError = require('../utils/ApiError');

const MINUTE = 60 * 1000;

// keyGenerator: optional, e.g. per user instead of per IP address (use after authenticate).
function createRateLimiter({ windowMs, limit, message, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit,
    ...(keyGenerator ? { keyGenerator } : {}),
    standardHeaders: 'draft-8', // RateLimit / RateLimit-Policy headers
    legacyHeaders: false,
    handler: (req, _res, next) => {
      req.log?.warn({ path: req.path }, 'rate limit exceeded');
      next(ApiError.tooManyRequests(message));
    },
  });
}

const DEFAULTS = {
  global: { windowMs: 15 * MINUTE, limit: 300 },
};

module.exports = { createRateLimiter, DEFAULTS, MINUTE };
