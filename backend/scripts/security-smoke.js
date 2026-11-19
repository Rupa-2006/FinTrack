// Live security smoke test against a running local stack (run from backend/):
//
//   npm run security:smoke                       API on http://localhost:5000, AI service on :8000
//   npm run security:smoke -- <apiUrl> <aiUrl>
//
// Needs the demo data (npm run seed:demo). Development only: it signs in as the demo user,
// registers one throwaway account ("Phase Nine Probe") and creates and deletes one transaction.
// Prints PASS or FAIL per check and never prints tokens or passwords. Exit code 0 = all passed.
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const backend = path.join(__dirname, '..') + path.sep;
const API = process.argv[2] || 'http://localhost:5000';
const AI = process.argv[3] || 'http://localhost:8000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) {
  console.error('security:smoke only runs against a local API (http://localhost...).');
  process.exit(2);
}
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

const DEMO_PASSWORD = /DEMO_PASSWORD = '([^']+)'/.exec(fs.readFileSync(backend + 'scripts/seed-demo.js', 'utf8'))[1];

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { 'X-Requested-With': 'XMLHttpRequest', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  if (raw) h['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, text, json };
}

const leaks = (text) => /at \w+ \(|node_modules|\.js:\d+|ER_[A-Z_]+|SELECT |stack/i.test(text);

(async () => {
  // ---------- headers, CORS
  const health = await call('GET', '/api/health');
  const h = health.headers;
  check('X-Content-Type-Options nosniff', h.get('x-content-type-options') === 'nosniff');
  check('CSP present with frame-ancestors none', /frame-ancestors 'none'/.test(h.get('content-security-policy') || ''));
  check('Referrer-Policy no-referrer', h.get('referrer-policy') === 'no-referrer');
  check('X-Powered-By hidden', !h.get('x-powered-by'));
  check('Strict-Transport-Security set', Boolean(h.get('strict-transport-security')));
  check('X-Request-Id on every response', Boolean(h.get('x-request-id')));
  const evil = await fetch(API + '/api/health', { headers: { Origin: 'https://evil.example' } });
  check('CORS: unknown origin gets no Access-Control-Allow-Origin', !evil.headers.get('access-control-allow-origin'));
  const good = await fetch(API + '/api/health', { headers: { Origin: 'http://localhost:5180' } });
  check('CORS: the web app origin is allowed', good.headers.get('access-control-allow-origin') === 'http://localhost:5180');

  // ---------- every protected route without a token
  const spec = YAML.parse(fs.readFileSync(backend + 'docs/openapi.yaml', 'utf8'));
  let protectedCount = 0; const open = [];
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const secured = (op.security ?? spec.security ?? []).some((s) => Object.keys(s).some((k) => k !== 'refreshCookie'));
      if (!secured) continue;
      protectedCount += 1;
      const url = '/api' + path.replace(/\{[^}]+\}/g, '1');
      const res = await call(method.toUpperCase(), url, { body: ['post', 'put', 'patch'].includes(method) ? {} : undefined });
      if (res.status !== 401) open.push(`${method.toUpperCase()} ${url} -> ${res.status}`);
    }
  }
  check(`all ${protectedCount} protected operations answer 401 without a token`, open.length === 0, open.join('; '));

  // ---------- sign in
  const login = await call('POST', '/api/auth/login', { body: { email: 'aarav.sharma@fintrack.demo', password: DEMO_PASSWORD } });
  const token = login.json?.data?.accessToken;
  check('demo user signs in', Boolean(token));
  check('login response carries no password or hash', !/password|hash/i.test(JSON.stringify(login.json?.data?.user ?? {})));

  // ---------- forged tokens
  const [hdr, payload] = token.split('.');
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${payload}.`;
  check('alg "none" token rejected', (await call('GET', '/api/users/profile', { token: none })).status === 401);
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const tampered = `${hdr}.${Buffer.from(JSON.stringify({ ...claims, sub: String(Number(claims.sub) + 1) })).toString('base64url')}.${token.split('.')[2]}`;
  check('token with altered user id rejected', (await call('GET', '/api/users/profile', { token: tampered })).status === 401);
  check('garbage bearer rejected', (await call('GET', '/api/users/profile', { token: 'abc.def' })).status === 401);

  // ---------- role boundary
  check('normal user gets 403 on admin overview', (await call('GET', '/api/admin/overview', { token })).status === 403);

  // ---------- SQL injection attempts
  const sqli = ["' OR 1=1 --", "1; DROP TABLE users", "\" OR \"\"=\"", "%' UNION SELECT password_hash FROM users --"];
  const sqlBad = [];
  for (const p of sqli) {
    for (const path of [`/api/transactions?search=${encodeURIComponent(p)}`, `/api/transactions?sort=${encodeURIComponent(p)}`, `/api/transactions?categoryId=${encodeURIComponent(p)}`, `/api/transactions/${encodeURIComponent(p)}`]) {
      const res = await call('GET', path, { token });
      if (res.status >= 500 || leaks(res.text) || /\$2[aby]\$/.test(res.text)) sqlBad.push(`${path} -> ${res.status}`);
    }
  }
  const all = await call('GET', '/api/transactions?search=' + encodeURIComponent("' OR 1=1 --"), { token });
  check('SQL injection payloads never cause a 500, a leak or extra rows', sqlBad.length === 0 && (all.json?.data?.length ?? 0) === 0, sqlBad.join('; '));

  // ---------- malformed and oversized bodies
  const bad = await call('POST', '/api/transactions', { token, raw: '{"type": "EXPENSE", ' });
  check('malformed JSON answers 400 without internals', bad.status === 400 && !leaks(bad.text), `status ${bad.status}`);
  const huge = await call('POST', '/api/transactions', { token, raw: JSON.stringify({ description: 'x'.repeat(150 * 1024) }) });
  check('body over 100 kB answers 413', huge.status === 413, `status ${huge.status}`);
  const neg = await call('POST', '/api/transactions', { token, body: { type: 'EXPENSE', amount: '-50', currency: 'INR', date: '2026-11-01', description: 'neg', categoryId: 1 } });
  check('negative amount rejected', neg.status === 400);
  const flt = await call('POST', '/api/transactions', { token, body: { type: 'EXPENSE', amount: 0.1 + 0.2, currency: 'INR', date: '2026-11-01', description: 'float', categoryId: 1 } });
  check('float amount (0.30000000000000004) rejected', flt.status === 400);
  const unknownRoute = await call('GET', '/api/../../etc/passwd', { token });
  check('path traversal gives a plain 404', unknownRoute.status === 404 && !/root:/.test(unknownRoute.text));

  // ---------- stored XSS payload stays inert data, CSV formula neutralised
  const cats = (await call('GET', '/api/categories?type=EXPENSE', { token })).json.data;
  const xss = '<img src=x onerror=alert(1)>';
  const created = await call('POST', '/api/transactions', { token, body: { type: 'EXPENSE', categoryId: cats[0].id, amount: '1.00', currency: 'INR', date: '2026-11-17', description: `=HYPERLINK("http://evil") ${xss}` } });
  check('XSS-like text is stored as plain text', created.status === 201 && created.json.data.description.includes(xss));
  const csv = await fetch(API + '/api/reports/export?from=2026-11-17&to=2026-11-17', { headers: { Authorization: `Bearer ${token}` } });
  const csvText = await csv.text();
  check('CSV export neutralises formulas', csvText.includes(`"'=HYPERLINK`) && !/[^']=HYPERLINK/.test(csvText.replace(`"'=HYPERLINK`, '')));
  check('CSV served as attachment', /attachment/.test(csv.headers.get('content-disposition') || ''));

  // ---------- another user's records
  const stamp = Date.now();
  const reg = await call('POST', '/api/auth/register', { body: { fullName: 'Phase Nine Probe', email: `phase9.probe.${stamp}@example.test`, password: 'Quiet-Lantern-48-Sky!' } });
  const other = reg.json?.data?.accessToken;
  check('second account registers', Boolean(other), `status ${reg.status}`);
  const id = created.json.data.id;
  const reads = await Promise.all([
    call('GET', `/api/transactions/${id}`, { token: other }),
    call('PUT', `/api/transactions/${id}`, { token: other, body: { type: 'EXPENSE', categoryId: cats[0].id, amount: '999.00', currency: 'INR', date: '2026-11-17', description: 'hijack' } }),
    call('DELETE', `/api/transactions/${id}`, { token: other }),
  ]);
  check("another user cannot read, change or delete the record (404 each)", reads.every((r) => r.status === 404), reads.map((r) => r.status).join(','));
  const still = await call('GET', `/api/transactions/${id}`, { token });
  check('the owner still sees it unchanged', still.status === 200 && still.json.data.amount === '1.00');
  await call('DELETE', `/api/transactions/${id}`, { token });
  const sessions = await call('GET', '/api/security/sessions', { token: other });
  check('the second user sees only their own session', sessions.json.data.length === 1);

  // ---------- mass assignment on profile
  const prof = await call('PUT', '/api/users/profile', { token: other, body: { fullName: 'Phase Nine Probe', roles: ['ADMIN'], status: 'ACTIVE', email: 'admin@fintrack.demo' } });
  const after = await call('GET', '/api/users/profile', { token: other });
  check('profile update ignores roles and email', prof.status === 200 && after.json.data.roles.join() === 'USER' && after.json.data.email.startsWith('phase9.probe'));

  // ---------- refresh cookie must not reach the data API
  const setCookie = login.headers.get('set-cookie') || '';
  check('refresh cookie is HttpOnly, SameSite=Strict, Path=/api/auth', /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie) && /Path=\/api\/auth/i.test(setCookie));
  const noXhr = await fetch(API + '/api/auth/refresh', { method: 'POST', headers: { Cookie: setCookie.split(';')[0] } });
  check('refresh without the custom header is refused (CSRF)', noXhr.status === 403);

  // ---------- AI service directly
  const ai1 = await fetch(AI + '/v1/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('AI service refuses an unsigned request', ai1.status === 401);
  const ai2 = await fetch(AI + '/docs');
  check('AI service has no public docs page', ai2.status === 404);
  const ai3 = await fetch(AI + '/v1/insights', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FinTrack-Timestamp': String(Math.floor(Date.now() / 1000)), 'X-FinTrack-Request-Id': 'x', 'X-FinTrack-Signature': '0'.repeat(64) }, body: '{}' });
  check('AI service refuses a wrong signature', ai3.status === 401);

  // ---------- sign the probe account out
  await call('DELETE', '/api/security/sessions', { token: other });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error('probe crashed:', err.message); process.exitCode = 2; });

