# FinTrack test report (Phase 9)

Date: 18 November 2026. Environment: Windows 11, Node 20+, Python 3.12, MySQL 8.0, Chromium
(the in-app browser), all services running locally with the fictional demo data.

## 1. Summary

| Area | Result |
|---|---|
| Backend (Jest + Supertest, real `fintrack_test` database) | 246 tests in 14 suites, all passing |
| Frontend (Vitest + React Testing Library + axe-core) | 172 tests in 12 files, all passing; stable over repeated coverage runs |
| AI service (pytest) | 97 tests, all passing |
| Lint (ESLint, backend and frontend) | Clean |
| Frontend production build | Succeeds |
| Live security smoke test (`npm run security:smoke`) | 34 of 34 checks pass |
| Dependency audit, production packages | 0 known vulnerabilities (npm, both apps; pip-audit, AI service) |
| Accessibility (axe-core, WCAG 2.2 AA + best practice, real browser) | 0 violations on every page, signed in, signed out and admin |
| Responsive layout (375, 768, 1280 px wide) | No sideways scrolling on any page; all stand-alone tap targets at least 24 px |
| Audit chain on the development database | Intact; saved anchor still matches |

## 2. Coverage

| Component | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| Backend | 95.9% | 94.8% | 78.6% | 95.8% |
| Frontend (`src/`) | 94.9% | 89.0% | 83.7% | 82.1% |
| AI service (`app/`) | 97% | | | |

Phase 9 raised these from 94.7%, 91.3% and 88% of lines. What remains uncovered is mostly
command-line entry points of the operational scripts (their logic is tested through the
exported functions), `main.jsx`, and the development-only design page.

Commands: `npm run test:coverage` in `backend/` and `frontend/`;
`.venv\Scripts\python -m pytest --cov=app` in `ai-service/`.

## 3. Tests added in Phase 9

| File | What it proves |
|---|---|
| `backend/tests/security/keyRotation.test.js` | Rotation to a genuinely new key version: old values are re-encrypted with the new key, still decrypt, stay bound to their row, a second run finds nothing left, undecryptable values are counted and left untouched, the run is audited and the chain stays intact |
| `backend/tests/unit/externalServices.test.js` | The exchange-rate client sends only codes and a date, has a timeout, and rejects error statuses, malformed dates and unusable rates; the email sender uses TLS on port 465, one connection pool, and reports delivery failures |
| `ai-service/tests/test_assistant_intents.py` | Every assistant answer type, with figures checked by hand against the sample data, and the empty-data wording |
| `ai-service/tests/test_insights_cards.py` | Budget exceeded / at risk, goals reachable / behind / other currency, savings rate good / low / negative |
| `frontend/src/test/a11y.test.jsx` | axe-core on public pages and the signed-in shell; one h1 and a main landmark; page titles; skip link; focus after navigation; mobile menu focus, inert background, Escape |
| `frontend/src/pages/ledger.test.jsx` (new block) | CSV export and its failure, month history in Analytics, budget editing, savings targets, failed deletes and copies shown to the user, goal deadline wording |
| `frontend/src/services/authService.test.js` | Simultaneous refreshes share one request; a failed refresh is not cached; auth calls never trigger refresh-and-retry |
| `frontend/src/utils/download.test.js` | CSV download link is created, clicked, removed and its object URL released |
| `frontend/src/routes/routes.test.jsx` (extended) | Every page's title matches its heading |

## 4. Live security verification

`backend/scripts/security-smoke.js` runs against the running stack; it refuses non-local
URLs. Results of the final run:

