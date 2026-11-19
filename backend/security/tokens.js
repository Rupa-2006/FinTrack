// Access tokens (JWT) and opaque random tokens (refresh, password reset).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { config } = require('../config/env');
const { JWT_ISSUER, JWT_AUDIENCE } = require('../config/constants');

const ALGORITHM = 'HS256';
const accessKey = Buffer.from(config.jwt.accessSecret, 'hex');

// Short-lived and stateless, but it names its session row, so revoking the session ends it.
// It carries ids only: no email, no personal data.
function signAccessToken({ userId, sessionId }) {
  return jwt.sign({ sid: sessionId }, accessKey, {
    algorithm: ALGORITHM,
    subject: String(userId),
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: config.jwt.accessTtl,
  });
}

// Throws for anything that is not a valid, unexpired token signed by us with HS256.
function verifyAccessToken(token) {
  const claims = jwt.verify(token, accessKey, { algorithms: [ALGORITHM], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
  const userId = Number(claims.sub);
  const sessionId = Number(claims.sid);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(sessionId)) throw new Error('malformed token claims');
  return { userId, sessionId };
}

// 256 bits from the system CSPRNG. Only its hash is stored, so a database leak does not
// yield usable tokens.
function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

module.exports = { signAccessToken, verifyAccessToken, generateOpaqueToken, hashToken };
