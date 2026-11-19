// Maps URL prefixes under /api to feature routers.
const { Router } = require('express');
const { AUTH_RATE_LIMITS, ASSISTANT_RATE_LIMIT } = require('../config/constants');
const { createAuthRouter } = require('./auth.routes');
const { createAssistantRouter } = require('./assistant.routes');

// Rate-limit options exist so tests can tighten or relax them.
function createApiRouter({ authRateLimits = AUTH_RATE_LIMITS, assistantRateLimit = ASSISTANT_RATE_LIMIT } = {}) {
  const router = Router();

  router.use('/health', require('./health.routes'));
  router.use('/auth', createAuthRouter({ ...AUTH_RATE_LIMITS, ...authRateLimits }));
  router.use('/users', require('./user.routes'));
  router.use('/security', require('./security.routes'));
  router.use('/admin', require('./admin.routes'));
  router.use('/assistant', createAssistantRouter({ ...ASSISTANT_RATE_LIMIT, ...assistantRateLimit }));

  const ledger = require('./ledger.routes');
  for (const name of ['categories', 'transactions', 'recurring', 'budgets', 'goals', 'currencies', 'analytics', 'reports', 'notifications']) {
    router.use(`/${name}`, ledger[name]);
  }

  return router;
}

module.exports = { createApiRouter };
