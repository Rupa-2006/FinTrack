// Health checks.
//   liveness  - the process is up (no dependencies touched; safe for frequent probes)
//   readiness - the API can do real work (database reachable and migrated)
const systemModel = require('../models/system.model');
const { version } = require('../package.json');

const startedAt = Date.now();

function getLiveness() {
  return {
    status: 'ok',
    service: 'fintrack-api',
    version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };
}

// Never throws: reports what is up and what is down. The caller decides on the status code.
async function getReadiness(log) {
  try {
    await systemModel.ping();
    const schemaVersion = await systemModel.getSchemaVersion();
    return { ready: true, checks: { database: 'up' }, schemaVersion };
  } catch (err) {
    log?.error({ err: { code: err.code, message: err.message } }, 'readiness check failed');
    return { ready: false, checks: { database: 'down' } };
  }
}

module.exports = { getLiveness, getReadiness };
