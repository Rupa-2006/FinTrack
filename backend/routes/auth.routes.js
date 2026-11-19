// /api/auth: the only routes that read the refresh cookie, so the CSRF guard covers them all.
const { Router } = require('express');
const cookieParser = require('cookie-parser');
const validate = require('../middleware/validate');
const { csrfGuard } = require('../middleware/csrf');
const { createRateLimiter } = require('../middleware/rateLimiters');
const schemas = require('../validators/auth.validators');
const controller = require('../controllers/auth.controller');

function createAuthRouter(limits) {
  const router = Router();
  const loginLimit = createRateLimiter(limits.login);
  const registerLimit = createRateLimiter(limits.register);
  const resetLimit = createRateLimiter(limits.passwordReset);
  const refreshLimit = createRateLimiter(limits.refresh);

  router.use(csrfGuard, cookieParser());

  router.post('/register', registerLimit, validate({ body: schemas.register }), controller.register);
  router.post('/login', loginLimit, validate({ body: schemas.login }), controller.login);
  router.post('/mfa/verify', loginLimit, validate({ body: schemas.verifyMfa }), controller.verifyMfa);
  router.post('/refresh', refreshLimit, controller.refresh);
  router.post('/logout', refreshLimit, controller.logout);
  router.post('/forgot-password', resetLimit, validate({ body: schemas.forgotPassword }), controller.forgotPassword);
  router.post('/reset-password', resetLimit, validate({ body: schemas.resetPassword }), controller.resetPassword);

  return router;
}

module.exports = { createAuthRouter };
