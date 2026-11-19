// Authentication and authorization, end to end against the real test database.
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../app');
const database = require('../../config/database');
const { config } = require('../../config/env');
const { JWT_ISSUER, JWT_AUDIENCE, LOCKOUT } = require('../../config/constants');
const mailService = require('../../services/mail.service');
const { authenticate, authorize } = require('../../middleware/authenticate');
const { errorHandler } = require('../../middleware/errorHandler');

const RELAXED = { windowMs: 60000, limit: 10000 };
const app = createApp({
  globalRateLimit: RELAXED,
  authRateLimits: { login: RELAXED, register: RELAXED, passwordReset: RELAXED, refresh: RELAXED },
});

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'Tr1cky-Horse-Battery!';
const OTHER_PASSWORD = 'An0ther-Quiet-River?';
let counter = 0;
const newEmail = () => `person${(counter += 1)}.${RUN}@example.test`;

const post = (path) => request(app).post(path).set('X-Requested-With', 'XMLHttpRequest');
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

function refreshCookie(res) {
  const header = (res.headers['set-cookie'] || []).find((value) => value.startsWith('ft_refresh='));
  return header ? header.split(';')[0] : null;
}

async function registerUser(overrides = {}) {
  const email = overrides.email || newEmail();
  const res = await post('/api/auth/register').send({ fullName: 'Test Person', email, password: PASSWORD, ...overrides });
  if (res.status !== 201) throw new Error(`registration failed: ${JSON.stringify(res.body)}`);
  return { email, user: res.body.data.user, accessToken: res.body.data.accessToken, cookie: refreshCookie(res), res };
}

const login = (email, password = PASSWORD) => post('/api/auth/login').send({ email, password });

async function eventsFor(userId) {
  return database.query('SELECT event_type, severity, metadata FROM security_events WHERE user_id = ? ORDER BY id', [userId]);
}

afterAll(async () => {
  await database.close();
});

