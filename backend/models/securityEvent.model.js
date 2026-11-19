// SQL for security events. The application account can only INSERT and SELECT here.
const database = require('../config/database');

async function insert({ userId, eventType, severity, ipAddress, userAgent, metadata }, db = database) {
  await db.query(
    'INSERT INTO security_events (user_id, event_type, severity, ip_address, user_agent, metadata) VALUES (?, ?, ?, ?, ?, ?)',
    [userId ?? null, eventType, severity, ipAddress ?? null, userAgent ?? null, metadata ? JSON.stringify(metadata) : null]
  );
}

module.exports = { insert };
