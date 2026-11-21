// Phase 7 security suite: audit trail, security events and notices, the admin area and its
// privacy boundary, and the operational scripts. Runs against the real test database.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../../app');
const database = require('../../config/database');
const { connect } = require('../../scripts/lib/db');
const audit = require('../../services/audit.service');
const adminModel = require('../../models/admin.model');
const { makeAdmin } = require('../../scripts/make-admin');
const { exportAnchor, verify } = require('../../scripts/audit-chain');
const { rotate } = require('../../scripts/rotate-encryption-key');
const { today } = require('../../utils/period');

const RELAXED = { windowMs: 60000, limit: 100000 };
const app = createApp({ globalRateLimit: RELAXED, authRateLimits: { login: RELAXED, register: RELAXED, passwordReset: RELAXED, refresh: RELAXED } });

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'Tr1cky-Horse-Battery!';
const BROWSER_A = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const BROWSER_B = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
let counter = 0;

function client(token) {
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    token,
    get: (p) => auth(request(app).get(`/api${p}`)),
    post: (p, body) => auth(request(app).post(`/api${p}`)).send(body),
    put: (p, body) => auth(request(app).put(`/api${p}`)).send(body),
    patch: (p, body) => auth(request(app).patch(`/api${p}`)).send(body),
    del: (p) => auth(request(app).delete(`/api${p}`)),
  };
}

const authPost = (p, body, userAgent = BROWSER_A) =>
  request(app).post(`/api${p}`).set('X-Requested-With', 'XMLHttpRequest').set('User-Agent', userAgent).send(body);

async function newUser({ admin = false } = {}) {
  counter += 1;
  const email = `sec${counter}.${RUN}@example.test`;
  const res = await authPost('/auth/register', { fullName: 'Security Tester', email, password: PASSWORD });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  if (admin) await makeAdmin(email);
  const api = client(res.body.data.accessToken);
  const categories = Object.fromEntries((await api.get('/categories')).body.data.map((c) => [c.name, c.id]));
  return { id: res.body.data.user.id, email, api, categories };
}

const auditRows = (userId) => database.query('SELECT * FROM audit_logs WHERE user_id = ? ORDER BY id', [userId]);
const eventsOf = (userId) => database.query('SELECT event_type, severity FROM security_events WHERE user_id = ? ORDER BY id', [userId]);
const securityNotices = async (api) => (await api.get('/notifications')).body.data.filter((n) => n.type === 'SECURITY');

afterAll(async () => {
  await database.close();
});

