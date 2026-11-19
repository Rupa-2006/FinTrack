// Serves the production build (dist/) the way Vercel will: the headers and the SPA fallback
// from vercel.json, and /api proxied to an API, so a production build can be checked locally.
//
//   npm run build && npm run serve:dist                  API at http://localhost:5000
//   node scripts/serve-dist.mjs --api http://localhost:5000 --port 4180
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const API = arg('api', 'http://localhost:5000');
const PORT = Number(arg('port', 4180));

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };

// vercel.json "source" patterns used here are "/(.*)", "/assets/(.*)" and "/index.html".
const toRegExp = (source) => new RegExp(`^${source.replace(/\(\.\*\)/g, '.*')}$`);
function headersFor(path) {
  const out = {};
  for (const rule of vercel.headers) {
    if (toRegExp(rule.source).test(path)) for (const { key, value } of rule.headers) out[key] = value;
  }
  return out;
}

async function proxy(req, res) {
  const headers = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress };
  delete headers.host;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Readable.toWeb(req);
  try {
    const upstream = await fetch(API + req.url, { method: req.method, headers, body, duplex: 'half', redirect: 'manual' });
    const out = {};
    upstream.headers.forEach((value, key) => { if (key !== 'set-cookie' && key !== 'content-encoding' && key !== 'content-length') out[key] = value; });
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    res.writeHead(upstream.status, out);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch {
    res.writeHead(502, { 'content-type': 'application/json' }).end('{"success":false,"error":{"code":"BAD_GATEWAY","message":"API unreachable"}}');
  }
}

function serveFile(urlPath, res) {
  let file = normalize(join(DIST, decodeURIComponent(urlPath)));
  if (!file.startsWith(DIST + sep) && file !== DIST) return res.writeHead(400).end();
  let isFile = false;
  try { isFile = statSync(file).isFile(); } catch { /* missing */ }
  let servedPath = urlPath;
  if (!isFile) {
    if (urlPath.startsWith('/assets/')) return res.writeHead(404, headersFor(urlPath)).end('Not found');
    file = join(DIST, 'index.html'); // SPA fallback, as the vercel.json rewrite does
    servedPath = '/index.html';
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', ...headersFor(urlPath), ...(servedPath === '/index.html' ? headersFor('/index.html') : {}) });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  if (path.startsWith('/api/')) return proxy(req, res);
  return serveFile(path === '/' ? '/index.html' : path, res);
}).listen(PORT, () => console.log(`dist/ on http://localhost:${PORT}, /api -> ${API}`));
