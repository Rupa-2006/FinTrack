// Recurring transactions against the real test database: dates of each occurrence, catching
// up, no duplicates (even when generation runs twice at once), pausing, end dates, deletion,
// validation and isolation between users.
const request = require('supertest');
const { createApp } = require('../../app');
const database = require('../../config/database');
const fxClient = require('../../services/fxClient');
const recurring = require('../../services/recurring.service');
const audit = require('../../services/audit.service');
const { today, addDays } = require('../../utils/period');

const RELAXED = { windowMs: 60000, limit: 100000 };
const app = createApp({ globalRateLimit: RELAXED, authRateLimits: { login: RELAXED, register: RELAXED, passwordReset: RELAXED, refresh: RELAXED } });
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TODAY = today();
let counter = 0;

const INR_PER_UNIT = { INR: 1, USD: 90, EUR: 100, GBP: 120, JPY: 0.6 };
function fakeRates(base, date) {
  const rates = {};
  for (const code of Object.keys(INR_PER_UNIT)) if (code !== base) rates[code] = String(INR_PER_UNIT[base] / INR_PER_UNIT[code]);
  return Promise.resolve({ date: date === 'latest' ? TODAY : date, rates });
}

async function newUser() {
  counter += 1;
  const res = await request(app).post('/api/auth/register').set('X-Requested-With', 'XMLHttpRequest')
    .send({ fullName: 'Recurring Tester', email: `recur${counter}.${RUN}@example.test`, password: 'Tr1cky-Horse-Battery!' });
  const token = res.body.data.accessToken;
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  const api = {
    get: (p) => auth(request(app).get(`/api${p}`)),
    post: (p, b) => auth(request(app).post(`/api${p}`)).send(b),
    put: (p, b) => auth(request(app).put(`/api${p}`)).send(b),
    del: (p) => auth(request(app).delete(`/api${p}`)),
  };
  const categories = Object.fromEntries((await api.get('/categories')).body.data.map((c) => [c.name, c.id]));
  return { id: res.body.data.user.id, api, categories };
}

const rule = (categories, overrides = {}) => ({
  type: 'EXPENSE', categoryId: categories['Rent & Housing'], amount: '24000.00', currency: 'INR', description: 'Monthly rent',
  paymentMethod: 'BANK_TRANSFER', frequency: 'MONTHLY', startDate: TODAY, ...overrides,
});
const generated = async (userId, ruleId) => database.query(
  'SELECT txn_date, amount, base_amount, deleted_at FROM transactions WHERE user_id = ? AND recurring_rule_id = ? ORDER BY txn_date', [userId, ruleId]
);

beforeEach(() => jest.spyOn(fxClient, 'fetchRates').mockImplementation(fakeRates));
afterAll(async () => {
  await database.close();
});

