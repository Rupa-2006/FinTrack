// Builds the Postman collection from docs/openapi.yaml, so the two never drift apart.
//
//   npm run docs:postman
//
// Writes docs/FinTrack.postman_collection.json and docs/FinTrack.local.postman_environment.json.
// The collection runs top to bottom as a scenario: it registers a throwaway account, exercises
// every endpoint with fictional data, signs in as the demo administrator for the admin folder,
// and finishes with the destructive requests (password change, sign-out, deactivation).
// Every request checks its status code. Run it with Postman's Collection Runner or newman.
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const DOCS = path.join(__dirname, '..', 'docs');
const spec = YAML.parse(fs.readFileSync(path.join(DOCS, 'openapi.yaml'), 'utf8'));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// ---- example bodies (fictional data) -------------------------------------------------
const BODIES = {
  'POST /auth/register': { fullName: '{{fullName}}', email: '{{email}}', password: '{{password}}', baseCurrency: 'INR' },
  'POST /auth/login': { email: '{{email}}', password: '{{password}}' },
  'POST /auth/forgot-password': { email: '{{email}}' },
  'POST /auth/reset-password': { token: 'not-a-real-reset-token-0000000000000000000000', password: 'Another-Long-Passw0rd!' },
  'PUT /users/profile': { fullName: '{{fullName}}', phone: '+91 98765 43210' },
  'PUT /users/password': { currentPassword: '{{password}}', newPassword: '{{newPassword}}' },
  'POST /users/deactivate': { password: '{{password}}' },
  'PATCH /admin/users/{id}/status': { status: 'ACTIVE' },
  'PUT /admin/users/{id}/roles': { role: 'ADMIN', granted: false },
  'POST /assistant/ask': { question: 'How much did I spend on groceries this month?' },
  'POST /categories': { name: 'Pet care {{$randomInt}}', type: 'EXPENSE', color: '#1E2E57' },
  'PUT /categories/{id}': { name: 'Pets and vet {{$randomInt}}', color: '#344D8C' },
  'POST /transactions': { type: 'EXPENSE', categoryId: '{{categoryId}}', amount: '1250.50', currency: 'INR', date: '{{today}}', description: 'Weekly groceries', paymentMethod: 'UPI', notes: 'Fictional example' },
  'PUT /transactions/{id}': { type: 'EXPENSE', categoryId: '{{categoryId}}', amount: '1310.00', currency: 'INR', date: '{{today}}', description: 'Weekly groceries and fruit', paymentMethod: 'CARD', notes: null },
  'POST /budgets': { budgetType: 'CATEGORY', categoryId: '{{categoryId}}', month: '{{month}}', amount: '6000.00', alertThresholdPct: 80 },
  'POST /budgets/copy': { fromMonth: '{{month}}', toMonth: '{{nextMonth}}' },
  'PUT /budgets/{id}': { amount: '6500.00', alertThresholdPct: 90 },
  'POST /goals': { title: 'Emergency fund', targetAmount: '100000.00', currency: 'INR', deadline: '{{nextYear}}', notes: 'Six months of expenses' },
  'PUT /goals/{id}': { title: 'Emergency fund', targetAmount: '120000.00', deadline: '{{nextYear}}', notes: null },
  'POST /goals/{id}/contributions': { amount: '5000.00', date: '{{today}}' },
  'PUT /currencies/base': { baseCurrency: 'EUR' },
  'POST /auth/mfa/verify': { challengeToken: 'not-a-real-challenge-token-000000000000000', code: '123456' },
  'POST /security/mfa/enable': { code: '000000' },
  'POST /security/mfa/disable': { password: '{{password}}', code: '000000' },
  'POST /security/mfa/recovery-codes': { password: '{{password}}' },
  'POST /transactions/import': {
    dryRun: true,
    rows: [
      { date: '{{today}}', type: 'EXPENSE', amount: '1250.50', currency: 'INR', description: 'Imported groceries', category: 'Groceries', paymentMethod: 'Card' },
      { date: 'not-a-date', type: 'EXPENSE', amount: '10', currency: 'INR', description: 'Bad row', category: 'Groceries' },
    ],
  },
  'POST /recurring': { type: 'EXPENSE', categoryId: '{{categoryId}}', amount: '649.00', currency: 'INR', description: 'Music streaming', paymentMethod: 'CARD', frequency: 'MONTHLY', startDate: '{{today}}' },
  'PUT /recurring/{id}': { type: 'EXPENSE', categoryId: '{{categoryId}}', amount: '699.00', currency: 'INR', description: 'Music streaming', paymentMethod: 'CARD', endDate: null, paused: true },
};
// numbers stay numbers in JSON even though they are written with a variable
const NUMERIC_VARS = ['{{categoryId}}'];

