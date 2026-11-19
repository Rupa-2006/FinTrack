// SQL for two-step sign-in: the encrypted TOTP secret, recovery-code hashes, sign-in challenges.
const database = require('../config/database');

async function findByUser(userId, db = database) {
  const [row] = await db.query('SELECT id, user_id, secret_enc, enabled_at, last_used_step FROM user_mfa WHERE user_id = ?', [userId]);
  return row ?? null;
}

async function findByUserForUpdate(userId, tx) {
  const [row] = await tx.query('SELECT id, user_id, secret_enc, enabled_at, last_used_step FROM user_mfa WHERE user_id = ? FOR UPDATE', [userId]);
  return row ?? null;
}

// The user's MFA row, with `fresh` = an unconfirmed secret created within `minutes`.
async function findPendingForUpdate(userId, minutes, tx) {
  const [row] = await tx.query(
    `SELECT id, secret_enc, enabled_at, (enabled_at IS NULL AND created_at > DATE_SUB(NOW(3), INTERVAL ? MINUTE)) AS fresh
       FROM user_mfa WHERE user_id = ? FOR UPDATE`,
    [minutes, userId]
  );
  return row ? { ...row, fresh: Boolean(Number(row.fresh)) } : null;
}

// Starting setup again replaces a stale unconfirmed secret; a confirmed one is never overwritten here.
async function savePendingSecret(userId, secretEnc, db = database) {
  await db.query(
    `INSERT INTO user_mfa (user_id, secret_enc) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE secret_enc = IF(enabled_at IS NULL, VALUES(secret_enc), secret_enc),
                             created_at = IF(enabled_at IS NULL, NOW(3), created_at),
                             last_used_step = IF(enabled_at IS NULL, NULL, last_used_step)`,
    [userId, secretEnc]
  );
}

async function enable(userId, step, tx) {
  await tx.query('UPDATE user_mfa SET enabled_at = NOW(3), last_used_step = ? WHERE user_id = ? AND enabled_at IS NULL', [step, userId]);
}

async function setLastUsedStep(userId, step, tx) {
  await tx.query('UPDATE user_mfa SET last_used_step = ? WHERE user_id = ?', [step, userId]);
}

async function remove(userId, tx) {
  await tx.query('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
  await tx.query('DELETE FROM mfa_challenges WHERE user_id = ?', [userId]);
  await tx.query('DELETE FROM user_mfa WHERE user_id = ?', [userId]);
}

async function replaceRecoveryCodes(userId, hashes, tx) {
  await tx.query('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
  for (const hash of hashes) await tx.query('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)', [userId, hash]);
}

// Marks the code used if it is a valid, unused code of this user. Returns true when it was.
async function useRecoveryCode(userId, hash, tx) {
  const result = await tx.query('UPDATE mfa_recovery_codes SET used_at = NOW(3) WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', [userId, hash]);
  return result.affectedRows === 1;
}

async function recoveryCodesLeft(userId, db = database) {
  const [row] = await db.query('SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL', [userId]);
  return Number(row.n);
}

async function createChallenge(userId, tokenHash, minutes, db = database) {
  await db.query('INSERT INTO mfa_challenges (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL ? MINUTE))', [userId, tokenHash, minutes]);
}

async function findChallengeForUpdate(tokenHash, tx) {
  const [row] = await tx.query(
    `SELECT id, user_id, attempts, used_at, expires_at <= NOW(3) AS expired
       FROM mfa_challenges WHERE token_hash = ? FOR UPDATE`,
    [tokenHash]
  );
  return row ?? null;
}

async function recordChallengeFailure(id, maxAttempts, tx) {
  // MySQL applies SET assignments left to right: `attempts` below is already the new count.
  await tx.query('UPDATE mfa_challenges SET attempts = attempts + 1, used_at = IF(attempts >= ?, NOW(3), used_at) WHERE id = ?', [maxAttempts, id]);
}

async function closeChallenge(id, tx) {
  await tx.query('UPDATE mfa_challenges SET used_at = NOW(3) WHERE id = ?', [id]);
}

module.exports = {
  findByUser, findByUserForUpdate, findPendingForUpdate, savePendingSecret, enable, setLastUsedStep, remove,
  replaceRecoveryCodes, useRecoveryCode, recoveryCodesLeft,
  createChallenge, findChallengeForUpdate, recordChallengeFailure, closeChallenge,
};
