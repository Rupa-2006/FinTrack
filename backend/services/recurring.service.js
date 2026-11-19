// Recurring transactions: rules that create an income or expense every week, month or year.
//
// There is no background job (free hosting sleeps idle services). Due occurrences are
// created when the user next opens their transactions, dashboard or recurring rules, and when
// a rule is created or resumed; a rule that starts in the past catches up then. Each
// occurrence goes through the normal transaction path: currency conversion at that day's rate,
// audit row, budget alerts and a confirmation. The database's unique key on (rule, date)
// guarantees an occurrence is created once, even if two requests run at the same time.
const database = require('../config/database');
const ApiError = require('../utils/ApiError');
const { logger } = require('../utils/logger');
const { toIso } = require('../utils/dates');
const { Decimal, assertCurrencyPrecision } = require('../utils/money');
const { today, addDays, addMonths, monthRange } = require('../utils/period');
const recurringModel = require('../models/recurring.model');
const categoryService = require('./category.service');
const transactionService = require('./transaction.service');
const notifications = require('./notification.service');
const audit = require('./audit.service');

const { DATA } = audit.EVENT_TYPES;
const MAX_PER_RUN = 400; // a weekly rule started a year ago is 53 occurrences
const OLDEST_START_DAYS = 366;

// Occurrence `index` of a rule starting on `start` ("YYYY-MM-DD").
function occurrence(start, frequency, index) {
  if (frequency === 'WEEKLY') return addDays(start, 7 * index);
  const [year, month, day] = start.split('-').map(Number);
  const target = frequency === 'MONTHLY'
    ? addMonths(start.slice(0, 7), index)
    : `${year + index}-${String(month).padStart(2, '0')}`;
  const lastDay = Number(monthRange(target).end.slice(8));
  return `${target}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function status(row) {
  if (row.paused) return 'PAUSED';
  if (row.end_date && row.next_date > row.end_date) return 'FINISHED';
  return 'ACTIVE';
}

function toDto(row) {
  const state = status(row);
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    currency: row.currency_code,
    description: row.description,
    paymentMethod: row.payment_method,
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    nextDate: state === 'FINISHED' ? null : row.next_date,
    status: state,
    category: { id: row.category_id, name: row.category_name, color: row.category_color },
    generatedCount: Number(row.generated_count),
    lastGeneratedDate: row.last_generated_date,
    createdAt: toIso(row.created_at),
  };
}

async function validate(userId, input) {
  await categoryService.requireUsable(userId, input.categoryId, input.type);
  assertCurrencyPrecision(input.amount, input.currency, 'body.amount');
}

// Creates every due occurrence for the user. Never throws: problems are logged, and the user
// is told once per occurrence when one could not be created (for example an archived category).
async function generateDue(userId, ctx = {}) {
  let created = 0;
  try {
    const now = today();
    for (const rule of await recurringModel.due(userId, now)) {
      let index = Number(rule.next_index);
      let date = rule.next_date;
      let made = 0;
      while (date <= now && (!rule.end_date || date <= rule.end_date) && made < MAX_PER_RUN) {
        try {
          await transactionService.create(userId, {
            type: rule.type, categoryId: rule.category_id, amount: rule.amount, currency: rule.currency_code,
            date, description: rule.description, paymentMethod: rule.payment_method, notes: null,
          }, { ...ctx, requestId: ctx.requestId ?? 'recurring' }, { recurringRuleId: rule.id });
          created += 1;
        } catch (err) {
          if (err.code !== 'ER_DUP_ENTRY') {
            // Stop at this occurrence and try again next time; the user hears about it once.
            logger.warn({ ruleId: rule.id, err: { message: err.message } }, 'recurring occurrence could not be created');
            await notifications.notify(userId, {
              type: 'SYSTEM', severity: 'WARNING', title: 'A recurring transaction was not created',
              message: `"${rule.description}" due on ${date} could not be recorded: ${err.message}. Edit the recurring rule to fix it.`,
              dedupeKey: `recurring-failed:${rule.id}:${date}`,
            });
            break;
          }
        }
        made += 1;
        index += 1;
        date = occurrence(rule.start_date, rule.frequency, index);
      }
      if (index !== Number(rule.next_index)) await recurringModel.advance(rule.id, Number(rule.next_index), index, date);
    }
  } catch (err) {
    logger.error({ err: { message: err.message } }, 'recurring generation failed');
  }
  return created;
}

async function list(userId, ctx) {
  await generateDue(userId, ctx);
  return (await recurringModel.list(userId)).map(toDto);
}

async function getOwned(userId, id) {
  const row = await recurringModel.findOwned(id, userId);
  if (!row) throw ApiError.notFound('Recurring transaction not found');
  return row;
}

async function create(userId, input, ctx = {}) {
  await validate(userId, input);
  if (input.startDate < addDays(today(), -OLDEST_START_DAYS)) {
    throw ApiError.validation([{ field: 'body.startDate', message: 'Start within the last year' }]);
  }
  const rule = { ...input, amount: new Decimal(input.amount).toFixed(2) };
  const id = await database.withTransaction(async (tx) => {
    const newId = await recurringModel.create(userId, rule, tx);
    await audit.append(tx, {
      userId, eventType: DATA, action: 'RECURRING_CREATED', resourceType: 'recurring_rule', resourceId: newId, details: { frequency: input.frequency }, ctx,
    });
    return newId;
  });
  const generated = await generateDue(userId, ctx);
  return { rule: toDto(await getOwned(userId, id)), generated };
}

async function update(userId, id, input, ctx = {}) {
  const existing = await getOwned(userId, id);
  await validate(userId, input);
  if (input.endDate && input.endDate < existing.start_date) {
    throw ApiError.validation([{ field: 'body.endDate', message: 'End on or after the start date' }]);
  }
  const next = { ...input, amount: new Decimal(input.amount).toFixed(2) };
  const before = {
    type: existing.type, categoryId: existing.category_id, amount: existing.amount, currency: existing.currency_code,
    description: existing.description, paymentMethod: existing.payment_method, endDate: existing.end_date, paused: Boolean(existing.paused),
  };
  const fields = Object.keys(before).filter((key) => String(before[key] ?? '') !== String(next[key] ?? ''));
  await database.withTransaction(async (tx) => {
    await recurringModel.update(id, userId, next, tx);
    await audit.append(tx, { userId, eventType: DATA, action: 'RECURRING_UPDATED', resourceType: 'recurring_rule', resourceId: id, details: { fields }, ctx });
  });
  const generated = next.paused ? 0 : await generateDue(userId, ctx);
  return { rule: toDto(await getOwned(userId, id)), generated };
}

// Removes the rule only: transactions it already created stay, unlinked.
async function remove(userId, id, ctx = {}) {
  await getOwned(userId, id);
  await database.withTransaction(async (tx) => {
    await recurringModel.remove(id, userId, tx);
    await audit.append(tx, { userId, eventType: DATA, action: 'RECURRING_DELETED', resourceType: 'recurring_rule', resourceId: id, ctx });
  });
}

module.exports = { list, create, update, remove, generateDue, occurrence };
