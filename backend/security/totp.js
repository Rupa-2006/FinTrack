// Time-based one-time passwords (RFC 6238, built on HOTP, RFC 4226) for two-step sign-in.
// SHA-1, 6 digits, 30-second steps: what Google Authenticator, Microsoft Authenticator,
// 1Password, Aegis and others expect. Built on Node's crypto module only.
const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20; // 160 bits, as RFC 4226 recommends
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('not a base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(SECRET_BYTES));
}

function hotp(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

const stepAt = (nowMs) => Math.floor(nowMs / 1000 / STEP_SECONDS);

// Returns the time step the code belongs to, or null. Accepts the previous, current and next
// step (clock drift of up to 30 s), never a step at or before `lastUsedStep`, so a code that
// was already used, or an older one, is refused.
function verify(secret, code, { now = Date.now(), lastUsedStep = null, window = 1 } = {}) {
  const candidate = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return null;
  const current = stepAt(now);
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(candidate))) return step;
  }
  return null;
}

// What authenticator apps read from the QR code.
function otpauthUri({ secret, account, issuer = 'FinTrack' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

// ---- recovery codes: 10 single-use codes such as "k7mq-2xnd", stored as SHA-256 hashes
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i
const RECOVERY_COUNT = 10;

function generateRecoveryCodes(count = RECOVERY_COUNT) {
  return Array.from({ length: count }, () => {
    const chars = Array.from(crypto.randomBytes(8), (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

const normalizeRecoveryCode = (code) => String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecoveryCode = (code) => crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
const looksLikeRecoveryCode = (code) => /^[a-z0-9]{8}$/.test(normalizeRecoveryCode(code)) && !/^\d+$/.test(normalizeRecoveryCode(code));

module.exports = {
  STEP_SECONDS, base32Encode, base32Decode, generateSecret, hotp, verify, otpauthUri, stepAt,
  generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode, RECOVERY_COUNT,
};
