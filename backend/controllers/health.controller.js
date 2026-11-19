const healthService = require('../services/health.service');
const { sendSuccess } = require('../utils/response');

function live(_req, res) {
  sendSuccess(res, healthService.getLiveness());
}

async function ready(req, res) {
  const { ready: isReady, checks, schemaVersion } = await healthService.getReadiness(req.log);
  if (!isReady) {
    // Says which dependency is down, never why (no hostnames, credentials or driver errors).
    return res.status(503).json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is not ready', details: checks, requestId: req.id },
    });
  }
  return sendSuccess(res, { status: 'ready', checks, schemaVersion });
}

module.exports = { live, ready };
