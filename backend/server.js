// Process entry point: validates configuration, starts the HTTP server, shuts down cleanly.
let config;
try {
  ({ config } = require('./config/env'));
} catch (err) {
  // Configuration problems are reported plainly and stop the process before anything listens.
  console.error(err.message);
  process.exit(1);
}

const { createApp } = require('./app');
const database = require('./config/database');
const { logger } = require('./utils/logger');

const SHUTDOWN_TIMEOUT_MS = 10000;

async function start() {
  try {
    await database.ping();
  } catch (err) {
    logger.fatal({ err: { code: err.code, message: err.message } }, 'cannot reach the database, not starting');
    process.exit(1);
  }

  const server = createApp().listen(config.port, () => {
    logger.info({ port: config.port, env: config.env, docs: config.docsEnabled ? '/api/docs' : 'disabled' }, 'FinTrack API listening');
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    force.unref();
    server.close(async () => {
      await database.close().catch(() => {});
      process.exit(0);
    });
    server.closeIdleConnections?.();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: { message: reason?.message, stack: reason?.stack } }, 'unhandled promise rejection');
  process.exit(1);
});

start();
