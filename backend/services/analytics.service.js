// Summaries, trends, the dashboard bundle and reports. Everything is read-only and computed
// from the user's own transactions in their main currency.
const { toIso } = require('../utils/dates');
const { Decimal, percent } = require('../utils/money');
const { addDays, addMonths, currentMonth, daysBetween, monthRange, today } = require('../utils/period');
const analyticsModel = require('../models/analytics.model');
const transactionModel = require('../models/transaction.model');
const notificationModel = require('../models/notification.model');
const userModel = require('../models/user.model');
const budgetService = require('./budget.service');
const goalService = require('./goal.service');
const transactionService = require('./transaction.service');

const EXPORT_ROW_LIMIT = 10000;

// { month } or { from, to } -> inclusive date range; the default is the current month.
function resolvePeriod({ from, to, month } = {}) {
  if (from && to) return { from, to };
  const range = monthRange(month || currentMonth());
  return { from: from || range.start, to: to || range.end };
}

function figures(totals) {
  const net = new Decimal(totals.income).minus(totals.expense);
  return {
    income: new Decimal(totals.income).toFixed(2),
    expense: new Decimal(totals.expense).toFixed(2),
    net: net.toFixed(2),
    // Share of income left over; null when there was no income to measure against.
    savingsRate: new Decimal(totals.income).gt(0) ? percent(net, totals.income) : null,
    transactionCount: totals.incomeCount + totals.expenseCount,
  };
}

// Change against the previous period as a percentage; null when there is nothing to compare.
function change(current, previous) {
  const before = new Decimal(previous);
  if (before.isZero()) return null;
  return new Decimal(current).minus(before).div(before.abs()).mul(100).toDecimalPlaces(1).toNumber();
}

// What a period is compared with:
//   a single day                   -> the day before
//   a week (Monday to Sunday)      -> the week before
//   a calendar month               -> the previous calendar month
//   a calendar year                -> the previous year
//   any other date range           -> the range of the same length just before it
// While a week, month or year is still running, the comparison stops at the same point of the
// previous one (Monday to Wednesday against Monday to Wednesday), so a part is never set
// against a whole.
function previousPeriod(from, to, now = today()) {
  const running = now >= from && now < to;
  const sameSpan = (previousFrom, previousTo) => {
    if (!running) return { from: previousFrom, to: previousTo };
    const sameDay = addDays(previousFrom, daysBetween(from, now));
    return { from: previousFrom, to: sameDay < previousTo ? sameDay : previousTo };
  };

  if (from === to) return { from: addDays(from, -1), to: addDays(from, -1) };

  const isMonday = new Date(`${from}T00:00:00Z`).getUTCDay() === 1;
  if (isMonday && daysBetween(from, to) === 6) return sameSpan(addDays(from, -7), addDays(to, -7));

  const month = from.slice(0, 7);
  const range = monthRange(month);
  if (from === range.start && to === range.end) {
    const previous = monthRange(addMonths(month, -1));
    return sameSpan(previous.start, previous.end);
  }

  const year = Number(from.slice(0, 4));
  if (from === `${year}-01-01` && to === `${year}-12-31`) return sameSpan(`${year - 1}-01-01`, `${year - 1}-12-31`);

  const previousTo = addDays(from, -1);
  return { from: addDays(previousTo, -daysBetween(from, to)), to: previousTo };
}

async function summary(userId, query) {
  const { from, to } = resolvePeriod(query);
  const { from: previousFrom, to: previousTo } = previousPeriod(from, to);
  const [user, now, before] = await Promise.all([
    userModel.findById(userId),
    analyticsModel.totalsByType(userId, from, to),
    analyticsModel.totalsByType(userId, previousFrom, previousTo),
  ]);
  const current = figures(now);
  const previous = figures(before);
  return {
    currency: user.base_currency,
    period: { from, to },
    ...current,
    previousPeriod: { from: previousFrom, to: previousTo, ...previous },
    changes: {
      income: change(current.income, previous.income),
      expense: change(current.expense, previous.expense),
      net: change(current.net, previous.net),
    },
  };
}

// One entry per month, oldest first, including months with no activity.
async function monthly(userId, { months = 6, until = currentMonth() } = {}) {
  const first = addMonths(until, -(months - 1));
  const [user, rows] = await Promise.all([
    userModel.findById(userId),
    analyticsModel.byMonth(userId, monthRange(first).start, monthRange(until).end),
  ]);
  const byMonth = new Map();
  for (let i = 0; i < months; i += 1) byMonth.set(addMonths(first, i), { income: '0.00', expense: '0.00', incomeCount: 0, expenseCount: 0 });
  for (const row of rows) {
    const entry = byMonth.get(row.month);
    if (entry) entry[row.type === 'INCOME' ? 'income' : 'expense'] = row.total;
  }
  return {
    currency: user.base_currency,
    months: [...byMonth].map(([month, totals]) => {
      const { income, expense, net, savingsRate } = figures(totals);
      return { month, income, expense, net, savingsRate };
    }),
  };
}

