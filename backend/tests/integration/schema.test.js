// Verifies the database itself: constraints, isolation helpers, append-only audit log and
// the privileges of the runtime account. Runs against <DB_NAME>_test, rebuilt from scratch.
const { connect } = require('../../scripts/lib/db');
const { migrate } = require('../../scripts/migrate');
const { seedDemo } = require('../../scripts/seed-demo');

let app; // runtime account (least privilege)
let migrator; // schema owner
let userId;
let foodCategoryId;

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const ZERO_HASH = '0'.repeat(64);

async function expectSqlError(promise, codes) {
  const expected = [].concat(codes);
  await expect(promise).rejects.toMatchObject({ code: expect.stringMatching(new RegExp(`^(${expected.join('|')})$`)) });
}

function insertTransaction(overrides = {}) {
  const row = {
    user_id: userId, category_id: foodCategoryId, type: 'EXPENSE', amount: '250.00', currency_code: 'INR',
    base_currency: 'INR', exchange_rate: '1', base_amount: '250.00', description: 'Test lunch', txn_date: '2026-11-01',
    ...overrides,
  };
  const columns = Object.keys(row);
  return app.execute(
    `INSERT INTO transactions (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    Object.values(row)
  );
}

beforeAll(async () => {
  await migrate({ test: true, fresh: true, log: () => {} });
  app = await connect('app', { test: true });
  migrator = await connect('migrator', { test: true });
  const [result] = await app.execute(
    "INSERT INTO users (full_name, email, password_hash) VALUES ('Schema Tester', 'schema.tester@example.test', 'x')"
  );
  userId = result.insertId;
  const [[category]] = await app.query("SELECT id FROM categories WHERE user_id IS NULL AND name = 'Food & Dining'");
  foodCategoryId = category.id;
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
  // These tests write raw rows on purpose, including an audit row with made-up hashes to
  // prove the append-only rules. Rebuild so later suites start from a valid, empty chain.
  await migrate({ test: true, fresh: true, log: () => {} });
});

describe('migrations and reference data', () => {
  test('all migrations are recorded and re-running is a no-op', async () => {
    const [rows] = await app.query('SELECT version FROM schema_migrations ORDER BY version');
    expect(rows.map((r) => r.version)).toEqual(['001', '002', '003', '004', '005', '006', '007', '008']);
    const second = await migrate({ test: true, log: () => {} });
    expect(second.appliedNow).toBe(0);
  });

  test('roles, currencies and default categories are seeded', async () => {
    const [[roles]] = await app.query('SELECT COUNT(*) AS n FROM roles');
    const [currencies] = await app.query('SELECT code, decimal_places FROM currencies ORDER BY code');
    const [[categories]] = await app.query('SELECT COUNT(*) AS n FROM categories WHERE user_id IS NULL');
    expect(roles.n).toBe(2);
    expect(currencies.map((c) => c.code)).toEqual(['EUR', 'GBP', 'INR', 'JPY', 'USD']);
    expect(currencies.find((c) => c.code === 'JPY').decimal_places).toBe(0);
    expect(categories.n).toBe(17);
  });

  test('no FLOAT or DOUBLE column exists anywhere', async () => {
    const [rows] = await app.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND data_type IN ('float', 'double')"
    );
    expect(rows).toEqual([]);
  });

  test('every table uses InnoDB', async () => {
    const [rows] = await app.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND engine <> 'InnoDB'"
    );
    expect(rows).toEqual([]);
  });
});

describe('users', () => {
  test('email is unique regardless of case', async () => {
    await expectSqlError(
      app.execute("INSERT INTO users (full_name, email, password_hash) VALUES ('Dup', 'SCHEMA.Tester@Example.Test', 'x')"),
      'ER_DUP_ENTRY'
    );
  });

  test('base currency must exist', async () => {
    await expectSqlError(
      app.execute("INSERT INTO users (full_name, email, password_hash, base_currency) VALUES ('Bad', 'bad.ccy@example.test', 'x', 'XXX')"),
      'ER_NO_REFERENCED_ROW_2'
    );
  });

  test('a user with data cannot be hard-deleted', async () => {
    await insertTransaction();
    await expectSqlError(app.execute('DELETE FROM users WHERE id = ?', [userId]), 'ER_ROW_IS_REFERENCED_2');
  });
});

describe('transactions', () => {
  test('money is stored exactly as DECIMAL', async () => {
    const [result] = await insertTransaction({ amount: '0.10', base_amount: '0.10' });
    await insertTransaction({ amount: '0.20', base_amount: '0.20', description: 'Decimal check' });
    const [[row]] = await app.execute('SELECT amount FROM transactions WHERE id = ?', [result.insertId]);
    const [[sum]] = await app.query("SELECT SUM(amount) AS total FROM transactions WHERE amount IN ('0.10', '0.20')");
    expect(row.amount).toBe('0.10');
    expect(sum.total).toBe('0.30');
  });

  test.each([
    ['zero amount', { amount: '0.00' }],
    ['negative amount', { amount: '-5.00' }],
    ['zero exchange rate', { currency_code: 'USD', exchange_rate: '0' }],
    ['same currency with a rate other than 1', { exchange_rate: '1.5' }],
  ])('rejects %s', async (_label, overrides) => {
    await expectSqlError(insertTransaction(overrides), 'ER_CHECK_CONSTRAINT_VIOLATED');
  });

  test.each([
    ['unknown currency', { currency_code: 'ABC' }],
    ['unknown category', { category_id: 999999 }],
    ['unknown user', { user_id: 999999 }],
    ['unknown exchange-rate snapshot', { currency_code: 'USD', exchange_rate: '94', exchange_rate_id: 999999 }],
  ])('rejects %s', async (_label, overrides) => {
    await expectSqlError(insertTransaction(overrides), 'ER_NO_REFERENCED_ROW_2');
  });

  test('rejects an invalid type or payment method', async () => {
    await expectSqlError(insertTransaction({ type: 'TRANSFER' }), ['WARN_DATA_TRUNCATED', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD']);
    await expectSqlError(insertTransaction({ payment_method: 'CHEQUE' }), ['WARN_DATA_TRUNCATED', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD']);
  });

  test('a category in use cannot be deleted', async () => {
    const [result] = await app.execute("INSERT INTO categories (user_id, name, type) VALUES (?, 'Pets', 'EXPENSE')", [userId]);
    await insertTransaction({ category_id: result.insertId });
    await expectSqlError(app.execute('DELETE FROM categories WHERE id = ?', [result.insertId]), 'ER_ROW_IS_REFERENCED_2');
  });
});

describe('categories and exchange rates', () => {
  test('default categories are unique even though user_id is NULL', async () => {
    await expectSqlError(
      migrator.query("INSERT INTO categories (user_id, name, type) VALUES (NULL, 'Salary', 'INCOME')"),
      'ER_DUP_ENTRY'
    );
  });

  test('a user cannot have two categories with the same name and type', async () => {
    await app.execute("INSERT INTO categories (user_id, name, type) VALUES (?, 'Hobbies', 'EXPENSE')", [userId]);
    await expectSqlError(
      app.execute("INSERT INTO categories (user_id, name, type) VALUES (?, 'hobbies', 'EXPENSE')", [userId]),
      'ER_DUP_ENTRY'
    );
  });

  test('one snapshot per currency pair and date; rate must be positive', async () => {
    const insert = (rate, date) =>
      app.execute(
        "INSERT INTO exchange_rates (base_currency, quote_currency, rate, rate_date, source) VALUES ('USD', 'INR', ?, ?, 'test')",
        [rate, date]
      );
    await insert('94.25000000', '2026-01-02');
    await expectSqlError(insert('95.00000000', '2026-01-02'), 'ER_DUP_ENTRY');
    await expectSqlError(insert('0', '2026-01-03'), 'ER_CHECK_CONSTRAINT_VIOLATED');
  });
});

describe('budgets and goals', () => {
  const insertBudget = (type, categoryId, month, amount = '5000.00') =>
    app.execute('INSERT INTO budgets (user_id, budget_type, category_id, period_month, amount) VALUES (?, ?, ?, ?, ?)', [
      userId, type, categoryId, month, amount,
    ]);

  test('one OVERALL budget per month (NULL category handled)', async () => {
    await insertBudget('OVERALL', null, '2026-11-01');
    await expectSqlError(insertBudget('OVERALL', null, '2026-11-01'), 'ER_DUP_ENTRY');
    await insertBudget('OVERALL', null, '2026-12-01'); // another month is history, not a duplicate
  });

  test('one budget per category per month', async () => {
    await insertBudget('CATEGORY', foodCategoryId, '2026-11-01');
    await expectSqlError(insertBudget('CATEGORY', foodCategoryId, '2026-11-01'), 'ER_DUP_ENTRY');
  });

  test.each([
    ['period not on the first of the month', ['OVERALL', null, '2026-10-15']],
    ['CATEGORY budget without a category', ['CATEGORY', null, '2026-09-01']],
    ['OVERALL budget with a category', ['OVERALL', 'FOOD', '2026-09-01']],
    ['non-positive amount', ['SAVINGS_TARGET', null, '2026-09-01', '0']],
  ])('rejects %s', async (_label, args) => {
    const resolved = args.map((value) => (value === 'FOOD' ? foodCategoryId : value));
    await expectSqlError(insertBudget(...resolved), 'ER_CHECK_CONSTRAINT_VIOLATED');
  });

  test('goal amounts are constrained and contributions cascade with the goal', async () => {
    await expectSqlError(
      app.execute("INSERT INTO savings_goals (user_id, title, target_amount, currency_code) VALUES (?, 'Bad', '0', 'INR')", [userId]),
      'ER_CHECK_CONSTRAINT_VIOLATED'
    );
    const [goal] = await app.execute(
      "INSERT INTO savings_goals (user_id, title, target_amount, currency_code) VALUES (?, 'Bike', '50000', 'INR')",
      [userId]
    );
    await app.execute("INSERT INTO goal_contributions (goal_id, user_id, amount, contributed_on) VALUES (?, ?, '1000', '2026-11-10')", [
      goal.insertId, userId,
    ]);
    await expectSqlError(
      app.execute('UPDATE savings_goals SET saved_amount = -1 WHERE id = ?', [goal.insertId]),
      'ER_CHECK_CONSTRAINT_VIOLATED'
    );
    await app.execute('DELETE FROM savings_goals WHERE id = ?', [goal.insertId]);
    const [[left]] = await app.execute('SELECT COUNT(*) AS n FROM goal_contributions WHERE goal_id = ?', [goal.insertId]);
    expect(left.n).toBe(0);
  });
});

describe('sessions and tokens', () => {
  test('token hashes are unique and refresh tokens are removed with their session', async () => {
    const [session] = await app.execute(
      "INSERT INTO user_sessions (user_id, expires_at) VALUES (?, '2030-01-01 00:00:00')",
      [userId]
    );
    const insertToken = () =>
      app.execute("INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES (?, ?, '2030-01-01 00:00:00')", [
        session.insertId, HASH_A,
      ]);
    await insertToken();
    await expectSqlError(insertToken(), 'ER_DUP_ENTRY');
    await app.execute('DELETE FROM user_sessions WHERE id = ?', [session.insertId]);
    const [[left]] = await app.execute('SELECT COUNT(*) AS n FROM refresh_tokens WHERE token_hash = ?', [HASH_A]);
    expect(left.n).toBe(0);
  });

  test('a notification dedupe key fires only once per user', async () => {
    const insert = () =>
      app.execute(
        "INSERT INTO notifications (user_id, type, title, message, dedupe_key) VALUES (?, 'BUDGET_THRESHOLD', 'Budget', '80% used', 'budget:1:2026-11:80')",
        [userId]
      );
    await insert();
    await expectSqlError(insert(), 'ER_DUP_ENTRY');
  });
});

describe('audit log is append-only', () => {
  const insertAudit = (db, prev, curr) =>
    db.execute(
      "INSERT INTO audit_logs (user_id, event_type, action, created_at, prev_hash, curr_hash) VALUES (?, 'TEST', 'CREATE', UTC_TIMESTAMP(3), ?, ?)",
      [userId, prev, curr]
    );

  test('the application account can insert and read', async () => {
    await insertAudit(app, ZERO_HASH, HASH_A);
    const [[row]] = await app.query('SELECT curr_hash FROM audit_logs ORDER BY id DESC LIMIT 1');
    expect(row.curr_hash).toBe(HASH_A);
  });

  test('the application account has no UPDATE or DELETE privilege', async () => {
    await expectSqlError(app.query("UPDATE audit_logs SET action = 'EDITED'"), 'ER_TABLEACCESS_DENIED_ERROR');
    await expectSqlError(app.query('DELETE FROM audit_logs'), 'ER_TABLEACCESS_DENIED_ERROR');
    await expectSqlError(app.query('TRUNCATE TABLE audit_logs'), 'ER_TABLEACCESS_DENIED_ERROR');
  });

  test('triggers reject UPDATE and DELETE even for the schema owner', async () => {
    await expect(migrator.query("UPDATE audit_logs SET action = 'EDITED'")).rejects.toMatchObject({ sqlState: '45000' });
    await expect(migrator.query('DELETE FROM audit_logs')).rejects.toMatchObject({ sqlState: '45000' });
    const [[row]] = await app.query('SELECT action FROM audit_logs ORDER BY id DESC LIMIT 1');
    expect(row.action).toBe('CREATE');
  });

  test('hashes must be 64 hex characters and unique', async () => {
    await expectSqlError(insertAudit(app, ZERO_HASH, 'not-a-hash'), ['ER_CHECK_CONSTRAINT_VIOLATED', 'ER_DATA_TOO_LONG']);
    await expectSqlError(insertAudit(app, HASH_B, HASH_A), 'ER_DUP_ENTRY');
  });

  test('the chain head is a single row the application can advance but not remove', async () => {
    const [[head]] = await app.query('SELECT id, last_id, last_hash FROM audit_chain_head');
    expect(head).toMatchObject({ id: 1, last_hash: ZERO_HASH });
    await app.query('UPDATE audit_chain_head SET last_id = last_id WHERE id = 1');
    await expectSqlError(app.query('DELETE FROM audit_chain_head'), 'ER_TABLEACCESS_DENIED_ERROR');
    await expectSqlError(app.query(`INSERT INTO audit_chain_head (id, last_hash) VALUES (2, '${ZERO_HASH}')`), 'ER_TABLEACCESS_DENIED_ERROR');
  });
});

describe('runtime account privileges', () => {
  test('cannot change the schema', async () => {
    await expectSqlError(app.query('CREATE TABLE hack (id INT)'), 'ER_TABLEACCESS_DENIED_ERROR');
    await expectSqlError(app.query('DROP TABLE transactions'), 'ER_TABLEACCESS_DENIED_ERROR');
    await expectSqlError(app.query('ALTER TABLE users ADD COLUMN x INT'), 'ER_TABLEACCESS_DENIED_ERROR');
  });

  test('security events and exchange rates are append-only', async () => {
    await app.execute("INSERT INTO security_events (user_id, event_type) VALUES (?, 'LOGIN_FAILED')", [userId]);
    await expectSqlError(app.query('DELETE FROM security_events'), 'ER_TABLEACCESS_DENIED_ERROR');
    await expectSqlError(app.query("UPDATE security_events SET event_type = 'X'"), 'ER_TABLEACCESS_DENIED_ERROR');
    await expectSqlError(app.query('UPDATE exchange_rates SET rate = 1'), 'ER_TABLEACCESS_DENIED_ERROR');
  });

  test('roles and currencies are read-only', async () => {
    await expectSqlError(app.query("INSERT INTO roles (name, description) VALUES ('ROOT', 'x')"), 'ER_TABLEACCESS_DENIED_ERROR');
    await expectSqlError(app.query("UPDATE currencies SET is_active = 0 WHERE code = 'INR'"), 'ER_TABLEACCESS_DENIED_ERROR');
  });
});

describe('demo seed', () => {
  let summary;

  beforeAll(async () => {
    summary = await seedDemo({ test: true, log: () => {} });
  });

  test('creates four accounts; the admin has no transactions', async () => {
    expect(summary).toHaveLength(4);
    expect(summary.find((u) => u.email === 'admin@fintrack.demo').transactions).toBe(0);
    expect(summary.filter((u) => u.transactions > 100)).toHaveLength(3);
  });

  test('passwords are stored as bcrypt hashes', async () => {
    const [rows] = await app.query("SELECT password_hash FROM users WHERE email LIKE '%@fintrack.demo'");
    for (const row of rows) expect(row.password_hash).toMatch(/^\$2[aby]\$12\$.{53}$/);
  });

  test('converted amounts equal original amount times the stored rate', async () => {
    const [rows] = await app.query(
      `SELECT COUNT(*) AS foreign_rows,
              SUM(ABS(base_amount - ROUND(amount * exchange_rate, 2)) > 0.01) AS mismatched,
              SUM(exchange_rate_id IS NULL) AS without_snapshot
         FROM transactions WHERE currency_code <> base_currency`
    );
    expect(Number(rows[0].foreign_rows)).toBeGreaterThan(10);
    expect(Number(rows[0].mismatched)).toBe(0);
    expect(Number(rows[0].without_snapshot)).toBe(0);
  });

  test('goal totals match their contributions', async () => {
    const [rows] = await app.query(
      `SELECT g.id FROM savings_goals g
         LEFT JOIN goal_contributions c ON c.goal_id = g.id
        GROUP BY g.id, g.saved_amount HAVING g.saved_amount <> COALESCE(SUM(c.amount), 0)`
    );
    expect(rows).toEqual([]);
  });

  test('refuses to seed twice without --reset, and --reset regenerates the same data', async () => {
    await expect(seedDemo({ test: true, log: () => {} })).rejects.toThrow(/already exists/);
    const again = await seedDemo({ test: true, reset: true, log: () => {} });
    expect(again.map((u) => u.transactions)).toEqual(summary.map((u) => u.transactions));
  });
});
