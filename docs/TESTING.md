# FinTrack testing

How FinTrack is tested, how to run each suite, and where each required security test lives.
Results of the last full run, coverage and the defects found: [TEST_REPORT.md](TEST_REPORT.md).

## 1. Strategy

| Layer | Tools | What it covers |
|---|---|---|
| Backend unit | Jest | Config validation, password policy and hashing, tokens, AES-256-GCM, audit-chain hashing, logger redaction, middleware, external clients (network mocked), Postman collection in sync with the API spec |
| Backend integration | Jest + Supertest, real MySQL (`fintrack_test`) | Every route through the real Express app and database: schema constraints, auth flows, money features, isolation between users, AI payloads and a real cross-language signature check |
| Backend security | Jest + Supertest | Audit trail and hash chain, append-only protection, admin privacy boundary, key rotation with a real key change |
| Frontend | Vitest + React Testing Library + axe-core | Every page with the API mocked: what is shown, what is sent, error handling, route guards, no tokens in browser storage, accessibility structure, focus management, page titles |
| AI service | pytest + FastAPI TestClient | Signature and replay checks, strict request schemas, every calculation and every assistant answer with figures checked by hand |
| Live | `npm run security:smoke` | 34 checks against the running stack (headers, CORS, auth, injection, IDOR, CSRF, AI service) |
| Accessibility | axe-core in a real browser | WCAG 2.2 AA and best practices on every page, including colour contrast |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | All of the above except the live and browser checks, plus migrations on a fresh MySQL 8 and a dependency audit, on every push |

Principles:

- **Real database.** Integration tests use a separate `fintrack_test` database, never mocks,
  so SQL, constraints, triggers and privileges are tested for real. `NODE_ENV=test` always
  appends `_test` to the database name, so tests cannot touch real data.
- **Fictional data only.** Each run creates its own users with unique emails, so suites don't
  depend on each other.
- **Exact money.** Amounts are asserted as exact decimal strings (`'1234.56'`), never as floats.
- **No network in unit tests.** The exchange-rate client refuses to run under test, and the
  AI service is replaced by a recorder, except in the one test that starts the real Python
  service.

## 2. Running the tests

| Suite | Folder | Command |
|---|---|---|
| API (all) | `backend/` | `npm test` |
| API with coverage | `backend/` | `npm run test:coverage` (HTML report in `backend/coverage/`) |
| One API file | `backend/` | `npx jest tests/integration/auth.test.js` |
| Web app | `frontend/` | `npm test` |
| Web app with coverage | `frontend/` | `npm run test:coverage` |
| AI service | `ai-service/` | `.venv\Scripts\python -m pytest` (add `--cov=app` for coverage) |
| Lint | `backend/`, `frontend/` | `npm run lint` |
| Live security checks | `backend/` | `npm run security:smoke` (API, AI service and demo data must be running) |
| Production build, served as Vercel serves it | `frontend/` | `npm run build`, then `npm run serve:dist` (http://localhost:4180) |
| Postman scenario | `backend/docs/` | Import the collection and the "FinTrack local" environment, fill in `adminPassword`, run the collection |
| Dependency audit | `backend/`, `frontend/`, `ai-service/` | `npm audit --omit=dev`; `.venv\Scripts\pip-audit -r requirements.txt` |

The backend's Jest `globalSetup` migrates `fintrack_test` before each run. The schema suite
rebuilds it from scratch before and after itself.

## 3. Required security tests and where they are

| Requirement (project brief) | Tests |
|---|---|
| SQL injection | `ledger.test.js`: markup and SQL in text fields stored as plain text; search, sort and filter only accept allowed values. `security.test.js`: admin user search is parameterised. Live: `security-smoke.js` sends injection payloads to search, sort, filter and id |
| XSS | `ledger.test.js`: markup stored inert; the CSV export neutralises formulas. `routes.test.jsx`: nothing about the session in browser storage. The production CSP was checked in the browser |
| Authentication bypass | `auth.test.js`: forged, unsigned, expired and wrong-audience tokens refused; revoked and suspended sessions refused. `security-smoke.js`: every protected route answers 401 without a token, and `alg: none` and altered tokens are refused |
| Unauthorised resource access (IDOR) | `ledger.test.js`: each money route tried as a second user (404). `auth.test.js`: another user's session cannot be ended. `security.test.js`: an administrator cannot read anyone's financial records |
| Rate limiting | `app.test.js`: global limit. `auth.test.js`: sign-in limited per client. `assistant.test.js`: assistant limited per user |
| Token expiry | `auth.test.js`: expired access tokens refused; expired and superseded reset links refused; refresh-token rotation and reuse detection |
| Encryption and decryption | `unit/security.test.js`: round trip, a fresh IV each time, tampered ciphertext or tag, a value moved to another row, an unknown key. `keyRotation.test.js`: re-encryption under a new key version |
| Audit-log integrity | `unit/auditChain.test.js` (hashing). `security.test.js`: one row per change in the same transaction, concurrent appends, the app account cannot update or delete, triggers stop even the migrator, anchors detect a rewritten tail |
| Password storage | `unit/security.test.js`: salted bcrypt, policy, 72-byte limit. `auth.test.js`: only the hash is stored, and responses never contain it |
| CSRF | `auth.test.js`: cookie routes need the custom header and an allowed origin |
| AI data boundary | `assistant.test.js`: the payload holds only the signed-in user's records and never notes or contact details. `test_security.py`: unsigned, stale, replayed or altered requests and unknown fields refused |

## 4. Writing new tests

- **Backend:** put a test next to its peers in `tests/unit`, `tests/integration` or
  `tests/security`.
  - Create users through the API (`/auth/register`) so sessions, audit rows and grants are real.
  - Use `createApp({ globalRateLimit: … })` with relaxed limits unless the limit itself is under
    test.
- **Frontend:** render through `renderApp(path, { user })` from `src/test/renderApp.jsx` and mock
  the service modules, never Axios.
  - Query by role and accessible name. If an element cannot be found that way, the page probably
    has an accessibility problem.
- **AI service:** use the `post_signed` fixture for endpoint tests and `make_transactions()` for
  data. Write the expected figures out by hand in a comment.
- **API spec:** a new endpoint goes into `backend/docs/openapi.yaml` in the same change. Run
  `npm run docs:postman` afterwards; `tests/unit/postman.test.js` fails until you do.
