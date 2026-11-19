// Changing the user's main (base) currency.
//
// Original amounts and currencies are never touched. What changes is the derived value of
// each transaction in the main currency, which is recalculated with the rate snapshot that
// applied on the transaction's own date. Budgets, which are amounts in the main currency,
// are converted at the latest rate. Everything happens in one database transaction.
const database = require('../config/database');
const ApiError = require('../utils/ApiError');
const { convert } = require('../utils/money');
const userModel = require('../models/user.model');
const transactionModel = require('../models/transaction.model');
const budgetModel = require('../models/budget.model');
const fxService = require('./fx.service');
const securityEvents = require('./securityEvent.service');
const audit = require('./audit.service');

async function changeBaseCurrency(userId, { baseCurrency }, ctx) {
  const user = await userModel.findById(userId);
  if (user.base_currency === baseCurrency) return { baseCurrency, transactionsConverted: 0, budgetsConverted: 0 };

  // Rates are looked up before the transaction opens; each distinct (currency, date) once.
  const cache = new Map();
  const rateFor = async (currency, date) => {
    const key = `${currency}@${date}`;
    if (!cache.has(key)) cache.set(key, await fxService.getRate(currency, baseCurrency, date, { live: false }));
    return cache.get(key);
  };
  const budgetRate = await fxService.getRate(user.base_currency, baseCurrency);

  const result = await database.withTransaction(async (tx) => {
    const transactions = await transactionModel.listForReconversion(userId, tx);
    for (const row of transactions) {
      const rate = await rateFor(row.currency_code, row.txn_date);
      await transactionModel.setConversion(
        row.id,
        { baseCurrency, exchangeRate: rate.rate, exchangeRateId: rate.id, baseAmount: convert(row.amount, rate.rate, baseCurrency) },
        tx
      );
    }
    const budgets = await budgetModel.listAllForUpdate(userId, tx);
    for (const budget of budgets) {
      const amount = convert(budget.amount, budgetRate.rate, baseCurrency);
      if (Number(amount) <= 0) throw ApiError.badRequest('A budget would become zero in the new currency. Raise or delete very small budgets first.');
      await budgetModel.setAmount(budget.id, amount, tx);
    }
    await tx.query('UPDATE users SET base_currency = ? WHERE id = ?', [baseCurrency, userId]);
    const counts = { transactionsConverted: transactions.length, budgetsConverted: budgets.length };
    await audit.append(tx, {
      userId, eventType: audit.EVENT_TYPES.ACCOUNT, action: 'BASE_CURRENCY_CHANGED', resourceType: 'user', resourceId: userId,
      details: { from: user.base_currency, to: baseCurrency, ...counts }, ctx,
    });
    return counts;
  });

  await securityEvents.record(securityEvents.EVENTS.BASE_CURRENCY_CHANGED, { userId, ctx, metadata: { from: user.base_currency, to: baseCurrency, ...result } });
  return { baseCurrency, previousBaseCurrency: user.base_currency, ...result };
}

module.exports = { changeBaseCurrency };
