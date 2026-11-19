# FinTrack API

Express 5 REST API. The only component that connects to MySQL.

## Commands (run from `backend/`)

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run init:env` | Generate `.env` with random secrets (first time only) |
| `npm run migrate` | Apply database migrations and runtime grants |
| `npm run seed:demo` | Load fictional demo data |
| `npm run dev` | Start the API with auto-restart on file changes |
| `npm start` | Start the API |
| `npm test` | Run all tests against `fintrack_test` |
| `npm run test:coverage` | Tests with a coverage summary (HTML report in `coverage/`) |
| `npm run security:smoke` | Live security checks against the running local API and AI service (needs the demo data) |
| `npm run lint` | ESLint |

Once running: `http://localhost:5000/api/health`, `http://localhost:5000/api/health/ready`,
interactive docs at `http://localhost:5000/api/docs`.

## Layout

| Path | Responsibility |
|---|---|
| `server.js` | Process entry: validates config, checks the database, listens, shuts down cleanly |
| `app.js` | Builds the Express app: headers, CORS, rate limit, JSON parsing, routes, error handling |
| `config/env.js` | Validates every environment variable at startup; the only reader of `process.env` |
| `config/database.js` | Connection pool, `query()`, `withTransaction()` |
| `routes/` | URL to controller mapping; attaches validation and (later) auth per route |
| `controllers/` | HTTP in and out only |
| `services/` | Business rules and transactions |
| `models/` | All SQL |
| `validators/` | Zod schemas |
| `middleware/` | `requestContext`, `rateLimiters`, `validate`, `authenticate` (+ `authorize`), `csrf`, `errorHandler` |
| `security/` | `passwords`, `tokens`, `fieldCrypto`, `auditChain` |
| `utils/` | `ApiError`, response helpers, logger |
| `docs/` | `openapi.yaml` (API contract, served at `/api/docs` outside production), Postman collection and environment |
| `scripts/` | `init-env`, `migrate`, `seed-demo`, `audit-chain`, `rotate-encryption-key`, `make-admin`, `security-smoke`, `build-postman` |
| `tests/` | `unit/`, `integration/`, `security/` |

## Authentication (Phase 5)

| Piece | How it works |
|---|---|
| Passwords | bcrypt, cost 12. Policy: 10 to 72 characters, lower, upper, number, symbol; not the name, email or a common password (`security/passwords.js`) |
| Access token | HS256 JWT, 15 minutes, carries only user id and session id. Returned in the response body; the SPA keeps it in memory |
| Refresh token | Random 256-bit value in the `ft_refresh` cookie (`httpOnly`, `SameSite=Strict`, `Secure` in production, path `/api/auth`). Only its SHA-256 hash is stored. Rotated on every use; reuse of an old token revokes the session |
| Sessions | One `user_sessions` row per sign-in. `authenticate` checks on every request that the session is live and the account active, and reads roles from the database |
| Lockout | 5 wrong passwords lock the account for 15 minutes |
| Password reset | Single-use token, 30 minutes, stored hashed, sent in the URL fragment. Completing it ends all sessions |
| CSRF | `/api/auth` requires an allow-listed `Origin` (when present) and an `X-Requested-With` header (`middleware/csrf.js`) |
| Roles | `authorize('ADMIN')` after `authenticate`; refusals are recorded as `ACCESS_DENIED` |
| Field encryption | `security/fieldCrypto.js`: AES-256-GCM, versioned keys, bound to table, column and row. Used for `users.phone_enc` |
| Security events | `services/securityEvent.service.js` writes sign-ins, failures, lockouts, password changes to `security_events` |
| Email | With `SMTP_HOST` empty, messages are written to `backend/tmp/mail/` (git-ignored) instead of being sent |

To try a password reset locally: request it on the Forgot password page, then open the newest
file in `backend/tmp/mail/` and follow the link in it.

Known limits: rate-limit counters are per process; two browser tabs that refresh at the very
same moment can trip reuse detection and sign the user out; sending through a real SMTP
server has not been exercised.

## Money features (Phase 6)

