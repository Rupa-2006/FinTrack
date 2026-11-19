// Structured JSON logging (pino).
// Secrets must never reach the logs: the paths below are replaced with "[REDACTED]" whatever
// the caller passes in. Request bodies and query strings are not logged at all.
const pino = require('pino');
const { config } = require('../config/env');

const SECRET_FIELDS = [
  'password', 'currentPassword', 'newPassword', 'passwordHash', 'password_hash',
  'token', 'accessToken', 'refreshToken', 'resetToken', 'token_hash',
  'secret', 'authorization', 'cookie', 'apiKey', 'encryptionKey',
];

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-signature"]',
  'res.headers["set-cookie"]',
  ...SECRET_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];

function createLogger({ level = config.logLevel, pretty = config.env === 'development' } = {}, destination) {
  const options = {
    level,
    base: { service: 'fintrack-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
  if (destination) return pino(options, destination);
  if (pretty) {
    return pino({ ...options, transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } });
  }
  return pino(options);
}

module.exports = { createLogger, logger: createLogger(), REDACT_PATHS };
