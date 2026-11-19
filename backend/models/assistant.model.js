// What the AI service may see, read for one user at a time.
// Deliberately narrow columns: no notes, no ids other than the transaction's own, nothing
// about the account. Amounts are base_amount, already in the user's main currency.
const database = require('../config/database');

const MONTHS_OF_HISTORY = 13;
const MAX_ROWS = 20000;

async function transactionsFor(userId, db = database) {
  return db.query(
    `SELECT t.id, t.txn_date, t.type, t.base_amount, c.name AS category, t.description
       FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.base_amount > 0
        AND t.txn_date >= DATE_SUB(UTC_DATE(), INTERVAL ${MONTHS_OF_HISTORY} MONTH)
      ORDER BY t.txn_date, t.id
      LIMIT ${MAX_ROWS}`,
    [userId]
  );
}

module.exports = { transactionsFor, MONTHS_OF_HISTORY };