async function categories(userId, query) {
  const { from, to } = resolvePeriod(query);
  const type = query.type || 'EXPENSE';
  const [user, rows] = await Promise.all([userModel.findById(userId), analyticsModel.byCategory(userId, from, to, type)]);
  const total = rows.reduce((sum, row) => sum.plus(row.total), new Decimal(0));
  return {
    currency: user.base_currency,
    period: { from, to },
    type,
    total: total.toFixed(2),
    categories: rows.map((row) => ({
      categoryId: row.category_id, name: row.name, color: row.color, total: row.total, transactionCount: row.entries, percent: percent(row.total, total),
    })),
  };
}

// Everything the dashboard shows, in one request.
async function dashboard(userId, { month = currentMonth() } = {}) {
  const [monthSummary, trend, topCategories, recent, budgets, goals, unread] = await Promise.all([
    summary(userId, { month }),
    monthly(userId, { months: 6, until: month }),
    categories(userId, { month, type: 'EXPENSE' }),
    transactionService.list(userId, { page: 1, pageSize: 6, sort: 'date', order: 'desc' }),
    budgetService.list(userId, { month }),
    goalService.list(userId),
    notificationModel.unreadCount(userId),
  ]);
  return {
    month,
    currency: monthSummary.currency,
    summary: monthSummary,
    trend: trend.months,
    topCategories: topCategories.categories.slice(0, 6),
    recentTransactions: recent.items,
    budgets: budgets.budgets,
    goals: goals.filter((goal) => goal.status === 'IN_PROGRESS').slice(0, 4),
    unreadNotifications: unread,
  };
}

// The printable monthly report.
async function monthlyReport(userId, { month = currentMonth() } = {}) {
  const { start, end } = monthRange(month);
  const [monthSummary, expenseCategories, incomeCategories, budgets, days, methods, largest] = await Promise.all([
    summary(userId, { month }),
    categories(userId, { month, type: 'EXPENSE' }),
    categories(userId, { month, type: 'INCOME' }),
    budgetService.list(userId, { month }),
    analyticsModel.byDay(userId, start, end),
    analyticsModel.byPaymentMethod(userId, start, end),
    analyticsModel.largestExpenses(userId, start, end, 5),
  ]);
  const daily = new Map();
  for (const row of days) {
    const entry = daily.get(row.day) || { date: row.day, income: '0.00', expense: '0.00' };
    entry[row.type === 'INCOME' ? 'income' : 'expense'] = row.total;
    daily.set(row.day, entry);
  }
  return {
    month,
    currency: monthSummary.currency,
    generatedAt: new Date().toISOString(),
    summary: monthSummary,
    expenseCategories: expenseCategories.categories,
    incomeCategories: incomeCategories.categories,
    budgets: budgets.budgets,
    daily: [...daily.values()],
    paymentMethods: methods.map((row) => ({ paymentMethod: row.payment_method, total: row.total, transactionCount: row.entries })),
    largestExpenses: largest.map((row) => ({ id: row.id, description: row.description, date: row.txn_date, amount: row.base_amount, category: row.category_name })),
  };
}

// Spreadsheets run cells that start with = + - @ as formulas. Such text gets a leading
// apostrophe so an exported description can never execute anything. Every cell is quoted.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportCsv(userId, { from, to, type } = {}) {
  const rows = await transactionModel.listForExport(userId, { from, to, type }, EXPORT_ROW_LIMIT);
  const header = ['Date', 'Type', 'Category', 'Description', 'Payment method', 'Amount', 'Currency', 'Exchange rate', 'Amount in main currency', 'Main currency', 'Recorded at'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.txn_date, row.type, row.category_name, row.description, row.payment_method,
        // Amounts are our own decimal strings, so they are written as plain numbers.
        row.amount, row.currency_code, row.exchange_rate, row.base_amount, row.base_currency, toIso(row.created_at),
      ]
        .map((value, index) => ([5, 7, 8].includes(index) ? value : csvCell(value)))
        .join(',')
    );
  }
  // The byte-order mark makes Excel read the file as UTF-8.
  return { filename: `fintrack-transactions-${from || 'start'}-to-${to || 'today'}.csv`, content: `\uFEFF${lines.join('\r\n')}\r\n`, rows: rows.length };
}

module.exports = { summary, monthly, categories, dashboard, monthlyReport, exportCsv, csvCell, previousPeriod };
