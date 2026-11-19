// Savings goals. A goal has its own currency; contributions add to it and withdrawals
// (negative contributions) take from it. The running total is updated in the same database
// transaction as the contribution, with the goal row locked.
const database = require('../config/database');
const ApiError = require('../utils/ApiError');
const { logger } = require('../utils/logger');
const { Decimal, assertCurrencyPrecision, percent } = require('../utils/money');
const { daysBetween, today } = require('../utils/period');
const { encryptField, decryptField } = require('../security/fieldCrypto');
const goalModel = require('../models/goal.model');
const notifications = require('./notification.service');
const audit = require('./audit.service');

const { DATA } = audit.EVENT_TYPES;

const notesContext = (userId) => `savings_goals:notes_enc:${userId}`;

function readNotes(row, userId) {
  try {
    return decryptField(row.notes_enc, notesContext(userId));
  } catch (err) {
    logger.error({ goalId: row.id, err: { message: err.message } }, 'could not decrypt goal notes');
    return null;
  }
}

function toDto(row, userId) {
  return {
    id: row.id,
    title: row.title,
    targetAmount: row.target_amount,
    savedAmount: row.saved_amount,
    remaining: Decimal.max(new Decimal(row.target_amount).minus(row.saved_amount), 0).toFixed(2),
    percent: Math.min(100, percent(row.saved_amount, row.target_amount)),
    currency: row.currency_code,
    deadline: row.deadline,
    daysLeft: row.deadline ? daysBetween(today(), row.deadline) : null,
    status: row.status,
    notes: readNotes(row, userId),
  };
}

async function list(userId) {
  return (await goalModel.list(userId)).map((row) => toDto(row, userId));
}

async function getOne(userId, id) {
  const row = await goalModel.findOwned(id, userId);
  if (!row) throw ApiError.notFound('Savings goal not found');
  const contributions = await goalModel.listContributions(id, userId);
  return { ...toDto(row, userId), contributions: contributions.map((c) => ({ id: c.id, amount: c.amount, date: c.contributed_on })) };
}

async function create(userId, input, ctx = {}) {
  assertCurrencyPrecision(input.targetAmount, input.currency, 'body.targetAmount');
  const id = await database.withTransaction(async (tx) => {
    const newId = await goalModel.create(userId, { ...input, notesEnc: input.notes ? encryptField(input.notes, notesContext(userId)) : null }, tx);
    await audit.append(tx, { userId, eventType: DATA, action: 'GOAL_CREATED', resourceType: 'savings_goal', resourceId: newId, details: { currency: input.currency }, ctx });
    return newId;
  });
  return getOne(userId, id);
}

const statusFor = (saved, target) => (new Decimal(saved).gte(target) ? 'COMPLETED' : 'IN_PROGRESS');

async function update(userId, id, input, ctx = {}) {
  const existing = await goalModel.findOwned(id, userId);
  if (!existing) throw ApiError.notFound('Savings goal not found');
  assertCurrencyPrecision(input.targetAmount, existing.currency_code, 'body.targetAmount');
  // Cancelling is the user's choice; otherwise the status follows the numbers.
  const status = input.status === 'CANCELLED' ? 'CANCELLED' : statusFor(existing.saved_amount, input.targetAmount);
  await database.withTransaction(async (tx) => {
    await goalModel.update(id, userId, {
      title: input.title,
      targetAmount: input.targetAmount,
      deadline: input.deadline,
      notesEnc: input.notes ? encryptField(input.notes, notesContext(userId)) : null,
      status,
    }, tx);
    await audit.append(tx, {
      userId, eventType: DATA, action: 'GOAL_UPDATED', resourceType: 'savings_goal', resourceId: id,
      details: status === existing.status ? null : { status }, ctx,
    });
  });
  return getOne(userId, id);
}

async function contribute(userId, id, { amount, date }, ctx = {}) {
  const result = await database.withTransaction(async (tx) => {
    const goal = await goalModel.findOwned(id, userId, tx, { forUpdate: true });
    if (!goal) throw ApiError.notFound('Savings goal not found');
    if (goal.status === 'CANCELLED') throw ApiError.conflict('This goal is cancelled. Reopen it before adding money.');
    assertCurrencyPrecision(amount, goal.currency_code, 'body.amount');
    const saved = new Decimal(goal.saved_amount).plus(amount);
    if (saved.lt(0)) {
      throw ApiError.validation([{ field: 'body.amount', message: `You can withdraw at most ${goal.saved_amount} ${goal.currency_code}` }]);
    }
    const status = statusFor(saved, goal.target_amount);
    await goalModel.addContribution(id, userId, { amount, date }, tx);
    await goalModel.setSaved(id, saved.toFixed(2), status, tx);
    await audit.append(tx, {
      userId, eventType: DATA, action: new Decimal(amount).isNegative() ? 'GOAL_WITHDRAWAL' : 'GOAL_CONTRIBUTION',
      resourceType: 'savings_goal', resourceId: id, ctx,
    });
    return { justCompleted: status === 'COMPLETED' && goal.status !== 'COMPLETED', goal };
  });

  if (result.justCompleted) {
    await notifications.notify(userId, {
      type: 'SYSTEM',
      title: `Goal reached: ${result.goal.title}`,
      message: `You have saved the full ${notifications.money(result.goal.target_amount, result.goal.currency_code)} for "${result.goal.title}". Well done.`,
      dedupeKey: `goal:${id}:completed`,
    });
  }
  return getOne(userId, id);
}

async function remove(userId, id, ctx = {}) {
  const removed = await database.withTransaction(async (tx) => {
    if (!(await goalModel.remove(id, userId, tx))) return false;
    await audit.append(tx, { userId, eventType: DATA, action: 'GOAL_DELETED', resourceType: 'savings_goal', resourceId: id, ctx });
    return true;
  });
  if (!removed) throw ApiError.notFound('Savings goal not found');
}

module.exports = { list, getOne, create, update, contribute, remove };
