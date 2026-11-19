// SQL for budgets, always scoped by user_id. period_month is the first day of the month.
const database = require('../config/database');

const COLUMNS = `b.id, b.budget_type, b.category_id, DATE_FORMAT(b.period_month, '%Y-%m') AS month, b.amount, b.alert_threshold_pct,
  c.name AS category_name, c.color AS category_color`;
const FROM = 'FROM budgets b LEFT JOIN categories c ON c.id = b.category_id';

async function listForMonth(userId, month, db = database) {
  return db.query(
    `SELECT ${COLUMNS} ${FROM} WHERE b.user_id = ? AND b.period_month = ?
      ORDER BY FIELD(b.budget_type, 'OVERALL', 'SAVINGS_TARGET', 'CATEGORY'), c.name`,
    [userId, `${month}-01`]
  );
}

async function findOwned(id, userId, db = database) {
  const rows = await db.query(`SELECT ${COLUMNS} ${FROM} WHERE b.id = ? AND b.user_id = ?`, [id, userId]);
  return rows[0] || null;
}

async function create(userId, { budgetType, categoryId, month, amount, alertThresholdPct }, db = database) {
  const result = await db.query(
    'INSERT INTO budgets (user_id, budget_type, category_id, period_month, amount, alert_threshold_pct) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, budgetType, categoryId ?? null, `${month}-01`, amount, alertThresholdPct]
  );
  return result.insertId;
}

async function update(id, userId, { amount, alertThresholdPct }, db = database) {
  await db.query('UPDATE budgets SET amount = ?, alert_threshold_pct = ? WHERE id = ? AND user_id = ?', [amount, alertThresholdPct, id, userId]);
}

async function remove(id, userId, db = database) {
  const result = await db.query('DELETE FROM budgets WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
}

// Copies every budget of one month into another, skipping scopes that already exist there.
async function copyMonth(userId, fromMonth, toMonth, db = database) {
  const result = await db.query(
    `INSERT IGNORE INTO budgets (user_id, budget_type, category_id, period_month, amount, alert_threshold_pct)
     SELECT user_id, budget_type, category_id, ?, amount, alert_threshold_pct FROM budgets WHERE user_id = ? AND period_month = ?`,
    [`${toMonth}-01`, userId, `${fromMonth}-01`]
  );
  return result.affectedRows;
}

async function listAllForUpdate(userId, db) {
  return db.query('SELECT id, amount FROM budgets WHERE user_id = ? FOR UPDATE', [userId]);
}

async function setAmount(id, amount, db) {
  await db.query('UPDATE budgets SET amount = ? WHERE id = ?', [amount, id]);
}

module.exports = { listForMonth, findOwned, create, update, remove, copyMonth, listAllForUpdate, setAmount };
