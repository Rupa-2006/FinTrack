# FinTrack security

How FinTrack protects accounts and data, where each control lives in the code, which test
proves it, and what it does **not** protect against. FinTrack is a portfolio project that
handles fictional data; the controls are built as they would be for a real fintech product.

## 1. Requirements and where they are met

| # | Requirement | Implementation | Proven by |
|---|---|---|---|
| 1 | Password hashing | bcrypt, cost 12; policy (10–72 chars, mixed character classes, not name/email/common) checked on the server | `tests/unit/security.test.js`, `tests/integration/auth.test.js` |
| 2 | AES-256-GCM encryption | `security/fieldCrypto.js`: random 96-bit IV per value, authentication tag, AAD binds each value to its table, column and owner | `tests/unit/security.test.js` (tampered tag, moved value, unknown key) |
| 3 | Keys from the environment | `ENCRYPTION_KEYS` (versioned), `JWT_ACCESS_SECRET`, `AUDIT_HMAC_KEY`; validated at start-up; `.env` is git-ignored | `tests/unit/env.test.js` |
| 4 | JWT authentication | 15-minute HS256 access token (algorithm, issuer and audience pinned); rotating refresh token in an httpOnly, SameSite=Strict cookie | `auth.test.js` (forged, unsigned, expired, wrong-audience tokens) |
| 5 | Role-based access | `authorize('ADMIN')`; roles read from the database on every request | `auth.test.js`, `security.test.js` (grant and revoke take effect at once) |
| 6 | Resource authorization | Every query filters on the authenticated `user_id`; another user's id answers 404 | `ledger.test.js` (every route tried as a second user), `security.test.js` (as an administrator) |
| 7 | Secure middleware | helmet headers, CORS allow-list, request ids, `no-store`, 100 kB body limit, central error handler | `app.test.js` |
| 8 | Input validation | Zod on body, query and params; unknown fields dropped | every integration suite |
| 9 | SQL injection | Prepared statements only; sort columns and table names from fixed lists; `LIKE` wildcards escaped | `ledger.test.js`, `security.test.js` (admin search) |
| 10 | XSS | React escaping, no `dangerouslySetInnerHTML`, `default-src 'none'` CSP on the API, tokens never in web storage, CSV formula neutralising | `ledger.test.js` (CSV), `routes.test.jsx` (storage) |
| 11 | CSRF | Cookie routes need an allow-listed `Origin` and a custom header; data routes use a header token | `auth.test.js` |
| 12 | Rate limiting | Global limit plus stricter limits on sign-in, registration, password reset, rate refresh and chain verification | `app.test.js`, `auth.test.js` |
| 13 | Security headers | HSTS, CSP, no-sniff, frame-ancestors none, no referrer | `app.test.js` |
| 14 | Failed-login monitoring | Every attempt recorded; lockout after 5; account holder notified; admin view of addresses with repeated failures | `auth.test.js`, `security.test.js` |
| 15 | Session revocation | One row per sign-in; checked on every request; users end sessions; password change, reset, suspension and token reuse end them | `auth.test.js`, `security.test.js` |
| 16 | Security event logging | `security_events` (append-only for the app account); users see their own, administrators see all | `security.test.js` |
| 17 | Audit trail | `audit_logs` row for every change, written in the same database transaction | `security.test.js` |
| 18 | Tamper-evident hash chain | HMAC-SHA256 chain, verifier, anchors (below) | `tests/unit/auditChain.test.js`, `security.test.js` |
| 19 | Transport security in production | HTTPS everywhere (Vercel, Render); HSTS from both; the refresh cookie is `Secure`; MySQL over TLS 1.2+ with the server certificate always verified, and the API refuses to start in production against a remote database without TLS (`config/dbSsl.js`) | `tests/unit/env.test.js`; refusal of an unverifiable certificate checked against local MySQL |
| 20 | Web app headers | `frontend/vercel.json`: CSP without inline scripts, `frame-ancestors 'none'`, HSTS, nosniff, `X-Frame-Options`, no referrer, Permissions-Policy, COOP | Production build served with these headers (`npm run serve:dist`) and used end to end: no CSP violations |
| 21 | Two-step sign-in (TOTP) | `security/totp.js` (RFC 6238, verified against the RFC test vectors), `services/mfa.service.js`. The secret is AES-256-GCM encrypted (and covered by key rotation); recovery codes are stored as SHA-256 hashes only. A correct password with two-step sign-in on opens no session, only a 5-minute, single-use, 5-attempt challenge. Codes are accepted once (the time step is remembered). Wrong codes count towards the account lockout. Turning it off needs the password and a code. Every change is audited and the user is notified | `tests/integration/mfa.test.js`, `src/pages/mfa.test.jsx` |

Also in place: new-device sign-in warnings, refresh-token reuse detection, timing-safe
handling of unknown emails, neutral password-reset responses, account suspension, and
administrator self-protection (no changes to your own account; the last administrator
cannot be removed).

## 2. The audit trail

Every change to an account or a record writes an `audit_logs` row: who (`user_id`), what
(`event_type`, `action`), which record (`resource_type`, `resource_id`), which fields changed
(`details`), from where (`ip_address`) and in which request (`request_id`, the same id as
the `X-Request-Id` response header and the server log line).

**What is never written:** amounts, descriptions, notes, phone numbers, passwords, tokens or
keys. An edit records `{"fields": ["amount", "description"]}`, not the old or new values.

**Same transaction:** the audit row is appended inside the database transaction that makes
the change. A change cannot be committed without its row, and a rolled-back change leaves none.

### The hash chain

```
curr_hash = HMAC-SHA256(AUDIT_HMAC_KEY, prev_hash + "|" + canonical_json(row))
```

