// Importing transactions from a spreadsheet or a bank-statement CSV (fictional or the user's
// own data only; there is no bank connection).
//
// The browser reads the file and maps its columns; this service receives plain rows, at most
// 500 per request. Each row is validated on its own, so one bad line never blocks the rest:
//
//   dryRun: true   -> nothing is saved; every row comes back as ready, duplicate or error
//   dryRun: false  -> ready rows are saved (and duplicates too, if skipDuplicates is false)
//
// A duplicate is an existing transaction with the same date, amount, currency and
// description. Saved rows go through the normal transaction path (validation, conversion at
// that day's rate, audit row) without a confirmation each; one summary notification follows,
// and the budgets of the affected months are checked once.
const { z } = require('zod');
const database = require('../config/database');
const ApiError = require('../utils/ApiError');
const { logger } = require('../utils/logger');
const { Decimal, assertCurrencyPrecision } = require('../utils/money');
const fields = require('../validators/common');
const transactionModel = require('../models/transaction.model');
const categoryService = require('./category.service');
const transactionService = require('./transaction.service');
const budgetService = require('./budget.service');
const notifications = require('./notification.service');
const audit = require('./audit.service');

const MAX_ROWS = 500;
const PAYMENT_ALIASES = {
  CASH: 'CASH', CARD: 'CARD', 'CREDIT CARD': 'CARD', 'DEBIT CARD': 'CARD', UPI: 'UPI', 'BANK TRANSFER': 'BANK_TRANSFER',
  BANK_TRANSFER: 'BANK_TRANSFER', TRANSFER: 'BANK_TRANSFER', NEFT: 'BANK_TRANSFER', IMPS: 'BANK_TRANSFER', WALLET: 'WALLET', OTHER: 'OTHER',
};

const rowSchema = z.object({
  date: fields.pastOrPresentDate,
  type: z.preprocess((v) => String(v ?? '').trim().toUpperCase(), z.enum(['INCOME', 'EXPENSE'], { error: 'Type must be income or expense' })),
  amount: fields.money,
  currency: z.preprocess((v) => String(v ?? '').trim().toUpperCase(), fields.currencyCode),
  // FinTrack's own CSV export protects formula-like text with a leading apostrophe; undo that.
  description: z.preprocess((v) => String(v ?? '').trim().replace(/^'(?=[=+\-@])/, ''), fields.text(255, 'Add a description')),
  category: z.preprocess((v) => String(v ?? '').trim(), z.string().max(50)).optional(),
  paymentMethod: z.preprocess((v) => String(v ?? '').trim().toUpperCase(), z.string()).optional(),
  notes: z.preprocess((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()), z.string().max(2000).nullable()).optional(),
});

const duplicateKey = (date, amount, currency, description) =>
  `${date}|${new Decimal(amount).toFixed(2)}|${currency}|${String(description).trim().toLowerCase()}`;

async function importTransactions(userId, { rows, dryRun = true, skipDuplicates = true, fallbackCategories = {} }, ctx = {}) {
  if (rows.length > MAX_ROWS) throw ApiError.badRequest(`Send at most ${MAX_ROWS} rows per request`);
  const categories = await categoryService.list(userId, { includeArchived: false });
  const byName = new Map(categories.map((c) => [`${c.type}|${c.name.toLowerCase()}`, c]));
  const usable = new Set(categories.map((c) => `${c.type}|${c.id}`));

  // 1. validate each row and find its category
  const results = rows.map((raw, index) => {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      return { row: index + 1, status: 'error', errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`) };
    }
    const value = parsed.data;
    const errors = [];
    let category = value.category ? byName.get(`${value.type}|${value.category.toLowerCase()}`) : null;
    if (!category && fallbackCategories[value.type] && usable.has(`${value.type}|${fallbackCategories[value.type]}`)) {
      category = categories.find((c) => c.id === Number(fallbackCategories[value.type]));
    }
    if (!category) errors.push(value.category ? `category: no ${value.type.toLowerCase()} category named "${value.category}"` : 'category: choose a category');
    const paymentMethod = value.paymentMethod ? PAYMENT_ALIASES[value.paymentMethod] : 'OTHER';
    if (!paymentMethod) errors.push(`paymentMethod: "${value.paymentMethod}" is not a known payment method`);
    try {
      assertCurrencyPrecision(value.amount, value.currency, 'amount');
    } catch (err) {
      errors.push(`amount: ${err.details?.[0]?.message ?? err.message}`);
    }
    if (errors.length) return { row: index + 1, status: 'error', errors };
    return {
      row: index + 1, status: 'ready',
      input: {
        type: value.type, categoryId: category.id, amount: value.amount, currency: value.currency, date: value.date,
        description: value.description, paymentMethod, notes: value.notes ?? null,
      },
      category: category.name,
    };
  });

  // 2. duplicates of what is already recorded
  const ready = results.filter((r) => r.status === 'ready');
  const existing = await transactionModel.onDates(userId, [...new Set(ready.map((r) => r.input.date))]);
  const known = new Set(existing.map((t) => duplicateKey(t.txn_date, t.amount, t.currency_code, t.description)));
  for (const r of ready) {
    if (known.has(duplicateKey(r.input.date, r.input.amount, r.input.currency, r.input.description))) r.status = 'duplicate';
  }

  // 3. save
  if (!dryRun) {
    const months = new Set();
    for (const r of results) {
      if (r.status !== 'ready' && !(r.status === 'duplicate' && !skipDuplicates)) {
        if (r.status === 'duplicate') r.status = 'skipped';
        continue;
      }
      try {
        const saved = await transactionService.create(userId, r.input, ctx, { imported: true, quiet: true });
        r.status = 'imported';
        r.transactionId = saved.id;
        months.add(saved.date.slice(0, 7));
      } catch (err) {
        r.status = 'error';
        r.errors = (err.details?.length ? err.details.map((d) => `${d.field.replace(/^body\./, '')}: ${d.message}`) : [err.message]);
      }
    }
    const imported = results.filter((r) => r.status === 'imported').length;
    if (imported) {
      for (const month of months) await budgetService.checkAlerts(userId, month).catch((err) => logger.error({ err: { message: err.message } }, 'budget check after import failed'));
      await database.withTransaction((tx) => audit.append(tx, {
        userId, eventType: audit.EVENT_TYPES.DATA, action: 'TRANSACTIONS_IMPORTED', resourceType: 'transaction',
        details: { imported, skipped: results.filter((r) => r.status === 'skipped').length, failed: results.filter((r) => r.status === 'error').length }, ctx,
      }));
      await notifications.notify(userId, {
        type: 'TRANSACTION', severity: 'INFO', title: 'Transactions imported',
        message: `${imported} transaction${imported === 1 ? ' was' : 's were'} imported from a file.`,
      });
    }
  }

  const count = (status) => results.filter((r) => r.status === status).length;
  return {
    dryRun,
    summary: { total: results.length, ready: count('ready'), duplicate: count('duplicate'), error: count('error'), imported: count('imported'), skipped: count('skipped') },
    rows: results.map(({ input, ...rest }) => ({ ...rest, ...(input ? { date: input.date, amount: input.amount, currency: input.currency, type: input.type, description: input.description } : {}) })),
  };
}

module.exports = { importTransactions, MAX_ROWS };
