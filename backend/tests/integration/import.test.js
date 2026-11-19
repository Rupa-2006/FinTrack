// Importing transactions from file rows, against the real test database.
const request = require('supertest');
const { createApp } = require('../../app');
const database = require('../../config/database');
const fxClient = require('../../services/fxClient');
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
    .send({ fullName: 'Import Tester', email: `import${counter}.${RUN}@example.test`, password: 'Tr1cky-Horse-Battery!' });
  const token = res.body.data.accessToken;
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  const api = {
    get: (p) => auth(request(app).get(`/api${p}`)),
    post: (p, b) => auth(request(app).post(`/api${p}`)).send(b),
  };
  const categories = Object.fromEntries((await api.get('/categories')).body.data.map((c) => [c.name, c.id]));
  return { id: res.body.data.user.id, api, categories };
}

const YESTERDAY = addDays(TODAY, -1);
const ROWS = [
  { date: YESTERDAY, type: 'expense', amount: '1200.50', currency: 'inr', description: 'Weekly shop', category: 'groceries', paymentMethod: 'Card' },
  { date: YESTERDAY, type: 'INCOME', amount: '85000', currency: 'INR', description: 'Salary', category: 'Salary', paymentMethod: 'Bank transfer' },
  { date: YESTERDAY, type: 'EXPENSE', amount: '20', currency: 'USD', description: 'Cloud storage', category: 'Subscriptions' },
  { date: 'yesterday', type: 'EXPENSE', amount: '5', currency: 'INR', description: 'Bad date', category: 'Groceries' },
  { date: YESTERDAY, type: 'EXPENSE', amount: '12.345', currency: 'INR', description: 'Too precise', category: 'Groceries' },
  { date: YESTERDAY, type: 'EXPENSE', amount: '100', currency: 'JPY', description: 'Ramen', category: 'Pets' },
];

beforeEach(() => jest.spyOn(fxClient, 'fetchRates').mockImplementation(fakeRates));
afterAll(async () => {
  await database.close();
});

test('a dry run checks every row and saves nothing', async () => {
  const { id, api } = await newUser();
  const res = await api.post('/transactions/import', { rows: ROWS });
  expect(res.status).toBe(200);
  expect(res.body.data.dryRun).toBe(true);
  expect(res.body.data.summary).toEqual({ total: 6, ready: 3, duplicate: 0, error: 3, imported: 0, skipped: 0 });
  const [shop, , , badDate, precise, pets] = res.body.data.rows;
  expect(shop).toMatchObject({ row: 1, status: 'ready', category: 'Groceries', type: 'EXPENSE', currency: 'INR', amount: '1200.50' });
  expect(badDate.errors.join()).toMatch(/^date:/);
  expect(precise.errors.join()).toMatch(/^amount:/);
  expect(pets.errors).toEqual(['category: no expense category named "Pets"']);
  expect(await database.query('SELECT id FROM transactions WHERE user_id = ?', [id])).toHaveLength(0);
});

test('importing saves the valid rows only, converted at their date, with one summary', async () => {
  const { id, api } = await newUser();
  const res = await api.post('/transactions/import', { rows: ROWS, dryRun: false });
  expect(res.body.data.summary).toMatchObject({ total: 6, imported: 3, error: 3 });
  expect(res.body.data.rows.filter((r) => r.status === 'imported').every((r) => Number.isInteger(r.transactionId))).toBe(true);
  const saved = await database.query('SELECT description, amount, base_amount, payment_method FROM transactions WHERE user_id = ? ORDER BY id', [id]);
  expect(saved).toEqual([
    { description: 'Weekly shop', amount: '1200.50', base_amount: '1200.50', payment_method: 'CARD' },
    { description: 'Salary', amount: '85000.00', base_amount: '85000.00', payment_method: 'BANK_TRANSFER' },
    { description: 'Cloud storage', amount: '20.00', base_amount: '1800.00', payment_method: 'OTHER' },
  ]);
  const notes = (await api.get('/notifications')).body.data.filter((n) => n.type === 'TRANSACTION');
  expect(notes.map((n) => n.title)).toEqual(['Transactions imported']); // no per-row confirmations
  const actions = (await database.query('SELECT action, details FROM audit_logs WHERE user_id = ?', [id])).map((r) => r.action);
  expect(actions.filter((a) => a === 'TRANSACTION_CREATED')).toHaveLength(3);
  expect(actions).toContain('TRANSACTIONS_IMPORTED');
  expect(await audit.verifyChain()).toMatchObject({ valid: true });
});

