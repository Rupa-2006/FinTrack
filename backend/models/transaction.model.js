// SQL for transactions. Every query is scoped by user_id: there is no function here that
// reads or changes a transaction without naming its owner.
const database = require('../config/database');

const COLUMNS = `t.id, t.type, t.amount, t.currency_code, t.base_currency, t.exchange_rate, t.exchange_rate_id, t.base_amount,
  t.description, t.notes_enc, t.payment_method, t.recurring_rule_id, t.txn_date, t.created_at, t.updated_at,
  t.category_id, c.name AS category_name, c.color AS category_color`;
const FROM = 'FROM transactions t JOIN categories c ON c.id = t.category_id';

// Column names come from this fixed list, never from the request.
const SORT_COLUMNS = { date: 't.txn_date', amount: 't.base_amount', created: 't.created_at' };

function buildFilters(userId, filters = {}) {
  const where = ['t.user_id = ?', 't.deleted_at IS NULL'];
  const params = [userId];
  const add = (clause, value) => {
    where.push(clause);
    params.push(value);
  };
  if (filters.type) add('t.type = ?', filters.type);
  if (filters.categoryId) add('t.category_id = ?', filters.categoryId);
  if (filters.from) add('t.txn_date >= ?', filters.from);
  if (filters.to) add('t.txn_date <= ?', filters.to);
  if (filters.minAmount) add('t.base_amount >= ?', filters.minAmount);
  if (filters.maxAmount) add('t.base_amount <= ?', filters.maxAmount);
  if (filters.paymentMethod) add('t.payment_method = ?', filters.paymentMethod);
  if (filters.currency) add('t.currency_code = ?', filters.currency);
  if (filters.foreignOnly) where.push('t.currency_code <> t.base_currency');
  // "!" escapes the LIKE wildcards, so a search for "50%" finds a literal percent sign.
  if (filters.search) add("t.description LIKE ? ESCAPE '!'", `%${filters.search.replace(/[!%_]/g, '!$&')}%`);
  return { where: where.join(' AND '), params };
}

async function list(userId, filters, { page, pageSize, sort = 'date', order = 'desc' }, db = database) {
  const { where, params } = buildFilters(userId, filters);
  const direction = order === 'asc' ? 'ASC' : 'DESC';
  // page and pageSize are validated integers; they are inlined because MySQL prepared
  // statements do not accept bound parameters for LIMIT reliably.
  const limit = Number.parseInt(pageSize, 10);
  const offset = (Number.parseInt(page, 10) - 1) * limit;
  const rows = await db.query(
    `SELECT ${COLUMNS} ${FROM} WHERE ${where} ORDER BY ${SORT_COLUMNS[sort]} ${direction}, t.id ${direction} LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [count] = await db.query(`SELECT COUNT(*) AS total FROM transactions t WHERE ${where}`, params);
  return { rows, totalItems: count.total };
}

async function findOwned(id, userId, db = database) {
  const rows = await db.query(`SELECT ${COLUMNS} ${FROM} WHERE t.id = ? AND t.user_id = ? AND t.deleted_at IS NULL`, [id, userId]);
  return rows[0] || null;
}

async function create(userId, t, db = database) {
  const result = await db.query(
    `INSERT INTO transactions (user_id, category_id, type, amount, currency_code, base_currency, exchange_rate, exchange_rate_id,
                               base_amount, description, notes_enc, payment_method, recurring_rule_id, txn_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, t.categoryId, t.type, t.amount, t.currency, t.baseCurrency, t.exchangeRate, t.exchangeRateId, t.baseAmount,
      t.description, t.notesEnc, t.paymentMethod, t.recurringRuleId ?? null, t.date]
  );
  return result.insertId;
}

async function update(id, userId, t, db = database) {
  await db.query(
    `UPDATE transactions
        SET category_id = ?, type = ?, amount = ?, currency_code = ?, base_currency = ?, exchange_rate = ?, exchange_rate_id = ?,
            base_amount = ?, description = ?, notes_enc = ?, payment_method = ?, txn_date = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [t.categoryId, t.type, t.amount, t.currency, t.baseCurrency, t.exchangeRate, t.exchangeRateId, t.baseAmount,
      t.description, t.notesEnc, t.paymentMethod, t.date, id, userId]
  );
}

// Soft delete: the row stays for the audit trail but disappears from every list and total.
async function softDelete(id, userId, db = database) {
  const result = await db.query('UPDATE transactions SET deleted_at = NOW(3) WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, userId]);
  return result.affectedRows > 0;
}

// Typical spending in a category over the 90 days before `date`, excluding one transaction.
async function categoryBaseline(userId, categoryId, date, exceptId, db = database) {
  const [row] = await db.query(
    `SELECT COUNT(*) AS samples, COALESCE(AVG(base_amount), 0) AS average
       FROM transactions
      WHERE user_id = ? AND category_id = ? AND type = 'EXPENSE' AND deleted_at IS NULL AND id <> ?
        AND txn_date >= DATE_SUB(?, INTERVAL 90 DAY) AND txn_date <= ?`,
    [userId, categoryId, exceptId, date, date]
  );
  return { samples: row.samples, average: row.average };
}

// For re-converting after a change of base currency (includes soft-deleted rows so they
// stay consistent).
async function listForReconversion(userId, db) {
  return db.query('SELECT id, amount, currency_code, txn_date FROM transactions WHERE user_id = ? FOR UPDATE', [userId]);
}

async function setConversion(id, { baseCurrency, exchangeRate, exchangeRateId, baseAmount }, db) {
  await db.query('UPDATE transactions SET base_currency = ?, exchange_rate = ?, exchange_rate_id = ?, base_amount = ? WHERE id = ?', [
    baseCurrency, exchangeRate, exchangeRateId, baseAmount, id,
  ]);
}

// Up to `limit` rows for CSV export, oldest first.
async function listForExport(userId, filters, limit, db = database) {
  const { where, params } = buildFilters(userId, filters);
  return db.query(`SELECT ${COLUMNS} ${FROM} WHERE ${where} ORDER BY t.txn_date ASC, t.id ASC LIMIT ${Number.parseInt(limit, 10)}`, params);
}

// Existing entries on the given dates, for duplicate detection during an import.
async function onDates(userId, dates, db = database) {
  if (!dates.length) return [];
  return db.query(
    `SELECT txn_date, amount, currency_code, description FROM transactions
      WHERE user_id = ? AND deleted_at IS NULL AND txn_date IN (${dates.map(() => '?').join(', ')})`,
    [userId, ...dates]
  );
}

module.exports = { onDates, list, findOwned, create, update, softDelete, categoryBaseline, listForReconversion, setConversion, listForExport };