// ---- which collection variable each {id} uses -------------------------------------------
const ID_VARIABLE = {
  '/security/sessions/{id}': 'missingId',
  '/admin/users/{id}': 'userId',
  '/categories/{id}': 'newCategoryId',
  '/transactions/{id}': 'transactionId',
  '/budgets/{id}': 'budgetId',
  '/goals/{id}': 'goalId',
  '/notifications/{id}': 'missingId',
  '/recurring/{id}': 'recurringId',
};

// ---- example query values ------------------------------------------------------------------
const QUERY = {
  'GET /transactions': { page: '1', pageSize: '20', sort: 'date', order: 'desc', search: 'groceries' },
  'GET /currencies/rates': { base: 'INR' },
  'GET /currencies/convert': { amount: '100', from: 'USD', to: 'INR' },
  'GET /analytics/monthly': { months: '6' },
  'GET /reports/export': { from: '{{monthStart}}', to: '{{today}}' },
  'GET /categories': { type: 'EXPENSE' },
  'GET /admin/users': { search: 'fintrack.demo' },
};

// ---- expected status codes, where the first documented success code is not enough ----------
const EXPECT = {
  'POST /auth/reset-password': [400], // the example token is deliberately invalid
  'DELETE /security/sessions/{id}': [404],
  'PATCH /notifications/{id}/read': [404],
  'DELETE /notifications/{id}': [404],
  'PATCH /admin/users/{id}/status': [200, 409],
  'PUT /admin/users/{id}/roles': [200, 409],
  'POST /admin/users/{id}/unlock': [200],
  'POST /currencies/rates/refresh': [200, 429, 503], // needs the external rates service
  'PUT /currencies/base': [200, 503],
  'GET /assistant/insights': [200, 503], // 503 when the AI service is not running
  'POST /assistant/ask': [200, 503],
  // A static collection cannot produce a live authenticator code, so these check the refusals.
  'POST /auth/mfa/verify': [401],
  'POST /security/mfa/enable': [400],
  'POST /security/mfa/disable': [409],
  'POST /security/mfa/recovery-codes': [409],
};

// ---- scripts that store ids for later requests ----------------------------------------------
const SAVE = {
  'POST /auth/register': ["pm.collectionVariables.set('accessToken', json.data.accessToken);", "pm.collectionVariables.set('userId', json.data.user.id);"],
  'POST /auth/login': ["pm.collectionVariables.set('accessToken', json.data.accessToken);"],
  'POST /auth/refresh': ["if (json.data) pm.collectionVariables.set('accessToken', json.data.accessToken);"],
  'GET /categories': ["const groceries = json.data.find((c) => c.name === 'Groceries') || json.data[0];", "pm.collectionVariables.set('categoryId', groceries.id);"],
  'POST /categories': ["pm.collectionVariables.set('newCategoryId', json.data.id);"],
  'POST /transactions': ["pm.collectionVariables.set('transactionId', json.data.id);"],
  'POST /budgets': ["pm.collectionVariables.set('budgetId', json.data.id);"],
  'POST /goals': ["pm.collectionVariables.set('goalId', json.data.id);"],
  'POST /recurring': ["pm.collectionVariables.set('recurringId', json.data.rule.id);"],
  'PUT /users/password': ["pm.collectionVariables.set('password', pm.collectionVariables.get('newPassword'));"],
};

