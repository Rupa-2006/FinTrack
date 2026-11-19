// The money features end to end against the real test database: categories, transactions,
// multi-currency, budgets, goals, analytics, reports and notifications.
const request = require('supertest');
const { createApp } = require('../../app');
const database = require('../../config/database');
const fxClient = require('../../services/fxClient');
const { today, currentMonth, addMonths, addDays } = require('../../utils/period');

const RELAXED = { windowMs: 60000, limit: 100000 };
const app = createApp({ globalRateLimit: RELAXED, authRateLimits: { login: RELAXED, register: RELAXED, passwordReset: RELAXED, refresh: RELAXED } });

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'Tr1cky-Horse-Battery!';
const TODAY = today();
const MONTH = currentMonth();
let counter = 0;

// Fixed fictional rates stand in for the external rates API.
const INR_PER_UNIT = { INR: 1, USD: 90, EUR: 100, GBP: 120, JPY: 0.6 };
function fakeRates(base, date) {
  const rates = {};
  for (const code of Object.keys(INR_PER_UNIT)) if (code !== base) rates[code] = String(INR_PER_UNIT[base] / INR_PER_UNIT[code]);
  return Promise.resolve({ date: date === 'latest' ? TODAY : date, rates });
}

function client(token) {
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    get: (path) => auth(request(app).get(`/api${path}`)),
    post: (path, body) => auth(request(app).post(`/api${path}`)).send(body),
    put: (path, body) => auth(request(app).put(`/api${path}`)).send(body),
    patch: (path, body) => auth(request(app).patch(`/api${path}`)).send(body),
    del: (path) => auth(request(app).delete(`/api${path}`)),
  };
}

// A fresh account with its own API client and a name -> id map of the default categories.
async function newUser(baseCurrency = 'INR') {
  counter += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({ fullName: 'Ledger Tester', email: `ledger${counter}.${RUN}@example.test`, password: PASSWORD, baseCurrency });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const api = client(res.body.data.accessToken);
  const categories = Object.fromEntries((await api.get('/categories')).body.data.map((c) => [c.name, c.id]));
  const add = async (overrides) => {
    const created = await api.post('/transactions', {
      type: 'EXPENSE', categoryId: categories.Groceries, amount: '100.00', currency: baseCurrency, date: TODAY, description: 'Test entry', ...overrides,
    });
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    return created.body.data;
  };
  return { id: res.body.data.user.id, api, categories, add };
}

beforeEach(() => {
  jest.spyOn(fxClient, 'fetchRates').mockImplementation(fakeRates);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await database.close();
});

describe('authentication is required everywhere', () => {
  test.each([
    '/categories', '/transactions', '/budgets', '/goals', '/currencies', '/currencies/rates', '/analytics/summary',
    '/analytics/monthly', '/analytics/categories', '/analytics/dashboard', '/reports/monthly', '/reports/export', '/notifications',
  ])('GET %s without a token is refused', async (path) => {
    const res = await request(app).get(`/api${path}`);
    expect(res.status).toBe(401);
  });
});

describe('categories', () => {
  test('everyone sees the 17 defaults; a custom category belongs to its creator only', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const defaults = (await alice.api.get('/categories')).body.data;
    expect(defaults).toHaveLength(17);
    expect(defaults.every((c) => c.isDefault)).toBe(true);
    expect((await alice.api.get('/categories?type=INCOME')).body.data).toHaveLength(5);

    const created = await alice.api.post('/categories', { name: 'Pet care', type: 'EXPENSE', color: '#336699' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: 'Pet care', type: 'EXPENSE', color: '#336699', isDefault: false });
    expect((await alice.api.get('/categories')).body.data).toHaveLength(18);
    expect((await bob.api.get('/categories')).body.data).toHaveLength(17);

    // Bob can neither edit, delete nor file a transaction under Alice's category.
    const id = created.body.data.id;
    expect((await bob.api.put(`/categories/${id}`, { name: 'Mine now' })).status).toBe(404);
    expect((await bob.api.del(`/categories/${id}`)).status).toBe(404);
    const misuse = await bob.api.post('/transactions', { type: 'EXPENSE', categoryId: id, amount: '5', currency: 'INR', date: TODAY, description: 'x' });
    expect(misuse.status).toBe(400);
    expect(misuse.body.error.details[0].field).toBe('body.categoryId');
  });

  test('names must be unique per user and type, and defaults cannot be changed', async () => {
    const { api, categories } = await newUser();
    expect((await api.post('/categories', { name: 'Groceries', type: 'EXPENSE' })).status).toBe(409);
    expect((await api.post('/categories', { name: 'Side jobs', type: 'INCOME' })).status).toBe(201);
    expect((await api.post('/categories', { name: 'side jobs', type: 'INCOME' })).status).toBe(409);
    expect((await api.put(`/categories/${categories.Groceries}`, { name: 'Renamed' })).status).toBe(404);
    expect((await api.del(`/categories/${categories.Groceries}`)).status).toBe(404);
    expect((await api.post('/categories', { name: '', type: 'EXPENSE', color: 'red' })).status).toBe(400);
  });

  test('an unused category is deleted; a used one is archived and its history kept', async () => {
    const { api, add } = await newUser();
    const unused = (await api.post('/categories', { name: 'Unused', type: 'EXPENSE' })).body.data.id;
    const used = (await api.post('/categories', { name: 'Hobby', type: 'EXPENSE' })).body.data.id;
    const txn = await add({ categoryId: used });

    expect((await api.del(`/categories/${unused}`)).body.data).toEqual({ outcome: 'deleted' });
    expect((await api.del(`/categories/${used}`)).body.data).toEqual({ outcome: 'archived' });
    const names = (await api.get('/categories')).body.data.map((c) => c.name);
    expect(names).not.toContain('Unused');
    expect(names).not.toContain('Hobby');
    expect((await api.get('/categories?includeArchived=true')).body.data.map((c) => c.name)).toContain('Hobby');
    expect((await api.get(`/transactions/${txn.id}`)).body.data.category.name).toBe('Hobby');
    // An archived category cannot take new transactions.
    expect((await api.post('/transactions', { type: 'EXPENSE', categoryId: used, amount: '5', currency: 'INR', date: TODAY, description: 'x' })).status).toBe(400);
  });
});

