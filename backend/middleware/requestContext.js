// Per-request plumbing: a server-generated request id, request logging, and cache headers.
const crypto = require('crypto');
const pinoHttp = require('pino-http');
const { logger } = require('../utils/logger');

// The id is always generated here (a client-supplied id could be used to forge log lines).
// It is returned in X-Request-Id, included in error bodies, log lines and audit rows.
function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

// Logs method, path and status only: no query string, headers or body, since those can
// carry search terms, tokens or financial details.
const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, path: String(req.url).split('?')[0] }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});

// API responses contain personal financial data: browsers and proxies must not store them.
function noStore(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

module.exports = { requestId, requestLogger, noStore };
