// Authentication and role checks for API routes.
//
//   router.get('/profile', authenticate, controller.getProfile);
//   router.get('/admin/users', authenticate, authorize('ADMIN'), controller.listUsers);
//
// authenticate sets req.auth = { userId, sessionId, roles }. Services take the user id from
// there and nowhere else, which is what keeps one user out of another user's data.
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../security/tokens');
const { requestMeta } = require('../utils/requestMeta');
const sessionModel = require('../models/session.model');
const securityEvents = require('../services/securityEvent.service');

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

async function authenticate(req, _res, next) {
  const match = BEARER.exec(req.get('authorization') || '');
  if (!match) throw ApiError.unauthorized();

  let claims;
  try {
    claims = verifyAccessToken(match[1]);
  } catch {
    // Expired, forged, wrong algorithm, wrong audience: the client learns only "not valid".
    throw ApiError.unauthorized('Your session has expired. Please sign in again.');
  }

  // The token is valid, but is the session still alive and the account still active?
  const principal = await sessionModel.findPrincipal(claims.sessionId, claims.userId);
  if (!principal) throw ApiError.unauthorized('Your session has expired. Please sign in again.');

  req.auth = { userId: principal.userId, sessionId: claims.sessionId, roles: principal.roles };
  next();
}

// Allows the request if the user holds at least one of the listed roles.
function authorize(...allowedRoles) {
  return async function authorizeRoles(req, _res, next) {
    if (!req.auth) throw ApiError.unauthorized();
    if (!allowedRoles.some((role) => req.auth.roles.includes(role))) {
      await securityEvents.record(securityEvents.EVENTS.ACCESS_DENIED, {
        userId: req.auth.userId,
        severity: 'WARNING',
        ctx: requestMeta(req),
        metadata: { method: req.method, path: req.baseUrl + req.path, requiredRoles: allowedRoles },
      });
      throw ApiError.forbidden();
    }
    next();
  };
}

module.exports = { authenticate, authorize };