// ---- folder order: a scenario that can run top to bottom -----------------------------------
const LAST = new Set(['POST /auth/logout', 'PUT /users/password', 'POST /users/deactivate', 'DELETE /security/sessions',
  'DELETE /security/sessions/{id}', 'DELETE /recurring/{id}', 'DELETE /transactions/{id}', 'DELETE /budgets/{id}', 'DELETE /goals/{id}', 'DELETE /categories/{id}']);
const END_ORDER = ['DELETE /recurring/{id}', 'DELETE /transactions/{id}', 'DELETE /budgets/{id}', 'DELETE /goals/{id}', 'DELETE /categories/{id}',
  // deactivation needs a live session and ends it; signing out afterwards is safe (idempotent)
  'DELETE /security/sessions/{id}', 'DELETE /security/sessions', 'PUT /users/password', 'POST /users/deactivate', 'POST /auth/logout'];
const FOLDER_ORDER = ['Health', 'Authentication', 'Account', 'Categories', 'Transactions', 'Recurring', 'Budgets', 'Goals', 'Currencies',
  'Analytics', 'Reports', 'Notifications', 'Assistant', 'Security', 'Admin'];

const placeholderValue = (key) => `{{${ID_VARIABLE[key]}}}`;

function jsonBody(key) {
  let text = JSON.stringify(BODIES[key], null, 2);
  for (const variable of NUMERIC_VARS) text = text.replaceAll(`"${variable}"`, variable);
  return { mode: 'raw', raw: text, options: { raw: { language: 'json' } } };
}

