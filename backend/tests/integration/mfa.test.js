// Two-step sign-in end to end, against the real database: setup, enabling, the sign-in
// challenge, replay protection, recovery codes, attempt limits, lockout, turning it off.
const request = require('supertest');
const { createApp } = require('../../app');
const database = require('../../config/database');
const totp = require('../../security/totp');
const audit = require('../../services/audit.service');

const RELAXED = { windowMs: 60000, limit: 100000 };
const app = createApp({ globalRateLimit: RELAXED, authRateLimits: { login: RELAXED, register: RELAXED, passwordReset: RELAXED, refresh: RELAXED } });
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'Tr1cky-Horse-Battery!';
let counter = 0;

const authPost = (path, body) => request(app).post(`/api${path}`).set('X-Requested-With', 'XMLHttpRequest').send(body);
const api = (token) => ({
  get: (path) => request(app).get(`/api${path}`).set('Authorization', `Bearer ${token}`),
  post: (path, body) => request(app).post(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
});
const codeAt = (secret, offset = 0) => totp.hotp(secret, totp.stepAt(Date.now()) + offset);

async function newUser() {
  counter += 1;
  const email = `mfa${counter}.${RUN}@example.test`;
  const res = await authPost('/auth/register', { fullName: 'Two Step Tester', email, password: PASSWORD });
  return { id: res.body.data.user.id, email, client: api(res.body.data.accessToken) };
}

// A user with two-step sign-in on. The enabling code used the current time step, so the next
// sign-in uses the next step (accepted within the clock-drift window).
async function userWithMfa() {
  const user = await newUser();
  const { secret } = (await user.client.post('/security/mfa/setup')).body.data;
  const enabled = await user.client.post('/security/mfa/enable', { code: codeAt(secret) });
  return { ...user, secret, recoveryCodes: enabled.body.data.recoveryCodes };
}

const startSignIn = async (email) => (await authPost('/auth/login', { email, password: PASSWORD })).body.data;
const securityEvents = (userId) => database.query('SELECT event_type FROM security_events WHERE user_id = ? ORDER BY id', [userId]);
const notices = async (client) => (await client.get('/notifications')).body.data.filter((n) => n.type === 'SECURITY').map((n) => n.title);

afterAll(async () => {
  await database.close();
});

describe('setting up two-step sign-in', () => {
  test('setup gives a secret and an otpauth link; the secret is stored encrypted', async () => {
    const { id, email, client } = await newUser();
    expect((await client.get('/security/mfa')).body.data).toEqual({ enabled: false, enabledAt: null, recoveryCodesLeft: 0 });
    const res = await client.post('/security/mfa/setup');
    expect(res.status).toBe(200);
    expect(res.body.data.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.body.data.otpauthUri).toBe(
      `otpauth://totp/${encodeURIComponent(`FinTrack:${email}`)}?secret=${res.body.data.secret}&issuer=FinTrack&algorithm=SHA1&digits=6&period=30`
    );
    const [row] = await database.query('SELECT secret_enc, enabled_at FROM user_mfa WHERE user_id = ?', [id]);
    expect(row.secret_enc).toMatch(/^v\d+\./);
    expect(row.secret_enc).not.toContain(res.body.data.secret);
    expect(row.enabled_at).toBeNull();
  });

  test('asking for setup twice at once, or again soon after, gives the same secret (it must match the stored one)', async () => {
    const { id, client } = await newUser();
    const [first, second] = await Promise.all([client.post('/security/mfa/setup'), client.post('/security/mfa/setup')]);
    expect(first.body.data.secret).toBe(second.body.data.secret);
    expect((await client.post('/security/mfa/setup')).body.data.secret).toBe(first.body.data.secret);
    // after 10 minutes an unconfirmed secret is replaced
    await database.query('UPDATE user_mfa SET created_at = DATE_SUB(NOW(3), INTERVAL 11 MINUTE) WHERE user_id = ?', [id]);
    const later = (await client.post('/security/mfa/setup')).body.data.secret;
    expect(later).not.toBe(first.body.data.secret);
    expect((await client.post('/security/mfa/enable', { code: codeAt(later) })).status).toBe(200); // the shown secret works
  });

  test('a wrong first code changes nothing; the right one turns it on and gives 10 recovery codes once', async () => {
    const { id, client } = await newUser();
    const { secret } = (await client.post('/security/mfa/setup')).body.data;
    const wrong = await client.post('/security/mfa/enable', { code: '000000' === codeAt(secret) ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect((await client.get('/security/mfa')).body.data.enabled).toBe(false);

    const res = await client.post('/security/mfa/enable', { code: codeAt(secret) });
    expect(res.status).toBe(200);
    expect(res.body.data.recoveryCodes).toHaveLength(10);
    expect(new Set(res.body.data.recoveryCodes).size).toBe(10);
    for (const code of res.body.data.recoveryCodes) expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect((await client.get('/security/mfa')).body.data).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });

    const stored = await database.query('SELECT code_hash FROM mfa_recovery_codes WHERE user_id = ?', [id]);
    expect(stored.map((r) => r.code_hash)).toEqual(expect.arrayContaining(res.body.data.recoveryCodes.map(totp.hashRecoveryCode)));
    expect(JSON.stringify(stored)).not.toContain(res.body.data.recoveryCodes[0]);
    expect(await notices(client)).toContain('Two-step sign-in is on');
    expect((await client.post('/security/mfa/setup')).status).toBe(409); // cannot be replaced silently
  });
});

describe('signing in with two-step sign-in', () => {
  test('the password alone gives a challenge, not a session', async () => {
    const { email } = await userWithMfa();
    const res = await authPost('/auth/login', { email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ mfaRequired: true, challengeToken: expect.any(String), expiresInMinutes: 5 });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|user/);
  });

  test('a correct code completes the sign-in; the same code and the same challenge never work twice', async () => {
    const { id, email, secret } = await userWithMfa();
    const { challengeToken } = await startSignIn(email);
    const code = codeAt(secret, 1);
    const res = await authPost('/auth/mfa/verify', { challengeToken, code });
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(id);
    expect(res.headers['set-cookie'].join(';')).toMatch(/ft_refresh=.+HttpOnly/);
    expect((await api(res.body.data.accessToken).get('/users/profile')).status).toBe(200);

    expect((await authPost('/auth/mfa/verify', { challengeToken, code })).status).toBe(401); // challenge used
    const again = await startSignIn(email);
    const replay = await authPost('/auth/mfa/verify', { challengeToken: again.challengeToken, code });
    expect(replay.status).toBe(401); // code already used
    expect(replay.body.error.message).toMatch(/not correct/);

    const [signedIn] = await database.query("SELECT details FROM audit_logs WHERE user_id = ? AND action = 'SIGNED_IN' ORDER BY id DESC LIMIT 1", [id]);
    expect(typeof signedIn.details === 'string' ? JSON.parse(signedIn.details) : signedIn.details).toEqual({ method: 'authenticator' });
  });

  test('an invented or missing challenge is refused', async () => {
    expect((await authPost('/auth/mfa/verify', { challengeToken: 'x'.repeat(43), code: '123456' })).status).toBe(401);
    expect((await authPost('/auth/mfa/verify', { code: '123456' })).status).toBe(400);
    expect((await request(app).post('/api/auth/mfa/verify').send({ challengeToken: 'x'.repeat(43), code: '123456' })).status).toBe(403); // CSRF header
  });

  test('a challenge allows few attempts, and wrong codes count towards the account lockout', async () => {
    const { id, email, secret } = await userWithMfa();
    const { challengeToken } = await startSignIn(email);
    const wrong = codeAt(secret, 1) === '000000' ? '111111' : '000000';
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await authPost('/auth/mfa/verify', { challengeToken, code: wrong })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 423]); // the fifth failure locks the account
    expect((await authPost('/auth/login', { email, password: PASSWORD })).status).toBe(423);
    const events = (await securityEvents(id)).map((e) => e.event_type);
    expect(events.filter((e) => e === 'MFA_FAILED')).toHaveLength(5);
    expect(events).toContain('ACCOUNT_LOCKED');
  });

  test('a recovery code works once, and the user is told how many are left', async () => {
    const { email, recoveryCodes } = await userWithMfa();
    const first = await startSignIn(email);
    const res = await authPost('/auth/mfa/verify', { challengeToken: first.challengeToken, code: recoveryCodes[3].toUpperCase() });
    expect(res.status).toBe(200);
    const client = api(res.body.data.accessToken);
    expect((await client.get('/security/mfa')).body.data.recoveryCodesLeft).toBe(9);
    const notice = (await client.get('/notifications')).body.data.find((n) => n.title === 'A recovery code was used to sign in');
    expect(notice.message).toContain('9 left');

    const second = await startSignIn(email);
    expect((await authPost('/auth/mfa/verify', { challengeToken: second.challengeToken, code: recoveryCodes[3] })).status).toBe(401);
  });
});

