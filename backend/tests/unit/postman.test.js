// The Postman collection is generated from openapi.yaml (npm run docs:postman). These checks
// fail when the API changes and the collection was not regenerated.
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const spec = YAML.parse(fs.readFileSync(path.join(DOCS, 'openapi.yaml'), 'utf8'));
const collection = JSON.parse(fs.readFileSync(path.join(DOCS, 'FinTrack.postman_collection.json'), 'utf8'));
const environment = JSON.parse(fs.readFileSync(path.join(DOCS, 'FinTrack.local.postman_environment.json'), 'utf8'));

const requests = collection.item.flatMap((folder) => folder.item.map((item) => ({ folder: folder.name, ...item })));
// "{{baseUrl}}/transactions/{{transactionId}}?x=1" -> "POST /transactions/{id}"
const routeOf = (item) => {
  const pathPart = item.request.url.raw.replace('{{baseUrl}}', '').split('?')[0].replace(/\{\{[A-Za-z]+Id\}\}/g, '{id}');
  return `${item.request.method} ${pathPart}`;
};

test('every documented operation is in the collection exactly once', () => {
  const documented = Object.entries(spec.paths).flatMap(([route, ops]) =>
    Object.keys(ops).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).map((m) => `${m.toUpperCase()} ${route}`));
  const inCollection = requests.filter((item) => item.name !== 'Sign in as administrator').map(routeOf);
  expect(inCollection.sort()).toEqual(documented.sort());
  expect(collection.info.description).toContain(`version ${spec.info.version}`);
});

test('every request has a status check and every body is valid JSON', () => {
  for (const item of requests) {
    const tests = item.event.find((e) => e.listen === 'test').script.exec.join('\n');
    expect(tests).toMatch(/pm\.test\(/);
    if (item.request.body) expect(() => JSON.parse(item.request.body.raw.replace(/\{\{categoryId\}\}/g, '1'))).not.toThrow();
  }
});

test('auth routes send the CSRF header, and no secret is stored in the files', () => {
  for (const item of requests.filter((r) => r.request.url.raw.includes('/auth/'))) {
    expect(item.request.header).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'X-Requested-With' })]));
  }
  expect(environment.values.find((v) => v.key === 'adminPassword').value).toBe('');
  expect(JSON.stringify(collection)).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|[0-9a-f]{64}/);
});

test('docs/API.md lists every endpoint', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'API.md'), 'utf8');
  const missing = Object.entries(spec.paths).flatMap(([route, ops]) =>
    Object.keys(ops)
      .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
      .filter((m) => !page.includes(`| ${m.toUpperCase()} | \`${route}\` |`))
      .map((m) => `${m.toUpperCase()} ${route}`));
  expect(missing).toEqual([]);
});

test('destructive requests run last', () => {
  const last = collection.item[collection.item.length - 1];
  expect(last.name).toMatch(/End of run/);
  expect(last.item.map((item) => item.request.method + ' ' + item.request.url.path.join('/'))).toEqual(
    expect.arrayContaining(['POST users/deactivate', 'POST auth/logout', 'PUT users/password']));
});
