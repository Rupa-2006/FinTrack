// SQL for currencies and exchange-rate snapshots.
// A rate row means: 1 unit of base_currency = rate units of quote_currency.
// Snapshots are never updated; the application account can only INSERT and SELECT them.
const database = require('../config/database');

async function listCurrencies(db = database) {
  return db.query('SELECT code, name, symbol, decimal_places FROM currencies WHERE is_active = TRUE ORDER BY code');
}

// The newest snapshot dated on or before `date`.
async function findOnOrBefore(from, to, date, db = database) {
  const rows = await db.query(
    `SELECT id, rate, rate_date, source FROM exchange_rates
      WHERE base_currency = ? AND quote_currency = ? AND rate_date <= ?
      ORDER BY rate_date DESC LIMIT 1`,
    [from, to, date]
  );
  return rows[0] || null;
}

async function findEarliest(from, to, db = database) {
  const rows = await db.query(
    'SELECT id, rate, rate_date, source FROM exchange_rates WHERE base_currency = ? AND quote_currency = ? ORDER BY rate_date ASC LIMIT 1',
    [from, to]
  );
  return rows[0] || null;
}

// A pair and date that already has a snapshot is left as it is.
async function insertSnapshot({ from, to, rate, rateDate, source }, db = database) {
  await db.query(
    'INSERT IGNORE INTO exchange_rates (base_currency, quote_currency, rate, rate_date, source) VALUES (?, ?, ?, ?, ?)',
    [from, to, rate, rateDate, source]
  );
}

async function latestForBase(base, db = database) {
  return db.query(
    `SELECT r.quote_currency, r.rate, r.rate_date, r.source
       FROM exchange_rates r
       JOIN (SELECT quote_currency, MAX(rate_date) AS newest FROM exchange_rates WHERE base_currency = ? GROUP BY quote_currency) m
         ON m.quote_currency = r.quote_currency AND m.newest = r.rate_date
      WHERE r.base_currency = ?
      ORDER BY r.quote_currency`,
    [base, base]
  );
}

module.exports = { listCurrencies, findOnOrBefore, findEarliest, insertSnapshot, latestForBase };
