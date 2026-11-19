// SQL for savings goals and their contributions, always scoped by user_id.
const database = require('../config/database');

const COLUMNS = 'id, title, target_amount, saved_amount, currency_code, deadline, notes_enc, status, created_at, updated_at';

async function list(userId, db = database) {
  return db.query(
    `SELECT ${COLUMNS} FROM savings_goals WHERE user_id = ?
      ORDER BY FIELD(status, 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'), (deadline IS NULL), deadline, id`,
    [userId]
  );
}

async function findOwned(id, userId, db = database, { forUpdate = false } = {}) {
  const rows = await db.query(`SELECT ${COLUMNS} FROM savings_goals WHERE id = ? AND user_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id, userId]);
  return rows[0] || null;
}

async function create(userId, { title, targetAmount, currency, deadline, notesEnc }, db = database) {
  const result = await db.query(
    'INSERT INTO savings_goals (user_id, title, target_amount, currency_code, deadline, notes_enc) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, title, targetAmount, currency, deadline, notesEnc]
  );
  return result.insertId;
}

async function update(id, userId, { title, targetAmount, deadline, notesEnc, status }, db = database) {
  await db.query(
    'UPDATE savings_goals SET title = ?, target_amount = ?, deadline = ?, notes_enc = ?, status = ? WHERE id = ? AND user_id = ?',
    [title, targetAmount, deadline, notesEnc, status, id, userId]
  );
}

async function setSaved(id, savedAmount, status, db) {
  await db.query('UPDATE savings_goals SET saved_amount = ?, status = ? WHERE id = ?', [savedAmount, status, id]);
}

async function addContribution(goalId, userId, { amount, date }, db) {
  await db.query('INSERT INTO goal_contributions (goal_id, user_id, amount, contributed_on) VALUES (?, ?, ?, ?)', [goalId, userId, amount, date]);
}

async function listContributions(goalId, userId, db = database) {
  return db.query(
    'SELECT id, amount, contributed_on FROM goal_contributions WHERE goal_id = ? AND user_id = ? ORDER BY contributed_on DESC, id DESC LIMIT 100',
    [goalId, userId]
  );
}

// Contributions go with the goal (ON DELETE CASCADE).
async function remove(id, userId, db = database) {
  const result = await db.query('DELETE FROM savings_goals WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
}

module.exports = { list, findOwned, create, update, setSaved, addContribution, listContributions, remove };
