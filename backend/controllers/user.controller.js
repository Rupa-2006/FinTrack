// HTTP layer for the signed-in user's own account (/api/users, /api/security/sessions).
const { sendSuccess, sendNoContent, paginationMeta } = require('../utils/response');
const { requestMeta } = require('../utils/requestMeta');
const userService = require('../services/user.service');

async function getProfile(req, res) {
  sendSuccess(res, await userService.getProfile(req.auth.userId));
}

async function updateProfile(req, res) {
  sendSuccess(res, await userService.updateProfile(req.auth.userId, req.validated.body, requestMeta(req)));
}

async function changePassword(req, res) {
  sendSuccess(res, await userService.changePassword(req.auth, req.validated.body, requestMeta(req)));
}

async function deactivate(req, res) {
  await userService.deactivate(req.auth, req.validated.body, requestMeta(req));
  sendNoContent(res);
}

async function listSessions(req, res) {
  sendSuccess(res, await userService.listSessions(req.auth));
}

async function revokeSession(req, res) {
  await userService.revokeSession(req.auth, req.validated.params.id, requestMeta(req));
  sendNoContent(res);
}

async function revokeOtherSessions(req, res) {
  sendSuccess(res, await userService.revokeOtherSessions(req.auth, requestMeta(req)));
}

async function paged(req, res, load) {
  const query = req.validated.query;
  const { items, totalItems } = await load(req.auth.userId, query);
  sendSuccess(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, totalItems }) });
}

const listSecurityEvents = (req, res) => paged(req, res, userService.listSecurityEvents);
const listActivity = (req, res) => paged(req, res, userService.listActivity);

module.exports = {
  getProfile, updateProfile, changePassword, deactivate, listSessions, revokeSession, revokeOtherSessions, listSecurityEvents, listActivity,
};
