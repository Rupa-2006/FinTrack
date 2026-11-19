// Password hashing and policy. Passwords are only ever stored as bcrypt hashes.
const bcrypt = require('bcrypt');
const { config } = require('../config/env');
const { BCRYPT_COST } = require('../config/constants');

// A low cost keeps the test suite fast; every other environment uses the real cost.
const cost = config.isTest ? 4 : BCRYPT_COST;

const MIN_LENGTH = 10;
const MAX_BYTES = 72; // bcrypt ignores everything after 72 bytes, so longer input is refused

const COMMON_PASSWORDS = new Set([
  'password123', 'password1234', 'password12345', 'qwerty12345', 'qwertyuiop', '1234567890', '12345678910',
  'iloveyou123', 'welcome123', 'welcome1234', 'admin12345', 'letmein123', 'passw0rd123', 'changeme123',
]);

// The rules, in the order they are shown to the user. Kept in step with
// frontend/src/utils/passwordRules.js.
function basicPasswordProblems(password) {
  const problems = [];
  if (password.length < MIN_LENGTH) problems.push(`Use at least ${MIN_LENGTH} characters`);
  if (Buffer.byteLength(password, 'utf8') > MAX_BYTES) problems.push(`Use at most ${MAX_BYTES} characters`);
  if (!/[a-z]/.test(password)) problems.push('Add a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('Add an uppercase letter');
  if (!/[0-9]/.test(password)) problems.push('Add a number');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('Add a symbol');
  return problems;
}

// Checks that need to know who the password is for.
function contextualPasswordProblems(password, { email, fullName } = {}) {
  const lower = password.toLowerCase();
  const problems = [];
  if (COMMON_PASSWORDS.has(lower.replace(/[^a-z0-9]/g, ''))) problems.push('This password is too common');
  const emailName = (email || '').split('@')[0].toLowerCase();
  if (emailName.length >= 4 && lower.includes(emailName)) problems.push('Do not use your email address in your password');
  for (const part of (fullName || '').toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part)) {
      problems.push('Do not use your name in your password');
      break;
    }
  }
  return problems;
}

function hashPassword(password) {
  return bcrypt.hash(password, cost);
}

function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

// Spends the same time as a real check when the account does not exist, so response time
// does not reveal which email addresses are registered.
let decoyHash;
async function verifyAgainstDecoy(password) {
  decoyHash ??= await bcrypt.hash('decoy-value-never-matches', cost);
  await bcrypt.compare(password, decoyHash);
}

module.exports = {
  MIN_LENGTH,
  MAX_BYTES,
  basicPasswordProblems,
  contextualPasswordProblems,
  hashPassword,
  verifyPassword,
  verifyAgainstDecoy,
};