| Check | Result |
|---|---|
| Security headers: nosniff, CSP with `frame-ancestors 'none'`, no-referrer, HSTS, no `X-Powered-By`, request id | Pass |
| CORS: unknown origin gets no `Access-Control-Allow-Origin`; the web app origin is allowed | Pass |
| All 55 bearer-protected operations in the OpenAPI document answer 401 without a token | Pass |
| Forged tokens (`alg: none`, altered user id, garbage) rejected | Pass |
| Normal user refused the admin API (403) | Pass |
| SQL injection payloads in search, sort, filter and id: no 500, no leak, no extra rows | Pass |
| Malformed JSON 400 without internals; body over 100 kB 413; negative and float amounts rejected | Pass |
| Path traversal gives a plain 404 | Pass |
| Script-like text stored as inert text; CSV export prefixes formulas with `'` and is an attachment | Pass |
| Another user cannot read, change or delete a record (404 each); the owner's record is unchanged | Pass |
| Profile update ignores `roles` and `email` (no mass assignment) | Pass |
| Refresh cookie HttpOnly, SameSite=Strict, Path=/api/auth; refresh without the custom header refused | Pass |
| AI service: unsigned and wrongly signed requests 401; no public docs page | Pass |

Also checked:

- **API log:** the log written during the run contains no tokens, cookies, passwords or request
  text. Request lines hold only the method, the path without its query string, the status and
  the timing.
- **Secrets in the repository:** every file git would commit was scanned for 64-character hex
  keys, private keys, cloud and GitHub tokens, database URLs with passwords, and hard-coded
  secrets. The only matches are test-fixture passwords and the documented demo password, and
  the demo seed refuses to run in production.
- **Ignored files:** `.env` files, audit anchors, the dev mail folder, coverage output and the
  Python virtual environment are git-ignored. `.coverage` and `htmlcov/` were added to the
  ignore list in this phase.

Rate limiting was not hammered live, because that would lock local sign-in for the window.
`app.test.js` and `auth.test.js` cover it.

## 5. Dependency audit

| Component | Production | Development |
|---|---|---|
| Backend (npm) | 0 | `picomatch` ReDoS advisory (GHSA-fc5q-39xc-vjpf) via Jest |
| Frontend (npm) | 0 | Same advisory via Vite, Vitest and coverage tooling |
| AI service (pip-audit) | 0 after upgrading `python-dotenv` 1.2.1 → 1.2.2 (PYSEC-2026-2270) | 0 |

**Accepted risk.** The `picomatch` advisory lists every published version as affected, so there
is no fixed release to upgrade to. `npm audit fix --force` would downgrade Vite to an
incompatible major version. The package only matches file paths written by developers,
inside the test runner and the build tool. It never ships in the browser bundle or the API.
Re-check when a fixed release appears.

## 6. Defects found and fixed in Phase 9

| # | Defect | Severity | Fix |
|---|---|---|---|
| 1 | A failed delete of a budget or savings goal, or a failed "Cancel goal", was silently ignored, so the user saw nothing | Medium | `ConfirmButton` shows any unhandled error next to the button; the goal card shows its own error. Regression tests added |
| 2 | Secondary text (`navy-400`, 3.75:1) and the income colour (3.76:1) failed WCAG AA contrast; the warning colour was 3.2:1 | Medium | Text uses `navy-500` (5.9:1); `income` is now `#047857` (5.5:1) and `warning` `#b45309` (5.0:1) |
| 3 | Charts were hidden from screen readers but still keyboard-focusable | Medium | Recharts' accessibility layer is off and the donut's root tab index is -1; each chart keeps its text equivalent |
| 4 | Every page's browser title was just "FinTrack" (WCAG 2.4.2) | Medium | `useDocumentTitle`, called by the shared page header, the sign-in card, Profile, the not-found, placeholder and refusal pages; a test checks every page |
| 5 | After navigating, keyboard focus stayed on the old link, so screen readers did not announce the new page | Medium | Focus moves to `<main>` on route change |
| 6 | The mobile menu did not take focus, and the page behind it stayed tabbable | Medium | Focus moves into the menu, the page behind is `inert`, and closing returns focus to the menu button |
| 7 | The 404 page had no main landmark or h1 | Low | Rewritten with `<main>` and `<h1>` |
| 8 | Empty-state titles were `<h3>` directly under the page `<h1>` (skipped heading level), and the "Administrators only" page had no h1 | Low | Empty states are status text by default; `titleAs="h1"` when they are the whole page |
| 9 | Loading placeholders put `aria-label` on a plain div, which screen readers ignore | Low | `role="status"` |
| 10 | Stand-alone links on the dashboard, assistant and landing pages were 20 px tall | Low | At least 24 px (WCAG 2.5.8) |
| 11 | The assistant read "How much was left over … after income and spending?" as an income question | Low | Net questions are matched before income, including "income and/vs/minus spending" |
| 12 | Under coverage, lazily loaded pages sometimes took longer than Testing Library's 1 s wait, so different tests failed on different runs | Test only | Wait limit raised to 4 s in `src/test/setup.js`; three consecutive coverage runs are clean |
| 13 | `python-dotenv` 1.2.1 had a published advisory | Low | Pinned 1.2.2 |
| 14 | `.coverage` (Python) was not git-ignored | Low | Added to `.gitignore` |

