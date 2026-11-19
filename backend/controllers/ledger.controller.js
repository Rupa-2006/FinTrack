// HTTP layer for the money features. Each handler reads validated input, passes the
// authenticated user's id to a service and shapes the response. No handler takes a user id
// from the request.
const { sendSuccess, sendCreated, sendNoContent } = require('../utils/response');
const { requestMeta } = require('../utils/requestMeta');
const categoryService = require('../services/category.service');
const transactionService = require('../services/transaction.service');
const budgetService = require('../services/budget.service');
const goalService = require('../services/goal.service');
const fxService = require('../services/fx.service');
const currencyService = require('../services/currency.service');
const analyticsService = require('../services/analytics.service');
const notificationService = require('../services/notification.service');
const recurringService = require('../services/recurring.service');
const importService = require('../services/import.service');
const userModel = require('../models/user.model');

const uid = (req) => req.auth.userId;
const body = (req) => req.validated.body;
const query = (req) => req.validated.query;
const idOf = (req) => req.validated.params.id;

const categories = {
  list: async (req, res) => sendSuccess(res, await categoryService.list(uid(req), query(req))),
  create: async (req, res) => sendCreated(res, await categoryService.create(uid(req), body(req), requestMeta(req))),
  update: async (req, res) => sendSuccess(res, await categoryService.update(uid(req), idOf(req), body(req), requestMeta(req))),
  remove: async (req, res) => sendSuccess(res, await categoryService.remove(uid(req), idOf(req), requestMeta(req))),
};

const transactions = {
  list: async (req, res) => {
    const { items, meta } = await transactionService.list(uid(req), query(req));
    sendSuccess(res, items, { meta });
  },
  get: async (req, res) => sendSuccess(res, await transactionService.getOne(uid(req), idOf(req))),
  create: async (req, res) => sendCreated(res, await transactionService.create(uid(req), body(req), requestMeta(req))),
  update: async (req, res) => sendSuccess(res, await transactionService.update(uid(req), idOf(req), body(req), requestMeta(req))),
  remove: async (req, res) => {
    await transactionService.remove(uid(req), idOf(req), requestMeta(req));
    sendNoContent(res);
  },
};

const budgets = {
  list: async (req, res) => sendSuccess(res, await budgetService.list(uid(req), query(req))),
  create: async (req, res) => sendCreated(res, await budgetService.create(uid(req), body(req), requestMeta(req))),
  update: async (req, res) => sendSuccess(res, await budgetService.update(uid(req), idOf(req), body(req), requestMeta(req))),
  copy: async (req, res) => sendSuccess(res, await budgetService.copy(uid(req), body(req), requestMeta(req))),
  remove: async (req, res) => {
    await budgetService.remove(uid(req), idOf(req), requestMeta(req));
    sendNoContent(res);
  },
};

const goals = {
  list: async (req, res) => sendSuccess(res, await goalService.list(uid(req))),
  get: async (req, res) => sendSuccess(res, await goalService.getOne(uid(req), idOf(req))),
  create: async (req, res) => sendCreated(res, await goalService.create(uid(req), body(req), requestMeta(req))),
  update: async (req, res) => sendSuccess(res, await goalService.update(uid(req), idOf(req), body(req), requestMeta(req))),
  contribute: async (req, res) => sendCreated(res, await goalService.contribute(uid(req), idOf(req), body(req), requestMeta(req))),
  remove: async (req, res) => {
    await goalService.remove(uid(req), idOf(req), requestMeta(req));
    sendNoContent(res);
  },
};

const baseOf = async (req) => query(req).base || (await userModel.findById(uid(req))).base_currency;

const currencies = {
  list: async (req, res) => {
    const user = await userModel.findById(uid(req));
    sendSuccess(res, { baseCurrency: user.base_currency, currencies: await fxService.listCurrencies() });
  },
  rates: async (req, res) => sendSuccess(res, await fxService.latestRates(await baseOf(req))),
  refresh: async (req, res) => sendSuccess(res, await fxService.refresh(await baseOf(req))),
  convert: async (req, res) => sendSuccess(res, await fxService.convertAmount(query(req))),
  changeBase: async (req, res) => sendSuccess(res, await currencyService.changeBaseCurrency(uid(req), body(req), requestMeta(req))),
};

const analytics = {
  summary: async (req, res) => sendSuccess(res, await analyticsService.summary(uid(req), query(req))),
  monthly: async (req, res) => sendSuccess(res, await analyticsService.monthly(uid(req), query(req))),
  categories: async (req, res) => sendSuccess(res, await analyticsService.categories(uid(req), query(req))),
  dashboard: async (req, res) => sendSuccess(res, await analyticsService.dashboard(uid(req), query(req))),
};

const reports = {
  monthly: async (req, res) => sendSuccess(res, await analyticsService.monthlyReport(uid(req), query(req))),
  exportCsv: async (req, res) => {
    const { filename, content } = await analyticsService.exportCsv(uid(req), query(req));
    res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` }).send(content);
  },
};

const notifications = {
  list: async (req, res) => {
    const { page, pageSize } = query(req);
    const { items, totalItems, unreadCount } = await notificationService.list(uid(req), query(req));
    sendSuccess(res, items, { meta: { pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) }, unreadCount } });
  },
  unreadCount: async (req, res) => sendSuccess(res, await notificationService.unreadCount(uid(req))),
  markRead: async (req, res) => {
    await notificationService.markRead(uid(req), idOf(req));
    sendNoContent(res);
  },
  markAllRead: async (req, res) => sendSuccess(res, await notificationService.markAllRead(uid(req))),
  remove: async (req, res) => {
    await notificationService.remove(uid(req), idOf(req));
    sendNoContent(res);
  },
};

const imports = {
  run: async (req, res) => sendSuccess(res, await importService.importTransactions(uid(req), body(req), requestMeta(req))),
};

const recurring = {
  list: async (req, res) => sendSuccess(res, await recurringService.list(uid(req), requestMeta(req))),
  create: async (req, res) => sendCreated(res, await recurringService.create(uid(req), body(req), requestMeta(req))),
  update: async (req, res) => sendSuccess(res, await recurringService.update(uid(req), idOf(req), body(req), requestMeta(req))),
  remove: async (req, res) => {
    await recurringService.remove(uid(req), idOf(req), requestMeta(req));
    sendNoContent(res);
  },
};

// Creates any recurring transactions that have fallen due before a list or dashboard is read.
async function catchUpRecurring(req, res, next) {
  await recurringService.generateDue(uid(req), requestMeta(req)); // never throws
  next();
}

module.exports = { catchUpRecurring, imports, recurring, categories, transactions, budgets, goals, currencies, analytics, reports, notifications };
