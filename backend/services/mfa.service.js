// Two-step sign-in: a TOTP code from an authenticator app after the password, with
// single-use recovery codes for a lost phone.
//
//   setup    -> a new secret (encrypted at rest), shown once as a QR code / key
//   enable   -> the first correct code switches it on and returns 10 recovery codes, once
//   sign-in  -> correct password gives a 5-minute, single-use challenge instead of a session;
//               a correct code (or recovery code) for that challenge opens the session
//   disable  -> needs the password and a current code
//
// Wrong codes count towards the same account lockout as wrong passwords, and each challenge
// allows at most 5 attempts. A code is accepted once: the time step is remembered.
const database = require('../config/database');
const ApiError = require('../utils/ApiError');
const passwords = require('../security/passwords');
const tokens = require('../security/tokens');
const totp = require('../security/totp');
const { encryptField, decryptField } = require('../security/fieldCrypto');
const { LOCKOUT } = require('../config/constants');
const userModel = require('../models/user.model');
const mfaModel = require('../models/mfa.model');
const securityEvents = require('./securityEvent.service');
const audit = require('./audit.service');

const { EVENTS } = securityEvents;
const { ACCOUNT } = audit.EVENT_TYPES;
const CHALLENGE_MINUTES = 5;
const PENDING_MINUTES = 10; // an unconfirmed setup secret is reused for this long
const CHALLENGE_ATTEMPTS = 5;
const CHALLENGE_ENDED = 'This sign-in has expired. Please enter your password again.';
const WRONG_CODE = 'That code is not correct. Check the time on your phone and try again.';

const secretContext = (userId) => `user_mfa:secret_enc:${userId}`;

async function assertPassword(userId, password, field = 'body.password') {
  const hash = await userModel.findPasswordHash(userId);
  if (!hash || !(await passwords.verifyPassword(password, hash))) {
    throw ApiError.validation([{ field, message: 'Your current password is incorrect' }]);
  }
}

async function status(userId) {
  const row = await mfaModel.findByUser(userId);
  const enabled = Boolean(row?.enabled_at);
  return {
    enabled,
    enabledAt: enabled ? new Date(`${String(row.enabled_at).replace(' ', 'T')}Z`).toISOString() : null,
    recoveryCodesLeft: enabled ? await mfaModel.recoveryCodesLeft(userId) : 0,
  };
}

async function isEnabled(userId) {
  return Boolean((await mfaModel.findByUser(userId))?.enabled_at);
}

// Starts setup; nothing changes for the account until the secret is confirmed. A repeated call
// within 10 minutes returns the same pending secret (a double click, or a page that asks twice,
// must not leave the screen showing a different secret from the stored one). Calls for one user
// are serialised by locking their row.
async function beginSetup(userId) {
  const user = await userModel.findById(userId);
  const secret = await database.withTransaction(async (tx) => {
    await tx.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    const existing = await mfaModel.findPendingForUpdate(userId, PENDING_MINUTES, tx);
    if (existing?.enabled_at) throw ApiError.conflict('Two-step sign-in is already on. Turn it off first to set up a new device.');
    if (existing && existing.fresh) return decryptField(existing.secret_enc, secretContext(userId));
    const fresh = totp.generateSecret();
    await mfaModel.savePendingSecret(userId, encryptField(fresh, secretContext(userId)), tx);
    return fresh;
  });
  return { secret, otpauthUri: totp.otpauthUri({ secret, account: user.email }) };
}

async function newRecoveryCodes(userId, tx) {
  const codes = totp.generateRecoveryCodes();
  await mfaModel.replaceRecoveryCodes(userId, codes.map(totp.hashRecoveryCode), tx);
  return codes;
}

async function enable(userId, { code }, ctx) {
  const codes = await database.withTransaction(async (tx) => {
    const row = await mfaModel.findByUserForUpdate(userId, tx);
    if (!row) throw ApiError.badRequest('Start the setup first');
    if (row.enabled_at) throw ApiError.conflict('Two-step sign-in is already on');
    const step = totp.verify(decryptField(row.secret_enc, secretContext(userId)), code);
    if (step === null) throw ApiError.validation([{ field: 'body.code', message: WRONG_CODE }]);
    await mfaModel.enable(userId, step, tx);
    const created = await newRecoveryCodes(userId, tx);
    await audit.append(tx, { userId, eventType: ACCOUNT, action: 'MFA_ENABLED', resourceType: 'user', resourceId: userId, ctx });
    return created;
  });
  await securityEvents.record(EVENTS.MFA_ENABLED, { userId, ctx });
  return { enabled: true, recoveryCodes: codes };
}

// Checks a TOTP code or a recovery code against the user's (locked) MFA row.
// Returns { method, remaining? } on success, null when wrong.
async function checkSecondFactor(userId, row, code, tx) {
  const value = String(code ?? '').trim();
  if (totp.looksLikeRecoveryCode(value)) {
    if (!(await mfaModel.useRecoveryCode(userId, totp.hashRecoveryCode(value), tx))) return null;
    return { method: 'recovery_code', remaining: await mfaModel.recoveryCodesLeft(userId, tx) };
  }
  const step = totp.verify(decryptField(row.secret_enc, secretContext(userId)), value, {
    lastUsedStep: row.last_used_step === null ? null : Number(row.last_used_step),
  });
  if (step === null) return null;
  await mfaModel.setLastUsedStep(userId, step, tx);
  return { method: 'authenticator' };
}

