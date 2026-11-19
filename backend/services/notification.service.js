// In-app notifications: budget alerts, unusual spending, goal milestones, monthly summaries.
const ApiError = require('../utils/ApiError');
const { toIso } = require('../utils/dates');
const { logger } = require('../utils/logger');
const { Decimal, percent } = require('../utils/money');
const { addMonths, currentMonth, monthRange } = require('../utils/period');
const notificationModel = require('../models/notification.model');
const analyticsModel = require('../models/analytics.model');
const userModel = require('../models/user.model');

// Display text only; stored amounts stay exact decimal strings.
function money(amount, currency) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(String(amount));
}

function monthName(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

// Raising a notification must never fail the action that caused it.
async function notify(userId, notification) {
  try {
    return await notificationModel.create(userId, notification);
  } catch (err) {
    logger.error({ err: { code: err.code, message: err.message }, type: notification.type }, 'could not create notification');
    return false;
  }
}

// The first time a user looks at their notifications in a new month, last month is summed up.
async function ensureMonthlySummary(userId) {
  const month = addMonths(currentMonth(), -1);
  const { start, end } = monthRange(month);
  const totals = await analyticsModel.totalsByType(userId, start, end);
  if (!totals.incomeCount && !totals.expenseCount) return;
  const user = await userModel.findById(userId);
  const net = new Decimal(totals.income).minus(totals.expense);
  const outcome = net.gte(0)
    ? `leaving ${money(net.toFixed(2), user.base_currency)} (${percent(net, totals.income)}% of income saved)`
    : `spending ${money(net.abs().toFixed(2), user.base_currency)} more than you earned`;
  await notify(userId, {
    type: 'MONTHLY_SUMMARY',
    title: `Your ${monthName(month)} summary`,
    message: `You received ${money(totals.income, user.base_currency)} and spent ${money(totals.expense, user.base_currency)}, ${outcome}.`,
    dedupeKey: `summary:${month}`,
  });
}

const toDto = (row) => ({
  id: row.id,
  type: row.type,
  severity: row.severity,
  title: row.title,
  message: row.message,
  read: row.read_at !== null,
  createdAt: toIso(row.created_at),
});

async function list(userId, query) {
  await ensureMonthlySummary(userId).catch((err) => logger.error({ err: { message: err.message } }, 'monthly summary failed'));
  const { rows, totalItems } = await notificationModel.list(userId, query);
  return { items: rows.map(toDto), totalItems, unreadCount: await notificationModel.unreadCount(userId) };
}

async function unreadCount(userId) {
  return { unreadCount: await notificationModel.unreadCount(userId) };
}

async function markRead(userId, id) {
  if (!(await notificationModel.markRead(id, userId))) throw ApiError.notFound('Notification not found');
}

async function markAllRead(userId) {
  return { updated: await notificationModel.markAllRead(userId) };
}

async function remove(userId, id) {
  if (!(await notificationModel.remove(id, userId))) throw ApiError.notFound('Notification not found');
}

module.exports = { notify, money, monthName, list, unreadCount, markRead, markAllRead, remove };
