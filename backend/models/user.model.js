// SQL for users and their roles. Functions take `db`: the pool (config/database) or a
// transaction handle, both expose query(sql, params).
const database = require('../config/database');

const PUBLIC_COLUMNS = 'id, full_name, email, phone_enc, base_currency, status, last_login_at, password_changed_at, created_at';

async function findById(id, db = database) {
  const rows = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, [id]);
  return rows[0] || null;
}

// Everything sign-in needs, including the hash. Never returned to a client.
async function findForAuthByEmail(email, db = database) {
  const rows = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash,
            (locked_until IS NOT NULL AND locked_until > NOW(3)) AS is_locked,
            TIMESTAMPDIFF(SECOND, NOW(3), locked_until) AS lock_seconds
       FROM users WHERE email = ?`,
    [email]
  );
  return rows[0] || null;
}

async function findPasswordHash(id, db = database) {
  const rows = await db.query('SELECT password_hash FROM users WHERE id = ?', [id]);
  return rows[0]?.password_hash || null;
}

async function getRoles(userId, db = database) {
  const rows = await db.query(
    'SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.name',
    [userId]
  );
  return rows.map((row) => row.name);
}

async function create({ fullName, email, passwordHash, baseCurrency }, db) {
  const result = await db.query(
    'INSERT INTO users (full_name, email, password_hash, base_currency) VALUES (?, ?, ?, ?)',
    [fullName, email, passwordHash, baseCurrency]
  );
  return result.insertId;
}

async function grantRole(userId, roleName, db) {
  await db.query('INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = ?', [userId, roleName]);
}

// Counts a wrong password. On the attempt that reaches the limit the account is locked and
// the counter starts again. MySQL evaluates SET left to right, so the second assignment
// sees the new counter value: 0 means "the limit was just reached".
async function recordFailedLogin(userId, { maxAttempts, minutes }, db = database) {
  await db.query(
    `UPDATE users
        SET failed_login_count = IF(failed_login_count + 1 >= ?, 0, failed_login_count + 1),
            locked_until = IF(failed_login_count = 0, DATE_ADD(NOW(3), INTERVAL ? MINUTE), locked_until)
      WHERE id = ?`,
    [maxAttempts, minutes, userId]
  );
  const rows = await db.query('SELECT (locked_until IS NOT NULL AND locked_until > NOW(3)) AS is_locked FROM users WHERE id = ?', [userId]);
  return Boolean(rows[0]?.is_locked);
}

async function recordSuccessfulLogin(userId, db) {
  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = ?', [userId]);
}

async function updateProfile(userId, { fullName, phoneEnc }, db = database) {
  await db.query('UPDATE users SET full_name = ?, phone_enc = ? WHERE id = ?', [fullName, phoneEnc, userId]);
}

// A new password also clears any lockout.
async function updatePassword(userId, passwordHash, db) {
  await db.query(
    'UPDATE users SET password_hash = ?, password_changed_at = NOW(3), failed_login_count = 0, locked_until = NULL WHERE id = ?',
    [passwordHash, userId]
  );
}

async function setStatus(userId, status, db) {
  await db.query('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
}

module.exports = {
  findById,
  findForAuthByEmail,
  findPasswordHash,
  getRoles,
  create,
  grantRole,
  recordFailedLogin,
  recordSuccessfulLogin,
  updateProfile,
  updatePassword,
  setStatus,
};
