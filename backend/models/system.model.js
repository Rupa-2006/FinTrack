// Queries about the database itself (used by the health check).
const db = require('../config/database');

async function ping() {
  await db.ping();
}

async function getSchemaVersion() {
  const rows = await db.query('SELECT MAX(version) AS version FROM schema_migrations');
  return rows[0].version;
}

module.exports = { ping, getSchemaVersion };
