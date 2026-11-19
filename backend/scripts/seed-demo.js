// Fictional demo data for development and demonstrations.
//
//   npm run seed:demo             create demo accounts + 6 months of data (refuses if already present)
//   npm run seed:demo -- --reset  delete the demo accounts' financial data and regenerate it
//   npm run seed:demo -- --test   target <DB_NAME>_test
//
// Runs as the APPLICATION account, so it also proves the runtime grants are sufficient.
// All people, amounts and rates below are invented. Exchange-rate snapshots are marked
// source = 'seed-fictional'; real rates come from the rates API in Phase 6.
// Encrypted columns (phone_enc, notes_enc) are left NULL: the demo data has no notes.
//
// Demo login for every account below (development only, never use in production):
//   password: FinTrack@Demo2026
const bcrypt = require('bcrypt');
const Decimal = require('decimal.js');
const { connect } = require('./lib/db');

const DEMO_PASSWORD = 'FinTrack@Demo2026';
const BCRYPT_COST = 12;
const MONTHS_OF_HISTORY = 6;

const DEMO_USERS = [
  { name: 'Priya Nair', email: 'admin@fintrack.demo', base: 'INR', roles: ['ADMIN', 'USER'], monthlyIncomeInr: 0 },
  { name: 'Aarav Sharma', email: 'aarav.sharma@fintrack.demo', base: 'INR', roles: ['USER'], monthlyIncomeInr: 85000 },
  { name: 'Emma Wilson', email: 'emma.wilson@fintrack.demo', base: 'USD', roles: ['USER'], monthlyIncomeInr: 420000 },
  { name: 'Lukas Becker', email: 'lukas.becker@fintrack.demo', base: 'EUR', roles: ['USER'], monthlyIncomeInr: 350000 },
];

// Fictional value of one unit of each currency, expressed in INR.
const INR_PER_UNIT = { INR: 1, USD: 94.25, EUR: 104.2, GBP: 124.7, JPY: 0.589 };
const DECIMALS = { INR: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0 };

// Share of monthly income, [min, max] entries per month, descriptions, payment methods.
const EXPENSE_PATTERNS = [
  { category: 'Food & Dining', share: 0.07, count: [8, 12], methods: ['UPI', 'CARD', 'CASH'], items: ['Lunch', 'Dinner out', 'Coffee', 'Food delivery', 'Bakery', 'Street food'] },
  { category: 'Groceries', share: 0.07, count: [4, 6], methods: ['UPI', 'CARD'], items: ['Weekly groceries', 'Vegetables and fruit', 'Supermarket', 'Dairy and eggs'] },
  { category: 'Transport', share: 0.04, count: [5, 8], methods: ['UPI', 'WALLET', 'CARD'], items: ['Metro pass top-up', 'Cab ride', 'Fuel', 'Bus fare', 'Parking'] },
  { category: 'Shopping', share: 0.06, count: [1, 3], methods: ['CARD', 'UPI'], items: ['Clothes', 'Shoes', 'Home supplies', 'Electronics accessory'] },
  { category: 'Entertainment', share: 0.03, count: [1, 3], methods: ['CARD', 'UPI'], items: ['Movie tickets', 'Concert', 'Bowling', 'Game purchase'] },
  { category: 'Health', share: 0.02, count: [0, 1], methods: ['CARD', 'CASH'], items: ['Pharmacy', 'Doctor visit', 'Gym day pass'] },
  { category: 'Education', share: 0.02, count: [0, 1], methods: ['CARD', 'BANK_TRANSFER'], items: ['Online course', 'Books', 'Workshop fee'] },
];

// Deterministic pseudo-random numbers so every run produces the same data set.
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

function recentMonths(count, today) {
  const months = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lastDay = back === 0 ? Math.min(daysInMonth, today.getUTCDate()) : daysInMonth;
    months.push({ year, month, lastDay, first: isoDate(year, month, 1) });
  }
  return months;
}

