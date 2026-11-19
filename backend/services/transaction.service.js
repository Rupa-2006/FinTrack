// Income and expense entries.
//
// The amount and currency the user typed are stored exactly as entered and never rewritten.
// Next to them the entry keeps its value in the user's main currency (base_amount), the rate
// that produced it and the id of the rate snapshot, so every converted figure is traceable.
const database = require('../config/database');
const ApiError = require('../utils/ApiError');
const { toIso } = require('../utils/dates');
const { logger } = require('../utils/logger');
const { Decimal, assertCurrencyPrecision, convert } = require('../utils/money');
const { paginationMeta } = require('../utils/response');
const { encryptField, decryptField } = require('../security/fieldCrypto');
const transactionModel = require('../models/transaction.model');
const userModel = require('../models/user.model');
const categoryService = require('./category.service');
const fxService = require('./fx.service');
const budgetService = require('./budget.service');
const notifications = require('./notification.service');
const audit = require('./audit.service');

const { DATA } = audit.EVENT_TYPES;

const notesContext = (userId) => `transactions:notes_enc:${userId}`;
const UNUSUAL_MULTIPLE = 3; // an expense this many times the category's usual size is flagged
const UNUSUAL_MIN_SAMPLES = 5;

function readNotes(row, userId) {
  try {
    return decryptField(row.notes_enc, notesContext(userId));
  } catch (err) {
    logger.error({ transactionId: row.id, err: { message: err.message } }, 'could not decrypt transaction notes');
    return null;
  }
}

