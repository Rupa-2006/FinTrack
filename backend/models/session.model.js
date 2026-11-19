// SQL for login sessions and their rotating refresh tokens.
const database = require('../config/database');

async function create({ userId, ipAddress, userAgent, ttlDays }, db) {
  const result = await db.query(
    'INSERT INTO user_sessions (user_id, ip_address, user_agent, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? DAY))',
    [userId, ipAddress, userAgent, ttlDays]
  );
  return result.insertId;
}

async function createRefreshToken({ sessionId, tokenHash, ttlDays }, db) {
  const result = await db.query(
    'INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL ? DAY))',
    [sessionId, tokenHash, ttlDays]
  );
  return result.insertId;
}

// Locks the token row so two requests presenting the same token cannot both rotate it.
async function findRefreshTokenForUpdate(tokenHash, db) {
  const rows = await db.query(
    `SELECT rt.id, rt.session_id, rt.used_at, (rt.expires_at <= NOW(3)) AS token_expired,
            s.user_id, s.revoked_at, (s.expires_at <= NOW(3)) AS session_expired
       FROM refresh_tokens rt JOIN user_sessions s ON s.id = rt.session_id
      WHERE rt.token_hash = ? FOR UPDATE`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function markRefreshTokenUsed(id, replacedBy, db) {
  await db.query('UPDATE refresh_tokens SET used_at = NOW(3), replaced_by = ? WHERE id = ?', [replacedBy, id]);
}

// Each refresh pushes the idle timeout out again.
async function touch(sessionId, ttlDays, db) {
  await db.query('UPDATE user_sessions SET last_used_at = NOW(3), expires_at = DATE_ADD(NOW(3), INTERVAL ? DAY) WHERE id = ?', [ttlDays, sessionId]);
}

async function revoke(sessionId, reason, db = database) {
  const result = await db.query(
    'UPDATE user_sessions SET revoked_at = NOW(3), revoke_reason = ? WHERE id = ? AND revoked_at IS NULL',
    [reason, sessionId]
  );
  return result.affectedRows > 0;
}

async function revokeOwned(sessionId, userId, reason, db = database) {
  const result = await db.query(
    'UPDATE user_sessions SET revoked_at = NOW(3), revoke_reason = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > NOW(3)',
    [reason, sessionId, userId]
  );
  return result.affectedRows > 0;
}

// exceptSessionId = null revokes every session of the user.
async function revokeAllForUser(userId, reason, exceptSessionId = null, db = database) {
  const result = await db.query(
    'UPDATE user_sessions SET revoked_at = NOW(3), revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?',
    [reason, userId, exceptSessionId ?? 0]
  );
  return result.affectedRows;
}

async function findSessionIdByRefreshHash(tokenHash, db = database) {
  const rows = await db.query(
    'SELECT s.id, s.user_id FROM refresh_tokens rt JOIN user_sessions s ON s.id = rt.session_id WHERE rt.token_hash = ?',
    [tokenHash]
  );
  return rows[0] || null;
}

// Who an access token belongs to, checked on every request: the session must still be
// live and the account active. Roles come from the database, not from the token, so a
// role change or a revoked session takes effect immediately.
async function findPrincipal(sessionId, userId, db = database) {
  const rows = await db.query(
    `SELECT u.id,
            (SELECT GROUP_CONCAT(r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles
       FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > NOW(3) AND u.status = 'ACTIVE'`,
    [sessionId, userId]
  );
  if (!rows[0]) return null;
  return { userId: rows[0].id, roles: rows[0].roles ? String(rows[0].roles).split(',') : [] };
}

// How many sessions the user has had, and whether one came from this IP address and
// browser. Used to warn about sign-ins from somewhere new.
async function deviceFamiliarity(userId, { ip, userAgent }, db = database) {
  const [row] = await db.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(ip_address <=> ? AND user_agent <=> ?), 0) AS same
       FROM user_sessions WHERE user_id = ?`,
    [ip ?? null, userAgent ?? null, userId]
  );
  return { previousSessions: Number(row.total), seenBefore: Number(row.same) > 0 };
}

async function listActiveForUser(userId, db = database) {
  return db.query(
    `SELECT id, ip_address, user_agent, created_at, last_used_at, expires_at
       FROM user_sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW(3)
      ORDER BY last_used_at DESC`,
    [userId]
  );
}

module.exports = {
  create,
  createRefreshToken,
  findRefreshTokenForUpdate,
  markRefreshTokenUsed,
  touch,
  revoke,
  revokeOwned,
  revokeAllForUser,
  findSessionIdByRefreshHash,
  findPrincipal,
  deviceFamiliarity,
  listActiveForUser,
};