## 7. Accessibility method

**In a real browser.** axe-core 4.11 was loaded into each page and run with the WCAG 2.0, 2.1
and 2.2 A/AA rules plus best practices. That covered:

- the 11 signed-in pages and the edit form
- the 4 admin tabs
- the landing, sign-in, register, forgot-password, reset-password and not-found pages

Colour contrast was measured there.

**In jsdom.** `src/test/a11y.test.jsx` repeats the structural checks on every test run.

**Keyboard support:**

- A global `:focus-visible` rule draws a 2 px navy outline on every focusable element.
- The skip link, focus after navigation and the mobile menu behaviour are tested.
- The menu was also confirmed in the browser at 375 px: focus moves into it, the background is
  inert, Escape closes it and focus returns to the menu button.

**Not done:** a manual screen-reader pass (NVDA or VoiceOver), and a 200% zoom review.
Screenshots could not be taken because the app window was behind other windows, so layouts were
verified by measurement (scroll width and element bounds) rather than by eye in this phase.
Earlier phases did review them visually.

## 8. Responsive method

At 375×812 (phone), 768×1024 (tablet) and desktop width, every page was opened and checked
for two things:

- that the document is no wider than the viewport
- that no element runs past the right edge outside a scrolling container

At phone width the four admin tabs and the mobile menu were included.

## 9. Known limits (unchanged)

- No multi-factor authentication.
- Rate-limit counters are kept per process.
- SMTP delivery has not been tried against a real server.
- Monthly summaries and anchor exports have no scheduler.

See [SECURITY.md](SECURITY.md) section 7.

## 10. Leftover test data in the development database

The live runs left behind:

- a "Phase Nine Probe" account per smoke-test run
- the Meera test user
- the transactions "Browser check: language course" and "Phase 7 check: cab ride"

All of it is fictional.

- `npm run seed:demo -- --reset` regenerates the demo accounts' financial data, which removes
  the two check transactions.
- The extra accounts stay. Rebuilding the database (`npm run migrate` on a fresh schema, then
  `seed:demo`) removes everything.

## 11. Phase 10 addendum (version 1.0.0)

Final run on 18 November 2026:

| Area | Result |
|---|---|
| Backend | 259 tests in 15 suites, lines 95.9% |
| Frontend | 179 tests in 13 files, lines 95.2%; lint clean; build succeeds |
| AI service | 97 tests |
| Live security smoke test | 34 of 34 |
| Postman scenario | Every non-admin request (55) answered as expected against the local API, using a small local runner. The 9 admin requests are covered by the Jest suites |
| Production build | Served with the exact `vercel.json` headers and `/api` proxy: sign-in, session restore on reload, charts and the assistant work; no CSP violations |
| Production-mode API | Docs off, HSTS, only the `https` origin allowed, `Secure` cookie, readiness with schema version, visitor IP correct behind two proxies |
| Database TLS | Verification enforced: a self-signed server certificate is refused |
| Accessibility of the new report views | 0 axe violations, no sideways scrolling at 375 px |

### Defects found and fixed in Phase 10