describe('registration', () => {
  test('creates the account, signs the user in and stores only a bcrypt hash', async () => {
    const { res, user, email } = await registerUser({ baseCurrency: 'USD' });
    expect(res.body.data.user).toEqual({ id: expect.any(Number), fullName: 'Test Person', email, baseCurrency: 'USD', roles: ['USER'] });
    expect(res.body.data.accessToken.split('.')).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toMatch(/password|refresh/i);

    const [row] = await database.query('SELECT password_hash, status FROM users WHERE id = ?', [user.id]);
    expect(row.password_hash).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
    expect(row.password_hash).not.toContain(PASSWORD);
    expect(row.status).toBe('ACTIVE');
  });

  test('sets the refresh token as an httpOnly, SameSite=Strict cookie scoped to /api/auth', async () => {
    const { res } = await registerUser();
    const cookie = res.headers['set-cookie'].find((value) => value.startsWith('ft_refresh='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  test('stores the refresh token only as a hash', async () => {
    const { cookie, user } = await registerUser();
    const raw = cookie.split('=')[1];
    const rows = await database.query(
      'SELECT rt.token_hash FROM refresh_tokens rt JOIN user_sessions s ON s.id = rt.session_id WHERE s.user_id = ?',
      [user.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toBe(raw);
  });

  test('rejects weak passwords and lists every unmet rule', async () => {
    const res = await post('/api/auth/register').send({ fullName: 'Test Person', email: newEmail(), password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const messages = res.body.error.details.filter((item) => item.field === 'body.password').map((item) => item.message);
    expect(messages).toEqual(expect.arrayContaining(['Use at least 10 characters', 'Add an uppercase letter', 'Add a number', 'Add a symbol']));
  });

  test('rejects a password containing the name or email, and common passwords', async () => {
    const withName = await post('/api/auth/register').send({ fullName: 'Marigold Stone', email: newEmail(), password: 'Marigold-2026!x' });
    expect(withName.status).toBe(400);
    expect(withName.body.error.details[0].message).toMatch(/name/);
    const common = await post('/api/auth/register').send({ fullName: 'Test Person', email: newEmail(), password: 'Password123!' });
    expect(common.status).toBe(400);
    expect(common.body.error.details[0].message).toMatch(/too common/);
  });

  test('rejects malformed input and ignores fields it does not know', async () => {
    const bad = await post('/api/auth/register').send({ fullName: '<script>alert(1)</script>', email: 'not-an-email', password: PASSWORD, baseCurrency: 'XXX' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.map((item) => item.field).sort()).toEqual(['body.baseCurrency', 'body.email', 'body.fullName']);

    // Trying to register as an administrator or pre-set a status has no effect.
    const { user } = await registerUser({ roles: ['ADMIN'], role: 'ADMIN', status: 'SUSPENDED', isAdmin: true });
    expect(user.roles).toEqual(['USER']);
    const roles = await database.query('SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?', [user.id]);
    expect(roles.map((row) => row.name)).toEqual(['USER']);
  });

  test('an email address can only be registered once, whatever its letter case', async () => {
    const { email } = await registerUser();
    const res = await post('/api/auth/register').send({ fullName: 'Test Person', email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  test('SQL injection text in sign-in fields is treated as data, not executed', async () => {
    const email = newEmail();
    const res = await post('/api/auth/login').send({ email: "x' OR '1'='1", password: "' OR ''='" });
    expect(res.status).toBe(400); // not an email address
    const second = await login(email, "' OR '1'='1' -- ");
    expect(second.status).toBe(401);
  });
});

describe('sign-in', () => {
  test('returns the user and an access token for correct credentials', async () => {
    const { email, user } = await registerUser();
    const res = await login(email.toUpperCase());
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: user.id, email, roles: ['USER'] });
    expect(refreshCookie(res)).toBeTruthy();
    const claims = jwt.decode(res.body.data.accessToken);
    expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub']); // ids only, no personal data
    expect(claims.exp - claims.iat).toBe(15 * 60);
  });

  test('an unknown email and a wrong password get the identical answer', async () => {
    const { email } = await registerUser();
    const wrong = await login(email, 'Wrong-Passw0rd!!');
    const unknown = await login(newEmail(), 'Wrong-Passw0rd!!');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.body.error.code).toBe('UNAUTHENTICATED');
    expect(refreshCookie(wrong)).toBeNull();
  });

  test(`locks the account after ${LOCKOUT.maxAttempts} wrong passwords, even for the right password`, async () => {
    const { email, user } = await registerUser();
    const statuses = [];
    for (let i = 0; i < LOCKOUT.maxAttempts; i += 1) statuses.push((await login(email, 'Wrong-Passw0rd!!')).status);
    expect(statuses).toEqual([401, 401, 401, 401, 423]);

    const blocked = await login(email);
    expect(blocked.status).toBe(423);
    expect(blocked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(blocked.body.error.message).toMatch(/Try again in \d+ minute/);

    const events = await eventsFor(user.id);
    expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining(['LOGIN_FAILED', 'ACCOUNT_LOCKED']));
    expect(events.find((event) => event.event_type === 'ACCOUNT_LOCKED').severity).toBe('CRITICAL');

    // When the lock has run out, signing in works again and the counter is back to zero.
    await database.query('UPDATE users SET locked_until = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?', [user.id]);
    expect((await login(email, 'Wrong-Passw0rd!!')).status).toBe(401);
    expect((await login(email)).status).toBe(200);
    const [row] = await database.query('SELECT failed_login_count, locked_until FROM users WHERE id = ?', [user.id]);
    expect(row).toEqual({ failed_login_count: 0, locked_until: null });
  });

  test('a successful sign-in resets the failed-attempt counter', async () => {
    const { email, user } = await registerUser();
    await login(email, 'Wrong-Passw0rd!!');
    await login(email, 'Wrong-Passw0rd!!');
    await login(email);
    const [row] = await database.query('SELECT failed_login_count FROM users WHERE id = ?', [user.id]);
    expect(row.failed_login_count).toBe(0);
  });

  test('security events never contain the password', async () => {
    const { email, user } = await registerUser();
    await login(email, 'Wrong-Passw0rd!!');
    await login(email);
    const events = await eventsFor(user.id);
    expect(events.map((event) => event.event_type)).toEqual(['REGISTERED', 'LOGIN_FAILED', 'LOGIN_SUCCESS']);
    expect(JSON.stringify(events)).not.toMatch(/Wrong-Passw0rd|Tr1cky/);
  });

  test('sign-in is rate limited per client', async () => {
    const strict = createApp({ globalRateLimit: RELAXED, authRateLimits: { login: { windowMs: 60000, limit: 2 } } });
    const attempt = () => request(strict).post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: newEmail(), password: 'x' });
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('access tokens', () => {
  test('protected routes require a token', async () => {
    for (const res of [
      await request(app).get('/api/users/profile'),
      await request(app).get('/api/users/profile').set('Authorization', 'Bearer not-a-token'),
      await request(app).get('/api/users/profile').set('Authorization', 'Basic abc'),
      await request(app).get('/api/security/sessions'),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  test('forged, unsigned, expired and wrong-audience tokens are all refused', async () => {
    const { accessToken } = await registerUser();
    const claims = jwt.decode(accessToken);
    const key = Buffer.from(config.jwt.accessSecret, 'hex');
    const base = { sub: claims.sub, sid: claims.sid };
    const options = { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE };

    const [header, payload, signature] = accessToken.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ ...claims, sub: '1' })).toString('base64url');
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
    const candidates = {
      tampered: `${header}.${tamperedPayload}.${signature}`,
      unsigned,
      wrongKey: jwt.sign(base, Buffer.alloc(32, 7), { ...options, expiresIn: '15m' }),
      expired: jwt.sign({ ...base, iat: Math.floor(Date.now() / 1000) - 3600 }, key, { ...options, expiresIn: '15m' }),
      wrongAudience: jwt.sign(base, key, { ...options, audience: 'someone-else', expiresIn: '15m' }),
    };
    for (const [name, token] of Object.entries(candidates)) {
      const res = await request(app).get('/api/users/profile').set(bearer(token));
      expect([name, res.status]).toEqual([name, 401]);
    }
    // Control: the genuine token works.
    expect((await request(app).get('/api/users/profile').set(bearer(accessToken))).status).toBe(200);
  });
});

describe('refresh token rotation', () => {
  test('a refresh issues a new access token and replaces the refresh token', async () => {
    const { cookie, user } = await registerUser();
    const res = await post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.accessToken.split('.')).toHaveLength(3);
    const next = refreshCookie(res);
    expect(next).toBeTruthy();
    expect(next).not.toBe(cookie);
    expect((await post('/api/auth/refresh').set('Cookie', next)).status).toBe(200);
  });

  test('reusing an old refresh token revokes the whole session', async () => {
    const { cookie, user } = await registerUser();
    const rotated = await post('/api/auth/refresh').set('Cookie', cookie);
    const stolenReplay = await post('/api/auth/refresh').set('Cookie', cookie);
    expect(stolenReplay.status).toBe(401);
    expect(stolenReplay.headers['set-cookie'].join(';')).toMatch(/ft_refresh=;/); // cookie cleared

    // The legitimate holder of the newer token is signed out too, and so is the access token.
    expect((await post('/api/auth/refresh').set('Cookie', refreshCookie(rotated))).status).toBe(401);
    expect((await request(app).get('/api/users/profile').set(bearer(rotated.body.data.accessToken))).status).toBe(401);

    const events = await eventsFor(user.id);
    expect(events.find((event) => event.event_type === 'REFRESH_TOKEN_REUSE').severity).toBe('CRITICAL');
  });

  test('a missing or made-up refresh token is refused', async () => {
    expect((await post('/api/auth/refresh')).status).toBe(401);
    expect((await post('/api/auth/refresh').set('Cookie', 'ft_refresh=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(401);
  });

  test('two simultaneous refreshes with the same token cannot both succeed', async () => {
    const { cookie } = await registerUser();
    const results = await Promise.all([post('/api/auth/refresh').set('Cookie', cookie), post('/api/auth/refresh').set('Cookie', cookie)]);
    expect(results.filter((res) => res.status === 200).length).toBeLessThanOrEqual(1);
  });
});

describe('CSRF defence on cookie routes', () => {
  test('a request without the custom header is blocked', async () => {
    const { cookie } = await registerUser();
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('a request from another origin is blocked even with the header', async () => {
    const { cookie } = await registerUser();
    const res = await post('/api/auth/refresh').set('Cookie', cookie).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    const allowed = await post('/api/auth/refresh').set('Cookie', cookie).set('Origin', config.clientOrigins[0]);
    expect(allowed.status).toBe(200);
  });
});

describe('sign-out', () => {
  test('revokes the session, clears the cookie and kills the access token', async () => {
    const { cookie, accessToken } = await registerUser();
    const res = await post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'].join(';')).toMatch(/ft_refresh=;/);
    expect((await post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect((await request(app).get('/api/users/profile').set(bearer(accessToken))).status).toBe(401);
    expect((await post('/api/auth/logout')).status).toBe(204); // signing out twice is harmless
  });
});

describe('password reset', () => {
  const tokenFromOutbox = (email) => {
    const mail = [...mailService.outbox].reverse().find((message) => message.to === email);
    return mail ? /#token=([A-Za-z0-9_-]+)/.exec(mail.text)[1] : null;
  };

  test('the answer is the same for known and unknown addresses, and only real accounts get mail', async () => {
    const { email } = await registerUser();
    const unknownEmail = newEmail();
    const known = await post('/api/auth/forgot-password').send({ email });
    const unknown = await post('/api/auth/forgot-password').send({ email: unknownEmail });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(JSON.stringify(known.body)).not.toMatch(/token=/);
    expect(tokenFromOutbox(email)).toBeTruthy();
    expect(tokenFromOutbox(unknownEmail)).toBeNull();
  });

  test('a reset link changes the password once, signs out every session and stores only a hash', async () => {
    const { email, cookie, accessToken, user } = await registerUser();
    await post('/api/auth/forgot-password').send({ email });
    const token = tokenFromOutbox(email);
    const [stored] = await database.query('SELECT token_hash FROM password_reset_tokens WHERE user_id = ?', [user.id]);
    expect(stored.token_hash).not.toBe(token);

    const weak = await post('/api/auth/reset-password').send({ token, password: 'weak' });
    expect(weak.status).toBe(400);

    const res = await post('/api/auth/reset-password').send({ token, password: OTHER_PASSWORD });
    expect(res.status).toBe(200);
    expect((await login(email, PASSWORD)).status).toBe(401);
    expect((await login(email, OTHER_PASSWORD)).status).toBe(200);
    expect((await post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect((await request(app).get('/api/users/profile').set(bearer(accessToken))).status).toBe(401);

    const again = await post('/api/auth/reset-password').send({ token, password: 'Third-Passw0rd-Here!' });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toMatch(/invalid or has expired/);
  });

  test('expired links, superseded links and invented tokens do not work', async () => {
    const { email, user } = await registerUser();
    await post('/api/auth/forgot-password').send({ email });
    const first = tokenFromOutbox(email);
    await post('/api/auth/forgot-password').send({ email });
    const second = tokenFromOutbox(email);
    expect(second).not.toBe(first);
    expect((await post('/api/auth/reset-password').send({ token: first, password: OTHER_PASSWORD })).status).toBe(400);

    await database.query('UPDATE password_reset_tokens SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE user_id = ?', [user.id]);
    expect((await post('/api/auth/reset-password').send({ token: second, password: OTHER_PASSWORD })).status).toBe(400);
    expect((await post('/api/auth/reset-password').send({ token: 'A'.repeat(43), password: OTHER_PASSWORD })).status).toBe(400);
    expect((await login(email)).status).toBe(200); // password unchanged
  });
});

describe('profile', () => {
  test('a user reads and updates their own profile; the phone number is encrypted at rest', async () => {
    const { accessToken, user, email } = await registerUser();
    const before = await request(app).get('/api/users/profile').set(bearer(accessToken));
    expect(before.body.data).toMatchObject({ id: user.id, email, fullName: 'Test Person', phone: null, baseCurrency: 'INR', status: 'ACTIVE', roles: ['USER'] });
    expect(before.body.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(JSON.stringify(before.body)).not.toMatch(/password_hash|passwordHash|phone_enc/);

    const res = await request(app).put('/api/users/profile').set(bearer(accessToken)).send({ fullName: "Asha O'Neil-Rao", phone: '+91 98765 43210' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fullName: "Asha O'Neil-Rao", phone: '+91 98765 43210' });

    const [row] = await database.query('SELECT phone_enc FROM users WHERE id = ?', [user.id]);
    expect(row.phone_enc).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(row.phone_enc).not.toContain('98765');

    const cleared = await request(app).put('/api/users/profile').set(bearer(accessToken)).send({ fullName: "Asha O'Neil-Rao", phone: '' });
    expect(cleared.body.data.phone).toBeNull();
  });

  test('email, role, status and currency cannot be changed through the profile', async () => {
    const { accessToken, email } = await registerUser();
    const res = await request(app)
      .put('/api/users/profile')
      .set(bearer(accessToken))
      .send({ fullName: 'Test Person', email: 'attacker@example.test', roles: ['ADMIN'], status: 'SUSPENDED', baseCurrency: 'USD', id: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email, roles: ['USER'], status: 'ACTIVE', baseCurrency: 'INR' });
  });

  test('invalid profile input is rejected field by field', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).put('/api/users/profile').set(bearer(accessToken)).send({ fullName: 'X', phone: 'call me' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((item) => item.field).sort()).toEqual(['body.fullName', 'body.phone']);
  });

  test("an encrypted phone number copied into another user's row does not decrypt", async () => {
    const first = await registerUser();
    const second = await registerUser();
    await request(app).put('/api/users/profile').set(bearer(first.accessToken)).send({ fullName: 'Test Person', phone: '+44 20 7946 0958' });
    const [row] = await database.query('SELECT phone_enc FROM users WHERE id = ?', [first.user.id]);
    await database.query('UPDATE users SET phone_enc = ? WHERE id = ?', [row.phone_enc, second.user.id]);
    const res = await request(app).get('/api/users/profile').set(bearer(second.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBeNull();
  });
});

describe('changing the password', () => {
  test('requires the current password, enforces the policy and signs out other devices', async () => {
    const { email, accessToken } = await registerUser();
    const otherDevice = await login(email);
    const put = (body) => request(app).put('/api/users/password').set(bearer(accessToken)).send(body);

    const wrongCurrent = await put({ currentPassword: 'Wrong-Passw0rd!!', newPassword: OTHER_PASSWORD });
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.body.error.details[0].field).toBe('body.currentPassword');
    expect((await put({ currentPassword: PASSWORD, newPassword: 'weak' })).status).toBe(400);
    expect((await put({ currentPassword: PASSWORD, newPassword: PASSWORD })).status).toBe(400);

    const res = await put({ currentPassword: PASSWORD, newPassword: OTHER_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ otherSessionsRevoked: 1 });

    expect((await request(app).get('/api/users/profile').set(bearer(accessToken))).status).toBe(200); // this device stays signed in
    expect((await request(app).get('/api/users/profile').set(bearer(otherDevice.body.data.accessToken))).status).toBe(401);
    expect((await login(email, PASSWORD)).status).toBe(401);
    expect((await login(email, OTHER_PASSWORD)).status).toBe(200);
  });
});

describe('sessions', () => {
  test('a user lists their sessions and can end another one', async () => {
    const { email, accessToken } = await registerUser();
    const second = await login(email);
    const list = await request(app).get('/api/security/sessions').set(bearer(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((session) => session.current)).toHaveLength(1);
    const other = list.body.data.find((session) => !session.current);

    const res = await request(app).delete(`/api/security/sessions/${other.id}`).set(bearer(accessToken));
    expect(res.status).toBe(204);
    expect((await request(app).get('/api/users/profile').set(bearer(second.body.data.accessToken))).status).toBe(401);
    expect((await request(app).get('/api/security/sessions').set(bearer(accessToken))).body.data).toHaveLength(1);
  });

  test("a user cannot see or end another user's session", async () => {
    const victim = await registerUser();
    const attacker = await registerUser();
    const victimSessions = await request(app).get('/api/security/sessions').set(bearer(victim.accessToken));
    const victimSessionId = victimSessions.body.data[0].id;

    const attackerList = await request(app).get('/api/security/sessions').set(bearer(attacker.accessToken));
    expect(attackerList.body.data.map((session) => session.id)).not.toContain(victimSessionId);

    const res = await request(app).delete(`/api/security/sessions/${victimSessionId}`).set(bearer(attacker.accessToken));
    expect(res.status).toBe(404);
    expect((await request(app).get('/api/users/profile').set(bearer(victim.accessToken))).status).toBe(200);
    expect((await request(app).delete('/api/security/sessions/abc').set(bearer(attacker.accessToken))).status).toBe(400);
  });

  test('"sign out everywhere else" keeps only the current session', async () => {
    const { email, accessToken } = await registerUser();
    await login(email);
    await login(email);
    const res = await request(app).delete('/api/security/sessions').set(bearer(accessToken));
    expect(res.body.data).toEqual({ revoked: 2 });
    expect((await request(app).get('/api/security/sessions').set(bearer(accessToken))).body.data).toHaveLength(1);
  });
});

describe('account deactivation', () => {
  test('needs the password, ends every session and blocks future sign-in', async () => {
    const { email, accessToken, cookie, user } = await registerUser();
    const wrong = await request(app).post('/api/users/deactivate').set(bearer(accessToken)).send({ password: 'Wrong-Passw0rd!!' });
    expect(wrong.status).toBe(400);

    const res = await request(app).post('/api/users/deactivate').set(bearer(accessToken)).send({ password: PASSWORD });
    expect(res.status).toBe(204);
    expect((await request(app).get('/api/users/profile').set(bearer(accessToken))).status).toBe(401);
    expect((await post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    const signIn = await login(email);
    expect(signIn.status).toBe(403);
    expect((await login(email, 'Wrong-Passw0rd!!')).status).toBe(401); // a stranger still learns nothing

    const [row] = await database.query('SELECT status FROM users WHERE id = ?', [user.id]);
    expect(row.status).toBe('DEACTIVATED'); // the row is kept, not deleted
  });
});

describe('role-based access control', () => {
  const probe = express();
  probe.get('/admin-only', authenticate, authorize('ADMIN'), (_req, res) => res.json({ ok: true }));
  probe.use(errorHandler);

  test('a normal user is refused an admin route and the attempt is recorded', async () => {
    const { accessToken, user } = await registerUser();
    const res = await request(probe).get('/admin-only').set(bearer(accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await request(probe).get('/admin-only')).status).toBe(401);
    const events = await eventsFor(user.id);
    expect(events.map((event) => event.event_type)).toContain('ACCESS_DENIED');
  });

  test('roles are read from the database on every request, so changes apply at once', async () => {
    const { accessToken, user } = await registerUser();
    await database.query("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'ADMIN'", [user.id]);
    expect((await request(probe).get('/admin-only').set(bearer(accessToken))).status).toBe(200);
    await database.query("DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = 'ADMIN'", [user.id]);
    expect((await request(probe).get('/admin-only').set(bearer(accessToken))).status).toBe(403);
  });

  test('an administrator account cannot deactivate itself', async () => {
    const { accessToken, user } = await registerUser();
    await database.query("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'ADMIN'", [user.id]);
    const res = await request(app).post('/api/users/deactivate').set(bearer(accessToken)).send({ password: PASSWORD });
    expect(res.status).toBe(403);
  });
});