// Amount given in INR terms -> amount in `currency`, rounded to that currency's decimals.
function fromInr(inrAmount, currency) {
  return new Decimal(inrAmount).div(INR_PER_UNIT[currency]).toDecimalPlaces(DECIMALS[currency], Decimal.ROUND_HALF_UP);
}

async function seedExchangeRates(db, months, random) {
  const codes = Object.keys(INR_PER_UNIT);
  const rows = [];
  for (const month of months) {
    const unit = {};
    for (const code of codes) {
      const drift = code === 'INR' ? 1 : 1 + (random() - 0.5) * 0.03; // +/- 1.5 % monthly movement
      unit[code] = new Decimal(INR_PER_UNIT[code]).mul(drift);
    }
    for (const base of codes) {
      for (const quote of codes) {
        if (base === quote) continue;
        rows.push([base, quote, unit[base].div(unit[quote]).toFixed(8), month.first, 'seed-fictional']);
      }
    }
  }
  await db.query(
    'INSERT IGNORE INTO exchange_rates (base_currency, quote_currency, rate, rate_date, source) VALUES ?',
    [rows]
  );
  const [stored] = await db.query(
    'SELECT id, base_currency, quote_currency, rate, rate_date FROM exchange_rates WHERE rate_date IN (?)',
    [months.map((m) => m.first)]
  );
  const lookup = new Map();
  for (const row of stored) lookup.set(`${row.base_currency}>${row.quote_currency}@${row.rate_date}`, row);
  return lookup;
}