describe('managing two-step sign-in', () => {
  test('new recovery codes need the password and replace the old ones', async () => {
    const { email, client, recoveryCodes } = await userWithMfa();
    expect((await client.post('/security/mfa/recovery-codes', { password: 'Wrong-Passw0rd!!' })).status).toBe(400);
    const res = await client.post('/security/mfa/recovery-codes', { password: PASSWORD });
    expect(res.body.data.recoveryCodes).toHaveLength(10);
    const { challengeToken } = await startSignIn(email);
    expect((await authPost('/auth/mfa/verify', { challengeToken, code: recoveryCodes[0] })).status).toBe(401);
    expect((await authPost('/auth/mfa/verify', { challengeToken, code: res.body.data.recoveryCodes[0] })).status).toBe(200);
  });

  test('turning it off needs the password and a current code, then the password is enough again', async () => {
    const { id, email, client, secret } = await userWithMfa();
    expect((await client.post('/security/mfa/disable', { password: 'Wrong-Passw0rd!!', code: codeAt(secret, 1) })).status).toBe(400);
    expect((await client.post('/security/mfa/disable', { password: PASSWORD, code: '12345x' })).status).toBe(400);
    const res = await client.post('/security/mfa/disable', { password: PASSWORD, code: codeAt(secret, 1) });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: false });
    expect(await database.query('SELECT id FROM user_mfa WHERE user_id = ?', [id])).toHaveLength(0);
    expect(await database.query('SELECT id FROM mfa_recovery_codes WHERE user_id = ?', [id])).toHaveLength(0);
    const signIn = await authPost('/auth/login', { email, password: PASSWORD });
    expect(signIn.body.data.accessToken).toEqual(expect.any(String));
    expect(await notices(client)).toContain('Two-step sign-in was turned off');
  });

  test('every change is audited without secrets, and the chain stays intact', async () => {
    const { id, secret, recoveryCodes } = await userWithMfa();
    const rows = await database.query('SELECT action, details FROM audit_logs WHERE user_id = ?', [id]);
    expect(rows.map((r) => r.action)).toContain('MFA_ENABLED');
    const all = JSON.stringify(rows) + JSON.stringify(await database.query('SELECT metadata FROM security_events WHERE user_id = ?', [id]));
    expect(all).not.toContain(secret);
    expect(all).not.toContain(recoveryCodes[0]);
    expect(await audit.verifyChain()).toMatchObject({ valid: true });
  });
});