describe('transactions', () => {
  test('an entry in the main currency is stored exactly, with rate 1', async () => {
    const { add } = await newUser();
    const txn = await add({ amount: '1200.5', description: 'Weekly shop', paymentMethod: 'UPI' });
    expect(txn).toMatchObject({
      type: 'EXPENSE', amount: '1200.50', currency: 'INR', baseAmount: '1200.50', baseCurrency: 'INR', exchangeRate: '1.00000000',
      description: 'Weekly shop', paymentMethod: 'UPI', date: TODAY, hasNotes: false, notes: null,
    });
    expect(txn.category.name).toBe('Groceries');
  });

  test('a foreign-currency entry keeps its original amount and records the rate used', async () => {
    const { add, id } = await newUser();
    const txn = await add({ amount: '20.00', currency: 'USD', description: 'Cloud storage' });
    expect(txn).toMatchObject({ amount: '20.00', currency: 'USD', baseAmount: '1800.00', baseCurrency: 'INR', exchangeRate: '90.00000000' });
    const [row] = await database.query(
      'SELECT t.amount, t.currency_code, t.exchange_rate_id, r.rate, r.source FROM transactions t JOIN exchange_rates r ON r.id = t.exchange_rate_id WHERE t.user_id = ?',
      [id]
    );
    expect(row).toMatchObject({ amount: '20.00', currency_code: 'USD', rate: '90.00000000' }); // traceable to a stored snapshot
  });

  test('money is exact: large amounts and awkward decimals do not drift', async () => {
    const { add, api } = await newUser();
    await add({ amount: '0.10' });
    await add({ amount: '0.20' });
    await add({ amount: '9999999999999.99', type: 'INCOME', categoryId: (await newUser()).categories.Salary });
    const summary = (await api.get('/analytics/summary')).body.data;
    expect(summary.expense).toBe('0.30');
    expect(summary.income).toBe('9999999999999.99');
    expect(summary.net).toBe('9999999999999.69');
  });

  test('invalid entries are rejected field by field', async () => {
    const { api, categories } = await newUser();
    const base = { type: 'EXPENSE', categoryId: categories.Groceries, amount: '10', currency: 'INR', date: TODAY, description: 'ok' };
    const cases = [
      [{ amount: '0' }, 'body.amount'],
      [{ amount: '-5' }, 'body.amount'],
      [{ amount: '1.999' }, 'body.amount'],
      [{ amount: 'ten' }, 'body.amount'],
      [{ amount: '100.50', currency: 'JPY' }, 'body.amount'],
      [{ currency: 'BTC' }, 'body.currency'],
      [{ date: '2026-02-30' }, 'body.date'],
      [{ date: addDays(TODAY, 5) }, 'body.date'],
      [{ description: '   ' }, 'body.description'],
      [{ description: 'x'.repeat(256) }, 'body.description'],
      [{ type: 'TRANSFER' }, 'body.type'],
      [{ categoryId: categories.Salary }, 'body.categoryId'], // an income category for an expense
      [{ categoryId: 999999999 }, 'body.categoryId'],
      [{ paymentMethod: 'CHEQUE' }, 'body.paymentMethod'],
    ];
    for (const [change, field] of cases) {
      const res = await api.post('/transactions', { ...base, ...change });
      expect([JSON.stringify(change), res.status]).toEqual([JSON.stringify(change), 400]);
      expect(res.body.error.details.map((d) => d.field)).toContain(field);
    }
    expect((await api.get('/transactions')).body.data).toHaveLength(0);
  });

  test('markup and SQL in text fields are stored and returned as plain text', async () => {
    const { add, api } = await newUser();
    const description = `<img src=x onerror=alert(1)> '; DROP TABLE transactions; --`;
    const txn = await add({ description });
    expect(txn.description).toBe(description);
    expect((await api.get('/transactions')).body.data).toHaveLength(1);
    const [row] = await database.query('SELECT COUNT(*) AS n FROM transactions');
    expect(row.n).toBeGreaterThan(0);
  });

  test('notes are encrypted at rest and only returned on the detail view', async () => {
    const { add, api, id } = await newUser();
    const txn = await add({ notes: 'Split with flatmate, owed 600' });
    expect(txn.notes).toBe('Split with flatmate, owed 600');
    const [row] = await database.query('SELECT notes_enc FROM transactions WHERE user_id = ?', [id]);
    expect(row.notes_enc).toMatch(/^v1\./);
    expect(row.notes_enc).not.toContain('flatmate');
    const listed = (await api.get('/transactions')).body.data[0];
    expect(listed.hasNotes).toBe(true);
    expect(listed).not.toHaveProperty('notes');
  });

  test('filters, search, sorting and pagination', async () => {
    const { add, api, categories } = await newUser();
    await add({ amount: '50000', type: 'INCOME', categoryId: categories.Salary, description: 'Monthly salary', date: addDays(TODAY, -3) });
    await add({ amount: '300', description: 'Vegetables', date: addDays(TODAY, -2), paymentMethod: 'CASH' });
    await add({ amount: '900', description: '50% off shoes', categoryId: categories.Shopping, date: addDays(TODAY, -1), paymentMethod: 'CARD' });
    await add({ amount: '10', currency: 'EUR', description: 'Ebook', categoryId: categories.Education });
    const ids = async (query) => (await api.get(`/transactions?${query}`)).body.data.map((t) => t.description);

    expect(await ids('type=INCOME')).toEqual(['Monthly salary']);
    expect(await ids(`categoryId=${categories.Shopping}`)).toEqual(['50% off shoes']);
    expect(await ids(`from=${addDays(TODAY, -2)}&to=${addDays(TODAY, -1)}`)).toEqual(['50% off shoes', 'Vegetables']);
    expect(await ids('minAmount=500&maxAmount=1500')).toEqual(['Ebook', '50% off shoes']); // Ebook = 1000 INR
    expect(await ids('search=veg')).toEqual(['Vegetables']);
    expect(await ids(`search=${encodeURIComponent('50%')}`)).toEqual(['50% off shoes']); // % is literal, not a wildcard
    expect(await ids(`search=${encodeURIComponent('_')}`)).toEqual([]);
    expect(await ids('paymentMethod=CASH')).toEqual(['Vegetables']);
    expect(await ids('foreignOnly=true')).toEqual(['Ebook']);
    expect(await ids('currency=EUR')).toEqual(['Ebook']);
    expect(await ids('sort=amount&order=asc')).toEqual(['Vegetables', '50% off shoes', 'Ebook', 'Monthly salary']);

    const paged = await api.get('/transactions?page=2&pageSize=3');
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.meta.pagination).toEqual({ page: 2, pageSize: 3, totalItems: 4, totalPages: 2 });
    for (const bad of ['pageSize=500', 'page=0', 'sort=password_hash', 'order=sideways', `from=${TODAY}&to=${addDays(TODAY, -1)}`, 'type=x']) {
      expect([bad, (await api.get(`/transactions?${bad}`)).status]).toEqual([bad, 400]);
    }
  });

  test('editing text keeps the stored rate; changing the currency re-converts', async () => {
    const { add, api, id, categories } = await newUser();
    const txn = await add({ amount: '20', currency: 'USD' });
    const body = { type: 'EXPENSE', categoryId: categories.Groceries, amount: '20', currency: 'USD', date: TODAY, description: 'Renamed' };

    // Pretend the market moved: a rename must not re-price the entry.
    await database.query('UPDATE transactions SET exchange_rate = 91, base_amount = 1820 WHERE user_id = ?', [id]);
    const renamed = await api.put(`/transactions/${txn.id}`, body);
    expect(renamed.body.data).toMatchObject({ description: 'Renamed', exchangeRate: '91.00000000', baseAmount: '1820.00' });

    const recurrencied = await api.put(`/transactions/${txn.id}`, { ...body, currency: 'EUR' });
    expect(recurrencied.body.data).toMatchObject({ amount: '20.00', currency: 'EUR', exchangeRate: '100.00000000', baseAmount: '2000.00' });
  });

  test('deleting is a soft delete: gone from lists and totals, kept in the table', async () => {
    const { add, api, id } = await newUser();
    const txn = await add({ amount: '750' });
    expect((await api.del(`/transactions/${txn.id}`)).status).toBe(204);
    expect((await api.get(`/transactions/${txn.id}`)).status).toBe(404);
    expect((await api.del(`/transactions/${txn.id}`)).status).toBe(404);
    expect((await api.get('/transactions')).body.data).toHaveLength(0);
    expect((await api.get('/analytics/summary')).body.data.expense).toBe('0.00');
    const [row] = await database.query('SELECT deleted_at FROM transactions WHERE user_id = ?', [id]);
    expect(row.deleted_at).not.toBeNull();
  });

  test("one user cannot read, change or delete another user's transaction", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const txn = await alice.add({ description: 'Private purchase', notes: 'secret' });
    const body = { type: 'EXPENSE', categoryId: bob.categories.Groceries, amount: '1', currency: 'INR', date: TODAY, description: 'hijacked' };

    expect((await bob.api.get(`/transactions/${txn.id}`)).status).toBe(404);
    expect((await bob.api.put(`/transactions/${txn.id}`, body)).status).toBe(404);
    expect((await bob.api.del(`/transactions/${txn.id}`)).status).toBe(404);
    expect((await bob.api.get('/transactions')).body.data).toHaveLength(0);
    expect((await bob.api.get('/transactions?search=Private')).body.data).toHaveLength(0);
    expect((await bob.api.get('/reports/export')).text).not.toContain('Private purchase');
    // A user id smuggled into the request is ignored.
    const smuggled = await bob.api.post('/transactions', { ...body, userId: alice.id, user_id: alice.id });
    expect(smuggled.status).toBe(201);
    expect((await alice.api.get('/transactions')).body.data.map((t) => t.description)).toEqual(['Private purchase']);
    expect((await alice.api.get(`/transactions/${txn.id}`)).body.data.description).toBe('Private purchase');
  });
});

