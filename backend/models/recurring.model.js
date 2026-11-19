// SQL for recurring transaction rules. Every query is scoped to the owner.
const database = require('../config/database');

const COLUMNS = `r.id, r.user_id, r.category_id, c.name AS category_name, c.color AS category_color, r.type, r.amount, r.currency_code,
  r.description, r.payment_method, r.frequency, r.start_date, r.end_date, r.next_index, r.next_date, r.paused,
  r.last_run_at, r.created_at, r.updated_at,
  (SELECT COUNT(*) FROM transactions t WHERE t.recurring_rule_id = r.id AND t.deleted_at IS NULL) AS generated_count,
  (SELECT MAX(t.txn_date) FROM transactions t WHERE t.recurring_rule_id = r.id AND t.deleted_at IS NULL) AS last_generated_date`;
const FROM = 'FROM recurring_rules r JOIN categories c ON c.id = r.category_id';

const list = (userId, db = database) => db.query(`SELECT ${COLUMNS} ${FROM} WHERE r.user_id = ? ORDER BY r.paused, r.next_date, r.id`, [userId]);

async function findOwned(id, userId, db = database) {
  const [row] = await db.query(`SELECT ${COLUMNS} ${FROM} WHERE r.id = ? AND r.user_id = ?`, [id, userId]);
  return row ?? null;
}

// Rules with an occurrence due on or before `today`.
const due = (userId, today, db = database) => db.query(
  `SELECT r.id, r.category_id, r.type, r.amount, r.currency_code, r.description, r.payment_method, r.frequency,
          r.start_date, r.end_date, r.next_index, r.next_date
     FROM recurring_rules r
    WHERE r.user_id = ? AND r.paused = 0 AND r.next_date <= ? AND (r.end_date IS NULL OR r.next_date <= r.end_date)`,
  [userId, today]
);

async function create(userId, r, db = database) {
  const result = await db.query(
    `INSERT INTO recurring_rules (user_id, category_id, type, amount, currency_code, description, payment_method, frequency, start_date, end_date, next_index, next_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [userId, r.categoryId, r.type, r.amount, r.currency, r.description, r.paymentMethod, r.frequency, r.startDate, r.endDate, r.startDate]
  );
  return result.insertId;
}

async function update(id, userId, r, db = database) {
  await db.query(
    `UPDATE recurring_rules SET category_id = ?, type = ?, amount = ?, currency_code = ?, description = ?, payment_method = ?, end_date = ?, paused = ?
      WHERE id = ? AND user_id = ?`,
    [r.categoryId, r.type, r.amount, r.currency, r.description, r.paymentMethod, r.endDate, r.paused ? 1 : 0, id, userId]
  );
}

// Moves the rule on to the next occurrence still to create. The `next_index = ?` condition
// makes two simultaneous runs advance it only once.
async function advance(id, fromIndex, toIndex, nextDate, db = database) {
  await db.query(
    'UPDATE recurring_rules SET next_index = ?, next_date = ?, last_run_at = NOW(3) WHERE id = ? AND next_index = ?',
    [toIndex, nextDate, id, fromIndex]
  );
}

async function remove(id, userId, db = database) {
  const result = await db.query('DELETE FROM recurring_rules WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows === 1;
}

module.exports = { list, findOwned, due, create, update, advance, remove };