function toDto(row, userId, { withNotes = false } = {}) {
  const dto = {
    id: row.id,
    type: row.type,
    amount: row.amount,
    currency: row.currency_code,
    baseAmount: row.base_amount,
    baseCurrency: row.base_currency,
    exchangeRate: row.exchange_rate,
    description: row.description,
    paymentMethod: row.payment_method,
    recurringRuleId: row.recurring_rule_id ?? null,
    date: row.txn_date,
    category: { id: row.category_id, name: row.category_name, color: row.category_color },
    hasNotes: row.notes_enc !== null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
  if (withNotes) dto.notes = readNotes(row, userId);
  return dto;
}

async function list(userId, { page, pageSize, sort, order, ...filters }) {
  const { rows, totalItems } = await transactionModel.list(userId, filters, { page, pageSize, sort, order });
  return { items: rows.map((row) => toDto(row, userId)), meta: paginationMeta({ page, pageSize, totalItems }) };
}

async function getOne(userId, id) {
  const row = await transactionModel.findOwned(id, userId);
  if (!row) throw ApiError.notFound('Transaction not found');
  return toDto(row, userId, { withNotes: true });
}

// Validates the input against the user's own data and works out the stored row.
async function prepare(userId, input, existing = null) {
  const user = await userModel.findById(userId);
  await categoryService.requireUsable(userId, input.categoryId, input.type);
  assertCurrencyPrecision(input.amount, input.currency, 'body.amount');

  // Editing the description of an old entry must not silently re-price it: the stored rate
  // is kept unless the currency or the date changed.
  const keepRate = existing && existing.currency_code === input.currency && existing.txn_date === input.date && existing.base_currency === user.base_currency;
  const rate = keepRate
    ? { rate: existing.exchange_rate, id: existing.exchange_rate_id }
    : await fxService.getRate(input.currency, user.base_currency, input.date);

  return {
    ...input,
    amount: new Decimal(input.amount).toFixed(2),
    baseCurrency: user.base_currency,
    exchangeRate: rate.rate,
    exchangeRateId: rate.id,
    baseAmount: convert(input.amount, rate.rate, user.base_currency),
    notesEnc: input.notes ? encryptField(input.notes, notesContext(userId)) : null,
  };
}

// Follow-up checks. They add notifications and must never undo the saved transaction.
async function afterChange(userId, transaction) {
  try {
    await budgetService.checkAlerts(userId, transaction.date.slice(0, 7));
    if (transaction.type !== 'EXPENSE') return;
    const baseline = await transactionModel.categoryBaseline(userId, transaction.category.id, transaction.date, transaction.id);
    if (baseline.samples >= UNUSUAL_MIN_SAMPLES && new Decimal(transaction.baseAmount).gt(new Decimal(baseline.average).mul(UNUSUAL_MULTIPLE))) {
      await notifications.notify(userId, {
        type: 'UNUSUAL_SPENDING',
        severity: 'WARNING',
        title: `Unusually large ${transaction.category.name} expense`,
        message: `"${transaction.description}" (${notifications.money(transaction.baseAmount, transaction.baseCurrency)}) is more than ${UNUSUAL_MULTIPLE} times your usual ${transaction.category.name} expense of about ${notifications.money(new Decimal(baseline.average).toFixed(2), transaction.baseCurrency)}.`,
        dedupeKey: `unusual:${transaction.id}`,
      });
    }
  } catch (err) {
    logger.error({ err: { message: err.message } }, 'post-transaction checks failed');
  }
}

// `recurringRuleId` is set when a recurring rule creates the entry (services/recurring.service.js).
// `quiet` skips the confirmation and the per-entry alerts (used by imports, which send one summary).
async function create(userId, input, ctx = {}, { recurringRuleId = null, imported = false, quiet = false } = {}) {
  const prepared = { ...(await prepare(userId, input)), recurringRuleId }; // may fetch a rate, so it runs before the transaction opens
  const id = await database.withTransaction(async (tx) => {
    const newId = await transactionModel.create(userId, prepared, tx);
    await audit.append(tx, {
      userId, eventType: DATA, action: 'TRANSACTION_CREATED', resourceType: 'transaction', resourceId: newId,
      details: { type: prepared.type, foreignCurrency: prepared.currency !== prepared.baseCurrency, ...(recurringRuleId ? { recurringRuleId } : {}), ...(imported ? { imported: true } : {}) }, ctx,
    });
    return newId;
  });
  const transaction = await getOne(userId, id);
  if (quiet) return transaction;
  await confirm(userId, transaction);
  await afterChange(userId, transaction);
  return transaction;
}

// Confirmation of a newly recorded transaction, like a bank's "payment made" message. It
// never undoes the saved transaction if it fails.
async function confirm(userId, transaction) {
  try {
    const income = transaction.type === 'INCOME';
    const original = notifications.money(transaction.amount, transaction.currency);
    const converted = transaction.currency === transaction.baseCurrency
      ? ''
      : ` (${notifications.money(transaction.baseAmount, transaction.baseCurrency)})`;
    await notifications.notify(userId, {
      type: 'TRANSACTION',
      severity: 'INFO',
      title: `${transaction.recurringRuleId ? 'Recurring ' : ''}${income ? 'income' : 'expense'} recorded`.replace(/^./, (c) => c.toUpperCase()),
      message: `${original}${converted} ${income ? 'from' : 'for'} ${transaction.category.name}: "${transaction.description}" on ${transaction.date}.`,
      dedupeKey: `transaction:${transaction.id}`,
    });
  } catch (err) {
    logger.error({ err: { message: err.message } }, 'transaction confirmation failed');
  }
}

// Names of the fields an edit changed, for the audit trail (never their values).
function changedFields(existing, next) {
  const pairs = {
    type: [existing.type, next.type],
    categoryId: [existing.category_id, next.categoryId],
    amount: [existing.amount, next.amount],
    currency: [existing.currency_code, next.currency],
    date: [existing.txn_date, next.date],
    description: [existing.description, next.description],
    paymentMethod: [existing.payment_method, next.paymentMethod],
    notes: [existing.notes_enc === null ? null : 'set', next.notesEnc === null ? null : 'set'],
  };
  const changed = Object.keys(pairs).filter((field) => String(pairs[field][0]) !== String(pairs[field][1]));
  // Notes are re-encrypted on every save, so a "set -> set" edit cannot be told apart from an unchanged note.
  if (existing.notes_enc !== null && next.notesEnc !== null) changed.push('notes');
  return [...new Set(changed)];
}

async function update(userId, id, input, ctx = {}) {
  const existing = await transactionModel.findOwned(id, userId);
  if (!existing) throw ApiError.notFound('Transaction not found');
  const prepared = await prepare(userId, input, existing);
  await database.withTransaction(async (tx) => {
    await transactionModel.update(id, userId, prepared, tx);
    await audit.append(tx, {
      userId, eventType: DATA, action: 'TRANSACTION_UPDATED', resourceType: 'transaction', resourceId: id,
      details: { fields: changedFields(existing, prepared) }, ctx,
    });
  });
  const transaction = await getOne(userId, id);
  await afterChange(userId, transaction);
  return transaction;
}

async function remove(userId, id, ctx = {}) {
  const removed = await database.withTransaction(async (tx) => {
    if (!(await transactionModel.softDelete(id, userId, tx))) return false;
    await audit.append(tx, { userId, eventType: DATA, action: 'TRANSACTION_DELETED', resourceType: 'transaction', resourceId: id, ctx });
    return true;
  });
  if (!removed) throw ApiError.notFound('Transaction not found');
}

module.exports = { list, getOne, create, update, remove, toDto };