describe('budgets', () => {
  test('progress is computed from transactions and alerts fire once per level', async () => {
    const { add, api, categories } = await newUser();
    await add({ amount: '1200.50' });
    const created = await api.post('/budgets', { budgetType: 'CATEGORY', categoryId: categories.Groceries, month: MONTH, amount: '1500', alertThresholdPct: 80 });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ amount: '1500.00', spent: '1200.50', remaining: '299.50', percentUsed: 80, status: 'WARNING' });

    await add({ amount: '400' });
    await add({ amount: '50' });
    const list = (await api.get(`/budgets?month=${MONTH}`)).body.data;
    expect(list).toMatchObject({ month: MONTH, currency: 'INR', expense: '1650.50' });
    expect(list.budgets[0]).toMatchObject({ spent: '1650.50', remaining: '-150.50', percentUsed: 110, status: 'EXCEEDED' });

    const alerts = (await api.get('/notifications')).body.data.filter((n) => n.type === 'BUDGET_THRESHOLD');
    expect(alerts.map((n) => [n.severity, n.title]).sort()).toEqual([['CRITICAL', 'Over budget: Groceries'], ['WARNING', 'Budget alert: Groceries']]);
  });

  test('overall and savings-target budgets, validation and duplicates', async () => {
    const { add, api, categories } = await newUser();
    await add({ amount: '50000', type: 'INCOME', categoryId: categories.Salary });
    await add({ amount: '20000', categoryId: categories['Rent & Housing'] });
    expect((await api.post('/budgets', { budgetType: 'OVERALL', month: MONTH, amount: '40000' })).body.data).toMatchObject({ spent: '20000.00', percentUsed: 50, status: 'ON_TRACK', category: null });
    expect((await api.post('/budgets', { budgetType: 'SAVINGS_TARGET', month: MONTH, amount: '25000' })).body.data).toMatchObject({ saved: '30000.00', percentUsed: 120, status: 'REACHED' });

    expect((await api.post('/budgets', { budgetType: 'OVERALL', month: MONTH, amount: '1' })).status).toBe(409);
    expect((await api.post('/budgets', { budgetType: 'CATEGORY', month: MONTH, amount: '1' })).status).toBe(400); // no category
    expect((await api.post('/budgets', { budgetType: 'OVERALL', categoryId: categories.Groceries, month: MONTH, amount: '1' })).status).toBe(400);
    expect((await api.post('/budgets', { budgetType: 'CATEGORY', categoryId: categories.Salary, month: MONTH, amount: '1' })).status).toBe(400); // income category
    expect((await api.post('/budgets', { budgetType: 'OVERALL', month: '2026-13', amount: '1' })).status).toBe(400);
    expect((await api.post('/budgets', { budgetType: 'OVERALL', month: addMonths(MONTH, 1), amount: '0' })).status).toBe(400);
    expect((await api.post('/budgets', { budgetType: 'OVERALL', month: addMonths(MONTH, 1), amount: '1', alertThresholdPct: 150 })).status).toBe(400);
  });

  test('update, copy to another month, delete, and isolation between users', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const budget = (await alice.api.post('/budgets', { budgetType: 'CATEGORY', categoryId: alice.categories.Transport, month: MONTH, amount: '3000' })).body.data;
    await alice.api.post('/budgets', { budgetType: 'OVERALL', month: MONTH, amount: '40000' });

    expect((await alice.api.put(`/budgets/${budget.id}`, { amount: '3500', alertThresholdPct: 90 })).body.data).toMatchObject({ amount: '3500.00', alertThresholdPct: 90 });
    expect((await bob.api.put(`/budgets/${budget.id}`, { amount: '1' })).status).toBe(404);
    expect((await bob.api.del(`/budgets/${budget.id}`)).status).toBe(404);
    expect((await bob.api.get(`/budgets?month=${MONTH}`)).body.data.budgets).toHaveLength(0);

    const next = addMonths(MONTH, 1);
    expect((await alice.api.post('/budgets/copy', { fromMonth: MONTH, toMonth: next })).body.data).toEqual({ copied: 2 });
    expect((await alice.api.post('/budgets/copy', { fromMonth: MONTH, toMonth: next })).body.data).toEqual({ copied: 0 }); // nothing duplicated
    expect((await alice.api.get(`/budgets?month=${next}`)).body.data.budgets).toHaveLength(2);

    expect((await alice.api.del(`/budgets/${budget.id}`)).status).toBe(204);
    expect((await alice.api.get(`/budgets?month=${MONTH}`)).body.data.budgets).toHaveLength(1);
  });
});