describe('audit trail', () => {
  test('a change writes one audit row with who, what, where and the request id, but no financial values', async () => {
    const { api, id, categories } = await newUser();
    const res = await api.post('/transactions', {
      type: 'EXPENSE', categoryId: categories.Groceries, amount: '1234.56', currency: 'INR', date: today(), description: 'Secret pharmacy visit', notes: 'private note',
    });
    expect(res.status).toBe(201);
    const rows = (await auditRows(id)).filter((row) => row.action === 'TRANSACTION_CREATED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: 'DATA', resource_type: 'transaction', resource_id: String(res.body.data.id), request_id: res.headers['x-request-id'],
    });
    expect(rows[0].ip_address).toBeTruthy();
    const everything = JSON.stringify(await auditRows(id));
    expect(everything).not.toMatch(/1234|Secret pharmacy|private note/);
  });

  test('edits record which fields changed, never the old or new values', async () => {
    const { api, id, categories } = await newUser();
    const body = { type: 'EXPENSE', categoryId: categories.Groceries, amount: '10', currency: 'INR', date: today(), description: 'First' };
    const created = (await api.post('/transactions', body)).body.data;
    await api.put(`/transactions/${created.id}`, { ...body, amount: '99.99', description: 'Second' });
    const [row] = (await auditRows(id)).filter((r) => r.action === 'TRANSACTION_UPDATED');
    expect(row.details.fields.sort()).toEqual(['amount', 'description']);
    expect(JSON.stringify(row)).not.toMatch(/99\.99|Second/);
  });

  test('a rejected change leaves no audit row', async () => {
    const { api, id } = await newUser();
    await api.post('/budgets', { budgetType: 'OVERALL', month: today().slice(0, 7), amount: '1000' });
    const before = (await auditRows(id)).length;
    expect((await api.post('/budgets', { budgetType: 'OVERALL', month: today().slice(0, 7), amount: '2000' })).status).toBe(409);
    expect((await api.post('/transactions', { type: 'EXPENSE', amount: '-1' })).status).toBe(400);
    expect((await auditRows(id)).length).toBe(before);
  });

  test('sign-in, sign-out, profile, password and session actions are all on the trail', async () => {
    const { api, id, email } = await newUser();
    const signIn = await authPost('/auth/login', { email, password: PASSWORD });
    await api.put('/users/profile', { fullName: 'Security Tester', phone: '+91 98765 43210' });
    await api.put('/users/password', { currentPassword: PASSWORD, newPassword: 'An0ther-Quiet-River?' });
    const cookie = signIn.headers['set-cookie'].find((c) => c.startsWith('ft_refresh=')).split(';')[0];
    await authPost('/auth/logout', {}).set('Cookie', cookie);
    const actions = (await auditRows(id)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['ACCOUNT_REGISTERED', 'SIGNED_IN', 'PROFILE_UPDATED', 'PASSWORD_CHANGED']));
    expect(JSON.stringify(await auditRows(id))).not.toMatch(/98765|An0ther|Tr1cky/);
  });

  test('details with undefined values are hashed as stored, so verification stays valid', async () => {
    const { api, id } = await newUser();
    const goal = (await api.post('/goals', { title: 'Bike', targetAmount: '30000', currency: 'INR' })).body.data;
    // an edit that leaves the status as it was (this once hashed {"status":null} but stored {})
    expect((await api.put(`/goals/${goal.id}`, { title: 'Road bike', targetAmount: '32000' })).status).toBe(200);
    await database.withTransaction((tx) => audit.append(tx, {
      userId: id, eventType: audit.EVENT_TYPES.DATA, action: 'TEST_UNDEFINED_DETAILS', resourceType: 'test',
      details: { kept: 'yes', dropped: undefined, nested: { gone: undefined } },
    }));
    const [row] = await database.query("SELECT details FROM audit_logs WHERE action = 'TEST_UNDEFINED_DETAILS' AND user_id = ?", [id]);
    expect(typeof row.details === 'string' ? JSON.parse(row.details) : row.details).toEqual({ kept: 'yes', nested: {} });
    expect(await audit.verifyChain()).toMatchObject({ valid: true });
  });

  test('verifying while new rows are being appended does not report a false break', async () => {
    const { id } = await newUser();
    let appended = false;
    // A database handle that lets another change land right after the first rows are read.
    const busy = {
      query: async (sql, params) => {
        const result = await database.query(sql, params);
        if (!appended && /FROM audit_logs WHERE id >/.test(sql)) {
          appended = true;
          await database.withTransaction((tx) => audit.append(tx, { userId: id, eventType: audit.EVENT_TYPES.DATA, action: 'TEST_DURING_VERIFY', resourceType: 'test' }));
        }
        return result;
      },
    };
    const during = await audit.verifyChain({}, busy);
    expect(appended).toBe(true);
    expect(during.valid).toBe(true);
    const after = await audit.verifyChain();
    expect(after.valid).toBe(true);
    expect(after.lastId).toBeGreaterThan(during.lastId); // the new row is checked next time
  });

  test('concurrent changes still form one unbroken chain', async () => {
    const { api, categories } = await newUser();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => api.post('/transactions', {
        type: 'EXPENSE', categoryId: categories.Transport, amount: String(10 + i), currency: 'INR', date: today(), description: `Ride ${i}`,
      }))
    );
    expect(results.every((res) => res.status === 201)).toBe(true);
    const [dupes] = await database.query('SELECT COUNT(*) AS n FROM (SELECT prev_hash FROM audit_logs GROUP BY prev_hash HAVING COUNT(*) > 1) d');
    expect(dupes.n).toBe(0); // no fork: no two rows build on the same previous hash
    const result = await audit.verifyChain();
    expect(result).toMatchObject({ valid: true });
    expect(result.checkedRows).toBeGreaterThan(12);
  });

  test('the application account cannot change or delete audit rows', async () => {
    await expect(database.query('UPDATE audit_logs SET action = ? WHERE id = (SELECT 1)', ['X'])).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' });
    await expect(database.query('DELETE FROM audit_logs WHERE id > 0')).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' });
    await expect(database.query('UPDATE audit_chain_head SET last_hash = REPEAT(?, 64)', ['a'])).resolves.toBeDefined(); // allowed: the head moves
    // ...but moving it by hand is exactly what verification catches. Put it back.
    const [last] = await database.query('SELECT id, curr_hash FROM audit_logs ORDER BY id DESC LIMIT 1');
    expect((await audit.verifyChain()).valid).toBe(false);
    await database.query('UPDATE audit_chain_head SET last_id = ?, last_hash = ? WHERE id = 1', [last.id, last.curr_hash]);
    expect(await audit.verifyChain()).toMatchObject({ valid: true });
  });

  test('even the migration account is stopped by the append-only triggers', async () => {
    const migrator = await connect('migrator', { test: true });
    try {
      await expect(migrator.query('UPDATE audit_logs SET action = action LIMIT 1')).rejects.toMatchObject({ sqlState: '45000' });
      await expect(migrator.query('DELETE FROM audit_logs LIMIT 1')).rejects.toMatchObject({ sqlState: '45000' });
    } finally {
      await migrator.end();
    }
  });

  test('anchors confirm the chain once ended where they say; a forged anchor does not match', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-anchors-'));
    try {
      const { anchor } = await exportAnchor({ dir });
      expect(await audit.checkAnchor(anchor)).toBe(true);
      expect(await audit.checkAnchor({ ...anchor, lastHash: 'f'.repeat(64) })).toBe(false);
      const report = await verify({ dir });
      expect(report).toMatchObject({ ok: true, chain: { valid: true }, anchors: [{ ok: true }] });
      fs.writeFileSync(path.join(dir, 'anchor-forged.json'), JSON.stringify({ lastId: anchor.lastId, lastHash: '0'.repeat(63) + '1' }));
      expect((await verify({ dir })).ok).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('users read their own activity trail and nobody else\'s', async () => {
    const alice = await newUser();
    const bob = await newUser();
    await alice.api.post('/goals', { title: 'Private goal', targetAmount: '100', currency: 'INR' });
    const own = await alice.api.get('/security/audit-logs');
    expect(own.status).toBe(200);
    expect(own.body.data.map((row) => row.action)).toEqual(expect.arrayContaining(['GOAL_CREATED', 'ACCOUNT_REGISTERED']));
    expect(own.body.data[0]).not.toHaveProperty('userEmail');
    const theirs = await bob.api.get('/security/audit-logs');
    expect(theirs.body.data.map((row) => row.action)).not.toContain('GOAL_CREATED');
    expect((await bob.api.get('/security/audit-logs?eventType=DATA')).body.data).toHaveLength(0);
  });
});

