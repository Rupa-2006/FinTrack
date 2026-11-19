// The AI assistant: insights and questions about the signed-in user's own records.
//
// "The AI must only access authorized user data" is enforced here, by construction: the
// user id comes from the access token, this service loads that user's records only, and
// sends them in the body of a signed request. The AI service has no database access, so it
// cannot see anything else even if it is wrong or compromised.
//
// Questions and answers are not stored or logged.
const { currentMonth, today } = require('../utils/period');
const assistantModel = require('../models/assistant.model');
const budgetModel = require('../models/budget.model');
const goalModel = require('../models/goal.model');
const userModel = require('../models/user.model');
const aiClient = require('./aiClient');

async function collect(userId) {
  const [user, transactions, budgets, goals] = await Promise.all([
    userModel.findById(userId),
    assistantModel.transactionsFor(userId),
    budgetModel.listForMonth(userId, currentMonth()),
    goalModel.list(userId),
  ]);
  return {
    currency: user.base_currency,
    today: today(),
    transactions: transactions.map((t) => ({
      id: t.id,
      date: t.txn_date,
      type: t.type,
      amount: t.base_amount,
      category: t.category,
      description: t.description.slice(0, 255),
    })),
    budgets: budgets.map((b) => ({
      budgetType: b.budget_type,
      category: b.category_name ?? null,
      amount: b.amount,
      alertThresholdPct: b.alert_threshold_pct,
    })),
    goals: goals.map((g) => ({
      title: g.title,
      targetAmount: g.target_amount,
      savedAmount: g.saved_amount,
      currency: g.currency_code,
      deadline: g.deadline,
      status: g.status,
    })),
  };
}

async function insights(userId) {
  return aiClient.post('/v1/insights', await collect(userId));
}

async function ask(userId, { question }) {
  return aiClient.post('/v1/assistant/ask', { ...(await collect(userId)), question });
}

module.exports = { collect, insights, ask };
