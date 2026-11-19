// Read-only aggregate SQL. All totals use base_amount (the user's main currency), ignore
// soft-deleted rows and are scoped by user_id. Date ranges are inclusive.
const database = require('../config/database');

const SCOPE = 'user_id = ? AND deleted_at IS NULL AND txn_date >= ? AND txn_date <= ?';

async function totalsByType(userId, from, to, db = database) {
  const rows = await db.query(
    `SELECT type, COALESCE(SUM(base_amount), 0) AS total, COUNT(*) AS entries FROM transactions WHERE ${SCOPE} GROUP BY type`,
    [userId, from, to]
  );
  const result = { income: '0.00', expense: '0.00', incomeCount: 0, expenseCount: 0 };
  for (const row of rows) {
    if (row.type === 'INCOME') Object.assign(result, { income: row.total, incomeCount: row.entries });
    else Object.assign(result, { expense: row.total, expenseCount: row.entries });
  }
  return result;
}

async function byCategory(userId, from, to, type, db = database) {
  return db.query(
    `SELECT c.id AS category_id, c.name, c.color, SUM(t.base_amount) AS total, COUNT(*) AS entries
       FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.txn_date >= ? AND t.txn_date <= ? AND t.type = ?
      GROUP BY c.id, c.name, c.color
      ORDER BY total DESC`,
    [userId, from, to, type]
  );
}

async function byMonth(userId, from, to, db = database) {
  return db.query(
    `SELECT DATE_FORMAT(txn_date, '%Y-%m') AS month, type, SUM(base_amount) AS total
       FROM transactions WHERE ${SCOPE}
      GROUP BY DATE_FORMAT(txn_date, '%Y-%m'), type`,
    [userId, from, to]
  );
}

async function byDay(userId, from, to, db = database) {
  return db.query(
    `SELECT txn_date AS day, type, SUM(base_amount) AS total FROM transactions WHERE ${SCOPE} GROUP BY txn_date, type ORDER BY txn_date`,
    [userId, from, to]
  );
}

async function byPaymentMethod(userId, from, to, db = database) {
  return db.query(
    `SELECT payment_method, SUM(base_amount) AS total, COUNT(*) AS entries
       FROM transactions WHERE ${SCOPE} AND type = 'EXPENSE' GROUP BY payment_method ORDER BY total DESC`,
    [userId, from, to]
  );
}

async function largestExpenses(userId, from, to, limit, db = database) {
  return db.query(
    `SELECT t.id, t.description, t.txn_date, t.base_amount, c.name AS category_name
       FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.txn_date >= ? AND t.txn_date <= ? AND t.type = 'EXPENSE'
      ORDER BY t.base_amount DESC, t.id DESC LIMIT ${Number.parseInt(limit, 10)}`,
    [userId, from, to]
  );
}

module.exports = { totalsByType, byCategory, byMonth, byDay, byPaymentMethod, largestExpenses };
