// Calls the AI service with signed requests.
//
//   X-FinTrack-Timestamp, X-FinTrack-Request-Id (used once), X-FinTrack-Signature =
//   hex HMAC-SHA256(AI_SERVICE_SHARED_SECRET, timestamp \n METHOD \n path \n requestId \n sha256hex(body))
//
// Must stay in step with ai-service/app/security.py. The AI service rejects anything else,
// so even on the same network nobody without the secret can use it.
const crypto = require('crypto');
const { config } = require('../config/env');
const ApiError = require('../utils/ApiError');
const { logger } = require('../utils/logger');

const TIMEOUT_MS = 10000;
const UNAVAILABLE = 'The AI assistant is unavailable right now. Please try again in a moment.';

let baseUrl = config.aiService.url;
const secret = Buffer.from(config.aiService.sharedSecret, 'hex');

function signRequest({ timestamp, method, path, requestId, body }, key = secret) {
  const bodyHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const text = `${timestamp}\n${method.toUpperCase()}\n${path}\n${requestId}\n${bodyHash}`;
  return crypto.createHmac('sha256', key).update(text, 'utf8').digest('hex');
}

async function post(path, payload) {
  const url = new URL(path, baseUrl);
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = crypto.randomUUID();
  const signature = signRequest({ timestamp, method: 'POST', path: url.pathname, requestId, body });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fintrack-timestamp': timestamp,
        'x-fintrack-request-id': requestId,
        'x-fintrack-signature': signature,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ err: { name: err.name, message: err.message } }, 'AI service unreachable');
    throw ApiError.serviceUnavailable(UNAVAILABLE);
  }
  if (!response.ok) {
    // The body may describe the request; only the status is logged.
    logger.error({ status: response.status, path: url.pathname }, 'AI service refused the request');
    throw ApiError.serviceUnavailable(UNAVAILABLE);
  }
  const json = await response.json();
  return json.data;
}

// Tests point the client at a service started on another port.
function setBaseUrl(url) {
  baseUrl = url;
}

module.exports = { post, signRequest, setBaseUrl };
