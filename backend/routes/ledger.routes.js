// Routes for the money features. Every router requires authentication, and every handler
// works on the signed-in user's own data only.
const { Router } = require('express');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/authenticate');
const { createRateLimiter, MINUTE } = require('../middleware/rateLimiters');
const s = require('../validators/ledger.validators');
const c = require('../controllers/ledger.controller');

const params = validate({ params: s.idParams });

function protectedRouter() {
  const router = Router();
  router.use(authenticate);
  return router;
}

const categories = protectedRouter();
categories.get('/', validate({ query: s.categoryQuery }), c.categories.list);
categories.post('/', validate({ body: s.categoryBody }), c.categories.create);
categories.put('/:id', validate({ params: s.idParams, body: s.categoryUpdate }), c.categories.update);
categories.delete('/:id', params, c.categories.remove);

const transactions = protectedRouter();
transactions.get('/', validate({ query: s.transactionQuery }), c.catchUpRecurring, c.transactions.list);
transactions.post('/', validate({ body: s.transactionBody }), c.transactions.create);
// Each import request may create up to 500 entries, so imports are limited per user.
const importLimit = createRateLimiter({ windowMs: 15 * MINUTE, limit: 60, message: 'Too many imports in a short time. Please wait a few minutes.', keyGenerator: (req) => `import:${req.auth.userId}` });
transactions.post('/import', importLimit, validate({ body: s.importBody }), c.imports.run);
transactions.get('/:id', params, c.transactions.get);
transactions.put('/:id', validate({ params: s.idParams, body: s.transactionBody }), c.transactions.update);
transactions.delete('/:id', params, c.transactions.remove);

const budgets = protectedRouter();
budgets.get('/', validate({ query: s.budgetQuery }), c.budgets.list);
budgets.post('/', validate({ body: s.budgetBody }), c.budgets.create);
budgets.post('/copy', validate({ body: s.budgetCopy }), c.budgets.copy);
budgets.put('/:id', validate({ params: s.idParams, body: s.budgetUpdate }), c.budgets.update);
budgets.delete('/:id', params, c.budgets.remove);

const goals = protectedRouter();
goals.get('/', c.goals.list);
goals.post('/', validate({ body: s.goalBody }), c.goals.create);
goals.get('/:id', params, c.goals.get);
goals.put('/:id', validate({ params: s.idParams, body: s.goalUpdate }), c.goals.update);
goals.delete('/:id', params, c.goals.remove);
goals.post('/:id/contributions', validate({ params: s.idParams, body: s.contributionBody }), c.goals.contribute);

// Refreshing calls an external service, so it is limited more tightly.
const currencies = protectedRouter();
const refreshLimit = createRateLimiter({ windowMs: 15 * MINUTE, limit: 10, message: 'Rates were refreshed recently. Please try again later.' });
currencies.get('/', c.currencies.list);
currencies.get('/rates', validate({ query: s.ratesQuery }), c.currencies.rates);
currencies.post('/rates/refresh', refreshLimit, validate({ query: s.ratesQuery }), c.currencies.refresh);
currencies.get('/convert', validate({ query: s.convertQuery }), c.currencies.convert);
currencies.put('/base', validate({ body: s.baseCurrencyBody }), c.currencies.changeBase);

const analytics = protectedRouter();
analytics.get('/summary', validate({ query: s.periodQuery }), c.analytics.summary);
analytics.get('/monthly', validate({ query: s.monthlyQuery }), c.analytics.monthly);
analytics.get('/categories', validate({ query: s.categoriesQuery }), c.analytics.categories);
analytics.get('/dashboard', validate({ query: s.monthQuery }), c.catchUpRecurring, c.analytics.dashboard);

const reports = protectedRouter();
reports.get('/monthly', validate({ query: s.monthQuery }), c.reports.monthly);
reports.get('/export', validate({ query: s.exportQuery }), c.reports.exportCsv);

const recurring = protectedRouter();
recurring.get('/', c.recurring.list);
recurring.post('/', validate({ body: s.recurringBody }), c.recurring.create);
recurring.put('/:id', validate({ params: s.idParams, body: s.recurringUpdate }), c.recurring.update);
recurring.delete('/:id', params, c.recurring.remove);

const notifications = protectedRouter();
notifications.get('/', validate({ query: s.notificationQuery }), c.notifications.list);
notifications.get('/unread-count', c.notifications.unreadCount);
notifications.post('/read-all', c.notifications.markAllRead);
notifications.patch('/:id/read', params, c.notifications.markRead);
notifications.delete('/:id', params, c.notifications.remove);

module.exports = { categories, transactions, recurring, budgets, goals, currencies, analytics, reports, notifications };