| Piece | How it works |
|---|---|
| Amounts | `DECIMAL(18,2)` in MySQL, strings in JSON, `decimal.js` for arithmetic (`utils/money.js`). Never a JavaScript float. JPY takes whole numbers only |
| Multi-currency | Each transaction keeps the amount and currency as entered, plus `base_amount`, `exchange_rate` and `exchange_rate_id` in the user's main currency (`services/fx.service.js`) |
| Exchange rates | Stored snapshots; a conversion uses the newest one up to 7 days before the transaction date, otherwise fetches that date from Frankfurter (ECB rates, free, no key) and stores it. If the service is down, the nearest stored snapshot is used. Only currency codes are sent out |
| Main currency change | Re-values all transactions (rate of each one's own date) and budgets (latest rate) in one database transaction (`services/currency.service.js`) |
| Budgets | One row per month and scope. Spent amounts are computed from transactions, never stored. Alerts at the threshold and when exceeded, each once (`dedupe_key`) |
| Goals | Contributions and withdrawals update the running total in the same transaction, with the goal row locked |
| Unusual spending | An expense over 3x the category's 90-day average (with at least 5 earlier entries) raises a notification |
| Comparisons | A month is compared with the previous month; while it is running, only up to the same day |
| CSV export | Quoted cells, formula-like text prefixed with `'`, UTF-8 with BOM, at most 10 000 rows |
| Encryption | `transactions.notes_enc` and `savings_goals.notes_enc` via `security/fieldCrypto.js` |
| Isolation | Every model query filters on `user_id`; another user's id answers 404. Tests in `tests/integration/ledger.test.js` try each route as a second user |

Known limits: monthly summaries are created when the user opens notifications (there is no
background job yet); the rates service only covers business days, so a weekend date uses the
previous business day's rate.

## Security hardening (Phase 7)

Full detail, including limits: [docs/SECURITY.md](../docs/SECURITY.md).

| Piece | Where |
|---|---|
| Audit trail | `services/audit.service.js`: `append(tx, entry)` inside the change's own transaction; `verifyChain()`; `checkAnchor()` |
| Hash chain | `security/auditChain.js`: canonical JSON, HMAC-SHA256, per-row check |
| Security events and notices | `services/securityEvent.service.js`: records events, notifies the account holder of lockouts, new devices, password changes, token reuse and role changes |
| Admin API | `routes/admin.routes.js`, `services/admin.service.js`, `models/admin.model.js` (metadata and counts only) |
| Tools | `npm run audit:verify`, `npm run audit:anchor`, `npm run keys:rotate`, `npm run make-admin -- email` |
| Tests | `tests/security/security.test.js`, `tests/unit/auditChain.test.js` |

Rule for new code: any service function that changes data wraps the change and an
`audit.append(tx, …)` call in one `withTransaction`, and its `details` hold field names and
ids only.

## AI assistant (Phase 8)

| Piece | Where |
|---|---|
| Routes | `routes/assistant.routes.js`: `GET /api/assistant/insights`, `POST /api/assistant/ask`, 30 calls per 5 minutes per user |
| What is sent | `services/assistant.service.js` + `models/assistant.model.js`: the user's last 13 months of transactions (date, type, amount in main currency, category, description), this month's budgets and their goals. Never notes, phone, email or other users' data |
| Signing | `services/aiClient.js`: HMAC-SHA256 over timestamp, method, path, a one-time request id and the body hash; 10 s timeout; failures become a calm 503 |
| Tests | `tests/integration/assistant.test.js` checks the payload, validation, outage and per-user limit, and starts the real Python service to prove both sides agree on signatures |

## Production and documentation (Phase 10)

| Piece | Where |
|---|---|
| Database TLS | `config/dbSsl.js`: `DB_SSL=true` gives TLS 1.2+ with the server certificate verified (provider CA from `DB_SSL_CA` or `DB_SSL_CA_FILE`). Production refuses a remote database without it |
| Production settings | `NODE_ENV=production` turns the API docs off, requires `https` origins, sets the cookie `Secure`; `TRUST_PROXY=2` behind Vercel and Render |
| Hosting | `render.yaml` (repository root); health check `/api/health/ready` |
| CI and operations | `.github/workflows/`: `ci.yml` (every push), `migrate.yml` (production migrations), `operations.yml` (first admin, chain check, anchors) |
| Postman | `npm run docs:postman` regenerates `docs/FinTrack.postman_collection.json` and the local environment from `openapi.yaml`; `tests/unit/postman.test.js` keeps the collection and `docs/API.md` in step with the spec |
| Reports | `/analytics/summary` and `/analytics/categories` take any `from`/`to` range; a day, a Monday-to-Sunday week, a month or a year is compared with the previous one (to the same point while it is running) |
| Transaction confirmations | Each new transaction creates a `TRANSACTION` notification (`services/transaction.service.js`) |

Full guide: [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). API reference: [docs/API.md](../docs/API.md).

## Version 1.1 features

| Feature | Where | Notes |
|---|---|---|
| Two-step sign-in | `security/totp.js`, `services/mfa.service.js`, `models/mfa.model.js`, migration 007 | TOTP (RFC 6238) on Node's crypto; secret encrypted with `fieldCrypto`; recovery codes hashed; login returns a challenge, `POST /auth/mfa/verify` opens the session |
| Recurring transactions | `services/recurring.service.js`, `models/recurring.model.js`, migration 008 | Due occurrences are created when transactions, the dashboard or the rule list are read (`catchUpRecurring`); unique key (rule, date) prevents duplicates |
| CSV import | `services/import.service.js` | Up to 500 rows per request, row-by-row validation, duplicate detection, `dryRun` preview; saved rows use `transactionService.create(..., { quiet: true })` |

Tests: `tests/integration/mfa.test.js`, `recurring.test.js`, `import.test.js`.

## Request pipeline

`requestId` → request log → security headers → CORS → `no-store` + rate limit → JSON body
(100 kB max) → route (`validate` → controller → service → model) → `notFound` → `errorHandler`.

## Rules for new code

- Read configuration from `config`, never from `process.env`.
- Throw `ApiError` for anything the client should see; let everything else fall through to the 500 handler.
- Respond through `utils/response.js` so every body has the same shape.
- SQL goes in `models/` with `?` parameters. Never build SQL from request values.
- Log through `req.log` / `logger`, never `console`. Do not log request bodies.
- Document each new endpoint in `docs/openapi.yaml` in the same change.
- Put `authenticate` on every route that touches user data, and take the user id from
  `req.auth.userId` only, never from the URL or body.