async function disable(userId, { password, code }, ctx) {
  await assertPassword(userId, password);
  await database.withTransaction(async (tx) => {
    const row = await mfaModel.findByUserForUpdate(userId, tx);
    if (!row?.enabled_at) throw ApiError.conflict('Two-step sign-in is not on');
    if (!(await checkSecondFactor(userId, row, code, tx))) throw ApiError.validation([{ field: 'body.code', message: WRONG_CODE }]);
    await mfaModel.remove(userId, tx);
    await audit.append(tx, { userId, eventType: ACCOUNT, action: 'MFA_DISABLED', resourceType: 'user', resourceId: userId, ctx });
  });
  await securityEvents.record(EVENTS.MFA_DISABLED, { userId, severity: 'WARNING', ctx });
  return { enabled: false };
}

async function regenerateRecoveryCodes(userId, { password }, ctx) {
  await assertPassword(userId, password);
  const codes = await database.withTransaction(async (tx) => {
    const row = await mfaModel.findByUserForUpdate(userId, tx);
    if (!row?.enabled_at) throw ApiError.conflict('Two-step sign-in is not on');
    const created = await newRecoveryCodes(userId, tx);
    await audit.append(tx, { userId, eventType: ACCOUNT, action: 'MFA_RECOVERY_CODES_REGENERATED', resourceType: 'user', resourceId: userId, ctx });
    return created;
  });
  await securityEvents.record(EVENTS.MFA_RECOVERY_CODES_REGENERATED, { userId, ctx });
  return { recoveryCodes: codes };
}

// After a correct password: a challenge token instead of a session.
async function createChallenge(userId) {
  const token = tokens.generateOpaqueToken();
  await mfaModel.createChallenge(userId, tokens.hashToken(token), CHALLENGE_MINUTES);
  return token;
}

// Completes the second step. Returns the user id and how it was passed; failures are counted
// and committed before the error is thrown.
async function verifyChallenge(challengeToken, code, ctx) {
  if (!challengeToken || typeof challengeToken !== 'string') throw ApiError.unauthorized(CHALLENGE_ENDED);
  const outcome = await database.withTransaction(async (tx) => {
    const challenge = await mfaModel.findChallengeForUpdate(tokens.hashToken(challengeToken), tx);
    if (!challenge || challenge.used_at || Number(challenge.expired)) return { failure: 'ended' };
    const row = await mfaModel.findByUserForUpdate(challenge.user_id, tx);
    const user = await userModel.findById(challenge.user_id, tx);
    if (!row?.enabled_at || !user || user.status !== 'ACTIVE') {
      await mfaModel.closeChallenge(challenge.id, tx);
      return { failure: 'ended' };
    }
    const passed = await checkSecondFactor(challenge.user_id, row, code, tx);
    if (!passed) {
      await mfaModel.recordChallengeFailure(challenge.id, CHALLENGE_ATTEMPTS, tx);
      const locked = await userModel.recordFailedLogin(challenge.user_id, LOCKOUT, tx);
      return { failure: 'wrong', userId: challenge.user_id, locked, attemptsLeft: CHALLENGE_ATTEMPTS - challenge.attempts - 1 };
    }
    await mfaModel.closeChallenge(challenge.id, tx);
    return { userId: challenge.user_id, ...passed };
  });

  if (outcome.failure === 'ended') throw ApiError.unauthorized(CHALLENGE_ENDED);
  if (outcome.failure === 'wrong') {
    await securityEvents.record(EVENTS.MFA_FAILED, { userId: outcome.userId, severity: 'WARNING', ctx });
    if (outcome.locked) {
      await securityEvents.record(EVENTS.ACCOUNT_LOCKED, {
        userId: outcome.userId, severity: 'CRITICAL', ctx, metadata: { minutes: LOCKOUT.minutes, attempts: LOCKOUT.maxAttempts },
      });
      throw ApiError.locked(`Too many failed sign-in attempts. Try again in ${LOCKOUT.minutes} minutes.`);
    }
    if (outcome.attemptsLeft <= 0) throw ApiError.unauthorized(CHALLENGE_ENDED);
    throw ApiError.unauthorized(WRONG_CODE);
  }
  if (outcome.method === 'recovery_code') {
    await securityEvents.record(EVENTS.MFA_RECOVERY_CODE_USED, { userId: outcome.userId, severity: 'WARNING', ctx, metadata: { remaining: outcome.remaining } });
  }
  return { userId: outcome.userId, method: outcome.method };
}

module.exports = {
  status, isEnabled, beginSetup, enable, disable, regenerateRecoveryCodes, createChallenge, verifyChallenge,
  CHALLENGE_MINUTES, CHALLENGE_ATTEMPTS,
};
