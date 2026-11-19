// /api/admin: administrators only. There is deliberately no route here that returns another
// user's transactions, budgets, goals or notes (see models/admin.model.js).
const { Router } = require('express');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/authenticate');
const { createRateLimiter, MINUTE } = require('../middleware/rateLimiters');
const s = require('../validators/security.validators');
const c = require('../controllers/admin.controller');

const router = Router();
router.use(authenticate, authorize('ADMIN'));

// Verifying reads the whole audit table, so it is limited.
const verifyLimit = createRateLimiter({ windowMs: 15 * MINUTE, limit: 10, message: 'The audit chain was verified recently. Please try again later.' });

router.get('/overview', c.overview);
router.get('/users', validate({ query: s.userListQuery }), c.listUsers);
router.patch('/users/:id/status', validate({ params: s.idParams, body: s.statusBody }), c.setStatus);
router.put('/users/:id/roles', validate({ params: s.idParams, body: s.roleBody }), c.setRole);
router.post('/users/:id/unlock', validate({ params: s.idParams }), c.unlock);
router.get('/security-events', validate({ query: s.adminEventsQuery }), c.securityEvents);
router.get('/audit-logs', validate({ query: s.adminAuditQuery }), c.auditLogs);
router.post('/audit-logs/verify', verifyLimit, c.verifyAuditChain);

module.exports = router;