describe('security events and notices to the account holder', () => {
  test('users see their own sign-in history, with a readable device', async () => {
    const { api, email } = await newUser();
    await authPost('/auth/login', { email, password: 'Wrong-Passw0rd!!' });
    const res = await api.get('/security/events');
    expect(res.status).toBe(200);
    const types = res.body.data.map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(['REGISTERED', 'LOGIN_FAILED']));
    expect(res.body.data[0].device).toBe('Chrome on Windows');
    expect((await api.get('/security/events?eventType=LOGIN_FAILED')).body.data.every((e) => e.eventType === 'LOGIN_FAILED')).toBe(true);
    expect((await api.get('/security/events?eventType=drop table')).status).toBe(400);
  });

  test('a sign-in from a new browser warns the user; a familiar one does not', async () => {
    const { api, id, email } = await newUser();
    await authPost('/auth/login', { email, password: PASSWORD }, BROWSER_A); // same browser as registration
    expect(await securityNotices(api)).toHaveLength(0);
    await authPost('/auth/login', { email, password: PASSWORD }, BROWSER_B);
    const notices = await securityNotices(api);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ title: 'New sign-in to your account', severity: 'WARNING' });
    expect(notices[0].message).toMatch(/Safari on macOS/);
    await authPost('/auth/login', { email, password: PASSWORD }, BROWSER_B);
    expect(await securityNotices(api)).toHaveLength(1);
    expect((await eventsOf(id)).filter((e) => e.event_type === 'NEW_DEVICE_LOGIN')).toHaveLength(1);
  });

  test('a lockout and a password change are announced', async () => {
    const { api, email } = await newUser();
    for (let i = 0; i < 5; i += 1) await authPost('/auth/login', { email, password: 'Wrong-Passw0rd!!' });
    await api.put('/users/password', { currentPassword: PASSWORD, newPassword: 'An0ther-Quiet-River?' });
    const titles = (await securityNotices(api)).map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(['Your account was locked', 'Your password was changed']));
  });
});

