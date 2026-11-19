// The signed-in user's own account: profile, password, deactivation, sessions.
// Every function takes the authenticated user id; nothing here accepts a user id from input.
const database = require('../config/database');
const ApiError = require('../utils/ApiError');
const { toIso } = require('../utils/dates');
const { logger } = require('../utils/logger');
const passwords = require('../security/passwords');
const { encryptField, decryptField } = require('../security/fieldCrypto');
const userModel = require('../models/user.model');
const sessionModel = require('../models/session.model');
const securityEvents = require('./securityEvent.service');
const { assertPasswordAllowed } = require('./auth.service');

const audit = require('./audit.service');

const { EVENTS } = securityEvents;
const { AUTH, ACCOUNT } = audit.EVENT_TYPES;
const phoneContext = (userId) => `users:phone_enc:${userId}`;

function readPhone(row) {
  try {
    return decryptField(row.phone_enc, phoneContext(row.id));
  } catch (err) {
    // A value that fails authentication is treated as absent, and reported.
    logger.error({ userId: row.id, err: { message: err.message } }, 'could not decrypt phone number');
    return null;
  }
}

async function loadProfile(userId) {
  const row = await userModel.findById(userId);
  if (!row) throw ApiError.notFound('Account not found');
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: readPhone(row),
    baseCurrency: row.base_currency,
    roles: await userModel.getRoles(userId),
    status: row.status,
    createdAt: toIso(row.created_at),
    lastLoginAt: toIso(row.last_login_at),
    passwordChangedAt: toIso(row.password_changed_at),
  };
}

function getProfile(userId) {
  return loadProfile(userId);
}

async function updateProfile(userId, { fullName, phone }, ctx) {
  const phoneEnc = phone ? encryptField(phone, phoneContext(userId)) : null;
  await database.withTransaction(async (tx) => {
    await userModel.updateProfile(userId, { fullName, phoneEnc }, tx);
    await audit.append(tx, { userId, eventType: ACCOUNT, action: 'PROFILE_UPDATED', resourceType: 'user', resourceId: userId, details: { fields: ['fullName', 'phone'] }, ctx });
  });
  // Field names only: the values themselves stay out of the event log.
  await securityEvents.record(EVENTS.PROFILE_UPDATED, { userId, ctx, metadata: { fields: ['fullName', 'phone'] } });
  return loadProfile(userId);
}

async function assertCurrentPassword(userId, password, field) {
  const hash = await userModel.findPasswordHash(userId);
  if (!hash || !(await passwords.verifyPassword(password, hash))) {
    throw ApiError.validation([{ field, message: 'Your current password is incorrect' }]);
  }
}

// Changing the password signs out every other device.
async function changePassword({ userId, sessionId }, { currentPassword, newPassword }, ctx) {
  await assertCurrentPassword(userId, currentPassword, 'body.currentPassword');
  if (currentPassword === newPassword) {
    throw ApiError.validation([{ field: 'body.newPassword', message: 'Choose a password you have not just used' }]);
  }
  const user = await userModel.findById(userId);
  assertPasswordAllowed(newPassword, { email: user.email, fullName: user.full_name }, 'body.newPassword');
  const passwordHash = await passwords.hashPassword(newPassword);

  const revoked = await database.withTransaction(async (tx) => {
    await userModel.updatePassword(userId, passwordHash, tx);
    const count = await sessionModel.revokeAllForUser(userId, 'PASSWORD_CHANGED', sessionId, tx);
    await audit.append(tx, { userId, eventType: ACCOUNT, action: 'PASSWORD_CHANGED', resourceType: 'user', resourceId: userId, details: { otherSessionsRevoked: count }, ctx });
    return count;
  });
  await securityEvents.record(EVENTS.PASSWORD_CHANGED, { userId, severity: 'WARNING', ctx, metadata: { otherSessionsRevoked: revoked } });
  return { otherSessionsRevoked: revoked };
}

// Accounts are deactivated, never deleted, so records and the audit trail stay intact.
async function deactivate({ userId, roles }, { password }, ctx) {
  if (roles.includes('ADMIN')) {
    throw ApiError.forbidden('Administrator accounts cannot deactivate themselves');
  }
  await assertCurrentPassword(userId, password, 'body.password');
  await database.withTransaction(async (tx) => {
    await userModel.setStatus(userId, 'DEACTIVATED', tx);
    await sessionModel.revokeAllForUser(userId, 'ACCOUNT_DEACTIVATED', null, tx);
    await audit.append(tx, { userId, eventType: ACCOUNT, action: 'ACCOUNT_DEACTIVATED', resourceType: 'user', resourceId: userId, ctx });
  });
  await securityEvents.record(EVENTS.ACCOUNT_DEACTIVATED, { userId, severity: 'WARNING', ctx });
}

async function listSessions({ userId, sessionId }) {
  const rows = await sessionModel.listActiveForUser(userId);
  return rows.map((row) => ({
    id: row.id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    device: securityEvents.describeDevice(row.user_agent),
    createdAt: toIso(row.created_at),
    lastUsedAt: toIso(row.last_used_at),
    expiresAt: toIso(row.expires_at),
    current: row.id === sessionId,
  }));
}

// A session id that belongs to someone else is "not found", so ids cannot be probed.
async function revokeSession({ userId }, targetSessionId, ctx) {
  const revoked = await database.withTransaction(async (tx) => {
    if (!(await sessionModel.revokeOwned(targetSessionId, userId, 'REVOKED_BY_USER', tx))) return false;
    await audit.append(tx, { userId, eventType: AUTH, action: 'SESSION_REVOKED', resourceType: 'session', resourceId: targetSessionId, ctx });
    return true;
  });
  if (!revoked) throw ApiError.notFound('Session not found');
  await securityEvents.record(EVENTS.SESSION_REVOKED, { userId, ctx, metadata: { sessionId: targetSessionId } });
}

async function revokeOtherSessions({ userId, sessionId }, ctx) {
  const revoked = await database.withTransaction(async (tx) => {
    const count = await sessionModel.revokeAllForUser(userId, 'REVOKED_BY_USER', sessionId, tx);
    if (count) await audit.append(tx, { userId, eventType: AUTH, action: 'OTHER_SESSIONS_REVOKED', resourceType: 'session', details: { count }, ctx });
    return count;
  });
  if (revoked) await securityEvents.record(EVENTS.SESSION_REVOKED, { userId, ctx, metadata: { count: revoked, scope: 'all_other_sessions' } });
  return { revoked };
}

// The user's own sign-in history and security events.
async function listSecurityEvents(userId, { page, pageSize, eventType }) {
  return securityEvents.list({ userId, eventType, page, pageSize });
}

// The user's own audit trail.
async function listActivity(userId, { page, pageSize, eventType }) {
  return audit.list({ userId, eventType, page, pageSize });
}

module.exports = {
  getProfile, updateProfile, changePassword, deactivate, listSessions, revokeSession, revokeOtherSessions, listSecurityEvents, listActivity,
};
