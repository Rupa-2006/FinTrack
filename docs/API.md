# FinTrack API

REST API for the FinTrack web app. This page explains conventions, authentication and every
endpoint. Fuller detail is in two machine-readable files:

| File | Use |
|---|---|
| [`backend/docs/openapi.yaml`](../backend/docs/openapi.yaml) | OpenAPI 3 contract, version 1.1.0. Served as interactive docs at `http://localhost:5000/api/docs` in development (off in production) |
| [`backend/docs/FinTrack.postman_collection.json`](../backend/docs/FinTrack.postman_collection.json) | Postman collection generated from the spec (`npm run docs:postman`). Every request carries a status check, and it runs top to bottom as a scenario with a throwaway account |
| [`backend/docs/FinTrack.local.postman_environment.json`](../backend/docs/FinTrack.local.postman_environment.json) | Postman environment for the local API (fill in `adminPassword`) |

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `/api` (local `http://localhost:5000/api`; in production the web app's own origin, proxied to the API) |
| Format | JSON in and out, UTF-8; request bodies up to 100 kB |
| Success | `{ "success": true, "data": …, "meta": { … } }`. `meta` carries pagination and unread counts where relevant |
| Failure | `{ "success": false, "error": { "code": "…", "message": "…", "requestId": "…", "details": [ { "field": "body.amount", "message": "…" } ] } }` |
| Request id | Every response has `X-Request-Id`; quote it when reporting a problem. It also appears in server logs and audit rows |
| Money | Decimal **strings** such as `"1250.50"`, never numbers, in requests and responses. Up to 2 decimals (JPY: whole numbers) |
| Dates | `YYYY-MM-DD` for calendar dates, `YYYY-MM` for months, ISO 8601 UTC for timestamps |
| Currencies | `INR`, `USD`, `EUR`, `GBP`, `JPY` |
| Pagination | `page` (from 1) and `pageSize` (up to 100). `meta.pagination` holds `{ page, pageSize, totalItems, totalPages }` |
| Unknown fields | Silently dropped (validated with Zod); unknown query values for fixed lists are refused |
| Caching | API responses send `Cache-Control: no-store` |
| Another user's record | Answers **404**, exactly as for a record that does not exist, so ids cannot be probed |

### Status and error codes

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A field is missing or invalid; `details` names each field |
| 400 | `BAD_REQUEST` | Malformed JSON or a request that cannot apply |
| 401 | `UNAUTHENTICATED` | No token, an invalid or expired token, a revoked session, or wrong credentials |
| 403 | `FORBIDDEN` | Missing role, or a cookie route without the CSRF header or allowed origin |
| 404 | `NOT_FOUND` | No such route or record (including other users' records) |
| 409 | `CONFLICT` | Duplicate (email, category, budget) or a state that does not allow the change |
| 413 | | Body over 100 kB |
| 423 | `ACCOUNT_LOCKED` | Too many failed sign-ins (15-minute lock) |
| 429 | `RATE_LIMITED` | Rate limit reached; `RateLimit-*` headers tell when to retry |
| 500 | `INTERNAL_ERROR` | Unexpected failure; never includes internal details |
| 503 | `SERVICE_UNAVAILABLE` | The database, the AI service or the rates service cannot be reached |

## 2. Authentication

1. `POST /auth/register` or `POST /auth/login` returns `{ user, accessToken }` and sets the
   refresh cookie `ft_refresh`.
   - With two-step sign-in on, `POST /auth/login` instead returns
     `{ mfaRequired: true, challengeToken }` and no cookie. `POST /auth/mfa/verify` with that
     challenge and a code then returns the session.
   - The cookie is `httpOnly`, `SameSite=Strict` and `Secure` in production, with path
     `/api/auth`.
2. Send the access token on every other request: `Authorization: Bearer <accessToken>`.
   - It lasts 15 minutes.
   - The web app keeps it in memory only.
3. When it expires (401), call `POST /auth/refresh` with the cookie. You get a new access token
   and a rotated cookie.
   - Each refresh token works once. Presenting a used one ends the whole session (theft
     detection).
4. `/api/auth/*` routes also require the header `X-Requested-With: XMLHttpRequest`, and, when
   the browser sends one, an allowed `Origin`. This is the CSRF protection for cookie routes.
5. Roles (`USER`, `ADMIN`) are read from the database on every request; `/admin/*` needs `ADMIN`.

```http
POST /api/auth/login
Content-Type: application/json
X-Requested-With: XMLHttpRequest

{ "email": "aarav.sharma@fintrack.demo", "password": "…" }
```

```json
{
  "success": true,
  "data": {
    "user": { "id": 2, "fullName": "Aarav Sharma", "email": "aarav.sharma@fintrack.demo", "baseCurrency": "INR", "roles": ["USER"] },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…"
  }
}
```

### Rate limits (per client address unless stated)

| Scope | Limit |
|---|---|
| All `/api` routes | 300 requests per 15 minutes |
| Sign-in | 10 per 15 minutes |
| Registration | 10 per hour |
| Forgot password | 5 per hour |
| Token refresh | 120 per 15 minutes |
| AI assistant | 30 per 5 minutes **per user** |
| Two-step sign-in settings | 10 per 15 minutes per user |
| Import | 60 requests per 15 minutes per user |
| Two-step sign-in code | Counts with sign-in (10 per 15 minutes); 5 attempts per challenge; wrong codes count towards the lockout |
| Exchange-rate refresh | 10 per 15 minutes |
| Audit-chain verification (admin) | 10 per 15 minutes |

## 3. Endpoints

`Auth` column:

- **public**: no token
- **cookie**: refresh cookie and CSRF header
- **user**: bearer token
- **admin**: bearer token with the ADMIN role

### Health

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | public | Liveness: the process is up |
| GET | `/health/ready` | public | Readiness: database reachable, schema version (used by the host's health check) |

### Authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | Create an account (`fullName`, `email`, `password`, optional `baseCurrency`); signs in |
| POST | `/auth/login` | public | Sign in; lockout after 5 failures |
| POST | `/auth/refresh` | cookie | New access token, rotated refresh cookie |
| POST | `/auth/mfa/verify` | public | Second step of a two-step sign-in: the challenge from `/auth/login` plus an authenticator or recovery code (5 minutes, single use, 5 attempts) |
| POST | `/auth/logout` | cookie | End this session and clear the cookie (safe to repeat) |
| POST | `/auth/forgot-password` | public | Email a reset link; the same answer whether or not the address exists |
| POST | `/auth/reset-password` | public | Set a new password with the single-use, 30-minute token; ends all sessions |

### Account

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/users/profile` | user | Own profile (phone decrypted) |
| PUT | `/users/profile` | user | Change name and phone (phone stored encrypted) |
| PUT | `/users/password` | user | Change password (needs the current one); ends other sessions |
| POST | `/users/deactivate` | user | Deactivate the account (needs the password); ends all sessions |

### Security (own account)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/security/sessions` | user | Active sessions, marking the current one |
| DELETE | `/security/sessions` | user | End all other sessions |
| DELETE | `/security/sessions/{id}` | user | End one session |
| GET | `/security/events` | user | Own sign-in and security history |
| GET | `/security/audit-logs` | user | Own audit trail (actions, never values) |
| GET | `/security/mfa` | user | Two-step sign-in status and recovery codes left |
| POST | `/security/mfa/setup` | user | New TOTP secret and `otpauth://` URI for the QR code (encrypted, inactive until confirmed) |
| POST | `/security/mfa/enable` | user | Confirm with the first code; returns 10 recovery codes once |
| POST | `/security/mfa/disable` | user | Turn off (password and a code) |
| POST | `/security/mfa/recovery-codes` | user | Replace the recovery codes (password) |

### Categories

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/categories` | user | Default and own categories (`type`, `includeArchived`) |
| POST | `/categories` | user | Create a category (`name`, `type`, optional `color`) |
| PUT | `/categories/{id}` | user | Rename or recolour an own category |
| DELETE | `/categories/{id}` | user | Delete an unused category, or archive a used one |

### Transactions

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/transactions` | user | List with filters: `type`, `categoryId`, `from`, `to`, `minAmount`, `maxAmount`, `search`, `paymentMethod`, `currency`, `foreignOnly`, `sort` (`date`, `amount`, `created`), `order`, paging |
| POST | `/transactions` | user | Record income or an expense in any supported currency; converts to the main currency, keeps the original, sends a confirmation and any budget or unusual-spending alert |
| GET | `/transactions/{id}` | user | One transaction (notes decrypted) |
| PUT | `/transactions/{id}` | user | Replace a transaction |
| DELETE | `/transactions/{id}` | user | Delete a transaction |
| POST | `/transactions/import` | user | Import up to 500 rows per request from a CSV file: preview (`dryRun`, the default) shows each row as ready, duplicate or error; then save |

### Recurring transactions

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/recurring` | user | Rules with schedule, next date and status (`ACTIVE`, `PAUSED`, `FINISHED`); creates anything due first |
| POST | `/recurring` | user | Weekly, monthly or yearly rule; past occurrences (up to a year back) are recorded at once |
| PUT | `/recurring/{id}` | user | Change amount, category, end date; pause or resume (resuming fills in missed dates) |
| DELETE | `/recurring/{id}` | user | Stop the rule; transactions already recorded stay |

### Budgets and savings goals

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/budgets` | user | Budgets for a `month`, with spent, remaining, percentage used and status |
| POST | `/budgets` | user | Create a `CATEGORY`, `OVERALL` or `SAVINGS_TARGET` budget for a month |
| POST | `/budgets/copy` | user | Copy budgets from `fromMonth` to `toMonth` |
| PUT | `/budgets/{id}` | user | Change amount and alert threshold |
| DELETE | `/budgets/{id}` | user | Delete a budget |
| GET | `/goals` | user | Savings goals with progress and days left |
| POST | `/goals` | user | Create a goal (`title`, `targetAmount`, `currency`, optional `deadline`, `notes`) |
| GET | `/goals/{id}` | user | One goal |
| PUT | `/goals/{id}` | user | Change a goal, cancel or reopen it |
| DELETE | `/goals/{id}` | user | Delete a goal |
| POST | `/goals/{id}/contributions` | user | Add (positive) or withdraw (negative) money |

### Currencies

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/currencies` | user | Supported currencies and the main currency |
| GET | `/currencies/rates` | user | Latest stored rates for a `base`, with rate date and source |
| POST | `/currencies/rates/refresh` | user | Fetch today's rates (rate-limited) |
| GET | `/currencies/convert` | user | Convert `amount` from one currency to another |
| PUT | `/currencies/base` | user | Change the main currency; re-values all transactions and budgets in one database transaction |

### Analytics and reports

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/analytics/summary` | user | Income, expenses, net, savings rate for a `month` or any `from`/`to` range, with the change against the comparison period (day, week, month, year or same length) |
| GET | `/analytics/monthly` | user | Month-by-month trend (`months`, `until`) |
| GET | `/analytics/categories` | user | Category breakdown for a period, `type` `EXPENSE` or `INCOME` |
| GET | `/analytics/dashboard` | user | Everything the dashboard shows, in one request |
| GET | `/reports/monthly` | user | Full monthly report: summary, categories, largest expenses, budgets, payment methods, daily totals |
| GET | `/reports/export` | user | CSV download for a range (formula-safe, UTF-8 with BOM, up to 10,000 rows) |

### Notifications

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/notifications` | user | Newest first (`unreadOnly`, paging). Types: budget threshold, unusual spending, transaction confirmation, security, monthly summary |
| GET | `/notifications/unread-count` | user | Count for the bell |
| POST | `/notifications/read-all` | user | Mark all as read |
| PATCH | `/notifications/{id}/read` | user | Mark one as read |
| DELETE | `/notifications/{id}` | user | Delete one |

### AI assistant

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/assistant/insights` | user | Findings, unusual expenses, month-end estimate with range, budget suggestions, regular payments |
| POST | `/assistant/ask` | user | Answer a question (`question`, 2 to 500 characters) about the user's own records |

Both are computed by the AI service from the signed-in user's own records only. They answer
503 if that service is unreachable.

### Administration

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/overview` | admin | Account and usage counts; recent suspicious addresses |
| GET | `/admin/users` | admin | Accounts with metadata (`search`, `status`, `role`, paging) |
| PATCH | `/admin/users/{id}/status` | admin | Suspend (`SUSPENDED`) or reactivate (`ACTIVE`) |
| PUT | `/admin/users/{id}/roles` | admin | Grant or remove `ADMIN` (`role`, `granted`) |
| POST | `/admin/users/{id}/unlock` | admin | Lift a sign-in lockout |
| GET | `/admin/security-events` | admin | Security events across accounts (filters: `eventType`, `severity`, `userId`) |
| GET | `/admin/audit-logs` | admin | Audit rows across accounts (filters: `eventType`, `action`, `userId`) |
| POST | `/admin/audit-logs/verify` | admin | Recompute the hash chain and report the first broken link |

No admin endpoint returns transactions, budgets, goals, notes or phone numbers.

## 4. Example: record an expense in another currency

```http
POST /api/transactions
Authorization: Bearer eyJ…
Content-Type: application/json

{ "type": "EXPENSE", "categoryId": 9, "amount": "20.00", "currency": "USD",
  "date": "2026-11-16", "description": "Cloud storage", "paymentMethod": "CARD" }
```

```json
{
  "success": true,
  "data": {
    "id": 41, "type": "EXPENSE", "amount": "20.00", "currency": "USD",
    "baseAmount": "1800.00", "baseCurrency": "INR", "exchangeRate": "90.00000000",
    "description": "Cloud storage", "paymentMethod": "CARD", "date": "2026-11-16",
    "category": { "id": 9, "name": "Subscriptions" }, "hasNotes": false
  }
}
```

A validation failure looks like this:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid",
    "requestId": "6cb14d16-5b80-41aa-bce9-702bc3f3a97f",
    "details": [ { "field": "body.amount", "message": "Enter an amount with at most 2 decimal places" } ]
  }
}
```

## 5. Changing the API

Document a new endpoint in `backend/docs/openapi.yaml` in the same change, then run
`npm run docs:postman`. `tests/unit/postman.test.js` fails if the collection no longer matches
the spec, and if this page no longer lists every endpoint.
