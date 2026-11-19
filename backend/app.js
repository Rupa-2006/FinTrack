// Builds the Express application. Kept separate from server.js so tests can create an app
// without opening a port.
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { config } = require('./config/env');
const { requestId, requestLogger, noStore } = require('./middleware/requestContext');
const { createRateLimiter, DEFAULTS } = require('./middleware/rateLimiters');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { createDocsRouter } = require('./routes/docs.routes');
const { createApiRouter } = require('./routes');

const corsOptions = {
  // Only listed front-end origins may read responses. Requests without an Origin header
  // (curl, server-to-server, same-origin) are not CORS requests and pass through.
  origin(origin, callback) {
    callback(null, !origin || config.clientOrigins.includes(origin));
  },
  credentials: true, // the refresh-token cookie
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Content-Disposition'],
  maxAge: 600,
};

// Options exist so tests can tighten or relax the rate limits.
function createApp({ globalRateLimit = DEFAULTS.global, authRateLimits, assistantRateLimit } = {}) {
  const app = express();

  app.set('trust proxy', config.trustProxy); // so req.ip is the real client behind a proxy
  app.set('etag', false);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(requestLogger);

  // Security headers. This is a JSON API, so its content policy is "load nothing".
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
    })
  );
  app.use(cors(corsOptions));

  app.use('/api', noStore, createRateLimiter(globalRateLimit));
  if (config.docsEnabled) app.use('/api/docs', createDocsRouter());

  app.use(express.json({ limit: '100kb' }));
  app.use('/api', createApiRouter({ authRateLimits, assistantRateLimit }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