async function upsertUser(db, user, passwordHash, roleIds) {
  await db.execute(
    `INSERT INTO users (full_name, email, password_hash, base_currency)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash),
       base_currency = VALUES(base_currency), status = 'ACTIVE', failed_login_count = 0, locked_until = NULL`,
    [user.name, user.email, passwordHash, user.base]
  );
  const [[row]] = await db.execute('SELECT id FROM users WHERE email = ?', [user.email]);
  for (const role of user.roles) {
    await db.execute('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [row.id, roleIds[role]]);
  }
  return row.id;
}

async function clearFinancialData(db, userId) {
  await db.execute('DELETE FROM savings_goals WHERE user_id = ?', [userId]); // contributions cascade
  await db.execute('DELETE FROM budgets WHERE user_id = ?', [userId]);
  await db.execute('DELETE FROM transactions WHERE user_id = ?', [userId]);
  await db.execute('DELETE FROM notifications WHERE user_id = ?', [userId]);
}

function buildTransactions({ user, userId, months, categoryIds, rates, random }) {
  const rows = [];
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (min, max) => min + Math.floor(random() * (max - min + 1));
  const foreignChoices = Object.keys(INR_PER_UNIT).filter((code) => code !== user.base);

  function add({ month, day, type, category, inrAmount, currency = user.base, description, method }) {
    if (day > month.lastDay) return;
    const amount = fromInr(inrAmount, currency);
    if (amount.lte(0)) return;
    let rate = new Decimal(1);
    let rateId = null;
    if (currency !== user.base) {
      const snapshot = rates.get(`${currency}>${user.base}@${month.first}`);
      rate = new Decimal(snapshot.rate);
      rateId = snapshot.id;
    }
    const baseAmount = amount.mul(rate).toDecimalPlaces(DECIMALS[user.base], Decimal.ROUND_HALF_UP);
    rows.push([
      userId, categoryIds[`${type}:${category}`], type, amount.toFixed(2), currency, user.base,
      rate.toFixed(8), rateId, baseAmount.toFixed(2), description, method, isoDate(month.year, month.month, day),
    ]);
  }

  const income = user.monthlyIncomeInr;
  months.forEach((month, index) => {
    add({ month, day: 1, type: 'INCOME', category: 'Salary', inrAmount: income, description: 'Monthly salary', method: 'BANK_TRANSFER' });
    if (random() < 0.4) {
      add({ month, day: between(12, 24), type: 'INCOME', category: 'Freelance', inrAmount: income * (0.08 + random() * 0.1),
        currency: pick(foreignChoices.filter((c) => c !== 'JPY')), description: 'Freelance project payment', method: 'BANK_TRANSFER' });
    }
    add({ month, day: 3, type: 'EXPENSE', category: 'Rent & Housing', inrAmount: income * 0.28, description: 'Monthly rent', method: 'BANK_TRANSFER' });
    add({ month, day: between(5, 8), type: 'EXPENSE', category: 'Utilities & Bills', inrAmount: income * (0.02 + random() * 0.01), description: 'Electricity bill', method: 'UPI' });
    add({ month, day: between(9, 12), type: 'EXPENSE', category: 'Utilities & Bills', inrAmount: income * 0.012, description: 'Internet and mobile plan', method: 'CARD' });
    add({ month, day: 6, type: 'EXPENSE', category: 'Subscriptions', inrAmount: 650, description: 'Music streaming', method: 'CARD' });
    add({ month, day: 15, type: 'EXPENSE', category: 'Subscriptions', inrAmount: 1900, currency: user.base === 'USD' ? 'EUR' : 'USD',
      description: 'Cloud storage plan', method: 'CARD' });

    for (const pattern of EXPENSE_PATTERNS) {
      const count = between(pattern.count[0], pattern.count[1]);
      for (let i = 0; i < count; i += 1) {
        const typical = (income * pattern.share) / ((pattern.count[0] + pattern.count[1]) / 2);
        add({ month, day: between(1, 28), type: 'EXPENSE', category: pattern.category, inrAmount: typical * (0.5 + random()),
          description: pick(pattern.items), method: pick(pattern.methods) });
      }
    }

    if (index === months.length - 3) {
      // A short trip abroad: transactions in a foreign currency.
      const tripCurrency = pick(foreignChoices);
      add({ month, day: 18, type: 'EXPENSE', category: 'Travel', inrAmount: income * 0.12, currency: tripCurrency, description: 'Flight tickets', method: 'CARD' });
      add({ month, day: 20, type: 'EXPENSE', category: 'Travel', inrAmount: income * 0.08, currency: tripCurrency, description: 'Hotel stay', method: 'CARD' });
      add({ month, day: 21, type: 'EXPENSE', category: 'Food & Dining', inrAmount: income * 0.015, currency: tripCurrency, description: 'Restaurant abroad', method: 'CASH' });
    }
    if (index === months.length - 2) {
      // One deliberately unusual purchase, for the anomaly detection in Phase 8.
      add({ month, day: 14, type: 'EXPENSE', category: 'Shopping', inrAmount: income * 0.55, description: 'Laptop purchase', method: 'CARD' });
    }
  });
  return rows;
}

function buildBudgets({ user, userId, months, categoryIds }) {
  const rows = [];
  const shares = { 'Food & Dining': 0.08, Groceries: 0.08, Transport: 0.05, Shopping: 0.07, Entertainment: 0.04 };
  for (const month of months.slice(-3)) {
    const amount = (share) => fromInr(user.monthlyIncomeInr * share, user.base).toFixed(2);
    rows.push([userId, 'OVERALL', null, month.first, amount(0.7), 80]);
    rows.push([userId, 'SAVINGS_TARGET', null, month.first, amount(0.2), 80]);
    for (const [category, share] of Object.entries(shares)) {
      rows.push([userId, 'CATEGORY', categoryIds[`EXPENSE:${category}`], month.first, amount(share), 80]);
    }
  }
  return rows;
}

async function insertGoals(db, { user, userId, months }) {
  const goals = [
    { title: 'Emergency fund', targetShare: 3, monthlyShare: 0.08, deadlineMonths: 12 },
    { title: 'Holiday trip', targetShare: 0.9, monthlyShare: 0.04, deadlineMonths: 5 },
  ];
  const today = new Date();
  for (const goal of goals) {
    const target = fromInr(user.monthlyIncomeInr * goal.targetShare, user.base);
    const monthly = fromInr(user.monthlyIncomeInr * goal.monthlyShare, user.base);
    const contributions = months.slice(-4).filter((m) => m.lastDay >= 10);
    const saved = monthly.mul(contributions.length);
    const deadline = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + goal.deadlineMonths, 1));
    const [result] = await db.execute(
      'INSERT INTO savings_goals (user_id, title, target_amount, saved_amount, currency_code, deadline) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, goal.title, target.toFixed(2), saved.toFixed(2), user.base, isoDate(deadline.getUTCFullYear(), deadline.getUTCMonth() + 1, 1)]
    );
    for (const month of contributions) {
      await db.execute(
        'INSERT INTO goal_contributions (goal_id, user_id, amount, contributed_on) VALUES (?, ?, ?, ?)',
        [result.insertId, userId, monthly.toFixed(2), isoDate(month.year, month.month, 10)]
      );
    }
  }
}

