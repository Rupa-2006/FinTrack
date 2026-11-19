// validate(), errorHandler and response helpers, exercised through a tiny throw-away app.
const express = require('express');
const request = require('supertest');
const { z } = require('zod');

const validate = require('../../middleware/validate');
const { errorHandler, notFound } = require('../../middleware/errorHandler');
const { requestId } = require('../../middleware/requestContext');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendCreated, sendNoContent, paginationMeta } = require('../../utils/response');

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
});
const listQuery = z.object({ page: z.coerce.number().int().min(1).default(1) });
const idParams = z.object({ id: z.coerce.number().int().positive('Id must be a positive integer') });

function buildApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '1kb' }));
  app.post('/items', validate({ body: itemSchema }), (req, res) => sendCreated(res, req.validated.body));
  app.get('/items', validate({ query: listQuery }), (req, res) =>
    sendSuccess(res, [], { meta: paginationMeta({ page: req.validated.query.page, pageSize: 20, totalItems: 45 }) })
  );
  app.delete('/items/:id', validate({ params: idParams }), (_req, res) => sendNoContent(res));
  app.get('/forbidden', () => {
    throw ApiError.forbidden();
  });
  app.get('/conflict', async () => {
    throw ApiError.conflict('That name is already used', [{ field: 'name' }]);
  });
  app.get('/crash', async () => {
    const err = new Error("ER_NO_SUCH_TABLE: Table 'fintrack.secret_table' doesn't exist at C:\\app\\models\\x.js");
    err.code = 'ER_NO_SUCH_TABLE';
    err.sql = 'SELECT * FROM secret_table';
    throw err;
  });
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

describe('validate middleware', () => {
  test('passes coerced, trimmed data and drops undeclared fields', async () => {
    const res = await request(app).post('/items').send({ name: '  Coffee ', amount: '4.50', isAdmin: true, user_id: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { name: 'Coffee', amount: 4.5 } });
  });

  test('reports every invalid field with its location', async () => {
    const res = await request(app).post('/items').send({ name: '', amount: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { field: 'body.name', message: 'Name is required' },
      { field: 'body.amount', message: 'Amount must be greater than 0' },
    ]);
  });

  test('validates query strings and route parameters', async () => {
    const ok = await request(app).get('/items?page=3');
    expect(ok.body.meta.pagination).toEqual({ page: 3, pageSize: 20, totalItems: 45, totalPages: 3 });
    const badQuery = await request(app).get('/items?page=0');
    expect(badQuery.status).toBe(400);
    expect(badQuery.body.error.details[0].field).toBe('query.page');
    const badParam = await request(app).delete('/items/abc');
    expect(badParam.status).toBe(400);
    expect(badParam.body.error.details[0].field).toBe('params.id');
    expect((await request(app).delete('/items/5')).status).toBe(204);
  });
});

describe('error handler', () => {
  test('ApiError becomes its status, code and message', async () => {
    const forbidden = await request(app).get('/forbidden');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: 'You do not have permission to do this', requestId: forbidden.headers['x-request-id'] },
    });
    const conflict = await request(app).get('/conflict');
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details).toEqual([{ field: 'name' }]);
  });

  test('unexpected errors return a generic 500 with no internals', async () => {
    const res = await request(app).get('/crash');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/secret_table|ER_NO_SUCH_TABLE|models|SELECT|stack/i);
  });

  test('malformed and oversized JSON bodies are client errors', async () => {
    const malformed = await request(app).post('/items').set('Content-Type', 'application/json').send('{"name": ');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    const oversized = await request(app).post('/items').send({ name: 'x'.repeat(2000), amount: 1 });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('unknown routes return 404 in the standard shape', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
