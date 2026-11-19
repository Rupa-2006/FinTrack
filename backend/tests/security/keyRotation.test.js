// Key rotation with a real version change: values written with the current key are
// re-encrypted with a new active key, stay readable, and are bound to the same row.
// The configuration is the real one plus one extra key version that becomes active.
jest.mock('../../config/env', () => {
  const nodeCrypto = require('crypto');
  const actual = jest.requireActual('../../config/env');
  const current = actual.config.encryption;
  const next = Math.max(...current.keys.keys()) + 1;
  const keys = [...current.keys].map(([version, key]) => `${version}:${key.toString('hex')}`);
  keys.push(`${next}:${nodeCrypto.randomBytes(32).toString('hex')}`);
  return {
    ...actual,
    previousVersion: current.activeVersion,
    config: actual.loadConfig({ ...process.env, ENCRYPTION_KEYS: keys.join(','), ENCRYPTION_ACTIVE_KEY_VERSION: String(next) }),
  };
});

const crypto = require('crypto');
const database = require('../../config/database');
const { config, previousVersion } = require('../../config/env');
const { decryptField } = require('../../security/fieldCrypto');
const { rotate } = require('../../scripts/rotate-encryption-key');
const audit = require('../../services/audit.service');

const NEW_VERSION = config.encryption.activeVersion;
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

// Encrypts exactly as fieldCrypto does, but with a chosen key version.
function encryptWith(version, plaintext, context) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryption.keys.get(version), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [`v${version}`, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

const users = [];
let firstRun;

beforeAll(async () => {
  for (const [index, phone] of ['+44 20 7946 0101', '+91 98765 43210'].entries()) {
    const result = await database.query('INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)', [
      'Rotation Tester', `rotation${index}.${RUN}@example.test`, 'not-a-real-hash',
    ]);
    const id = result.insertId;
    await database.query('UPDATE users SET phone_enc = ? WHERE id = ?', [encryptWith(previousVersion, phone, `users:phone_enc:${id}`), id]);
    users.push({ id, phone });
  }
});

// Other suites share this database and only know the original key, so put every value this
// suite re-encrypted back under the original key.
afterAll(async () => {
  for (const { table, owner, column } of [
    { table: 'users', owner: 'id', column: 'phone_enc' }, { table: 'transactions', owner: 'user_id', column: 'notes_enc' },
    { table: 'savings_goals', owner: 'user_id', column: 'notes_enc' }, { table: 'user_mfa', owner: 'user_id', column: 'secret_enc' },
  ]) {
    const rows = await database.query(`SELECT id, ${owner} AS owner_id, ${column} AS value FROM ${table} WHERE ${column} LIKE ?`, [`v${NEW_VERSION}.%`]);
    for (const row of rows) {
      const context = `${table}:${column}:${row.owner_id}`;
      await database.query(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [encryptWith(previousVersion, decryptField(row.value, context), context), row.id]);
    }
  }
  await database.close();
});

const stored = async (id) => (await database.query('SELECT phone_enc FROM users WHERE id = ?', [id]))[0].phone_enc;

test('a dry run counts the old values and changes nothing', async () => {
  const before = await Promise.all(users.map((user) => stored(user.id)));
  const report = await rotate({ dryRun: true });
  expect(report).toMatchObject({ activeVersion: NEW_VERSION, dryRun: true });
  expect(report.fields.find((field) => field.table === 'users').rewritten).toBeGreaterThanOrEqual(users.length);
  expect(await Promise.all(users.map((user) => stored(user.id)))).toEqual(before);
});

test('rotation re-encrypts old values with the new key, and they still decrypt', async () => {
  // Other suites leave deliberately broken values behind (a ciphertext copied to another row);
  // those are reported as failed, which is the point. This suite's own values must all succeed.
  firstRun = await rotate();
  expect(firstRun.fields.find((field) => field.table === 'users').rewritten).toBeGreaterThanOrEqual(users.length);
  for (const user of users) {
    const value = await stored(user.id);
    expect(value.startsWith(`v${NEW_VERSION}.`)).toBe(true);
    expect(value).not.toContain(user.phone);
    expect(decryptField(value, `users:phone_enc:${user.id}`)).toBe(user.phone);
  }
});

test('a second run finds nothing left to re-encrypt', async () => {
  const report = await rotate({ dryRun: true });
  // Only the values no key can open remain, and they are the ones already reported as failed.
  expect(report.fields.map((field) => field.rewritten)).toEqual(firstRun.fields.map((field) => field.failed));
});

test('re-encrypted values are still bound to their own row', async () => {
  const [first, second] = users;
  const value = await stored(first.id);
  expect(() => decryptField(value, `users:phone_enc:${second.id}`)).toThrow();
});

test('a value no key can open is counted as failed, left untouched and never printed', async () => {
  const id = users[1].id;
  const garbage = `v${previousVersion}.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA`;
  await database.query('UPDATE users SET phone_enc = ? WHERE id = ?', [garbage, id]);
  const report = await rotate();
  const failedBefore = firstRun.fields.find((field) => field.table === 'users').failed;
  expect(report.fields.find((field) => field.table === 'users').failed).toBe(failedBefore + 1);
  expect(await stored(id)).toBe(garbage);
  expect(JSON.stringify(report)).not.toContain(garbage);
  await database.query('UPDATE users SET phone_enc = NULL WHERE id = ?', [id]);
});

test('each real run is written to the audit trail, which stays intact', async () => {
  const [row] = await database.query("SELECT details FROM audit_logs WHERE action = 'ENCRYPTION_KEY_ROTATED' ORDER BY id DESC LIMIT 1");
  const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
  expect(details.fields.map((field) => field.table)).toEqual(['users', 'transactions', 'savings_goals', 'user_mfa']);
  expect(await audit.verifyChain()).toMatchObject({ valid: true });
});
