// Schemas for the money features: categories, transactions, budgets, goals, currencies,
// analytics, reports and notifications.
const { z } = require('zod');
const fields = require('./common');

const TXN_TYPES = ['INCOME', 'EXPENSE'];
const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'WALLET', 'OTHER'];
const BUDGET_TYPES = ['CATEGORY', 'OVERALL', 'SAVINGS_TARGET'];

const txnType = z.enum(TXN_TYPES, { error: 'Type must be INCOME or EXPENSE' });
const idParams = z.object({ id: fields.id });
const flag = z.enum(['true', 'false']).optional().transform((value) => value === 'true');
const page = z.coerce.number().int().min(1).max(100000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(20);

const dateRange = (shape) =>
  z.object(shape).refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The start date must not be after the end date',
    path: ['from'],
  });

// ---- categories
const color = z.union([z.null(), z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Colour must look like #1E2E57')]).optional().transform((v) => v || null);
const categoryBody = z.object({ name: fields.text(50, 'Enter a category name'), type: txnType, color });
const categoryUpdate = z.object({ name: fields.text(50, 'Enter a category name'), color });
const categoryQuery = z.object({ type: txnType.optional(), includeArchived: flag });

// ---- transactions
const transactionBody = z.object({
  type: txnType,
  categoryId: fields.id,
  amount: fields.money,
  currency: fields.currencyCode,
  date: fields.pastOrPresentDate,
  description: fields.text(255, 'Enter a description'),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: 'Choose a payment method' }).default('OTHER'),
  notes: fields.optionalText(2000),
});

const transactionQuery = dateRange({
  page,
  pageSize,
  type: txnType.optional(),
  categoryId: fields.id.optional(),
  from: fields.isoDate.optional(),
  to: fields.isoDate.optional(),
  minAmount: fields.money.optional(),
  maxAmount: fields.money.optional(),
  search: z.string().trim().max(100).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  currency: fields.currencyCode.optional(),
  foreignOnly: flag,
  sort: z.enum(['date', 'amount', 'created']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// ---- budgets
const threshold = z.coerce.number({ error: 'Enter a percentage' }).int('Use a whole number').min(1, 'Minimum is 1').max(100, 'Maximum is 100').default(80);
const budgetBody = z
  .object({
    budgetType: z.enum(BUDGET_TYPES, { error: 'Choose a budget type' }),
    categoryId: fields.id.nullish(),
    month: fields.month,
    amount: fields.money,
    alertThresholdPct: threshold,
  })
  .refine((value) => (value.budgetType === 'CATEGORY') === Boolean(value.categoryId), {
    message: 'Choose a category for a category budget (and none for the others)',
    path: ['categoryId'],
  });
const budgetUpdate = z.object({ amount: fields.money, alertThresholdPct: threshold });
const budgetQuery = z.object({ month: fields.month.optional() });
const budgetCopy = z.object({ fromMonth: fields.month, toMonth: fields.month }).refine((v) => v.fromMonth !== v.toMonth, {
  message: 'Choose two different months',
  path: ['toMonth'],
});

// ---- savings goals
const deadline = z.union([z.null(), z.literal(''), fields.isoDate]).optional().transform((value) => value || null);
const goalBody = z.object({
  title: fields.text(100, 'Enter a title'),
  targetAmount: fields.money,
  currency: fields.currencyCode,
  deadline,
  notes: fields.optionalText(2000),
});
const goalUpdate = z.object({
  title: fields.text(100, 'Enter a title'),
  targetAmount: fields.money,
  deadline,
  notes: fields.optionalText(2000),
  status: z.enum(['IN_PROGRESS', 'CANCELLED']).optional(),
});
const contributionBody = z.object({ amount: fields.signedMoney, date: fields.pastOrPresentDate });

// ---- currencies
const ratesQuery = z.object({ base: fields.currencyCode.optional() });
const convertQuery = z.object({ amount: fields.money, from: fields.currencyCode, to: fields.currencyCode });
const baseCurrencyBody = z.object({ baseCurrency: fields.currencyCode });

// ---- analytics and reports
const periodQuery = dateRange({ from: fields.isoDate.optional(), to: fields.isoDate.optional(), month: fields.month.optional() });
const monthlyQuery = z.object({ months: z.coerce.number().int().min(1).max(24).default(6), until: fields.month.optional() });
const categoriesQuery = dateRange({
  from: fields.isoDate.optional(), to: fields.isoDate.optional(), month: fields.month.optional(), type: txnType.default('EXPENSE'),
});
const monthQuery = z.object({ month: fields.month.optional() });
const exportQuery = dateRange({ from: fields.isoDate.optional(), to: fields.isoDate.optional(), type: txnType.optional() });

// ---- notifications
const notificationQuery = z.object({ page, pageSize, unreadOnly: flag });

// ---- recurring transactions
const FREQUENCIES = ['WEEKLY', 'MONTHLY', 'YEARLY'];
const endDate = z.union([z.null(), z.literal(''), fields.isoDate]).optional().transform((value) => value || null);
const recurringFields = {
  type: txnType,
  categoryId: fields.id,
  amount: fields.money,
  currency: fields.currencyCode,
  description: fields.text(255, 'Enter a description'),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: 'Choose a payment method' }).default('OTHER'),
  endDate,
};
const recurringBody = z
  .object({ ...recurringFields, frequency: z.enum(FREQUENCIES, { error: 'Choose how often' }), startDate: fields.isoDate })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: 'End on or after the start date', path: ['endDate'] });
const recurringUpdate = z.object({ ...recurringFields, paused: z.boolean().default(false) });

// ---- import: rows are checked one by one in the service, so one bad line never fails the request
const cell = z.union([z.string().max(2000), z.number(), z.null()]);
const importBody = z.object({
  rows: z.array(z.record(z.string().max(40), cell), { error: 'Send the rows to import' }).min(1, 'The file has no rows').max(500, 'Send at most 500 rows at a time'),
  dryRun: z.boolean().default(true),
  skipDuplicates: z.boolean().default(true),
  fallbackCategories: z.object({ EXPENSE: fields.id.optional(), INCOME: fields.id.optional() }).default({}),
});

module.exports = {
  importBody, recurringBody, recurringUpdate,
  TXN_TYPES, PAYMENT_METHODS, BUDGET_TYPES,
  idParams,
  categoryBody, categoryUpdate, categoryQuery,
  transactionBody, transactionQuery,
  budgetBody, budgetUpdate, budgetQuery, budgetCopy,
  goalBody, goalUpdate, contributionBody,
  ratesQuery, convertQuery, baseCurrencyBody,
  periodQuery, monthlyQuery, categoriesQuery, monthQuery, exportQuery,
  notificationQuery,
};
