// The hash chain behind the audit log.
//
//   curr_hash = HMAC-SHA256(AUDIT_HMAC_KEY, prev_hash + "|" + canonical_json(row fields))
//
// Every row names the hash of the row before it, so changing, removing or reordering a row
// breaks the chain from that point on, and nobody without the key can compute a valid
// replacement. This makes tampering detectable; it does not make it impossible (see
// docs/SECURITY.md for the layers around it).
const crypto = require('crypto');
const { config } = require('../config/env');

const GENESIS_HASH = '0'.repeat(64);

// The fields covered by the hash. The row id is not one of them: it is assigned by MySQL
// after the hash is computed, and the prev_hash link already fixes the order.
const HASHED_FIELDS = ['user_id', 'event_type', 'action', 'resource_type', 'resource_id', 'details', 'ip_address', 'request_id', 'created_at'];

// JSON with object keys sorted at every level, so the same content always gives the same
// text (MySQL's JSON type does not keep key order).
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// created_at is always hashed as "YYYY-MM-DD HH:MM:SS.mmm". Rows are written with all three
// millisecond digits, but the MySQL driver returns a time whose milliseconds are exactly .000
// without the fraction ("07:06:13"), which made about one row in a thousand look changed.
function canonicalTime(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return `${text}.000`;
  return text;
}

function hashedContent(row) {
  return Object.fromEntries(HASHED_FIELDS.map((field) => [field, field === 'created_at' ? canonicalTime(row[field]) : row[field] ?? null]));
}

function computeHash(prevHash, row, key = config.auditHmacKey) {
  return crypto.createHmac('sha256', key).update(`${prevHash}|${canonicalJson(hashedContent(row))}`).digest('hex');
}

function hashesEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Checks one stored row against the hash of the row before it.
// Returns null when it is sound, otherwise the reason it is not.
function checkRow(expectedPrevHash, row, key) {
  if (row.prev_hash !== expectedPrevHash) return 'its link to the previous row is broken (a row was removed, inserted or reordered)';
  if (!hashesEqual(computeHash(row.prev_hash, row, key), row.curr_hash)) return 'its contents do not match its hash (the row was changed)';
  return null;
}

module.exports = { GENESIS_HASH, HASHED_FIELDS, canonicalJson, computeHash, checkRow };
