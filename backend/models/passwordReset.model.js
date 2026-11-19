// SQL for single-use password reset tokens (stored as SHA-256 hashes).
async function invalidateForUser(userId, db) {
  await db.query('UPDATE password_reset_tokens SET used_at = NOW(3) WHERE user_id = ? AND used_at IS NULL', [userId]);
}

async function create({ userId, tokenHash, ttlMinutes, requestedIp }, db) {
  await db.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL ? MINUTE), ?)',
    [userId, tokenHash, ttlMinutes, requestedIp]
  );
}

// Returns the token only if it is unused, unexpired and belongs to an active account.
async function findUsableForUpdate(tokenHash, db) {
  const rows = await db.query(
    `SELECT t.id, t.user_id, u.email, u.full_name
       FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > NOW(3) AND u.status = 'ACTIVE'
        FOR UPDATE`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function markUsed(id, db) {
  await db.query('UPDATE password_reset_tokens SET used_at = NOW(3) WHERE id = ?', [id]);
}

module.exports = { invalidateForUser, create, findUsableForUpdate, markUsed };