test('rows already recorded are found as duplicates and skipped unless asked otherwise', async () => {
  const { id, api } = await newUser();
  const once = [ROWS[0], ROWS[1]];
  await api.post('/transactions/import', { rows: once, dryRun: false });
  const again = await api.post('/transactions/import', { rows: [{ ...ROWS[0], description: '  weekly SHOP ' }, ROWS[1]] });
  expect(again.body.data.summary).toMatchObject({ duplicate: 2, ready: 0 });
  const skipped = await api.post('/transactions/import', { rows: once, dryRun: false });
  expect(skipped.body.data.summary).toMatchObject({ imported: 0, skipped: 2 });
  const forced = await api.post('/transactions/import', { rows: once, dryRun: false, skipDuplicates: false });
  expect(forced.body.data.summary.imported).toBe(2);
  expect(await database.query('SELECT id FROM transactions WHERE user_id = ?', [id])).toHaveLength(4);
});

test("FinTrack's own CSV export imports back unchanged", async () => {
  const source = await newUser();
  const target = await newUser();
  await source.api.post('/transactions', {
    type: 'EXPENSE', categoryId: source.categories['Food & Dining'], amount: '450.00', currency: 'INR', date: YESTERDAY,
    description: '=1+1 Dinner', paymentMethod: 'UPI',
  });
  const csv = (await source.api.get(`/reports/export?from=${YESTERDAY}&to=${YESTERDAY}`)).text;
  // what the web app's parser produces from the export: header names as keys
  const [header, line] = (csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv).trim().split('\r\n');
  const cells = (text) => [...text.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map((m) => (m[1] ?? m[2]).replace(/""/g, '"'));
  const record = Object.fromEntries(cells(header).map((name, i) => [name, cells(line)[i]]));
  const res = await target.api.post('/transactions/import', {
    dryRun: false,
    rows: [{ date: record.Date, type: record.Type, amount: record.Amount, currency: record.Currency, description: record.Description, category: record.Category, paymentMethod: record['Payment method'] }],
  });
  expect(res.body.data.summary.imported).toBe(1);
  const [copy] = await database.query('SELECT description, payment_method, txn_date FROM transactions WHERE user_id = ?', [target.id]);
  expect(copy).toEqual({ description: '=1+1 Dinner', payment_method: 'UPI', txn_date: YESTERDAY }); // the protective apostrophe is removed
});

test('a fallback category is used for rows without a matching one, but only a usable one', async () => {
  const alice = await newUser();
  const bob = await newUser();
  const row = { date: YESTERDAY, type: 'EXPENSE', amount: '99', currency: 'INR', description: 'Mystery shop', category: 'Unknown thing' };
  const ok = await alice.api.post('/transactions/import', { rows: [row], fallbackCategories: { EXPENSE: alice.categories.Shopping } });
  expect(ok.body.data.rows[0]).toMatchObject({ status: 'ready', category: 'Shopping' });
  const wrongType = await alice.api.post('/transactions/import', { rows: [row], fallbackCategories: { EXPENSE: alice.categories.Salary } });
  expect(wrongType.body.data.rows[0].status).toBe('error');
  const custom = (await bob.api.post('/categories', { name: 'Bob only', type: 'EXPENSE' })).body.data;
  const foreign = await alice.api.post('/transactions/import', { rows: [row], fallbackCategories: { EXPENSE: custom.id } });
  expect(foreign.body.data.rows[0].status).toBe('error'); // another user's category is never used
});

test('the request is limited to 500 rows and needs at least one', async () => {
  const { api } = await newUser();
  expect((await api.post('/transactions/import', { rows: [] })).status).toBe(400);
  const many = Array.from({ length: 501 }, () => ({ date: YESTERDAY }));
  expect((await api.post('/transactions/import', { rows: many })).status).toBe(400);
  expect((await request(app).post('/api/transactions/import').send({ rows: [ROWS[0]] })).status).toBe(401);
});
