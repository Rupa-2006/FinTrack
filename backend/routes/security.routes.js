// /api/security: the signed-in user's own sessions, security events and activity trail.
const { Router } = require('express');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/authenticate');
const schemas = require('../validators/user.validators');
const securitySchemas = require('../validators/security.validators');
const controller = require('../controllers/user.controller');
const mfa = require('../controllers/mfa.controller');
const authSchemas = require('../validators/auth.validators');
const { createRateLimiter, MINUTE } = require('../middleware/rateLimiters');

// Guessing codes or passwords through the settings is limited like sign-in, per account.
const mfaLimit = createRateLimiter({
  windowMs: 15 * MINUTE, limit: 10, message: 'Too many attempts. Please try again later.', keyGenerator: (req) => `mfa:${req.auth.userId}`,
});

const router = Router();

router.use(authenticate);

router.get('/sessions', controller.listSessions);
router.delete('/sessions', controller.revokeOtherSessions);
router.delete('/sessions/:id', validate({ params: schemas.sessionParams }), controller.revokeSession);
router.get('/events', validate({ query: securitySchemas.ownEventsQuery }), controller.listSecurityEvents);
router.get('/audit-logs', validate({ query: securitySchemas.ownActivityQuery }), controller.listActivity);

router.get('/mfa', mfa.status);
router.post('/mfa/setup', mfaLimit, mfa.setup);
router.post('/mfa/enable', mfaLimit, validate({ body: authSchemas.mfaEnable }), mfa.enable);
router.post('/mfa/disable', mfaLimit, validate({ body: authSchemas.mfaDisable }), mfa.disable);
router.post('/mfa/recovery-codes', mfaLimit, validate({ body: authSchemas.mfaPassword }), mfa.recoveryCodes);

module.exports = router;