async function seedDemo({ test = false, reset = false, log = console.log } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo data must not be seeded in production');
  const db = await connect('app', { test });
  try {
    const [[existing]] = await db.query(
      "SELECT COUNT(*) AS n FROM transactions t JOIN users u ON u.id = t.user_id WHERE u.email LIKE '%@fintrack.demo'"
    );
    if (existing.n > 0 && !reset) {
      throw new Error('Demo data already exists. Use "npm run seed:demo -- --reset" to regenerate it.');
    }

    const random = createRandom(20261116);
    const months = recentMonths(MONTHS_OF_HISTORY, new Date());
    const [roleRows] = await db.query('SELECT id, name FROM roles');
    const roleIds = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
    const [categoryRows] = await db.query('SELECT id, name, type FROM categories WHERE user_id IS NULL');
    const categoryIds = Object.fromEntries(categoryRows.map((c) => [`${c.type}:${c.name}`, c.id]));
    if (!roleIds.USER || categoryRows.length === 0) throw new Error('Reference data missing: run "npm run migrate" first');

    const rates = await seedExchangeRates(db, months, random);
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);
    const summary = [];

    for (const user of DEMO_USERS) {
      await db.beginTransaction();
      try {
        const userId = await upsertUser(db, user, passwordHash, roleIds);
        await clearFinancialData(db, userId);
        let transactionCount = 0;
        if (user.monthlyIncomeInr > 0) {
          const transactions = buildTransactions({ user, userId, months, categoryIds, rates, random });
          await db.query(
            `INSERT INTO transactions (user_id, category_id, type, amount, currency_code, base_currency,
               exchange_rate, exchange_rate_id, base_amount, description, payment_method, txn_date) VALUES ?`,
            [transactions]
          );
          transactionCount = transactions.length;
          await db.query(
            'INSERT INTO budgets (user_id, budget_type, category_id, period_month, amount, alert_threshold_pct) VALUES ?',
            [buildBudgets({ user, userId, months, categoryIds })]
          );
          await insertGoals(db, { user, userId, months });
        }
        await db.execute(
          "INSERT INTO notifications (user_id, type, severity, title, message, dedupe_key) VALUES (?, 'SYSTEM', 'INFO', ?, ?, 'welcome')",
          [userId, 'Welcome to FinTrack', 'Your demo account is ready. All data shown here is fictional.']
        );
        await db.commit();
        summary.push({ email: user.email, base: user.base, roles: user.roles.join('+'), transactions: transactionCount });
      } catch (err) {
        await db.rollback();
        throw err;
      }
    }
    log(`Seeded ${months[0].first} .. today:`);
    for (const row of summary) log(`  ${row.email.padEnd(30)} ${row.base}  ${row.roles.padEnd(10)} ${row.transactions} transactions`);
    return summary;
  } finally {
    await db.end();
  }
}

module.exports = { seedDemo, DEMO_USERS };

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  seedDemo({ test: args.has('--test'), reset: args.has('--reset') }).catch((err) => {
    console.error(`Seed error: ${err.message}`);
    process.exit(1);
  });
}
