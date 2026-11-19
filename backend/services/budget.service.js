// Monthly budgets. Amounts are in the user's main currency. What has been spent is always
// computed from the transactions, never stored, so it cannot drift out of date.
//
//   CATEGORY        limit for one expense category
//   OVERALL         limit for all expenses of the month
//   SAVINGS_TARGET  how much of the month's income should be left over
const database = require('../config/database');
const ApiError = require('../utils/ApiError');
const { Decimal, percent } = require('../utils/money');
const { currentMonth, monthRange } = require('../utils/period');
const budgetModel = require('../models/budget.model');
const analyticsModel = require('../models/analytics.model');
const userModel = require('../models/user.model');
const categoryService = require('./category.service');
const notifications = require('./notification.service');
const audit = require('./audit.service');

const { DATA } = audit.EVENT_TYPES;

function withProgress(row, spending) {
  const budget = {
    id: row.id,
    budgetType: row.budget_type,
    category: row.category_id ? { id: row.category_id, name: row.category_name, color: row.category_color } : null,
    month: row.month,
    amount: row.amount,
    alertThresholdPct: row.alert_threshold_pct,
  };
  if (row.budget_type === 'SAVINGS_TARGET') {
    const saved = new Decimal(spending.income).minus(spending.expense);
    const percentReached = percent(Decimal.max(saved, 0), row.amount);
    return { ...budget, saved: saved.toFixed(2), remaining: Decimal.max(new Decimal(row.amount).minus(saved), 0).toFixed(2), percentUsed: percentReached, status: percentReached >= 100 ? 'REACHED' : 'IN_PROGRESS' };
  }
  const spent = new Decimal(row.budget_type === 'OVERALL' ? spending.expense : spending.byCategory.get(row.category_id) ?? 0);
  const percentUsed = percent(spent, row.amount);
  let status = 'ON_TRACK';
  if (spent.gt(row.amount)) status = 'EXCEEDED';
  else if (percentUsed >= row.alert_threshold_pct) status = 'WARNING';
  return { ...budget, spent: spent.toFixed(2), remaining: new Decimal(row.amount).minus(spent).toFixed(2), percentUsed, status };
}

async function monthSpending(userId, month) {
  const { start, end } = monthRange(month);
  const [totals, categories] = await Promise.all([
    analyticsModel.totalsByType(userId, start, end),
    analyticsModel.byCategory(userId, start, end, 'EXPENSE'),
  ]);
  return { income: totals.income, expense: totals.expense, byCategory: new Map(categories.map((row) => [row.category_id, row.total])) };
}

async function list(userId, { month = currentMonth() } = {}) {
  const [rows, spending, user] = await Promise.all([budgetModel.listForMonth(userId, month), monthSpending(userId, month), userModel.findById(userId)]);
  return {
    month,
    currency: user.base_currency,
    income: spending.income,
    expense: spending.expense,
    budgets: rows.map((row) => withProgress(row, spending)),
  };
}

async function getOne(userId, id) {
  const row = await budgetModel.findOwned(id, userId);
  if (!row) throw ApiError.notFound('Budget not found');
  return withProgress(row, await monthSpending(userId, row.month));
}

async function create(userId, input, ctx = {}) {
  if (input.budgetType === 'CATEGORY') await categoryService.requireUsable(userId, input.categoryId, 'EXPENSE');
  let id;
  try {
    id = await database.withTransaction(async (tx) => {
      const newId = await budgetModel.create(userId, input, tx);
      await audit.append(tx, {
        userId, eventType: DATA, action: 'BUDGET_CREATED', resourceType: 'budget', resourceId: newId,
        details: { budgetType: input.budgetType, month: input.month }, ctx,
      });
      return newId;
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw ApiError.conflict('A budget for this already exists in that month. Edit it instead.');
    throw err;
  }
  await checkAlerts(userId, input.month);
  return getOne(userId, id);
}

async function update(userId, id, input, ctx = {}) {
  const existing = await budgetModel.findOwned(id, userId);
  if (!existing) throw ApiError.notFound('Budget not found');
  await database.withTransaction(async (tx) => {
    await budgetModel.update(id, userId, input, tx);
    await audit.append(tx, { userId, eventType: DATA, action: 'BUDGET_UPDATED', resourceType: 'budget', resourceId: id, details: { fields: ['amount', 'alertThresholdPct'] }, ctx });
  });
  await checkAlerts(userId, existing.month);
  return getOne(userId, id);
}

async function remove(userId, id, ctx = {}) {
  const removed = await database.withTransaction(async (tx) => {
    if (!(await budgetModel.remove(id, userId, tx))) return false;
    await audit.append(tx, { userId, eventType: DATA, action: 'BUDGET_DELETED', resourceType: 'budget', resourceId: id, ctx });
    return true;
  });
  if (!removed) throw ApiError.notFound('Budget not found');
}

async function copy(userId, { fromMonth, toMonth }, ctx = {}) {
  const copied = await database.withTransaction(async (tx) => {
    const count = await budgetModel.copyMonth(userId, fromMonth, toMonth, tx);
    if (count) await audit.append(tx, { userId, eventType: DATA, action: 'BUDGETS_COPIED', resourceType: 'budget', details: { fromMonth, toMonth, count }, ctx });
    return count;
  });
  return { copied };
}

// Raises "threshold reached" and "exceeded" notifications for a month's spending budgets.
// Each is created at most once per budget (dedupe key), however many transactions follow.
async function checkAlerts(userId, month) {
  const { currency, budgets } = await list(userId, { month });
  const label = notifications.monthName(month);
  for (const budget of budgets) {
    if (budget.budgetType === 'SAVINGS_TARGET' || budget.status === 'ON_TRACK') continue;
    const name = budget.category ? `${budget.category.name} budget` : 'overall budget';
    const figures = `${notifications.money(budget.spent, currency)} of ${notifications.money(budget.amount, currency)}`;
    if (budget.status === 'EXCEEDED') {
      await notifications.notify(userId, {
        type: 'BUDGET_THRESHOLD', severity: 'CRITICAL', title: `Over budget: ${budget.category?.name ?? 'Overall'}`,
        message: `You have spent ${figures} of your ${name} for ${label}.`, dedupeKey: `budget:${budget.id}:exceeded`,
      });
    } else {
      await notifications.notify(userId, {
        type: 'BUDGET_THRESHOLD', severity: 'WARNING', title: `Budget alert: ${budget.category?.name ?? 'Overall'}`,
        message: `You have used ${budget.percentUsed}% (${figures}) of your ${name} for ${label}.`, dedupeKey: `budget:${budget.id}:threshold`,
      });
    }
  }
}

module.exports = { list, create, update, remove, copy, checkAlerts };
