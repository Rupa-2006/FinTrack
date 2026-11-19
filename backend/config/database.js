// MySQL connection pool for the API. Connects as the least-privilege application account.
//
// Rules for everything that talks to the database:
//   - values always travel as bound parameters (`?`), never by string concatenation
//   - DECIMAL and DATE come back as strings, so money is never a JavaScript float
//   - multi-step changes go through withTransaction()
const mysql = require('mysql2/promise');
const { config } = require('./env');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  connectionLimit: config.db.poolSize,
  ssl: config.db.ssl ?? undefined, // TLS with certificate verification when DB_SSL=true
  waitForConnections: true,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true,
  decimalNumbers: false,
  multipleStatements: false, // one statement per call: closes a whole class of injection
  namedPlaceholders: false,
});

// Every physical connection works in UTC.
pool.pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

// Prepared statement on any pooled connection. Returns the rows (or the result header).
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// Runs `work(tx)` inside one database transaction. `tx.query` has the same signature as
// query(). Commits when work resolves, rolls back when it throws.
async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const tx = {
      query: async (sql, params = []) => (await connection.execute(sql, params))[0],
    };
    const result = await work(tx);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function ping() {
  await pool.query('SELECT 1');
}

async function close() {
  await pool.end();
}

module.exports = { query, withTransaction, ping, close };
