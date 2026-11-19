// HTTP layer for /api/auth: reads validated input, calls the service, shapes the response.
// The refresh token only ever leaves the server inside the httpOnly cookie, never in a body.
const { config } = require('../config/env');
const { REFRESH_COOKIE, REFRESH_COOKIE_PATH } = require('../config/constants');
const { sendSuccess, sendCreated, sendNoContent } = require('../utils/response');
const { requestMeta } = require('../utils/requestMeta');
const authService = require('../services/auth.service');

const DAY_MS = 24 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true, // not readable by JavaScript
    secure: config.isProduction, // HTTPS only in production (localhost is plain http)
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions(), maxAge: config.refreshTokenTtlDays * DAY_MS });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

async function register(req, res) {
  const { user, accessToken, refreshToken } = await authService.register(req.validated.body, requestMeta(req));
  setRefreshCookie(res, refreshToken);
  sendCreated(res, { user, accessToken });
}

async function login(req, res) {
  const result = await authService.login(req.validated.body, requestMeta(req));
  if (result.mfaRequired) {
    // No session and no cookie yet: the second step comes first.
    return sendSuccess(res, { mfaRequired: true, challengeToken: result.challengeToken, expiresInMinutes: result.expiresInMinutes });
  }
  setRefreshCookie(res, result.refreshToken);
  return sendSuccess(res, { user: result.user, accessToken: result.accessToken });
}

async function verifyMfa(req, res) {
  const { user, accessToken, refreshToken } = await authService.verifyMfa(req.validated.body, requestMeta(req));
  setRefreshCookie(res, refreshToken);
  sendSuccess(res, { user, accessToken });
}

async function refresh(req, res) {
  try {
    const { user, accessToken, refreshToken } = await authService.refresh(req.cookies?.[REFRESH_COOKIE], requestMeta(req));
    setRefreshCookie(res, refreshToken);
    sendSuccess(res, { user, accessToken });
  } catch (err) {
    if (err.status === 401) clearRefreshCookie(res); // a dead token is not worth keeping
    throw err;
  }
}

async function logout(req, res) {
  await authService.logout(req.cookies?.[REFRESH_COOKIE], requestMeta(req));
  clearRefreshCookie(res);
  sendNoContent(res);
}

async function forgotPassword(req, res) {
  await authService.requestPasswordReset(req.validated.body, requestMeta(req));
  sendSuccess(res, { message: 'If an account exists for that email address, a reset link has been sent.' });
}

async function resetPassword(req, res) {
  await authService.resetPassword(req.validated.body, requestMeta(req));
  clearRefreshCookie(res);
  sendSuccess(res, { message: 'Your password has been changed. Please sign in with your new password.' });
}

module.exports = { register, login, verifyMfa, refresh, logout, forgotPassword, resetPassword };
