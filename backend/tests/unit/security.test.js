// Password policy, token helpers and field encryption, without HTTP or the database.
const passwords = require('../../security/passwords');
const tokens = require('../../security/tokens');
const { encryptField, decryptField } = require('../../security/fieldCrypto');

describe('password policy', () => {
  test('a strong password has no problems', () => {
    expect(passwords.basicPasswordProblems('Tr1cky-Horse-Battery!')).toEqual([]);
  });

  test('each rule is reported separately', () => {
    expect(passwords.basicPasswordProblems('abc')).toEqual(['Use at least 10 characters', 'Add an uppercase letter', 'Add a number', 'Add a symbol']);
    expect(passwords.basicPasswordProblems('ABCDEFGHIJ1!')).toEqual(['Add a lowercase letter']);
  });

  test('input longer than bcrypt can hash is refused instead of silently truncated', () => {
    expect(passwords.basicPasswordProblems(`Aa1!${'x'.repeat(70)}`)).toEqual(['Use at most 72 characters']);
    expect(passwords.basicPasswordProblems(`Aa1!${'é'.repeat(40)}`)).toEqual(['Use at most 72 characters']); // 84 bytes
  });

  test('passwords built from the name, the email or a common password are refused', () => {
    expect(passwords.contextualPasswordProblems('Aarav-2026-Secure!', { fullName: 'Aarav Sharma' })).toEqual(['Do not use your name in your password']);
    expect(passwords.contextualPasswordProblems('xx-Budgetfan-99!', { email: 'budgetfan@example.test' })).toEqual(['Do not use your email address in your password']);
    expect(passwords.contextualPasswordProblems('Password-123!', {})).toEqual(['This password is too common']);
    expect(passwords.contextualPasswordProblems('Tr1cky-Horse-Battery!', { fullName: 'Al Wu', email: 'al@example.test' })).toEqual([]);
  });

  test('hashes are salted bcrypt and verify only the right password', async () => {
    const first = await passwords.hashPassword('Tr1cky-Horse-Battery!');
    const second = await passwords.hashPassword('Tr1cky-Horse-Battery!');
    expect(first).toMatch(/^\$2[aby]\$/);
    expect(first).not.toBe(second);
    expect(await passwords.verifyPassword('Tr1cky-Horse-Battery!', first)).toBe(true);
    expect(await passwords.verifyPassword('tr1cky-horse-battery!', first)).toBe(false);
  });
});

describe('tokens', () => {
  test('access tokens round-trip and reject alteration', () => {
    const token = tokens.signAccessToken({ userId: 42, sessionId: 7 });
    expect(tokens.verifyAccessToken(token)).toEqual({ userId: 42, sessionId: 7 });
    expect(() => tokens.verifyAccessToken(`${token.slice(0, -2)}xx`)).toThrow();
  });

  test('opaque tokens are 256-bit, unique and stored as a different value', () => {
    const first = tokens.generateOpaqueToken();
    const second = tokens.generateOpaqueToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
    expect(tokens.hashToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.hashToken(first)).toBe(tokens.hashToken(first));
  });
});

describe('field encryption (AES-256-GCM)', () => {
  const context = 'users:phone_enc:42';

  test('round-trips, including non-ASCII text, and passes null through', () => {
    const stored = encryptField('+91 98765 43210', context);
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain('98765');
    expect(decryptField(stored, context)).toBe('+91 98765 43210');
    expect(decryptField(encryptField('नोट ✓', context), context)).toBe('नोट ✓');
    expect(encryptField(null, context)).toBeNull();
    expect(decryptField(null, context)).toBeNull();
  });

  test('the same value encrypts differently every time', () => {
    expect(encryptField('same', context)).not.toBe(encryptField('same', context));
  });

  test('a changed ciphertext, a changed tag or another row context fails to decrypt', () => {
    const stored = encryptField('secret value', context);
    const [version, iv, tag, data] = stored.split('.');
    const flip = (part) => (part[0] === 'A' ? 'B' : 'A') + part.slice(1);
    expect(() => decryptField([version, iv, tag, flip(data)].join('.'), context)).toThrow();
    expect(() => decryptField([version, iv, flip(tag), data].join('.'), context)).toThrow();
    expect(() => decryptField(stored, 'users:phone_enc:43')).toThrow();
    expect(() => decryptField(['v9', iv, tag, data].join('.'), context)).toThrow(/unknown format or key version/);
    expect(() => decryptField('plain text', context)).toThrow();
  });
});
