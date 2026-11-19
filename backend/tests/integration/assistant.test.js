// The AI assistant from the API's side, plus a real end-to-end run against the Python
// service (started here) to prove both halves agree on the request signature.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const request = require('supertest');
const { createApp } = require('../../app');
const database = require('../../config/database');
const { config } = require('../../config/env');
const aiClient = require('../../services/aiClient');
const fxClient = require('../../services/fxClient');
const { today } = require('../../utils/period');

const RELAXED = { windowMs: 60000, limit: 100000 };
const app = createApp({
  globalRateLimit: RELAXED,
  authRateLimits: { login: RELAXED, register: RELAXED, passwordReset: RELAXED, refresh: RELAXED },
  assistantRateLimit: RELAXED,
});

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let counter = 0;

async function newUser() {
  counter += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({ fullName: 'Assistant Tester', email: `assist${counter}.${RUN}@example.test`, password: 'Tr1cky-Horse-Battery!' });
  const token = res.body.data.accessToken;
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  const api = {
    get: (p) => auth(request(app).get(`/api${p}`)),
    post: (p, body) => auth(request(app).post(`/api${p}`)).send(body),
  };
  const categories = Object.fromEntries((await api.get('/categories')).body.data.map((c) => [c.name, c.id]));
  const add = (overrides) => api.post('/transactions', {
    type: 'EXPENSE', categoryId: categories.Groceries, amount: '100', currency: 'INR', date: today(), description: 'Shop', ...overrides,
  });
  return { id: res.body.data.user.id, email: res.body.data.user.email, api, categories, add };
}

afterAll(async () => {
  await database.close();
});

describe('what the AI service receives', () => {
  let captured;
  beforeEach(() => {
    captured = [];
    jest.spyOn(aiClient, 'post').mockImplementation(async (route, payload) => {
      captured.push({ route, payload });
      return { answer: 'stub' };
    });
  });
  afterEach(() => jest.restoreAllMocks());

  test('only the signed-in user\'s records, in their main currency, without notes or account details', async () => {
    jest.spyOn(fxClient, 'fetchRates').mockResolvedValue({ date: today(), rates: { INR: '90' } }); // fictional USD rate
    const alice = await newUser();
    const bob = await newUser();
    await alice.add({ description: 'Alice private purchase', amount: '999', notes: 'alice secret note' });
    await bob.add({ description: 'Bob groceries', amount: '20', currency: 'USD', notes: 'bob secret note' });
    await bob.api.post('/goals', { title: 'Bike', targetAmount: '30000', currency: 'INR', notes: 'goal note' });
    await bob.api.post('/budgets', { budgetType: 'CATEGORY', categoryId: bob.categories.Groceries, month: today().slice(0, 7), amount: '5000' });

    const res = await bob.api.post('/assistant/ask', { question: '  How much did I spend on groceries?  ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ answer: 'stub' });

    const { route, payload } = captured[0];
    expect(route).toBe('/v1/assistant/ask');
    expect(payload.question).toBe('How much did I spend on groceries?');
    expect(payload.currency).toBe('INR');
    expect(payload.transactions).toHaveLength(1);
    expect(payload.transactions[0]).toEqual({
      id: expect.any(Number), date: today(), type: 'EXPENSE', amount: expect.stringMatching(/^\d+\.\d{2}$/), category: 'Groceries', description: 'Bob groceries',
    });
    expect(payload.transactions[0].amount).toBe('1800.00'); // 20 USD at 90, in the main currency
    expect(payload.budgets).toEqual([{ budgetType: 'CATEGORY', category: 'Groceries', amount: '5000.00', alertThresholdPct: 80 }]);
    expect(payload.goals[0]).toMatchObject({ title: 'Bike', targetAmount: '30000.00', savedAmount: '0.00', currency: 'INR', status: 'IN_PROGRESS' });

    const text = JSON.stringify(payload);
    expect(text).not.toMatch(/Alice|alice|secret note|goal note|@example|password|userId|user_id|email/);
  });

  test('insights are requested the same way', async () => {
    const user = await newUser();
    expect((await user.api.get('/assistant/insights')).status).toBe(200);
    expect(captured[0].route).toBe('/v1/insights');
    expect(captured[0].payload).not.toHaveProperty('question');
  });

  test('questions are validated, and the assistant needs a signed-in user', async () => {
    const user = await newUser();
    expect((await request(app).get('/api/assistant/insights')).status).toBe(401);
    expect((await request(app).post('/api/assistant/ask').send({ question: 'hi there' })).status).toBe(401);
    for (const question of ['', ' ', 'x'.repeat(501), 'bad\u0007bell', 42]) {
      expect((await user.api.post('/assistant/ask', { question })).status).toBe(400);
    }
    expect(captured).toHaveLength(0);
  });
});

describe('when the AI service is unavailable', () => {
  afterEach(() => aiClient.setBaseUrl(config.aiService.url));

  test('the user gets a calm 503 without internal detail', async () => {
    aiClient.setBaseUrl('http://127.0.0.1:9'); // nothing listens there
    const user = await newUser();
    const res = await user.api.get('/assistant/insights');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: expect.stringMatching(/assistant is unavailable/) });
    expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|fetch/);
  });
});

