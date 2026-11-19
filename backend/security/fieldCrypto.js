// Field-level encryption: AES-256-GCM with versioned keys.
//
// Stored form:  v<keyVersion>.<iv>.<authTag>.<ciphertext>   (base64url parts)
//
// `context` names where the value lives, e.g. "users:phone_enc:42". It is authenticated
// (AAD) but not stored, so a ciphertext copied into another row or column fails to decrypt.
// Key rotation: add a new version to ENCRYPTION_KEYS and make it active; old values stay
// readable because each value records the key version that wrote it.
const crypto = require('crypto');
const { config } = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function encryptField(plaintext, context) {
  if (plaintext === null || plaintext === undefined) return null;
  const version = config.encryption.activeVersion;
  const iv = crypto.randomBytes(IV_BYTES); // fresh for every value: never reuse an IV with a key
  const cipher = crypto.createCipheriv(ALGORITHM, config.encryption.keys.get(version), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [`v${version}`, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

// Throws if the value was altered, moved to another row, or written with an unknown key.
function decryptField(stored, context) {
  if (stored === null || stored === undefined) return null;
  const parts = String(stored).split('.');
  const version = /^v(\d+)$/.exec(parts[0] || '');
  const key = version && config.encryption.keys.get(Number(version[1]));
  if (parts.length !== 4 || !key) throw new Error('encrypted field has an unknown format or key version');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(parts[1], 'base64url'));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = { encryptField, decryptField };
