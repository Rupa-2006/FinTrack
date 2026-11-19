// Loads and validates every environment variable once, at startup.
// The rest of the code imports `config` and never reads process.env directly, so a missing
// or malformed secret stops the server before it accepts a request.
// Error messages name the variable and the rule, never the value.
const path = require('path');
const { z } = require('zod');
const { dbSslOptions, isLocalHost } = require('./dbSsl');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

class ConfigError extends Error {}

const hex64 = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hexadecimal characters (32 bytes)');
const notPlaceholder = (value) => !value.startsWith('replace_with');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  TRUST_PROXY: z.string().regex(/^(true|false|\d+)$/, 'must be true, false or a number of proxy hops').default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  API_DOCS_ENABLED: z.enum(['true', 'false']).optional(),

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().regex(/^[A-Za-z0-9_]+$/, 'may only contain letters, digits and _'),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1).refine(notPlaceholder, 'is still a placeholder'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  DB_SSL: z.enum(['true', 'false']).default('false'),
  DB_SSL_CA: z.string().optional(),
  DB_SSL_CA_FILE: z.string().optional(),

  JWT_ACCESS_SECRET: hex64,
  JWT_ACCESS_TTL: z.string().regex(/^\d+[smh]$/, 'must look like 15m, 900s or 1h').default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  ENCRYPTION_KEYS: z.string().regex(/^\d+:[0-9a-fA-F]{64}(,\d+:[0-9a-fA-F]{64})*$/, 'must be version:64hex[,version:64hex]'),
  ENCRYPTION_ACTIVE_KEY_VERSION: z.coerce.number().int().min(1),
  AUDIT_HMAC_KEY: hex64,

  CLIENT_ORIGINS: z.string().min(1),
  APP_PUBLIC_URL: z.url().default('http://localhost:5180'),

  AI_SERVICE_URL: z.url(),
  AI_SERVICE_SHARED_SECRET: hex64,
  FX_API_URL: z.url(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('FinTrack <no-reply@example.com>'),
});

function parseOrigins(raw, isProduction) {
  const origins = raw.split(',').map((item) => item.trim()).filter(Boolean);
  for (const origin of origins) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new ConfigError('CLIENT_ORIGINS: every entry must be a full origin such as https://app.example.com');
    }
    if (url.origin !== origin) throw new ConfigError('CLIENT_ORIGINS: entries must be origins only (no path, no trailing slash)');
    if (isProduction && url.protocol !== 'https:') throw new ConfigError('CLIENT_ORIGINS: production origins must use https');
  }
  return origins;
}

function parseTrustProxy(raw) {
  if (raw === 'true') return 1;
  if (raw === 'false') return false;
  return Number(raw);
}

function loadConfig(env = process.env) {
  // An empty value in .env ("SMTP_HOST=") means "not set".
  const input = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const values = parsed.data;
  const isProduction = values.NODE_ENV === 'production';
  const isTest = values.NODE_ENV === 'test';

  const encryptionKeys = new Map();
  for (const entry of values.ENCRYPTION_KEYS.split(',')) {
    const [version, keyHex] = entry.split(':');
    encryptionKeys.set(Number(version), Buffer.from(keyHex, 'hex'));
  }
  if (!encryptionKeys.has(values.ENCRYPTION_ACTIVE_KEY_VERSION)) {
    throw new ConfigError('ENCRYPTION_ACTIVE_KEY_VERSION: no key with this version exists in ENCRYPTION_KEYS');
  }
  // Financial data must not cross a network in clear text.
  if (isProduction && values.DB_SSL !== 'true' && !isLocalHost(values.DB_HOST)) {
    throw new ConfigError('DB_SSL: must be true in production when the database is on another machine');
  }
  let dbSsl;
  try {
    dbSsl = dbSslOptions(values);
  } catch (err) {
    throw new ConfigError(err.code === 'ENOENT' ? 'DB_SSL_CA_FILE: file not found' : err.message);
  }

  return Object.freeze({
    env: values.NODE_ENV,
    isProduction,
    isTest,
    port: values.PORT,
    trustProxy: parseTrustProxy(values.TRUST_PROXY),
    logLevel: values.LOG_LEVEL || (isTest ? 'silent' : isProduction ? 'info' : 'debug'),
    // Interactive API docs are on outside production unless explicitly switched.
    docsEnabled: values.API_DOCS_ENABLED ? values.API_DOCS_ENABLED === 'true' : !isProduction,
    db: Object.freeze({
      host: values.DB_HOST,
      port: values.DB_PORT,
      // Tests always use a separate database so they can never touch real data.
      name: isTest ? `${values.DB_NAME}_test` : values.DB_NAME,
      user: values.DB_USER,
      password: values.DB_PASSWORD,
      poolSize: values.DB_POOL_SIZE,
      ssl: dbSsl,
    }),
    jwt: Object.freeze({ accessSecret: values.JWT_ACCESS_SECRET, accessTtl: values.JWT_ACCESS_TTL }),
    refreshTokenTtlDays: values.REFRESH_TOKEN_TTL_DAYS,
    encryption: Object.freeze({ keys: encryptionKeys, activeVersion: values.ENCRYPTION_ACTIVE_KEY_VERSION }),
    auditHmacKey: Buffer.from(values.AUDIT_HMAC_KEY, 'hex'),
    clientOrigins: parseOrigins(values.CLIENT_ORIGINS, isProduction),
    appPublicUrl: values.APP_PUBLIC_URL,
    aiService: Object.freeze({ url: values.AI_SERVICE_URL, sharedSecret: values.AI_SERVICE_SHARED_SECRET }),
    fxApiUrl: values.FX_API_URL,
    mail: Object.freeze({
      host: values.SMTP_HOST || null,
      port: values.SMTP_PORT,
      user: values.SMTP_USER || null,
      password: values.SMTP_PASSWORD || null,
      from: values.MAIL_FROM,
    }),
  });
}

module.exports = { loadConfig, ConfigError, config: loadConfig() };
