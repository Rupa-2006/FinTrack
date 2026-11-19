// Shared connection helper for command-line scripts and schema tests.
// The API itself uses a pool in config/ (Phase 3); scripts need one-off connections
// under a specific MySQL account.
const path = require('path');
const mysql = require('mysql2/promise');
const { dbSslOptions } = require('../../config/dbSsl');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const ACCOUNTS = {
  app: { user: 'DB_USER', password: 'DB_PASSWORD' },
  migrator: { user: 'DB_MIGRATOR_USER', password: 'DB_MIGRATOR_PASSWORD' },
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.startsWith('replace_with')) {
    throw new Error(`${name} is not set in backend/.env (run "npm run init:env" first)`);
  }
  return value;
}

function databaseName({ test = false } = {}) {
  const name = requireEnv('DB_NAME');
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('DB_NAME may only contain letters, digits and _');
  return test ? `${name}_test` : name;
}

async function connect(account, { test = false, multipleStatements = false } = {}) {
  const keys = ACCOUNTS[account];
  if (!keys) throw new Error(`Unknown account "${account}"`);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: requireEnv(keys.user),
    password: requireEnv(keys.password),
    database: databaseName({ test }),
    ssl: dbSslOptions(process.env) ?? undefined,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true, // DATE/DATETIME as strings: no silent timezone shifts
    decimalNumbers: false, // DECIMAL as strings: no float rounding of money
    multipleStatements,
  });
  await connection.query("SET time_zone = '+00:00'");
  return connection;
}

module.exports = { connect, databaseName, requireEnv };