| # | Defect | Severity | Fix |
|---|---|---|---|
| 1 | **False tamper alarm in the audit chain.** Editing a savings goal without changing its status passed `details: { status: undefined }`. MySQL stored `{}`, but the hash had been computed over `{"status":null}`, so verification reported the untouched row as changed | High | `audit.append` now hashes exactly the stored form of `details` (JSON round trip); the goal service no longer sends `undefined`. A regression test fails without the fix |
| 2 | The brief's daily, weekly and yearly reports existed only as API ranges; the page offered months only | Medium (missing requirement) | Analytics has Day, Week, Month and Year views. The API compares days, weeks and years with the previous one, to the same point while running |
| 3 | The brief's transaction-confirmation notifications were never created (the type existed, unused) | Medium (missing requirement) | Each new transaction creates a confirmation, with the converted amount when the currency differs |
| 4 | No TLS option for MySQL; managed databases require it | Medium | `DB_SSL`, `DB_SSL_CA`, `DB_SSL_CA_FILE`, always verified; production refuses a remote database without TLS |
| 5 | ARCHITECTURE.md described parts that were never built (an in-process scheduler, a `jobs/` folder, an optional LLM layer, routers in the AI service) and recommended TiDB, which lacks the triggers the audit log relies on | Low (documentation) | Rewritten to match the build; the empty `jobs/` and `seeds/` folders removed |

**Effect of defect 1 on existing data.** The development database holds two rows written by
the old code: rows 38 and 59, both `GOAL_UPDATED`, created by the Postman scenario runs on
18 November. `npm run audit:verify` reports the first of them.

Each was checked: its stored hash matches exactly when `details` is read as
`{"status":null}`, so neither row was altered. They cannot be corrected, because the triggers
make audit rows immutable by design. Rebuilding the development database (fresh migration and
`npm run seed:demo`) gives a clean chain. Production has never run the old code.

## 12. Version 1.1 (two-step sign-in, recurring transactions, CSV import)

Final run on 18 November 2026:

| Area | Result |
|---|---|
| Backend | 293 tests in 18 suites (new: `mfa.test.js` 11, `recurring.test.js` 16, `import.test.js` 6, plus security and env additions) |
| Frontend | 204 tests in 17 files (new: two-step sign-in, Recurring page, Import page, CSV and column-mapping helpers) |
| AI service | 97 tests (unchanged) |
| Live security smoke test | 34 of 34 |
| Postman scenario | 66 of 66 checks on every non-admin request, including the 10 new endpoints |
| TOTP implementation | Matches the RFC 4226 and RFC 6238 test vectors |
| Browser, end to end | Two-step sign-in set up with the QR key, signed out, signed in with password and code; a monthly rule from September recorded 3 transactions; a bank-statement CSV mapped automatically, a duplicate and an invalid date flagged, 2 rows imported |
| Accessibility | 0 axe violations on the Security, sign-in code, Recurring and Import pages; no sideways scrolling at 375 px |
| Dependencies | `qrcode` added to the web app; production audit still 0 known vulnerabilities |

### Defects found and fixed while building 1.1

| # | Defect | Severity | Fix |
|---|---|---|---|
| 1 | **False tamper alarm under load.** `verifyChain` read the rows first and the chain head last, so a change made during verification made an untouched log look truncated | High | The head is read first and the chain checked up to it; a regression test appends a row in the middle of a check |
| 2 | Starting two-step setup twice at once (React's development double effect, or a double click) stored a different secret from the one shown, so the first code was refused | Medium | Setup is serialised per user and reuses a pending secret for 10 minutes; regression test |
| 3 | A two-step challenge closed one attempt early (MySQL applies `SET` assignments left to right) | Low | Condition uses the incremented value; covered by the lockout test |
| 4 | The import page's scrolling results table could not be reached by keyboard | Low | Focusable, named region |
| 5 | **False tamper alarm for about 1 audit row in 1,000.** A row written at exactly .000 milliseconds was hashed as "07:06:13.000" but read back by the MySQL driver as "07:06:13", so verification reported it as changed. Found as intermittent test failures on 19 November | High | The chain always hashes the time with three millisecond digits; unit regression test. Rows already written verify correctly with the fix |