describe('occurrence dates', () => {
  test('monthly rules keep their day, falling back to the last day of shorter months', () => {
    expect([0, 1, 2, 3].map((n) => recurring.occurrence('2026-01-31', 'MONTHLY', n))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(recurring.occurrence('2028-01-31', 'MONTHLY', 1)).toBe('2028-02-29'); // leap year
    expect(recurring.occurrence('2026-11-15', 'MONTHLY', 2)).toBe('2027-01-15');
  });

  test('weekly and yearly rules', () => {
    expect([0, 1, 2].map((n) => recurring.occurrence('2026-12-25', 'WEEKLY', n))).toEqual(['2026-12-25', '2027-01-01', '2027-01-08']);
    expect([0, 1, 4].map((n) => recurring.occurrence('2028-02-29', 'YEARLY', n))).toEqual(['2028-02-29', '2029-02-28', '2032-02-29']);
  });
});

describe('creating and generating', () => {
  test('a rule that started in the past catches up at once, through the normal transaction path', async () => {
    const { id, api, categories } = await newUser();
    const start = addDays(TODAY, -21);
    const res = await api.post('/recurring', rule(categories, { frequency: 'WEEKLY', startDate: start, description: 'Weekly cleaner', amount: '800' }));
    expect(res.status).toBe(201);
    expect(res.body.data.generated).toBe(4); // start, +7, +14, +21 (today)
    expect(res.body.data.rule).toMatchObject({
      status: 'ACTIVE', frequency: 'WEEKLY', amount: '800.00', generatedCount: 4, lastGeneratedDate: TODAY, nextDate: addDays(TODAY, 7),
    });
    const rows = await generated(id, res.body.data.rule.id);
    expect(rows.map((r) => r.txn_date)).toEqual([start, addDays(start, 7), addDays(start, 14), TODAY]);

    const listed = (await api.get('/transactions?search=cleaner')).body.data;
    expect(listed).toHaveLength(4);
    expect(listed.every((t) => t.recurringRuleId === res.body.data.rule.id)).toBe(true);
    const confirmations = (await api.get('/notifications')).body.data.filter((n) => n.type === 'TRANSACTION');
    expect(confirmations[0].title).toBe('Recurring expense recorded');
    const audits = await database.query("SELECT action FROM audit_logs WHERE user_id = ? AND action IN ('RECURRING_CREATED', 'TRANSACTION_CREATED')", [id]);
    expect(audits.filter((a) => a.action === 'TRANSACTION_CREATED')).toHaveLength(4);
  });

  test('a foreign-currency rule converts each occurrence at its own date', async () => {
    const { id, api, categories } = await newUser();
    const res = await api.post('/recurring', rule(categories, { categoryId: categories.Subscriptions, amount: '9.99', currency: 'USD', description: 'Cloud storage' }));
    const [row] = await generated(id, res.body.data.rule.id);
    expect(row).toMatchObject({ amount: '9.99', base_amount: '899.10' }); // 9.99 x 90
  });

  test('running generation again, or twice at the same time, never duplicates an occurrence', async () => {
    const { id, api, categories } = await newUser();
    const res = await api.post('/recurring', rule(categories, { startDate: addDays(TODAY, 1) }));
    expect(res.body.data.generated).toBe(0);
    // let time "pass": the rule is now due for five weekly occurrences
    await database.query('UPDATE recurring_rules SET frequency = ?, start_date = ?, next_date = ? WHERE id = ?',
      ['WEEKLY', addDays(TODAY, -28), addDays(TODAY, -28), res.body.data.rule.id]);
    const counts = await Promise.all([recurring.generateDue(id), recurring.generateDue(id), recurring.generateDue(id)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(await generated(id, res.body.data.rule.id)).toHaveLength(5);
    expect(await recurring.generateDue(id)).toBe(0);
  });

  test('opening the transactions list or the dashboard creates what has fallen due', async () => {
    const { id, api, categories } = await newUser();
    const res = await api.post('/recurring', rule(categories, { startDate: addDays(TODAY, 1) }));
    await database.query('UPDATE recurring_rules SET start_date = ?, next_date = ? WHERE id = ?', [TODAY, TODAY, res.body.data.rule.id]);
    expect((await api.get('/transactions')).body.data.map((t) => t.description)).toContain('Monthly rent');
    expect(await generated(id, res.body.data.rule.id)).toHaveLength(1);
    expect((await api.get('/analytics/dashboard')).status).toBe(200);
    expect(await generated(id, res.body.data.rule.id)).toHaveLength(1);
  });

  test('a deleted occurrence is not created again', async () => {
    const { id, api, categories } = await newUser();
    const res = await api.post('/recurring', rule(categories));
    const [txn] = (await api.get('/transactions')).body.data;
    expect((await api.del(`/transactions/${txn.id}`)).status).toBe(204);
    expect(await recurring.generateDue(id)).toBe(0);
    expect((await api.get('/transactions')).body.data).toHaveLength(0);
    expect((await generated(id, res.body.data.rule.id))[0].deleted_at).not.toBeNull();
  });
});

describe('changing, pausing, ending and deleting', () => {
  test('a paused rule creates nothing; resuming catches up', async () => {
    const { id, api, categories } = await newUser();
    const created = (await api.post('/recurring', rule(categories, { startDate: addDays(TODAY, 1) }))).body.data.rule;
    const body = { ...rule(categories), paused: true };
    delete body.frequency;
    delete body.startDate;
    expect((await api.put(`/recurring/${created.id}`, body)).body.data.rule.status).toBe('PAUSED');
    await database.query('UPDATE recurring_rules SET start_date = ?, next_date = ? WHERE id = ?', [addDays(TODAY, -40), addDays(TODAY, -40), created.id]);
    expect(await recurring.generateDue(id)).toBe(0);
    const resumed = await api.put(`/recurring/${created.id}`, { ...body, paused: false, amount: '25000' });
    expect(resumed.body.data).toMatchObject({ generated: 2, rule: { status: 'ACTIVE', amount: '25000.00' } });
    const [audit] = await database.query("SELECT details FROM audit_logs WHERE resource_type = 'recurring_rule' AND resource_id = ? AND action = 'RECURRING_UPDATED' ORDER BY id DESC LIMIT 1", [String(created.id)]);
    expect((typeof audit.details === 'string' ? JSON.parse(audit.details) : audit.details).fields.sort()).toEqual(['amount', 'paused']);
  });

  test('an end date stops the rule and marks it finished', async () => {
    const { api, categories } = await newUser();
    const res = await api.post('/recurring', rule(categories, { frequency: 'WEEKLY', startDate: addDays(TODAY, -28), endDate: addDays(TODAY, -14) }));
    expect(res.body.data).toMatchObject({ generated: 3, rule: { status: 'FINISHED', nextDate: null, generatedCount: 3 } });
  });

  test('deleting a rule keeps the transactions it created', async () => {
    const { id, api, categories } = await newUser();
    const created = (await api.post('/recurring', rule(categories))).body.data.rule;
    expect((await api.del(`/recurring/${created.id}`)).status).toBe(204);
    expect((await api.get('/recurring')).body.data).toEqual([]);
    const [kept] = await database.query("SELECT recurring_rule_id FROM transactions WHERE user_id = ? AND description = 'Monthly rent'", [id]);
    expect(kept.recurring_rule_id).toBeNull();
    expect(await audit.verifyChain()).toMatchObject({ valid: true });
  });
});

describe('validation and isolation', () => {
  test.each([
    ['a start more than a year ago', { startDate: addDays(TODAY, -400) }, 'body.startDate'],
    ['an end before the start', { endDate: addDays(TODAY, -1) }, 'body.endDate'],
    ['decimals for yen', { currency: 'JPY', amount: '100.50' }, 'body.amount'],
    ['an income category for an expense', { categoryId: 'SALARY' }, 'body.categoryId'],
    ['an unknown frequency', { frequency: 'DAILY' }, 'body.frequency'],
  ])('refuses %s', async (_name, overrides, field) => {
    const { api, categories } = await newUser();
    const body = rule(categories, overrides);
    if (overrides.categoryId === 'SALARY') body.categoryId = categories.Salary;
    const res = await api.post('/recurring', body);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  test("another user can neither see, change nor delete someone's rule", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const created = (await alice.api.post('/recurring', rule(alice.categories, { startDate: addDays(TODAY, 3) }))).body.data.rule;
    expect((await bob.api.get('/recurring')).body.data).toEqual([]);
    const body = { ...rule(bob.categories), paused: true };
    delete body.frequency;
    delete body.startDate;
    expect((await bob.api.put(`/recurring/${created.id}`, body)).status).toBe(404);
    expect((await bob.api.del(`/recurring/${created.id}`)).status).toBe(404);
    expect((await alice.api.get('/recurring')).body.data).toHaveLength(1);
  });
});
