// HTTP layer for /api/security/mfa: the signed-in user's two-step sign-in settings.
const { sendSuccess } = require('../utils/response');
const { requestMeta } = require('../utils/requestMeta');
const mfaService = require('../services/mfa.service');

const status = async (req, res) => sendSuccess(res, await mfaService.status(req.auth.userId));
const setup = async (req, res) => sendSuccess(res, await mfaService.beginSetup(req.auth.userId));
const enable = async (req, res) => sendSuccess(res, await mfaService.enable(req.auth.userId, req.validated.body, requestMeta(req)));
const disable = async (req, res) => sendSuccess(res, await mfaService.disable(req.auth.userId, req.validated.body, requestMeta(req)));
const recoveryCodes = async (req, res) => sendSuccess(res, await mfaService.regenerateRecoveryCodes(req.auth.userId, req.validated.body, requestMeta(req)));

module.exports = { status, setup, enable, disable, recoveryCodes };
