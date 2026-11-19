// TLS settings for MySQL connections, shared by the API pool and the command-line scripts.
//
//   DB_SSL=false            plain connection (local development only)
//   DB_SSL=true             TLS 1.2+, server certificate verified against:
//     DB_SSL_CA             the provider's CA certificate as PEM text ("\n" escapes allowed), or
//     DB_SSL_CA_FILE        a path to that PEM file, or neither: the system's trusted CAs.
//
// Certificate verification is never switched off: a connection that cannot be verified fails.
const fs = require('fs');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isLocalHost(host) {
  return LOCAL_HOSTS.has(String(host || '127.0.0.1').toLowerCase());
}

function dbSslOptions(env) {
  if ((env.DB_SSL || 'false') !== 'true') return null;
  const options = { rejectUnauthorized: true, minVersion: 'TLSv1.2' };
  if (env.DB_SSL_CA) {
    options.ca = env.DB_SSL_CA.replace(/\\n/g, '\n');
  } else if (env.DB_SSL_CA_FILE) {
    options.ca = fs.readFileSync(env.DB_SSL_CA_FILE, 'utf8');
  }
  if (options.ca !== undefined && !options.ca.includes('BEGIN CERTIFICATE')) {
    throw new Error('DB_SSL_CA / DB_SSL_CA_FILE: expected a PEM certificate (-----BEGIN CERTIFICATE-----)');
  }
  return options;
}

module.exports = { dbSslOptions, isLocalHost };