describe('rate limit', () => {
  test('each user has their own allowance', async () => {
    const limited = createApp({ globalRateLimit: RELAXED, authRateLimits: { register: RELAXED }, assistantRateLimit: { windowMs: 60000, limit: 2 } });
    jest.spyOn(aiClient, 'post').mockResolvedValue({});
    const tokenFor = async () => {
      counter += 1;
      const res = await request(limited).post('/api/auth/register').set('X-Requested-With', 'XMLHttpRequest')
        .send({ fullName: 'Rate Tester', email: `rate${counter}.${RUN}@example.test`, password: 'Tr1cky-Horse-Battery!' });
      return res.body.data.accessToken;
    };
    const [first, second] = [await tokenFor(), await tokenFor()];
    const call = (token) => request(limited).get('/api/assistant/insights').set('Authorization', `Bearer ${token}`);
    expect([(await call(first)).status, (await call(first)).status, (await call(first)).status]).toEqual([200, 200, 429]);
    expect((await call(second)).status).toBe(200); // someone else is not affected
    jest.restoreAllMocks();
  });
});

// ---------------------------------------------------------------- real Python service
const AI_DIR = path.join(__dirname, '..', '..', '..', 'ai-service');
const PYTHON = path.join(AI_DIR, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const PORT = 18765;
const runReal = fs.existsSync(PYTHON) ? describe : describe.skip;

runReal('end to end with the real AI service', () => {
  let child;
  const base = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(PYTHON, ['-m', 'uvicorn', '--factory', 'app.main:create_app', '--host', '127.0.0.1', '--port', String(PORT)], {
      cwd: AI_DIR,
      env: { ...process.env, AI_SERVICE_SHARED_SECRET: config.aiService.sharedSecret },
      stdio: 'ignore',
    });
    for (let i = 0; i < 100; i += 1) {
      try {
        if ((await fetch(`${base}/health`)).ok) break;
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    aiClient.setBaseUrl(base);
  }, 30000);

  afterAll(() => {
    aiClient.setBaseUrl(config.aiService.url);
    child?.kill();
  });

  test('a question is answered from the user\'s own records, with exact amounts', async () => {
    const user = await newUser();
    await user.add({ amount: '1200.50', description: 'Weekly shop' });
    await user.add({ amount: '300', description: 'Veg market' });
    const res = await user.api.post('/assistant/ask', { question: 'How much did I spend on groceries this month?' });
    expect(res.status).toBe(200);
    expect(res.body.data.intent).toBe('category_spending');
    expect(res.body.data.answer).toContain('₹1,500.50');
  });

  test('insights come back with money as strings and a disclaimer', async () => {
    const user = await newUser();
    await user.add({ amount: '250' });
    const res = await user.api.get('/assistant/insights');
    expect(res.status).toBe(200);
    expect(res.body.data.month.expense).toBe('250.00');
    expect(res.body.data.forecast.disclaimer).toMatch(/not a guarantee/);
    expect(res.body.data.disclaimer).toMatch(/not financial advice/);
  });

  test('the AI service refuses requests that are not signed with the shared secret', async () => {
    const body = JSON.stringify({ currency: 'INR', today: today(), transactions: [], budgets: [], goals: [] });
    const unsigned = await fetch(`${base}/v1/insights`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect(unsigned.status).toBe(401);

    const timestamp = String(Math.floor(Date.now() / 1000));
    const requestId = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
    const forged = aiClient.signRequest({ timestamp, method: 'POST', path: '/v1/insights', requestId, body }, Buffer.alloc(32, 1));
    const wrongKey = await fetch(`${base}/v1/insights`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fintrack-timestamp': timestamp, 'x-fintrack-request-id': requestId, 'x-fintrack-signature': forged },
      body,
    });
    expect(wrongKey.status).toBe(401);
  });
});
