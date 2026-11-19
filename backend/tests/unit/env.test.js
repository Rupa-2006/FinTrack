const { loadConfig, ConfigError } = require('../../config/env');

const HEX = (char) => char.repeat(64);
const valid = () => ({
  NODE_ENV: 'development',
  DB_NAME: 'fintrack',
  DB_USER: 'fintrack_app',
  DB_PASSWORD: 'local-password',
  JWT_ACCESS_SECRET: HEX('a'),
  ENCRYPTION_KEYS: `1:${HEX('b')},2:${HEX('c')}`,
  ENCRYPTION_ACTIVE_KEY_VERSION: '2',
  AUDIT_HMAC_KEY: HEX('d'),
  CLIENT_ORIGINS: 'http://localhost:5173, http://localhost:4173',
  AI_SERVICE_URL: 'http://127.0.0.1:8000',
  AI_SERVICE_SHARED_SECRET: HEX('e'),
  FX_API_URL: 'https://api.frankfurter.dev/v1',
  SMTP_HOST: '',
});

describe('environment configuration', () => {
  test('parses a valid environment and applies defaults', () => {
    const config = loadConfig(valid());
    expect(config.port).toBe(5000);
    expect(config.db).toMatchObject({ host: '127.0.0.1', port: 3306, name: 'fintrack', poolSize: 10 });
    expect(config.jwt.accessTtl).toBe('15m');
    expect(config.clientOrigins).toEqual(['http://localhost:5173', 'http://localhost:4173']);
    expect(config.trustProxy).toBe(false);
    expect(config.mail.host).toBeNull();
    expect(config.docsEnabled).toBe(true);
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('decodes versioned encryption keys into 32-byte buffers', () => {
    const { encryption, auditHmacKey } = loadConfig(valid());
    expect([...encryption.keys.keys()]).toEqual([1, 2]);
    expect(encryption.keys.get(2)).toHaveLength(32);
    expect(encryption.activeVersion).toBe(2);
    expect(auditHmacKey).toHaveLength(32);
  });

  test('uses a separate database when NODE_ENV is test', () => {
    const config = loadConfig({ ...valid(), NODE_ENV: 'test' });
    expect(config.db.name).toBe('fintrack_test');
    expect(config.logLevel).toBe('silent');
  });

  test('production turns the API docs off and requires https origins', () => {
    const production = { ...valid(), NODE_ENV: 'production', CLIENT_ORIGINS: 'https://app.example.com' };
    expect(loadConfig(production).docsEnabled).toBe(false);
    expect(() => loadConfig({ ...production, CLIENT_ORIGINS: 'http://app.example.com' })).toThrow(/https/);
  });

  describe('database TLS', () => {
    const PEM = '-----BEGIN CERTIFICATE-----\\nMIIBfake\\n-----END CERTIFICATE-----';
    const production = { ...valid(), NODE_ENV: 'production', CLIENT_ORIGINS: 'https://app.example.com' };

    test('is off by default for a local database', () => {
      expect(loadConfig(valid()).db.ssl).toBeNull();
      expect(loadConfig(production).db.ssl).toBeNull(); // production on the same machine is allowed
    });

    test('production refuses a remote database without TLS', () => {
      expect(() => loadConfig({ ...production, DB_HOST: 'mysql-x.aivencloud.com' })).toThrow(/DB_SSL: must be true in production/);
    });

    test('verifies the server certificate, with the provider CA when given', () => {
      const ssl = loadConfig({ ...production, DB_HOST: 'mysql-x.aivencloud.com', DB_SSL: 'true', DB_SSL_CA: PEM }).db.ssl;
      expect(ssl).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2', ca: PEM.replace(/\\n/g, '\n') });
      const systemCas = loadConfig({ ...production, DB_HOST: 'gateway.example.com', DB_SSL: 'true' }).db.ssl;
      expect(systemCas).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    });

    test('rejects a CA that is not a PEM certificate, or a missing CA file', () => {
      expect(() => loadConfig({ ...valid(), DB_SSL: 'true', DB_SSL_CA: 'not a cert' })).toThrow(/expected a PEM certificate/);
      expect(() => loadConfig({ ...valid(), DB_SSL: 'true', DB_SSL_CA_FILE: 'C:/no/such/ca.pem' })).toThrow(/DB_SSL_CA_FILE: file not found/);
    });
  });

  test.each([
    ['a missing secret', { JWT_ACCESS_SECRET: undefined }, /JWT_ACCESS_SECRET/],
    ['a short secret', { AUDIT_HMAC_KEY: 'abc123' }, /AUDIT_HMAC_KEY: must be 64 hex/],
    ['a placeholder password', { DB_PASSWORD: 'replace_with_app_user_password' }, /DB_PASSWORD: is still a placeholder/],
    ['a malformed key list', { ENCRYPTION_KEYS: 'not-a-key' }, /ENCRYPTION_KEYS/],
    ['an active key version that does not exist', { ENCRYPTION_ACTIVE_KEY_VERSION: '9' }, /ENCRYPTION_ACTIVE_KEY_VERSION/],
    ['an origin with a path', { CLIENT_ORIGINS: 'http://localhost:5173/app' }, /CLIENT_ORIGINS/],
    ['an unsafe database name', { DB_NAME: 'fintrack; DROP' }, /DB_NAME/],
    ['an invalid port', { PORT: '99999' }, /PORT/],
  ])('rejects %s', (_label, override, pattern) => {
    const env = { ...valid(), ...override };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(pattern);
  });

  test('error messages never contain the offending value', () => {
    const secret = 'super-secret-but-too-short';
    try {
      loadConfig({ ...valid(), JWT_ACCESS_SECRET: secret, AUDIT_HMAC_KEY: secret });
      throw new Error('expected loadConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.message).not.toContain(secret);
    }
  });
});