function buildRequest(method, route, op) {
  const key = `${method.toUpperCase()} ${route}`;
  const idBase = Object.keys(ID_VARIABLE).find((prefix) => route.startsWith(prefix));
  const pathText = route.replace('{id}', idBase ? placeholderValue(idBase) : '1');
  const segments = pathText.split('/').filter(Boolean);
  const query = Object.entries(QUERY[key] || {}).map(([name, value]) => ({ key: name, value }));
  const success = Object.keys(op.responses || {}).map(Number).filter((code) => code < 300);
  const expected = EXPECT[key] || [success[0]];
  const isAuth = route.startsWith('/auth/');
  const headers = [];
  if (isAuth) headers.push({ key: 'X-Requested-With', value: 'XMLHttpRequest', description: 'Required on /auth routes (CSRF protection).' });
  if (BODIES[key]) headers.push({ key: 'Content-Type', value: 'application/json' });

  const test = [
    `pm.test('${key} answers ${expected.join(' or ')}', () => pm.expect([${expected.join(', ')}]).to.include(pm.response.code));`,
  ];
  if (SAVE[key]) test.push('if (pm.response.code < 300) {', '  const json = pm.response.json();', ...SAVE[key].map((line) => `  ${line}`), '}');

  const request = {
    method: method.toUpperCase(),
    header: headers,
    url: { raw: `{{baseUrl}}${pathText}${query.length ? `?${query.map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`, host: ['{{baseUrl}}'], path: segments, ...(query.length ? { query } : {}) },
    description: [op.summary, op.description].filter(Boolean).join('\n\n'),
  };
  if (BODIES[key]) request.body = jsonBody(key);
  const secured = (op.security ?? spec.security ?? []).some((s) => 'bearerAuth' in s);
  if (!secured) request.auth = { type: 'noauth' };
  return { name: `${op.summary || key}`, key, event: [{ listen: 'test', script: { type: 'text/javascript', exec: test } }], request };
}

const byTag = new Map(FOLDER_ORDER.map((tag) => [tag, []]));
const end = [];
let count = 0;
for (const [route, ops] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const op = ops[method];
    if (!op) continue;
    count += 1;
    const item = buildRequest(method, route, op);
    if (LAST.has(item.key)) end.push(item);
    else byTag.get(op.tags[0]).push(item);
  }
}
end.sort((a, b) => END_ORDER.indexOf(a.key) - END_ORDER.indexOf(b.key));

// The admin folder signs in as the demo administrator and uses that token.
const adminLogin = {
  name: 'Sign in as administrator',
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    "pm.test('administrator signed in', () => pm.response.to.have.status(200));",
    "pm.collectionVariables.set('adminAccessToken', pm.response.json().data.accessToken);",
  ] } }],
  request: {
    method: 'POST', auth: { type: 'noauth' },
    header: [{ key: 'X-Requested-With', value: 'XMLHttpRequest' }, { key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: JSON.stringify({ email: '{{adminEmail}}', password: '{{adminPassword}}' }, null, 2), options: { raw: { language: 'json' } } },
    url: { raw: '{{baseUrl}}/auth/login', host: ['{{baseUrl}}'], path: ['auth', 'login'] },
    description: 'Uses adminEmail and adminPassword from the environment (the demo administrator locally).',
  },
};
const tagDescription = Object.fromEntries((spec.tags || []).map((tag) => [tag.name, tag.description]));
const strip = ({ key, ...item }) => item; // eslint-disable-line no-unused-vars

const folders = FOLDER_ORDER.map((tag) => {
  const items = byTag.get(tag).map(strip);
  const folder = { name: tag, description: tagDescription[tag] || '', item: items };
  if (tag === 'Admin') {
    folder.item = [adminLogin, ...items];
    folder.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{adminAccessToken}}', type: 'string' }] };
  }
  return folder;
});
folders.push({
  name: 'End of run (destructive)',
  description: 'Deletes what the run created, changes the throwaway account\'s password, signs it out and deactivates it. Run last.',
  item: end.map(strip),
});

const prerequest = [
  '// Dates and a unique throwaway account for each run.',
  "const pad = (n) => String(n).padStart(2, '0');",
  'const now = new Date();',
  "const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;",
  "pm.collectionVariables.set('today', `${ym(now)}-${pad(now.getDate())}`);",
  "pm.collectionVariables.set('month', ym(now));",
  "pm.collectionVariables.set('monthStart', `${ym(now)}-01`);",
  "pm.collectionVariables.set('nextMonth', ym(new Date(now.getFullYear(), now.getMonth() + 1, 1)));",
  "pm.collectionVariables.set('nextYear', `${now.getFullYear() + 1}-${pad(now.getMonth() + 1)}-01`);",
  "if (!pm.collectionVariables.get('email')) {",
  "  pm.collectionVariables.set('email', `postman.${Date.now()}@example.test`);",
  '}',
];

const variable = ['accessToken', 'adminAccessToken', 'userId', 'categoryId', 'newCategoryId', 'transactionId', 'recurringId', 'budgetId', 'goalId',
  'today', 'month', 'monthStart', 'nextMonth', 'nextYear', 'email']
  .map((key) => ({ key, value: '' }))
  .concat([
    { key: 'fullName', value: 'Postman Tester' },
    { key: 'password', value: 'Quiet-Harbour-Lamp-73!' },
    { key: 'newPassword', value: 'Bright-Meadow-Kite-58?' },
    { key: 'missingId', value: '999999999' },
  ]);

const collection = {
  info: {
    name: 'FinTrack API',
    description: [
      `Generated from backend/docs/openapi.yaml (version ${spec.info.version}) by \`npm run docs:postman\`. Do not edit by hand.`,
      '',
      'Runs top to bottom as a scenario with a throwaway account and fictional data. Pick the "FinTrack local" environment',
      'and fill in adminPassword (the demo administrator\'s password is in backend/scripts/seed-demo.js, development only).',
      'Authentication: requests send the access token from the collection variable accessToken; /auth routes also need',
      'the X-Requested-With header, and the refresh token travels in the ft_refresh cookie, which Postman keeps.',
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: prerequest } }],
  variable,
  item: folders,
};

const environment = {
  name: 'FinTrack local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:5000/api', enabled: true },
    { key: 'adminEmail', value: 'admin@fintrack.demo', enabled: true },
    { key: 'adminPassword', value: '', type: 'secret', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

fs.writeFileSync(path.join(DOCS, 'FinTrack.postman_collection.json'), `${JSON.stringify(collection, null, 2)}\n`);
fs.writeFileSync(path.join(DOCS, 'FinTrack.local.postman_environment.json'), `${JSON.stringify(environment, null, 2)}\n`);
console.log(`Postman collection: ${count} requests from openapi.yaml + 1 administrator sign-in, ${folders.length} folders`);
