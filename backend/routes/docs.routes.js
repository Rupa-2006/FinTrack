// Interactive API documentation (Swagger UI) at /api/docs, generated from docs/openapi.yaml.
// Mounted only when config.docsEnabled is true (off by default in production).
const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');

const SPEC_PATH = path.join(__dirname, '..', 'docs', 'openapi.yaml');

function loadSpec() {
  return YAML.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
}

function createDocsRouter() {
  const router = Router();
  const spec = loadSpec();

  // The API-wide policy is "load nothing". Swagger UI needs its own scripts and inline styles,
  // so this page alone gets a policy limited to same-origin resources.
  router.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
    );
    next();
  });
  router.get('/openapi.json', (_req, res) => res.json(spec));
  router.use(swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'FinTrack API' }));
  return router;
}

module.exports = { createDocsRouter, loadSpec };