describe('savings goals', () => {
  test('contributions and withdrawals keep the running total, and completion is announced once', async () => {
    const { api, id } = await newUser();
    const goal = (await api.post('/goals', { title: 'Emergency fund', targetAmount: '10000', currency: 'INR', deadline: '2030-01-01', notes: 'Three months of rent' })).body.data;
    expect(goal).toMatchObject({ savedAmount: '0.00', remaining: '10000.00', percent: 0, status: 'IN_PROGRESS', notes: 'Three months of rent' });
    expect(goal.daysLeft).toBeGreaterThan(0);
    const [row] = await database.query('SELECT notes_enc FROM savings_goals WHERE user_id = ?', [id]);
    expect(row.notes_enc).not.toContain('rent');

    const pay = (amount) => api.post(`/goals/${goal.id}/contributions`, { amount, date: TODAY });
    expect((await pay('4000')).body.data).toMatchObject({ savedAmount: '4000.00', percent: 40 });
    expect((await pay('-1500.25')).body.data).toMatchObject({ savedAmount: '2499.75', remaining: '7500.25' });
    const overdraw = await pay('-5000');
    expect(overdraw.status).toBe(400);
    expect(overdraw.body.error.details[0].message).toMatch(/at most 2499.75 INR/);
    expect((await pay('0')).status).toBe(400);

    const done = (await pay('7500.25')).body.data;
    expect(done).toMatchObject({ savedAmount: '10000.00', percent: 100, status: 'COMPLETED', remaining: '0.00' });
    expect(done.contributions.map((c) => c.amount)).toEqual(['7500.25', '-1500.25', '4000.00']);
    expect((await pay('-1')).body.data.status).toBe('IN_PROGRESS');
    await pay('1');
    const announcements = (await api.get('/notifications')).body.data.filter((n) => n.title === 'Goal reached: Emergency fund');
    expect(announcements).toHaveLength(1);
  });

  test('edit, cancel, reopen, delete, validation and isolation', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const goal = (await alice.api.post('/goals', { title: 'Laptop', targetAmount: '80000', currency: 'JPY' })).body.data;
    expect((await alice.api.post('/goals', { title: 'Bad', targetAmount: '100.50', currency: 'JPY' })).status).toBe(400);
    expect((await alice.api.post('/goals', { title: '', targetAmount: '0', currency: 'XYZ', deadline: 'soon' })).status).toBe(400);

    const cancelled = await alice.api.put(`/goals/${goal.id}`, { title: 'Laptop Pro', targetAmount: '90000', status: 'CANCELLED' });
    expect(cancelled.body.data).toMatchObject({ title: 'Laptop Pro', targetAmount: '90000.00', status: 'CANCELLED', currency: 'JPY' });
    expect((await alice.api.post(`/goals/${goal.id}/contributions`, { amount: '100', date: TODAY })).status).toBe(409);
    expect((await alice.api.put(`/goals/${goal.id}`, { title: 'Laptop Pro', targetAmount: '90000', status: 'IN_PROGRESS' })).body.data.status).toBe('IN_PROGRESS');

    expect((await bob.api.get(`/goals/${goal.id}`)).status).toBe(404);
    expect((await bob.api.put(`/goals/${goal.id}`, { title: 'x', targetAmount: '1' })).status).toBe(404);
    expect((await bob.api.post(`/goals/${goal.id}/contributions`, { amount: '1', date: TODAY })).status).toBe(404);
    expect((await bob.api.del(`/goals/${goal.id}`)).status).toBe(404);
    expect((await bob.api.get('/goals')).body.data).toHaveLength(0);

    expect((await alice.api.del(`/goals/${goal.id}`)).status).toBe(204);
    expect((await alice.api.get('/goals')).body.data).toHaveLength(0);
  });
});

