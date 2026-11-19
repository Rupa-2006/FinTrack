// The real application, end to end over HTTP (no port: supertest drives the app directly).
const request = require('supertest');
const { createApp } = require('../../app');
const database = require('../../config/database');
const systemModel = require('../../models/system.model');
const { config } = require('../../config/env');

const app = createApp();
const ALLOWED_ORIGIN = config.clientOrigins[0];

afterAll(async () => {
  await database.close();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('health', () => {
  test('GET /api/health reports liveness', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ status: 'ok', service: 'fintrack-api' });
    expect(typeof res.body.data.uptimeSeconds).toBe('number');
  });

  test('GET /api/health/ready checks the database and schema version', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    // the newest migration file is the schema version
    const latest = require('fs').readdirSync(require('path').join(__dirname, '..', '..', '..', 'database', 'migrations')).filter((f) => /^[0-9]{3}_/.test(f)).sort().pop().slice(0, 3);
    expect(res.body.data).toEqual({ status: 'ready', checks: { database: 'up' }, schemaVersion: latest });
  });

  test('readiness returns 503 without leaking why the database is down', async () => {
    jest.spyOn(systemModel, 'ping').mockRejectedValue(
      Object.assign(new Error("Access denied for user 'fintrack_app'@'10.0.0.5' (using password: YES)"), { code: 'ER_ACCESS_DENIED_ERROR' })
    );
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', details: { database: 'down' } });
    expect(JSON.stringify(res.body)).not.toMatch(/Access denied|fintrack_app|10\.0\.0\.5|ER_/);
  });
});

describe('response hygiene', () => {
  test('every response has a unique server-generated request id', async () => {
    const first = await request(app).get('/api/health').set('X-Request-Id', 'client-chosen-id');
    const second = await request(app).get('/api/health');
    expect(first.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.headers['x-request-id']).not.toBe('client-chosen-id');
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  test('security headers are set and the framework is not advertised', async () => {
    const { headers } = await request(app).get('/api/health');
    expect(headers['x-powered-by']).toBeUndefined();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['strict-transport-security']).toContain('max-age=31536000');
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['cache-control']).toBe('no-store');
  });

  test('unknown routes and methods return the standard 404', async () => {
    for (const res of [await request(app).get('/api/does-not-exist'), await request(app).delete('/api/health')]) {
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND', requestId: res.headers['x-request-id'] } });
    }
  });

  test('malformed JSON is a 400 and a body over 100 kB is a 413', async () => {
    const malformed = await request(app).post('/api/health').set('Content-Type', 'application/json').send('{oops');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    const oversized = await request(app).post('/api/health').send({ blob: 'x'.repeat(150 * 1024) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('CORS', () => {
  test('an allow-listed origin may read responses, with credentials', async () => {
    const res = await request(app).get('/api/health').set('Origin', ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });

  test('any other origin gets no CORS permission', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(app)
      .options('/api/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('preflight for an allowed origin lists the permitted methods and headers', async () => {
    const res = await request(app)
      .options('/api/health')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'Authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });
});

describe('rate limiting', () => {
  test('requests over the limit get 429 in the standard shape, with limit headers', async () => {
    const limited = createApp({ globalRateLimit: { windowMs: 60000, limit: 3 } });
    const statuses = [];
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await request(limited).get('/api/health');
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(last.body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
    expect(last.headers['ratelimit-policy']).toBeDefined();
    expect(last.headers.ratelimit).toBeDefined();
  });
});

describe('API documentation', () => {
  test('the OpenAPI document is served and describes the health endpoints', async () => {
    const res = await request(app).get('/api/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/health', '/health/ready',
        '/auth/register', '/auth/login', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password',
        '/users/profile', '/users/password', '/users/deactivate', '/security/sessions', '/security/sessions/{id}',
        '/categories', '/categories/{id}', '/transactions', '/transactions/{id}', '/budgets', '/budgets/copy', '/budgets/{id}',
        '/goals', '/goals/{id}', '/goals/{id}/contributions', '/currencies', '/currencies/rates', '/currencies/rates/refresh',
        '/currencies/convert', '/currencies/base', '/analytics/summary', '/analytics/monthly', '/analytics/categories',
        '/analytics/dashboard', '/reports/monthly', '/reports/export', '/notifications', '/notifications/unread-count',
        '/notifications/read-all', '/notifications/{id}/read', '/notifications/{id}',
        '/security/events', '/security/audit-logs', '/admin/overview', '/admin/users', '/admin/users/{id}/status',
        '/admin/users/{id}/roles', '/admin/users/{id}/unlock', '/admin/security-events', '/admin/audit-logs', '/admin/audit-logs/verify',
        '/assistant/insights', '/assistant/ask',
      ])
    );
  });

  test('Swagger UI is served with a same-origin content policy', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