describe('admin area', () => {
  let admin;
  beforeAll(async () => {
    admin = await newUser({ admin: true });
  });

  test.each([
    ['get', '/admin/overview'], ['get', '/admin/users'], ['get', '/admin/security-events'], ['get', '/admin/audit-logs'],
    ['post', '/admin/audit-logs/verify'], ['patch', '/admin/users/1/status'], ['put', '/admin/users/1/roles'], ['post', '/admin/users/1/unlock'],
  ])('%s %s: anonymous 401, normal user 403', async (method, route) => {
    const user = await newUser();
    expect((await request(app)[method](`/api${route}`)).status).toBe(401);
    expect((await user.api[method === 'delete' ? 'del' : method](route, {})).status).toBe(403);
  });

  test('a refused admin request is itself recorded as a security event', async () => {
    const user = await newUser();
    await user.api.get('/admin/users');
    expect((await eventsOf(user.id)).map((e) => e.event_type)).toContain('ACCESS_DENIED');
  });

  test('the overview gives counts only', async () => {
    const res = await admin.api.get('/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.data.users.total).toBeGreaterThan(0);
    expect(res.body.data.usage.transactions).toEqual(expect.any(Number));
    expect(JSON.stringify(res.body.data)).not.toMatch(/amount|description|notes|password/i);
  });

  test('privacy boundary: an administrator cannot read another user\'s money records', async () => {
    const user = await newUser();
    const txn = (await user.api.post('/transactions', {
      type: 'EXPENSE', categoryId: user.categories.Health, amount: '777.77', currency: 'INR', date: today(), description: 'Therapy session', notes: 'confidential',
    })).body.data;
    const goal = (await user.api.post('/goals', { title: 'Private surgery fund', targetAmount: '50000', currency: 'INR' })).body.data;

    expect((await admin.api.get(`/transactions/${txn.id}`)).status).toBe(404);
    expect((await admin.api.put(`/transactions/${txn.id}`, { type: 'EXPENSE', categoryId: admin.categories.Health, amount: '1', currency: 'INR', date: today(), description: 'x' })).status).toBe(404);
    expect((await admin.api.del(`/transactions/${txn.id}`)).status).toBe(404);
    expect((await admin.api.get(`/goals/${goal.id}`)).status).toBe(404);
    expect((await admin.api.get('/transactions?search=Therapy')).body.data).toHaveLength(0);
    expect((await admin.api.get('/reports/export')).text).not.toContain('Therapy');

    // Nothing an administrator can list contains the user's financial content.
    const everything = JSON.stringify([
      (await admin.api.get(`/admin/users?search=${encodeURIComponent(user.email)}`)).body,
      (await admin.api.get(`/admin/audit-logs?userId=${user.id}`)).body,
      (await admin.api.get(`/admin/security-events?userId=${user.id}`)).body,
      (await admin.api.get('/admin/overview')).body,
    ]);
    expect(everything).toContain(user.email);
    // "777.77" is the seeded amount; a bare "777" can appear by chance in random ids and hashes.
    expect(everything).not.toMatch(/777\.77|Therapy|confidential|surgery/);
  });

  test('the admin queries never read financial columns', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../models/admin.model.js'), 'utf8');
    const sql = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    expect(sql).not.toMatch(/\b(amount|base_amount|description|notes_enc|phone_enc|target_amount|saved_amount|password_hash)\b/);
    // Every read of a financial table is a bare SELECT COUNT(*): the four usage totals.
    const reads = sql.match(/FROM (transactions|budgets|savings_goals)\b/g) ?? [];
    const counts = sql.match(/SELECT COUNT\(\*\) FROM (transactions|budgets|savings_goals)\b/g) ?? [];
    expect(reads).toHaveLength(4);
    expect(counts).toHaveLength(reads.length);
    expect(sql).not.toMatch(/JOIN (transactions|budgets|savings_goals)\b/);
  });

  test('user search is parameterised: injection text matches nothing', async () => {
    const res = await admin.api.get(`/admin/users?search=${encodeURIComponent("' OR 1=1 -- ")}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    const all = await admin.api.get('/admin/users?pageSize=5');
    expect(all.body.meta.pagination.totalItems).toBeGreaterThan(1);
    expect(all.body.data[0]).toEqual(expect.objectContaining({ email: expect.any(String), roles: expect.any(Array), status: expect.any(String) }));
    expect(all.body.data[0]).not.toHaveProperty('passwordHash');
    expect(all.body.data[0]).not.toHaveProperty('phone');
  });

  test('suspending ends the user\'s sessions at once and blocks sign-in; reactivating restores it', async () => {
    const user = await newUser();
    const res = await admin.api.patch(`/admin/users/${user.id}/status`, { status: 'SUSPENDED' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'SUSPENDED', activeSessions: 0 });
    expect((await user.api.get('/users/profile')).status).toBe(401);
    expect((await authPost('/auth/login', { email: user.email, password: PASSWORD })).status).toBe(403);

    expect((await admin.api.patch(`/admin/users/${user.id}/status`, { status: 'ACTIVE' })).body.data.status).toBe('ACTIVE');
    expect((await authPost('/auth/login', { email: user.email, password: PASSWORD })).status).toBe(200);

    const trail = await database.query("SELECT user_id, action, details FROM audit_logs WHERE resource_type = 'user' AND resource_id = ? AND event_type = 'ADMIN'", [String(user.id)]);
    expect(trail.map((row) => [row.user_id, row.action])).toEqual([[admin.id, 'USER_SUSPENDED'], [admin.id, 'USER_REACTIVATED']]);
    expect((await eventsOf(user.id)).map((e) => e.event_type)).toEqual(expect.arrayContaining(['ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED']));
  });

  test('granting and revoking ADMIN takes effect on the next request and the user is told', async () => {
    const user = await newUser();
    expect((await user.api.get('/admin/overview')).status).toBe(403);
    expect((await admin.api.put(`/admin/users/${user.id}/roles`, { role: 'ADMIN', granted: true })).body.data.roles).toEqual(['ADMIN', 'USER']);
    expect((await user.api.get('/admin/overview')).status).toBe(200);
    expect((await admin.api.put(`/admin/users/${user.id}/roles`, { role: 'ADMIN', granted: false })).body.data.roles).toEqual(['USER']);
    expect((await user.api.get('/admin/overview')).status).toBe(403);
    expect((await securityNotices(user.api)).map((n) => n.title)).toContain('Your account permissions changed');
    expect((await admin.api.put(`/admin/users/${user.id}/roles`, { role: 'USER', granted: false })).status).toBe(400);
  });

  test('administrators cannot change their own account, and the last administrator is protected', async () => {
    expect((await admin.api.patch(`/admin/users/${admin.id}/status`, { status: 'SUSPENDED' })).status).toBe(403);
    expect((await admin.api.put(`/admin/users/${admin.id}/roles`, { role: 'ADMIN', granted: false })).status).toBe(403);

    const other = await newUser({ admin: true });
    jest.spyOn(adminModel, 'countAdmins').mockResolvedValue(1);
    try {
      expect((await admin.api.put(`/admin/users/${other.id}/roles`, { role: 'ADMIN', granted: false })).status).toBe(409);
      expect((await admin.api.patch(`/admin/users/${other.id}/status`, { status: 'SUSPENDED' })).status).toBe(409);
    } finally {
      jest.restoreAllMocks();
    }
    expect((await admin.api.patch('/admin/users/999999999/status', { status: 'SUSPENDED' })).status).toBe(404);
    expect((await admin.api.patch(`/admin/users/${other.id}/status`, { status: 'DEACTIVATED' })).status).toBe(400);
  });

  test('an administrator can unlock a locked account', async () => {
    const user = await newUser();
    for (let i = 0; i < 5; i += 1) await authPost('/auth/login', { email: user.email, password: 'Wrong-Passw0rd!!' });
    expect((await authPost('/auth/login', { email: user.email, password: PASSWORD })).status).toBe(423);
    const res = await admin.api.post(`/admin/users/${user.id}/unlock`);
    expect(res.body.data).toMatchObject({ locked: false, failedLoginCount: 0 });
    expect((await authPost('/auth/login', { email: user.email, password: PASSWORD })).status).toBe(200);
  });

  test('security events and audit rows across all users, with filters', async () => {
    const critical = await admin.api.get('/admin/security-events?severity=CRITICAL&pageSize=5');
    expect(critical.status).toBe(200);
    expect(critical.body.data.every((e) => e.severity === 'CRITICAL')).toBe(true);
    expect(critical.body.data[0]).toHaveProperty('userEmail');
    const adminActions = await admin.api.get('/admin/audit-logs?eventType=ADMIN');
    expect(adminActions.body.data.every((row) => row.eventType === 'ADMIN')).toBe(true);
    expect((await admin.api.get('/admin/audit-logs?action=ROLE_GRANTED')).body.data.length).toBeGreaterThan(0);
  });

  test('verifying the chain reports it intact and is itself recorded', async () => {
    const res = await admin.api.post('/admin/audit-logs/verify');
    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBeUndefined(); // shows the verifier's reason if it ever fails
    expect(res.body.data).toMatchObject({ valid: true, checkedRows: expect.any(Number) });
    const [last] = await database.query('SELECT user_id, action, details FROM audit_logs ORDER BY id DESC LIMIT 1');
    expect(last).toMatchObject({ user_id: admin.id, action: 'AUDIT_CHAIN_VERIFIED' });
    expect(last.details.valid).toBe(true);
  });
});

describe('operational scripts', () => {
  test('make-admin grants the role once and refuses unknown accounts', async () => {
    const user = await newUser();
    expect(await makeAdmin(user.email)).toEqual({ userId: user.id, changed: true });
    expect(await makeAdmin(user.email.toUpperCase())).toEqual({ userId: user.id, changed: false });
    await expect(makeAdmin('nobody@example.test')).rejects.toThrow(/No active account/);
    await expect(makeAdmin("x' OR '1'='1")).rejects.toThrow(/email address/);
  });

  test('key rotation leaves every encrypted value readable', async () => {
    const user = await newUser();
    await user.api.put('/users/profile', { fullName: 'Security Tester', phone: '+44 20 7946 0958' });
    const dry = await rotate({ dryRun: true });
    expect(dry.fields.map((f) => `${f.table}.${f.column}`)).toEqual(['users.phone_enc', 'transactions.notes_enc', 'savings_goals.notes_enc', 'user_mfa.secret_enc']);
    const result = await rotate();
    expect(result.fields.every((f) => f.failed === 0)).toBe(true);
    expect((await user.api.get('/users/profile')).body.data.phone).toBe('+44 20 7946 0958');
    expect(await audit.verifyChain()).toMatchObject({ valid: true });
  });
});
