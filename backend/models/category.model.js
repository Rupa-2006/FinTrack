// SQL for categories. A category with user_id NULL is a system default visible to everyone;
// any other category is visible only to its owner.
const database = require('../config/database');

const COLUMNS = 'id, user_id, name, type, color, is_archived';

async function listVisible(userId, { type, includeArchived } = {}, db = database) {
  const where = ['(user_id IS NULL OR user_id = ?)'];
  const params = [userId];
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  if (!includeArchived) where.push('is_archived = FALSE');
  return db.query(`SELECT ${COLUMNS} FROM categories WHERE ${where.join(' AND ')} ORDER BY type, (user_id IS NULL) DESC, name`, params);
}

async function findVisible(id, userId, db = database) {
  const rows = await db.query(`SELECT ${COLUMNS} FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)`, [id, userId]);
  return rows[0] || null;
}

async function findOwned(id, userId, db = database) {
  const rows = await db.query(`SELECT ${COLUMNS} FROM categories WHERE id = ? AND user_id = ?`, [id, userId]);
  return rows[0] || null;
}

async function nameTaken(userId, name, type, exceptId = 0, db = database) {
  const rows = await db.query(
    'SELECT id FROM categories WHERE (user_id IS NULL OR user_id = ?) AND name = ? AND type = ? AND id <> ? LIMIT 1',
    [userId, name, type, exceptId]
  );
  return rows.length > 0;
}

async function create(userId, { name, type, color }, db = database) {
  const result = await db.query('INSERT INTO categories (user_id, name, type, color) VALUES (?, ?, ?, ?)', [userId, name, type, color]);
  return result.insertId;
}

async function update(id, userId, { name, color }, db = database) {
  await db.query('UPDATE categories SET name = ?, color = ? WHERE id = ? AND user_id = ?', [name, color, id, userId]);
}

async function isInUse(id, db = database) {
  const rows = await db.query(
    'SELECT (EXISTS (SELECT 1 FROM transactions WHERE category_id = ?) OR EXISTS (SELECT 1 FROM budgets WHERE category_id = ?)) AS used',
    [id, id]
  );
  return Boolean(rows[0].used);
}

async function archive(id, userId, db = database) {
  await db.query('UPDATE categories SET is_archived = TRUE WHERE id = ? AND user_id = ?', [id, userId]);
}

async function remove(id, userId, db = database) {
  await db.query('DELETE FROM categories WHERE id = ? AND user_id = ?', [id, userId]);
}

module.exports = { listVisible, findVisible, findOwned, nameTaken, create, update, isInUse, archive, remove };
