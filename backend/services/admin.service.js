// Administration: account management and security monitoring.
//
// Every change an administrator makes is written to the audit trail in the same database
// transaction, naming the administrator (user_id) and the account changed (resource_id).
// Administrators cannot change their own status or roles, and the last active
// administrator cannot be removed, so the system cannot be left without one.
const database = require('../config/database');
const ApiError = require('../utils/ApiError');
const { toIso } = require('../utils/dates');
const adminModel = require('../models/admin.model');
const userModel = require('../models/user.model');
const sessionModel = require('../models/session.model');
const audit = require('./audit.service');
const securityEvents = require('./securityEvent.service');

const { ADMIN } = audit.EVENT_TYPES;
const { EVENTS } = securityEvents;
const n = (value) => Number(value ?? 0);

async function overview() {
  const { users, sessions, usage, security, suspiciousIps } = await adminModel.overview();
  return {
    users: {
      total: n(users.total), active: n(users.active), suspended: n(users.suspended), deactivated: n(users.deactivated),
      newLast30Days: n(users.new30d), activeLast7Days: n(users.activeLast7d), lockedNow: n(users.lockedNow),
    },
    activeSessions: n(sessions.active),
    usage: { transactions: n(usage.transactions), transactionsLast30Days: n(usage.transactions30d), budgets: n(usage.budgets), savingsGoals: n(usage.goals) },
    security: {
      signInsLast24h: n(security.logins24h), failedSignInsLast24h: n(security.failedLogins24h),
      criticalEventsLast7Days: n(security.critical7d), warningsLast7Days: n(security.warnings7d),
    },
    suspiciousIps: suspiciousIps.map((row) => ({ ipAddress: row.ip_address, failures: n(row.failures), accounts: n(row.accounts), lastSeen: toIso(row.last_seen) })),
  };
}

function toUserDto(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    roles: row.roles ? String(row.roles).split(',') : [],
    baseCurrency: row.base_currency,
    locked: Boolean(row.is_locked),
    failedLoginCount: row.failed_login_count,
    activeSessions: n(row.active_sessions),
    lastLoginAt: toIso(row.last_login_at),
    createdAt: toIso(row.created_at),
  };
}

async function listUsers(query) {
  const { rows, totalItems } = await adminModel.listUsers(query);
  return { items: rows.map(toUserDto), totalItems };
}

async function requireOtherUser(admin, targetId) {
  if (targetId === admin.userId) throw ApiError.forbidden('You cannot change your own account here');
  const target = await adminModel.findUser(targetId);
  if (!target) throw ApiError.notFound('User not found');
  return target;
}

// Suspending ends every session at once; reactivating lets the user sign in again.
async function setStatus(admin, targetId, { status }, ctx) {
  const target = await requireOtherUser(admin, targetId);
  if (target.status === 'DEACTIVATED') throw ApiError.conflict('This account was closed by its owner and cannot be changed');
  if (target.status === status) return toUserDto(target);
  if (status === 'SUSPENDED' && String(target.roles || '').split(',').includes('ADMIN') && (await adminModel.countAdmins()) <= 1) {
    throw ApiError.conflict('This is the last active administrator');
  }
  await database.withTransaction(async (tx) => {
    await userModel.setStatus(targetId, status, tx);
    if (status === 'SUSPENDED') await sessionModel.revokeAllForUser(targetId, 'SUSPENDED_BY_ADMIN', null, tx);
    await audit.append(tx, {
      userId: admin.userId, eventType: ADMIN, action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
      resourceType: 'user', resourceId: targetId, details: { from: target.status, to: status }, ctx,
    });
  });
  await securityEvents.record(status === 'SUSPENDED' ? EVENTS.ACCOUNT_SUSPENDED : EVENTS.ACCOUNT_REACTIVATED, {
    userId: targetId, severity: 'WARNING', ctx, metadata: { byAdmin: admin.userId },
  });
  return toUserDto(await adminModel.findUser(targetId));
}

async function setRole(admin, targetId, { role, granted }, ctx) {
  const target = await requireOtherUser(admin, targetId);
  if (!granted && role === 'ADMIN' && (await adminModel.countAdmins()) <= 1) throw ApiError.conflict('This is the last active administrator');
  if (!granted && role === 'USER') throw ApiError.badRequest('Every account keeps the USER role');
  const changed = await database.withTransaction(async (tx) => {
    const done = granted ? await adminModel.grantRole(targetId, role, admin.userId, tx) : await adminModel.revokeRole(targetId, role, tx);
    if (done) {
      await audit.append(tx, {
        userId: admin.userId, eventType: ADMIN, action: granted ? 'ROLE_GRANTED' : 'ROLE_REVOKED', resourceType: 'user', resourceId: targetId, details: { role }, ctx,
      });
    }
    return done;
  });
  if (changed) {
    await securityEvents.record(granted ? EVENTS.ROLE_GRANTED : EVENTS.ROLE_REVOKED, {
      userId: target.id, severity: 'WARNING', ctx, metadata: { role, byAdmin: admin.userId },
    });
  }
  return toUserDto(await adminModel.findUser(targetId));
}

async function unlock(admin, targetId, ctx) {
  await requireOtherUser(admin, targetId);
  await database.withTransaction(async (tx) => {
    await adminModel.unlock(targetId, tx);
    await audit.append(tx, { userId: admin.userId, eventType: ADMIN, action: 'USER_UNLOCKED', resourceType: 'user', resourceId: targetId, ctx });
  });
  await securityEvents.record(EVENTS.ACCOUNT_UNLOCKED, { userId: targetId, ctx, metadata: { byAdmin: admin.userId } });
  return toUserDto(await adminModel.findUser(targetId));
}

function listSecurityEvents(query) {
  return securityEvents.list(query, { includeUser: true });
}

function listAuditLogs(query) {
  return audit.list(query, { includeUser: true });
}

// Running the check is itself recorded, so the trail shows when it was last verified.
async function verifyAuditChain(admin, ctx) {
  const result = await audit.verifyChain();
  await audit.record({
    userId: admin.userId, eventType: ADMIN, action: 'AUDIT_CHAIN_VERIFIED', resourceType: 'audit_log',
    details: { valid: result.valid, checkedRows: result.checkedRows, brokenAtId: result.brokenAtId ?? null }, ctx,
  });
  return result;
}

module.exports = { overview, listUsers, setStatus, setRole, unlock, listSecurityEvents, listAuditLogs, verifyAuditChain };