Each row stores the hash of the row before it. Appends lock the single-row
`audit_chain_head` table first, so concurrent requests queue and the chain cannot fork.
Verification (`npm run audit:verify`, or **Verify chain** on the Admin page) recomputes
every link and reports the first row that is wrong:

| Tampering | Detected because |
|---|---|
| A row's contents changed | its recomputed hash differs |
| A row removed or inserted | the next row's `prev_hash` no longer matches |
| Rows reordered | links break |
| Hash recomputed by someone without the key | HMAC needs `AUDIT_HMAC_KEY` |
| The newest rows removed | `audit_chain_head` and saved anchors no longer match |

### Layers around the chain

A hash chain only **detects** changes. These layers make them hard to make:

1. The application's MySQL account has `SELECT, INSERT` on `audit_logs`, never `UPDATE` or `DELETE`.
2. `BEFORE UPDATE` and `BEFORE DELETE` triggers reject changes from every account, including the migration account.
3. `TRUNCATE` and `DROP` need privileges the application account does not have.
4. **Anchors**: `npm run audit:anchor` saves the current chain end (row id and hash) to
   `backend/audit-anchors/`. Copy these files somewhere the database administrators cannot
   write to. `audit:verify` checks every saved anchor is still in the chain.

### Honest limits

- Someone with database administrator rights **and** the HMAC key could rebuild a
  self-consistent chain. Anchors kept elsewhere, and independent backups, are what reveal
  that. The log is tamper-evident, not tamper-proof.
- Appends are serialised. That is fine at this scale; a very busy system would batch them or
  chain per partition.
- `audit_chain_head` must be writable by the application. Changing it by hand is detected by
  verification, but it is not prevented.

## 3. Administrator privacy boundary

Administrators can see account metadata (name, email, status, roles, last sign-in, lockout,
session count), totals across all accounts, every security event and every audit row.

They cannot see any user's transactions, budgets, goals, notes or phone number. No admin route
reads those tables except for four `COUNT(*)` totals. A test reads the admin model's SQL and
fails if that changes. Another test signs in as an administrator and confirms that every
money route answers 404 for other users' records.

## 4. The AI service

"The AI must only access authorized user data" is enforced by how the system is built, not
by trusting the analysis code:

- The AI service has **no database credentials**. It sees only what is in each request.
- The API takes the user id from the access token, loads that user's records, and sends them.
  The payload has a fixed shape (Pydantic `extra="forbid"` on the AI side), so notes, phone
  numbers, emails or another user's records cannot be added by mistake. A test asserts this.
- Requests are signed with HMAC-SHA256 over timestamp, method, path, a one-time request id and
  the body hash. Stale, altered, replayed or unsigned requests get 401, checked before the body
  is even parsed. Ideally the service has no public address (Render `pserv` on a paid plan). On
  the free plan it has a public URL, and the signature check (with the replay guard) is what
  keeps it closed; it holds no data either way.
- Answers come from a rule-based engine over the given records; there is no language model to
  manipulate, and instructions typed into a question are treated as plain text.
- Investment, tax, loan and insurance questions are declined. Estimates carry a "not a
  guarantee" note and every insight panel says it is not financial advice.
- Questions are not stored or logged; each assistant call is limited per user.

## 5. Operations

| Task | Command (from `backend/`) |
|---|---|
| Verify the audit chain and every anchor | `npm run audit:verify` (exit code 0 = intact, 1 = problem, 2 = could not run) |
| Save an anchor | `npm run audit:anchor` (schedule it, and copy the files off the server) |
| Rotate the encryption key | Add a new version to `ENCRYPTION_KEYS`, make it active, restart, run `npm run keys:rotate -- --dry-run`, then `npm run keys:rotate`, then remove the old version once nothing remains |
| First administrator | `npm run make-admin -- someone@example.com` (production: the "Production operations" GitHub workflow, task `make-admin`) |
| Production chain check and anchors | "Production operations" workflow, tasks `verify-audit-chain` and `save-audit-anchor` (the anchor is kept as a workflow artifact, outside the database) |
| Production migrations | "Migrate production database" workflow with the migrator account, which the running API never holds |
| Rotate the JWT secret | Change `JWT_ACCESS_SECRET` and restart; access tokens stop working and clients refresh automatically |

The HMAC key cannot be rotated without re-anchoring: the chain is verified with one key. To
change it, verify and anchor with the old key, then start a new chain segment (not yet
automated).

## 6. Verification (Phase 9)

- `npm run security:smoke` (from `backend/`, local stack only) runs 34 live checks.
  - Headers, CORS and every protected route without a token.
  - Forged tokens, the role boundary and SQL-injection payloads.
  - Malformed and oversized bodies, stored script text and CSV formulas.
  - Another user's records, mass assignment, cookie flags and CSRF, and the AI service's signature check.
- Key rotation is tested with a real version change (`tests/security/keyRotation.test.js`).
- Dependency audit:
  - npm production packages and pip-audit report no known vulnerabilities.
  - One development-only npm advisory (`picomatch`, no fixed release) is accepted. The reasoning is in [TEST_REPORT.md](TEST_REPORT.md).
- Results, coverage and the defects fixed are in [TEST_REPORT.md](TEST_REPORT.md).

## 7. Not covered (yet)

- Two-step sign-in cannot be reset by an administrator: a user who loses both the phone and
  the recovery codes needs database-level help (delete their `user_mfa` row). This is
  deliberate, because an admin reset would be a way around the second factor.

- Rate-limit counters are per process; several API instances need a shared store (Redis).
- Breached-password checking is a short built-in list, not a full breach corpus.
- Email delivery through a real SMTP server has not been exercised.
- Monthly summaries and anchor exports have no scheduler; they run on demand.