describe('analytics and reports', () => {
  async function userWithActivity() {
    const user = await newUser();
    const { add, categories } = user;
    await add({ amount: '50000', type: 'INCOME', categoryId: categories.Salary, description: 'Monthly salary' });
    await add({ amount: '1200.50', description: 'Weekly shop' });
    await add({ amount: '20', currency: 'USD', categoryId: categories['Food & Dining'], description: 'Dinner abroad' }); // 1800 INR
    return user;
  }

  test('summary totals are exact and compared with the previous period', async () => {
    const { api } = await userWithActivity();
    const res = await api.get(`/analytics/summary?month=${MONTH}`);
    expect(res.body.data).toMatchObject({ currency: 'INR', income: '50000.00', expense: '3000.50', net: '46999.50', savingsRate: 94, transactionCount: 3 });
    expect(res.body.data.previousPeriod).toMatchObject({ income: '0.00', expense: '0.00' });
    expect(res.body.data.changes).toEqual({ income: null, expense: null, net: null });
    const empty = (await api.get(`/analytics/summary?from=2020-01-01&to=2020-01-31`)).body.data;
    expect(empty).toMatchObject({ income: '0.00', net: '0.00', savingsRate: null, transactionCount: 0 });
  });

  test('a month is compared with the previous calendar month, to the same day while it is running', () => {
    const { previousPeriod } = require('../../services/analytics.service');
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod('2024-03-01', '2024-03-31')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(previousPeriod('2026-03-10', '2026-03-19')).toEqual({ from: '2026-02-28', to: '2026-03-09' }); // a plain 10-day range

    const { start, end } = require('../../utils/period').monthRange(MONTH);
    const previous = previousPeriod(start, end);
    expect(previous.from).toBe(`${addMonths(MONTH, -1)}-01`);
    expect(previous.to <= `${addMonths(MONTH, -1)}-${TODAY.slice(8)}`).toBe(true); // month to date
  });

  test('days, weeks and years are compared with the previous one, to the same point while running', () => {
    const { previousPeriod } = require('../../services/analytics.service');
    const later = '2030-01-01'; // all of these periods are over
    expect(previousPeriod('2026-11-18', '2026-11-18', later)).toEqual({ from: '2026-11-17', to: '2026-11-17' });
    expect(previousPeriod('2026-11-16', '2026-11-22', later)).toEqual({ from: '2026-11-09', to: '2026-11-15' }); // Monday to Sunday
    expect(previousPeriod('2026-01-01', '2026-12-31', later)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    // running: Wednesday of the week, 18 November of the year, 18th of the month
    expect(previousPeriod('2026-11-16', '2026-11-22', '2026-11-18')).toEqual({ from: '2026-11-09', to: '2026-11-11' });
    expect(previousPeriod('2026-01-01', '2026-12-31', '2026-11-18')).toEqual({ from: '2025-01-01', to: '2025-11-18' });
    expect(previousPeriod('2026-11-01', '2026-11-30', '2026-11-18')).toEqual({ from: '2026-10-01', to: '2026-10-18' });
    expect(previousPeriod('2026-03-01', '2026-03-31', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' }); // last day: whole months
    // a seven-day range that does not start on a Monday is a plain range
    expect(previousPeriod('2026-11-18', '2026-11-24', later)).toEqual({ from: '2026-11-11', to: '2026-11-17' });
  });

  test('categories accept any date range, for income or expenses', async () => {
    const { api } = await userWithActivity();
    const income = (await api.get(`/analytics/categories?from=${TODAY}&to=${TODAY}&type=INCOME`)).body.data;
    expect(income).toMatchObject({ type: 'INCOME', total: '50000.00', period: { from: TODAY, to: TODAY } });
    expect(income.categories.map((c) => c.name)).toEqual(['Salary']);
  });

  test('monthly trend lists every month, including empty ones', async () => {
    const { api } = await userWithActivity();
    const { months } = (await api.get('/analytics/monthly?months=4')).body.data;
    expect(months.map((m) => m.month)).toEqual([addMonths(MONTH, -3), addMonths(MONTH, -2), addMonths(MONTH, -1), MONTH]);
    expect(months[3]).toMatchObject({ income: '50000.00', expense: '3000.50', net: '46999.50' });
    expect(months[0]).toMatchObject({ income: '0.00', expense: '0.00', savingsRate: null });
    expect((await api.get('/analytics/monthly?months=99')).status).toBe(400);
  });

  test('category breakdown adds up to 100 percent', async () => {
    const { api } = await userWithActivity();
    const data = (await api.get('/analytics/categories')).body.data;
    expect(data.total).toBe('3000.50');
    expect(data.categories.map((c) => [c.name, c.total, c.percent])).toEqual([['Food & Dining', '1800.00', 60], ['Groceries', '1200.50', 40]]);
    expect((await api.get('/analytics/categories?type=INCOME')).body.data.categories[0]).toMatchObject({ name: 'Salary', percent: 100 });
  });

  test('the dashboard bundle has every section', async () => {
    const { api } = await userWithActivity();
    await api.post('/budgets', { budgetType: 'OVERALL', month: MONTH, amount: '40000' });
    await api.post('/goals', { title: 'Trip', targetAmount: '5000', currency: 'INR' });
    const data = (await api.get('/analytics/dashboard')).body.data;
    expect(data.summary.net).toBe('46999.50');
    expect(data.trend).toHaveLength(6);
    expect(data.topCategories[0].name).toBe('Food & Dining');
    expect(data.recentTransactions).toHaveLength(3);
    expect(data.budgets).toHaveLength(1);
    expect(data.goals.map((g) => g.title)).toEqual(['Trip']);
    expect(typeof data.unreadNotifications).toBe('number');
  });

  test('the monthly report covers categories, days, payment methods and largest expenses', async () => {
    const { api } = await userWithActivity();
    const report = (await api.get(`/reports/monthly?month=${MONTH}`)).body.data;
    expect(report.summary.expense).toBe('3000.50');
    expect(report.expenseCategories).toHaveLength(2);
    expect(report.incomeCategories).toHaveLength(1);
    expect(report.daily).toEqual([{ date: TODAY, income: '50000.00', expense: '3000.50' }]);
    expect(report.largestExpenses.map((e) => e.description)).toEqual(['Dinner abroad', 'Weekly shop']);
    expect(report.paymentMethods[0]).toMatchObject({ paymentMethod: 'OTHER', total: '3000.50' });
  });

  test('CSV export is a download, shows original and converted amounts, and defuses formulas', async () => {
    const { api, add } = await userWithActivity();
    await add({ amount: '5', description: '=HYPERLINK("http://evil.example","Click")' });
    await add({ amount: '6', description: 'He said "hi", twice' });
    const res = await api.get('/reports/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="fintrack-transactions-.*\.csv"/);
    const lines = res.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('"Amount","Currency","Exchange rate","Amount in main currency"');
    expect(res.text).toContain('"Dinner abroad","OTHER",20.00,"USD",90.00000000,1800.00,"INR"');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
    expect(res.text).toContain('"He said ""hi"", twice"');
    expect((await api.get('/reports/export?type=INCOME')).text.trim().split('\r\n')).toHaveLength(2);
  });
});

describe('currencies', () => {
  test('lists currencies, stored rates and converts with a traceable rate', async () => {
    const { api, add } = await newUser();
    await add({ amount: '1', currency: 'USD' }); // makes sure rate snapshots exist
    const list = (await api.get('/currencies')).body.data;
    expect(list.baseCurrency).toBe('INR');
    expect(list.currencies.map((c) => c.code)).toEqual(['EUR', 'GBP', 'INR', 'JPY', 'USD']);

    const rates = (await api.get('/currencies/rates?base=USD')).body.data;
    expect(rates.base).toBe('USD');
    expect(rates.rates.find((r) => r.currency === 'INR')).toMatchObject({ rate: '90.00000000', source: 'frankfurter' });

    const converted = (await api.get('/currencies/convert?amount=250&from=USD&to=INR')).body.data;
    expect(converted).toMatchObject({ result: '22500.00', rate: '90.00000000' });
    expect((await api.get('/currencies/convert?amount=1000&from=INR&to=JPY')).body.data.result).toBe('1667.00'); // yen has no decimals
    expect((await api.get('/currencies/convert?amount=5&from=INR&to=INR')).body.data.result).toBe('5.00');
    expect((await api.get('/currencies/convert?amount=5&from=INR&to=XXX')).status).toBe(400);
  });

  test('refresh stores new snapshots, and an outage leaves stored rates usable', async () => {
    const { api, add } = await newUser();
    const refreshed = await api.post('/currencies/rates/refresh');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.rates).toHaveLength(4);

    fxClient.fetchRates.mockRejectedValue(new Error('network down'));
    const failed = await api.post('/currencies/rates/refresh');
    expect(failed.status).toBe(503);
    expect(JSON.stringify(failed.body)).not.toMatch(/network down/);
    // Transactions still convert, using the nearest stored snapshot.
    expect((await add({ amount: '10', currency: 'GBP' })).baseAmount).toBe('1200.00');
  });

  test('changing the main currency re-values everything without touching original amounts', async () => {
    const { api, add, categories, id } = await newUser();
    const rupees = await add({ amount: '1200.50' });
    const dollars = await add({ amount: '20', currency: 'USD' });
    await api.post('/budgets', { budgetType: 'CATEGORY', categoryId: categories.Groceries, month: MONTH, amount: '9000' });

    const res = await api.put('/currencies/base', { baseCurrency: 'USD' });
    expect(res.body.data).toMatchObject({ baseCurrency: 'USD', previousBaseCurrency: 'INR', transactionsConverted: 2, budgetsConverted: 1 });

    expect((await api.get(`/transactions/${rupees.id}`)).body.data).toMatchObject({ amount: '1200.50', currency: 'INR', baseCurrency: 'USD', baseAmount: '13.34' });
    expect((await api.get(`/transactions/${dollars.id}`)).body.data).toMatchObject({ amount: '20.00', currency: 'USD', baseCurrency: 'USD', baseAmount: '20.00', exchangeRate: '1.00000000' });
    expect((await api.get('/analytics/summary')).body.data).toMatchObject({ currency: 'USD', expense: '33.34' });
    expect((await api.get(`/budgets?month=${MONTH}`)).body.data.budgets[0].amount).toBe('100.00');
    expect((await api.get('/users/profile')).body.data.baseCurrency).toBe('USD');
    const events = await database.query("SELECT event_type FROM security_events WHERE user_id = ? AND event_type = 'BASE_CURRENCY_CHANGED'", [id]);
    expect(events).toHaveLength(1);

    expect((await api.put('/currencies/base', { baseCurrency: 'USD' })).body.data.transactionsConverted).toBe(0); // no-op
    expect((await api.put('/currencies/base', { baseCurrency: 'DOGE' })).status).toBe(400);
  });
});

describe('notifications', () => {
  test('each new transaction is confirmed, with the converted amount when the currency differs', async () => {
    const { add, api, categories } = await newUser();
    await add({ amount: '1200.50', description: 'Weekly shop' });
    await add({ amount: '20', currency: 'USD', categoryId: categories['Food & Dining'], description: 'Dinner abroad' });
    await add({ amount: '50000', type: 'INCOME', categoryId: categories.Salary, description: 'Monthly salary' });
    const confirmations = (await api.get('/notifications')).body.data.filter((n) => n.type === 'TRANSACTION');
    expect(confirmations.map((n) => n.title)).toEqual(['Income recorded', 'Expense recorded', 'Expense recorded']);
    expect(confirmations.map((n) => n.severity)).toEqual(['INFO', 'INFO', 'INFO']);
    expect(confirmations[1].message).toBe(`$20.00 (₹1,800.00) for Food & Dining: "Dinner abroad" on ${TODAY}.`);
    expect(confirmations[2].message).toBe(`₹1,200.50 for Groceries: "Weekly shop" on ${TODAY}.`);
    expect(confirmations[0].message).toContain('from Salary');
  });

  test('an expense far above the usual for its category is flagged', async () => {
    const { add, api, categories } = await newUser();
    for (let i = 0; i < 5; i += 1) await add({ amount: '100', categoryId: categories.Transport, description: 'Cab ride' });
    await add({ amount: '250', categoryId: categories.Transport, description: 'Airport cab' }); // 2.5x: not flagged
    await add({ amount: '1000', categoryId: categories.Transport, description: 'Limousine' });
    const flagged = (await api.get('/notifications')).body.data.filter((n) => n.type === 'UNUSUAL_SPENDING');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toContain('"Limousine"');
    expect(flagged[0].severity).toBe('WARNING');
  });

  test('read, read all, delete and unread count, each limited to the owner', async () => {
    const alice = await newUser();
    const bob = await newUser();
    await alice.api.post('/budgets', { budgetType: 'OVERALL', month: MONTH, amount: '100' });
    await alice.add({ amount: '90' }); // warning
    await alice.add({ amount: '90' }); // exceeded
    // two budget alerts and two transaction confirmations
    expect((await alice.api.get('/notifications/unread-count')).body.data).toEqual({ unreadCount: 4 });
    const list = await alice.api.get('/notifications');
    expect(list.body.meta).toMatchObject({ unreadCount: 4, pagination: { totalItems: 4 } });
    const [first, ...others] = list.body.data;

    expect((await bob.api.patch(`/notifications/${first.id}/read`)).status).toBe(404);
    expect((await bob.api.del(`/notifications/${first.id}`)).status).toBe(404);
    expect((await bob.api.get('/notifications')).body.data).toHaveLength(0);
    expect((await bob.api.post('/notifications/read-all')).body.data).toEqual({ updated: 0 });

    expect((await alice.api.patch(`/notifications/${first.id}/read`)).status).toBe(204);
    expect((await alice.api.get('/notifications?unreadOnly=true')).body.data.map((n) => n.id)).toEqual(others.map((n) => n.id));
    expect((await alice.api.post('/notifications/read-all')).body.data).toEqual({ updated: 3 });
    expect((await alice.api.del(`/notifications/${first.id}`)).status).toBe(204);
    expect((await alice.api.get('/notifications')).body.data).toHaveLength(3);
    expect((await alice.api.get('/notifications/unread-count')).body.data).toEqual({ unreadCount: 0 });
  });

  test('last month is summarised the first time notifications are opened', async () => {
    const { api, id, categories } = await newUser();
    const lastMonth = `${addMonths(MONTH, -1)}-15`;
    await database.query(
      `INSERT INTO transactions (user_id, category_id, type, amount, currency_code, base_currency, base_amount, description, txn_date)
       VALUES (?, ?, 'INCOME', 1000, 'INR', 'INR', 1000, 'Old income', ?), (?, ?, 'EXPENSE', 400, 'INR', 'INR', 400, 'Old expense', ?)`,
      [id, categories.Salary, lastMonth, id, categories.Groceries, lastMonth]
    );
    await api.get('/notifications');
    const summaries = (await api.get('/notifications')).body.data.filter((n) => n.type === 'MONTHLY_SUMMARY');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].message).toMatch(/60% of income saved/);
  });
});
