// SQL for notifications, always scoped by user_id.
const database = require('../config/database');

// The unique (user_id, dedupe_key) index makes repeated alerts a no-op.
async function create(userId, { type, severity = 'INFO', title, message, dedupeKey = null }, db = database) {
  const result = await db.query(
    'INSERT IGNORE INTO notifications (user_id, type, severity, title, message, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, type, severity, title, message, dedupeKey]
  );
  return result.affectedRows > 0;
}

async function list(userId, { page, pageSize, unreadOnly }, db = database) {
  const where = `user_id = ?${unreadOnly ? ' AND read_at IS NULL' : ''}`;
  const limit = Number.parseInt(pageSize, 10);
  const offset = (Number.parseInt(page, 10) - 1) * limit;
  const rows = await db.query(
    `SELECT id, type, severity, title, message, read_at, created_at FROM notifications WHERE ${where}
      ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
    [userId]
  );
  const [count] = await db.query(`SELECT COUNT(*) AS total FROM notifications WHERE ${where}`, [userId]);
  return { rows, totalItems: count.total };
}

async function unreadCount(userId, db = database) {
  const [row] = await db.query('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]);
  return row.total;
}

async function markRead(id, userId, db = database) {
  const result = await db.query('UPDATE notifications SET read_at = COALESCE(read_at, NOW(3)) WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
}

async function markAllRead(userId, db = database) {
  const result = await db.query('UPDATE notifications SET read_at = NOW(3) WHERE user_id = ? AND read_at IS NULL', [userId]);
  return result.affectedRows;
}

async function remove(id, userId, db = database) {
  const result = await db.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
}

module.exports = { create, list, unreadCount, markRead, markAllRead, remove };
