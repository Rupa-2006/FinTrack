// SQL for the admin dashboard.
//
// Privacy boundary: administrators see account metadata, aggregate counts, security events
// and audit metadata. Nothing in this file selects a column from transactions, budgets or
// savings_goals rows (only COUNT(*) totals across all users), and no query returns another
// user's amounts, descriptions or notes.
const database = require('../config/database');

async function overview(db = database) {
  const [users] = await db.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(status = 'ACTIVE'), 0) AS active,
            COALESCE(SUM(status = 'SUSPENDED'), 0) AS suspended,
            COALESCE(SUM(status = 'DEACTIVATED'), 0) AS deactivated,
            COALESCE(SUM(created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)), 0) AS new30d,
            COALESCE(SUM(last_login_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY)), 0) AS activeLast7d,
            COALESCE(SUM(locked_until > NOW(3)), 0) AS lockedNow
       FROM users`
  );
  const [sessions] = await db.query('SELECT COUNT(*) AS active FROM user_sessions WHERE revoked_at IS NULL AND expires_at > NOW(3)');
  const [usage] = await db.query(
    `SELECT (SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL) AS transactions,
            (SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL AND created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)) AS transactions30d,
            (SELECT COUNT(*) FROM budgets) AS budgets,
            (SELECT COUNT(*) FROM savings_goals) AS goals`
  );
  const [security] = await db.query(
    `SELECT COALESCE(SUM(event_type = 'LOGIN_FAILED' AND created_at >= DATE_SUB(NOW(3), INTERVAL 1 DAY)), 0) AS failedLogins24h,
            COALESCE(SUM(event_type = 'LOGIN_SUCCESS' AND created_at >= DATE_SUB(NOW(3), INTERVAL 1 DAY)), 0) AS logins24h,
            COALESCE(SUM(severity = 'CRITICAL' AND created_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY)), 0) AS critical7d,
            COALESCE(SUM(severity = 'WARNING' AND created_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY)), 0) AS warnings7d
       FROM security_events WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY)`
  );
  // Addresses with many failed sign-ins in the last day: possible password guessing.
  const suspiciousIps = await db.query(
    `SELECT ip_address, COUNT(*) AS failures, COUNT(DISTINCT user_id) AS accounts, MAX(created_at) AS last_seen
       FROM security_events
      WHERE event_type = 'LOGIN_FAILED' AND created_at >= DATE_SUB(NOW(3), INTERVAL 1 DAY) AND ip_address IS NOT NULL
      GROUP BY ip_address HAVING COUNT(*) >= 5
      ORDER BY failures DESC LIMIT 10`
  );
  return { users, sessions, usage, security, suspiciousIps };
}

const USER_COLUMNS = `u.id, u.full_name, u.email, u.status, u.base_currency, u.failed_login_count,
  (u.locked_until IS NOT NULL AND u.locked_until > NOW(3)) AS is_locked, u.last_login_at, u.created_at,
  (SELECT GROUP_CONCAT(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
  (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > NOW(3)) AS active_sessions`;

async function listUsers({ search, status, role, page, pageSize }, db = database) {
  const where = ['1 = 1'];
  const params = [];
  if (search) {
    where.push("(u.email LIKE ? ESCAPE '!' OR u.full_name LIKE ? ESCAPE '!')");
    const pattern = `%${search.replace(/[!%_]/g, '!$&')}%`;
    params.push(pattern, pattern);
  }
  if (status) {
    where.push('u.status = ?');
    params.push(status);
  }
  if (role) {
    where.push('EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = ?)');
    params.push(role);
  }
  const limit = Number.parseInt(pageSize, 10);
  const offset = (Number.parseInt(page, 10) - 1) * limit;
  const rows = await db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const [count] = await db.query(`SELECT COUNT(*) AS total FROM users u WHERE ${where.join(' AND ')}`, params);
  return { rows, totalItems: count.total };
}

async function findUser(id, db = database) {
  const rows = await db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?`, [id]);
  return rows[0] || null;
}

async function countAdmins(db = database) {
  const [row] = await db.query(
    "SELECT COUNT(*) AS total FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE r.name = 'ADMIN' AND u.status = 'ACTIVE'"
  );
  return row.total;
}

async function grantRole(userId, roleName, grantedBy, db) {
  const result = await db.query('INSERT IGNORE INTO user_roles (user_id, role_id, granted_by) SELECT ?, id, ? FROM roles WHERE name = ?', [userId, grantedBy, roleName]);
  return result.affectedRows > 0;
}

async function revokeRole(userId, roleName, db) {
  const result = await db.query('DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = ?', [userId, roleName]);
  return result.affectedRows > 0;
}

async function unlock(userId, db) {
  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?', [userId]);
}

module.exports = { overview, listUsers, findUser, countAdmins, grantRole, revokeRole, unlock };
