// Security events: sign-ins, failures, lockouts, password and session changes, refused access.
// Metadata holds reasons and ids only: never passwords, tokens or keys.
//
// Events the account holder must know about also raise an in-app notification.
// Recording must not break the request it describes, so a failed insert is logged and
// swallowed.
const database = require('../config/database');
const securityEventModel = require('../models/securityEvent.model');
const notificationModel = require('../models/notification.model');
const { toIso } = require('../utils/dates');
const { logger } = require('../utils/logger');

const EVENTS = Object.freeze({
  REGISTERED: 'REGISTERED',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  NEW_DEVICE_LOGIN: 'NEW_DEVICE_LOGIN',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  LOGOUT: 'LOGOUT',
  REFRESH_TOKEN_REUSE: 'REFRESH_TOKEN_REUSE',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_REACTIVATED: 'ACCOUNT_REACTIVATED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  ROLE_GRANTED: 'ROLE_GRANTED',
  ROLE_REVOKED: 'ROLE_REVOKED',
  BASE_CURRENCY_CHANGED: 'BASE_CURRENCY_CHANGED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  MFA_ENABLED: 'MFA_ENABLED',
  MFA_DISABLED: 'MFA_DISABLED',
  MFA_FAILED: 'MFA_FAILED',
  MFA_RECOVERY_CODE_USED: 'MFA_RECOVERY_CODE_USED',
  MFA_RECOVERY_CODES_REGENERATED: 'MFA_RECOVERY_CODES_REGENERATED',
});

// What the account holder is told, and how urgently.
const USER_NOTICES = {
  NEW_DEVICE_LOGIN: {
    severity: 'WARNING', title: 'New sign-in to your account',
    message: (m) => `Your account was signed in to from a device or network not seen before (${m.device}, IP ${m.ip}). If this was not you, change your password and end that session on the Security page.`,
  },
  ACCOUNT_LOCKED: {
    severity: 'CRITICAL', title: 'Your account was locked',
    message: (m) => `After ${m.attempts} wrong passwords in a row, sign-in is blocked for ${m.minutes} minutes. If this was not you, consider changing your password.`,
  },
  REFRESH_TOKEN_REUSE: {
    severity: 'CRITICAL', title: 'A session was ended for your protection',
    message: () => 'An old sign-in token was used again, which can mean it was copied. That session has been ended. If you did not expect this, change your password.',
  },
  PASSWORD_CHANGED: {
    severity: 'WARNING', title: 'Your password was changed',
    message: () => 'Your password was changed and your other devices were signed out. If this was not you, reset your password now.',
  },
  PASSWORD_RESET_COMPLETED: {
    severity: 'WARNING', title: 'Your password was reset',
    message: () => 'Your password was reset with an emailed link and every device was signed out. If this was not you, contact support.',
  },
  ROLE_GRANTED: {
    severity: 'WARNING', title: 'Your account permissions changed',
    message: (m) => `An administrator gave your account the ${m.role} role.`,
  },
  ROLE_REVOKED: {
    severity: 'INFO', title: 'Your account permissions changed',
    message: (m) => `An administrator removed the ${m.role} role from your account.`,
  },
  ACCOUNT_REACTIVATED: {
    severity: 'INFO', title: 'Your account was reactivated',
    message: () => 'An administrator lifted the suspension on your account.',
  },
  MFA_ENABLED: {
    severity: 'INFO', title: 'Two-step sign-in is on',
    message: () => 'Signing in now needs a code from your authenticator app as well as your password. Keep your recovery codes somewhere safe.',
  },
  MFA_DISABLED: {
    severity: 'WARNING', title: 'Two-step sign-in was turned off',
    message: () => 'Your account is protected by your password only. If this was not you, change your password and turn two-step sign-in on again.',
  },
  MFA_RECOVERY_CODE_USED: {
    severity: 'WARNING', title: 'A recovery code was used to sign in',
    message: (m) => `A recovery code was used instead of an authenticator code (${m.remaining} left). If this was not you, change your password and create new recovery codes on the Security page.`,
  },
  MFA_RECOVERY_CODES_REGENERATED: {
    severity: 'INFO', title: 'New recovery codes created',
    message: () => 'Your previous recovery codes no longer work.',
  },
};

// ctx = { ip, userAgent, requestId } from the request (see utils/requestMeta).
// noticeData fills in the notification text and is never stored with the event.
async function record(eventType, { userId = null, severity = 'INFO', ctx = {}, metadata, noticeData } = {}) {
  try {
    await securityEventModel.insert({ userId, eventType, severity, ipAddress: ctx.ip, userAgent: ctx.userAgent, metadata });
    const notice = USER_NOTICES[eventType];
    if (notice && userId) {
      await notificationModel.create(userId, {
        type: 'SECURITY', severity: notice.severity, title: notice.title,
        message: notice.message({ ip: ctx.ip ?? 'unknown', ...metadata, ...noticeData }),
      });
    }
  } catch (err) {
    logger.error({ err: { code: err.code, message: err.message }, eventType }, 'could not record security event');
  }
}

// "Chrome on Windows" from a user-agent string; only for display.
function describeDevice(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'an unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : /curl|node|axios|python|postman/i.test(ua) ? 'a script or API client' : 'a browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return os ? `${browser} on ${os}` : browser;
}

function toDto(row, { includeUser = false } = {}) {
  const dto = {
    id: row.id,
    eventType: row.event_type,
    severity: row.severity,
    ipAddress: row.ip_address,
    device: row.user_agent ? describeDevice(row.user_agent) : null,
    metadata: row.metadata,
    createdAt: toIso(row.created_at),
  };
  if (includeUser) Object.assign(dto, { userId: row.user_id, userEmail: row.email ?? null });
  return dto;
}

// A page of events, newest first. userId limits it to one account.
async function list({ userId, eventType, severity, page, pageSize }, { includeUser = false } = {}, db = database) {
  const where = ['1 = 1'];
  const params = [];
  const add = (clause, value) => {
    where.push(clause);
    params.push(value);
  };
  if (userId) add('e.user_id = ?', userId);
  if (eventType) add('e.event_type = ?', eventType);
  if (severity) add('e.severity = ?', severity);
  const limit = Number.parseInt(pageSize, 10);
  const offset = (Number.parseInt(page, 10) - 1) * limit;
  const rows = await db.query(
    `SELECT e.id, e.user_id, e.event_type, e.severity, e.ip_address, e.user_agent, e.metadata, e.created_at, u.email
       FROM security_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [count] = await db.query(`SELECT COUNT(*) AS total FROM security_events e WHERE ${where.join(' AND ')}`, params);
  return { items: rows.map((row) => toDto(row, { includeUser })), totalItems: count.total };
}

module.exports = { record, list, describeDevice, EVENTS };
