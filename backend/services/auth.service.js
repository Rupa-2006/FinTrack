// Registration, sign-in, token rotation, sign-out and password reset.
//
// Session model:
//   - access token: 15-minute JWT, returned in the response body, held in memory by the SPA
//   - refresh token: random 256-bit value in an httpOnly cookie; only its hash is stored;
//     every use replaces it (rotation). Presenting an already-used token means it was
//     copied, so the whole session is revoked.
const database = require('../config/database');
const { config } = require('../config/env');
const { LOCKOUT, PASSWORD_RESET_TTL_MINUTES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { logger } = require('../utils/logger');
const passwords = require('../security/passwords');
const tokens = require('../security/tokens');
const userModel = require('../models/user.model');
const sessionModel = require('../models/session.model');
const passwordResetModel = require('../models/passwordReset.model');
const mailService = require('./mail.service');
const securityEvents = require('./securityEvent.service');
const audit = require('./audit.service');
const mfaService = require('./mfa.service');

const { EVENTS } = securityEvents;
const { AUTH } = audit.EVENT_TYPES;
const BAD_CREDENTIALS = 'Incorrect email or password';
const SESSION_ENDED = 'Your session has ended. Please sign in again.';

function toSessionUser(row, roles) {
  return { id: row.id, fullName: row.full_name, email: row.email, baseCurrency: row.base_currency, roles };
}

function assertPasswordAllowed(password, identity, field = 'body.password') {
  const problems = passwords.contextualPasswordProblems(password, identity);
  if (problems.length) throw ApiError.validation(problems.map((message) => ({ field, message })));
}

// Opens a session row and its first refresh token inside the caller's transaction.
async function openSession(userId, ctx, tx) {
  const ttlDays = config.refreshTokenTtlDays;
  const sessionId = await sessionModel.create({ userId, ipAddress: ctx.ip, userAgent: ctx.userAgent, ttlDays }, tx);
  const refreshToken = tokens.generateOpaqueToken();
  await sessionModel.createRefreshToken({ sessionId, tokenHash: tokens.hashToken(refreshToken), ttlDays }, tx);
  return { sessionId, refreshToken };
}

async function register({ fullName, email, password, baseCurrency }, ctx) {
  assertPasswordAllowed(password, { email, fullName });
  const passwordHash = await passwords.hashPassword(password);

  let created;
  try {
    created = await database.withTransaction(async (tx) => {
      const userId = await userModel.create({ fullName, email, passwordHash, baseCurrency }, tx);
      await userModel.grantRole(userId, 'USER', tx);
      await userModel.recordSuccessfulLogin(userId, tx);
      const session = await openSession(userId, ctx, tx);
      await audit.append(tx, { userId, eventType: AUTH, action: 'ACCOUNT_REGISTERED', resourceType: 'user', resourceId: userId, details: { baseCurrency }, ctx });
      return { userId, ...session };
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw ApiError.conflict('An account with this email address already exists');
    throw err;
  }

  await securityEvents.record(EVENTS.REGISTERED, { userId: created.userId, ctx });
  return {
    user: { id: created.userId, fullName, email, baseCurrency, roles: ['USER'] },
    accessToken: tokens.signAccessToken({ userId: created.userId, sessionId: created.sessionId }),
    refreshToken: created.refreshToken,
  };
}

async function login({ email, password }, ctx) {
  const user = await userModel.findForAuthByEmail(email);

  // Unknown email and wrong password are indistinguishable: same message, similar timing.
  if (!user) {
    await passwords.verifyAgainstDecoy(password);
    await securityEvents.record(EVENTS.LOGIN_FAILED, { severity: 'WARNING', ctx, metadata: { reason: 'unknown_email' } });
    throw ApiError.unauthorized(BAD_CREDENTIALS);
  }

  // While locked, the password is not even checked, so guessing cannot continue.
  if (user.is_locked) {
    await securityEvents.record(EVENTS.LOGIN_FAILED, { userId: user.id, severity: 'WARNING', ctx, metadata: { reason: 'account_locked' } });
    const minutes = Math.max(1, Math.ceil(Number(user.lock_seconds) / 60));
    throw ApiError.locked(`Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  if (!(await passwords.verifyPassword(password, user.password_hash))) {
    const lockedNow = await userModel.recordFailedLogin(user.id, LOCKOUT);
    await securityEvents.record(EVENTS.LOGIN_FAILED, { userId: user.id, severity: 'WARNING', ctx, metadata: { reason: 'wrong_password' } });
    if (lockedNow) {
      await securityEvents.record(EVENTS.ACCOUNT_LOCKED, {
        userId: user.id, severity: 'CRITICAL', ctx, metadata: { minutes: LOCKOUT.minutes, attempts: LOCKOUT.maxAttempts },
      });
      throw ApiError.locked(`Too many failed sign-in attempts. Try again in ${LOCKOUT.minutes} minutes.`);
    }
    throw ApiError.unauthorized(BAD_CREDENTIALS);
  }

  // Only someone who knows the password learns that the account is closed.
  if (user.status !== 'ACTIVE') {
    await securityEvents.record(EVENTS.LOGIN_FAILED, { userId: user.id, severity: 'WARNING', ctx, metadata: { reason: 'account_not_active' } });
    throw ApiError.forbidden('This account is no longer active');
  }

  // With two-step sign-in on, the password alone opens no session: the browser gets a
  // short-lived challenge to complete with a code (verifyMfa below).
  if (await mfaService.isEnabled(user.id)) {
    return { mfaRequired: true, challengeToken: await mfaService.createChallenge(user.id), expiresInMinutes: mfaService.CHALLENGE_MINUTES };
  }
  return completeSignIn(user, ctx, 'password');
}

// The second step: a code from the authenticator app, or a recovery code.
async function verifyMfa({ challengeToken, code }, ctx) {
  const { userId, method } = await mfaService.verifyChallenge(challengeToken, code, ctx);
  return completeSignIn(await userModel.findById(userId), ctx, method);
}

// Everything a successful sign-in does, after the password (and second step, if any).
async function completeSignIn(user, ctx, method) {
  // Asked before the new session exists: has this account signed in from here before?
  const familiarity = await sessionModel.deviceFamiliarity(user.id, ctx);
  const session = await database.withTransaction(async (tx) => {
    await userModel.recordSuccessfulLogin(user.id, tx);
    const opened = await openSession(user.id, ctx, tx);
    await audit.append(tx, { userId: user.id, eventType: AUTH, action: 'SIGNED_IN', resourceType: 'session', resourceId: opened.sessionId, details: { method }, ctx });
    return opened;
  });
  const roles = await userModel.getRoles(user.id);

  await securityEvents.record(EVENTS.LOGIN_SUCCESS, { userId: user.id, ctx, metadata: { sessionId: session.sessionId, method } });
  if (familiarity.previousSessions > 0 && !familiarity.seenBefore) {
    await securityEvents.record(EVENTS.NEW_DEVICE_LOGIN, {
      userId: user.id, severity: 'WARNING', ctx, metadata: { sessionId: session.sessionId }, noticeData: { device: securityEvents.describeDevice(ctx.userAgent) },
    });
  }
  return {
    user: toSessionUser(user, roles),
    accessToken: tokens.signAccessToken({ userId: user.id, sessionId: session.sessionId }),
    refreshToken: session.refreshToken,
  };
}

// Exchanges a refresh token for a new access token and a new refresh token.
async function refresh(refreshToken, ctx) {
  if (!refreshToken) throw ApiError.unauthorized(SESSION_ENDED);
  const tokenHash = tokens.hashToken(refreshToken);

  // Failures are returned, not thrown, so that a revocation made here is committed.
  const outcome = await database.withTransaction(async (tx) => {
    const row = await sessionModel.findRefreshTokenForUpdate(tokenHash, tx);
    if (!row) return { failure: 'unknown' };
    if (row.revoked_at || row.session_expired || row.token_expired) return { failure: 'expired' };
    if (row.used_at) {
      await sessionModel.revoke(row.session_id, 'TOKEN_REUSE', tx);
      return { failure: 'reuse', userId: row.user_id, sessionId: row.session_id };
    }
    const user = await userModel.findById(row.user_id, tx);
    if (!user || user.status !== 'ACTIVE') {
      await sessionModel.revoke(row.session_id, 'ACCOUNT_NOT_ACTIVE', tx);
      return { failure: 'inactive' };
    }
    const ttlDays = config.refreshTokenTtlDays;
    const nextToken = tokens.generateOpaqueToken();
    const nextId = await sessionModel.createRefreshToken({ sessionId: row.session_id, tokenHash: tokens.hashToken(nextToken), ttlDays }, tx);
    await sessionModel.markRefreshTokenUsed(row.id, nextId, tx);
    await sessionModel.touch(row.session_id, ttlDays, tx);
    return { user, sessionId: row.session_id, refreshToken: nextToken };
  });

  if (outcome.failure) {
    if (outcome.failure === 'reuse') {
      await securityEvents.record(EVENTS.REFRESH_TOKEN_REUSE, {
        userId: outcome.userId, severity: 'CRITICAL', ctx, metadata: { sessionId: outcome.sessionId, action: 'session_revoked' },
      });
    }
    throw ApiError.unauthorized(SESSION_ENDED);
  }

  const roles = await userModel.getRoles(outcome.user.id);
  return {
    user: toSessionUser(outcome.user, roles),
    accessToken: tokens.signAccessToken({ userId: outcome.user.id, sessionId: outcome.sessionId }),
    refreshToken: outcome.refreshToken,
  };
}

// Always succeeds from the caller's point of view: signing out twice is not an error.
async function logout(refreshToken, ctx) {
  if (!refreshToken) return;
  const session = await sessionModel.findSessionIdByRefreshHash(tokens.hashToken(refreshToken));
  if (!session) return;
  const revoked = await database.withTransaction(async (tx) => {
    if (!(await sessionModel.revoke(session.id, 'LOGOUT', tx))) return false;
    await audit.append(tx, { userId: session.user_id, eventType: AUTH, action: 'SIGNED_OUT', resourceType: 'session', resourceId: session.id, ctx });
    return true;
  });
  if (revoked) {
    await securityEvents.record(EVENTS.LOGOUT, { userId: session.user_id, ctx, metadata: { sessionId: session.id } });
  }
}

function resetEmailText(fullName, link) {
  return [
    `Hello ${fullName},`,
    '',
    'We received a request to reset the password of your FinTrack account.',
    `Open this link within ${PASSWORD_RESET_TTL_MINUTES} minutes to choose a new password:`,
    '',
    link,
    '',
    'The link works once. If you did not ask for it, you can ignore this email: your password has not changed.',
  ].join('\n');
}

// The response is the same whether or not the address has an account.
async function requestPasswordReset({ email }, ctx) {
  const user = await userModel.findForAuthByEmail(email);
  if (!user || user.status !== 'ACTIVE') {
    await securityEvents.record(EVENTS.PASSWORD_RESET_REQUESTED, { ctx, metadata: { outcome: 'no_active_account' } });
    return;
  }

  const token = tokens.generateOpaqueToken();
  await database.withTransaction(async (tx) => {
    await passwordResetModel.invalidateForUser(user.id, tx); // only the newest link works
    await passwordResetModel.create(
      { userId: user.id, tokenHash: tokens.hashToken(token), ttlMinutes: PASSWORD_RESET_TTL_MINUTES, requestedIp: ctx.ip },
      tx
    );
  });

  // The token travels in the URL fragment, which browsers never send to a server or put
  // in a Referer header.
  const link = `${config.appPublicUrl}/reset-password#token=${token}`;
  const sending = mailService
    .send({ to: user.email, subject: 'Reset your FinTrack password', text: resetEmailText(user.full_name, link) })
    .catch((err) => logger.error({ err: { code: err.code, message: err.message } }, 'could not send password reset email'));
  // A slow SMTP server must not make this response slower for real accounts than for unknown ones.
  if (!mailService.usesSmtp()) await sending;

  await securityEvents.record(EVENTS.PASSWORD_RESET_REQUESTED, { userId: user.id, ctx, metadata: { outcome: 'email_sent' } });
}

async function resetPassword({ token, password }, ctx) {
  const tokenHash = tokens.hashToken(token);
  const userId = await database.withTransaction(async (tx) => {
    const row = await passwordResetModel.findUsableForUpdate(tokenHash, tx);
    if (!row) throw ApiError.badRequest('This reset link is invalid or has expired. Please request a new one.');
    assertPasswordAllowed(password, { email: row.email, fullName: row.full_name });
    await userModel.updatePassword(row.user_id, await passwords.hashPassword(password), tx);
    await passwordResetModel.markUsed(row.id, tx);
    await sessionModel.revokeAllForUser(row.user_id, 'PASSWORD_RESET', null, tx); // sign out everywhere
    await audit.append(tx, { userId: row.user_id, eventType: AUTH, action: 'PASSWORD_RESET', resourceType: 'user', resourceId: row.user_id, ctx });
    return row.user_id;
  });
  await securityEvents.record(EVENTS.PASSWORD_RESET_COMPLETED, { userId, severity: 'WARNING', ctx });
}

module.exports = { register, login, verifyMfa, refresh, logout, requestPasswordReset, resetPassword, assertPasswordAllowed, toSessionUser };
