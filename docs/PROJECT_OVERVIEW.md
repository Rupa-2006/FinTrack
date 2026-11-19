# FinTrack project overview

**FinTrack** is an AI-powered personal finance management and cybersecurity platform. It is a
multi-user web application for recording income and expenses in several currencies, planning
with budgets and savings goals, understanding spending through reports and an AI assistant,
and seeing exactly how the account is protected.

It is a portfolio project built like a real fintech product. It uses **fictional data only**,
never connects to a bank and never processes payments.

## 1. Problem statement

People keep track of money in scattered places: banking apps per account, spreadsheets, notes.
That leaves them with three problems:

1. **No single picture.** Income, spending, budgets and savings live in different tools and
   currencies, so questions like "how much did I spend on food this month compared with last
   month?" take manual work.
2. **Little insight.** Raw transaction lists do not point out unusual expenses, a budget about
   to be exceeded, or whether a savings goal is realistic.
3. **Weak security in typical personal-finance tools.** Student and hobby finance apps often:
   - store passwords weakly
   - keep sensitive fields in clear text
   - let one user's id reach another's records
   - keep no trustworthy record of who changed what

   Financial data deserves the controls a bank would apply.

## 2. Objectives

| # | Objective | How FinTrack meets it |
|---|---|---|
| O1 | Let many users manage their own income and expenses, fully isolated from each other | Every query is scoped to the signed-in user; another user's record answers 404 (tested for every route) |
| O2 | Track money across currencies without losing information | The original amount and currency are kept, plus the converted amount, the rate used and its date, from stored ECB snapshots |
| O3 | Plan with monthly budgets and savings goals | Category and overall limits, savings targets, warnings at a chosen threshold, goals with contributions and deadlines |
| O4 | Explain financial behaviour | Dashboard, reports by day, week, month and year, CSV export, printable reports |
| O5 | Give intelligent, honest insights | A separate Python service finds unusual expenses, estimates the month end, suggests budgets and answers questions, labelled as estimates, never as advice |
| O6 | Make security part of the architecture | Two-step sign-in (authenticator codes, recovery codes), bcrypt, AES-256-GCM field encryption, short-lived JWT plus rotating refresh tokens, role-based access, validation, rate limits, CSRF and header protection, lockouts, session revocation, security events, a tamper-evident audit chain |
| O7 | Give administrators oversight without access to private finances | Admin dashboard with counts, account management, security events and audit review; no access to anyone's transactions (enforced in code and by a test) |
| O8 | Be deployable and maintainable like a product | Tests in CI, migrations, documented deployment on free hosting, full documentation |

## 3. Scope

**In scope:**

- Registration, sign-in and password reset by email.
- Profile, sessions, and account deactivation.
- Income and expenses with categories and payment methods, in INR, USD, EUR, GBP and JPY, entered
  by hand, recorded automatically from recurring rules, or imported from CSV files.
- Monthly budgets, savings targets and goals.
- Analytics, reports and CSV export.
- Notifications.
- An AI assistant over the user's own data.
- A security page for each user, and an admin dashboard.

**Out of scope, by design:**

- Bank connections and real payments.
- Investment, tax or loan advice. The assistant declines these questions.
- Native mobile apps. The web app is responsive.

## 4. Users and roles

| Role | Can |
|---|---|
| Visitor | Read the landing page, register, sign in, reset a forgotten password |
| User | Everything about their own money and account; nothing about anyone else's |
| Administrator | Everything a user can, plus the admin dashboard. Cannot read other users' financial records, cannot change their own role or status, and cannot remove the last administrator |

The roles are stored in the database and checked on every request, so revoking a role takes
effect on the next click.

## 5. Requirements traceability

The ten modules and sixteen pages of the project brief, and where each is built.

| Module (brief) | Built | Where |
|---|---|---|
| 1. Authentication and user management | All items, including refresh-token rotation, sessions and deactivation | `backend/services/auth.service.js`, `user.service.js`; pages Login, Register, Forgot/Reset password, Profile, Security |
| 2. Financial dashboard | Income, expenses, balance, savings, trends, income versus expense, categories, recent transactions, budget use; all from the database | `analytics.service.js` (`dashboard`), Dashboard page |
| 3. Transaction management | Full create, read, update and delete; categories, descriptions, dates, payment methods, search, filters, date range, pagination, history; validated on the server | `transaction.service.js`, `ledger.validators.js`, Transactions pages |
| 4. Budget management | Monthly and category budgets, limits, percentage used, progress bars, warnings, savings targets, history by month (with copy from the previous month) | `budget.service.js`, Budgets page |
| 5. Multi-currency | Five currencies, rates from a trusted source (ECB via Frankfurter), original amounts never overwritten, conversion, rate dates, stored historical snapshots | `fx.service.js`, `currency.service.js`, Currencies page |
| 6. AI financial assistant | Spending patterns, monthly summary, unusual spending, month comparison, budget suggestions, top categories, questions about own records; Python FastAPI; own data only; estimates labelled | `ai-service/`, `assistant.service.js`, AI assistant page |
| 7. Advanced cybersecurity | All 18 controls | [SECURITY.md](SECURITY.md) section 1 maps each to code and tests |
| 8. Reports and analytics | Daily, weekly, monthly and yearly reports; income, expense, category and savings figures; CSV export; printable | `analytics.service.js`, `/reports/*`, Analytics page (Day / Week / Month / Year) |
| 9. Notifications | Budget thresholds, unusual spending, transaction confirmations, security notices, monthly summaries | `notification.service.js`, `transaction.service.js`, `securityEvent.service.js`, Notifications page |
| 10. Administrator dashboard | Registered and active users, account management, role management, usage statistics, security event monitoring, audit-log review with chain verification; no private transaction details | `admin.service.js`, Admin page |

All 16 required pages exist:

- landing, registration, login, forgot password
- dashboard, transactions, add transaction, budgets, savings goals, analytics
- AI assistant, currency management, notifications
- security settings, user profile, admin dashboard

The app also has reset password, edit transaction and not-found pages.

**Mandatory constraints:**

| Constraint | Status |
|---|---|
| Never store plaintext passwords | bcrypt only |
| Keep keys, passwords and tokens out of logs | Log redaction; logs record no request bodies or query strings (checked in Phase 9) |
| Do not claim the hash chain makes logs impossible to alter | Documented as tamper-evident, with its limits |
| No secrets in the repository | `.env` files git-ignored; placeholder-only examples; repository scanned |
| No credentials in insecure browser storage | Access token in memory, refresh token in an httpOnly cookie; tested |
| AI accesses authorised data only | The AI service has no database access and receives only the signed-in user's records; tested |
| Predictions are not presented as guarantees | Disclaimers on every estimate and on the insights panel |
| Fictional data, no real banking or payments | Yes |
| DECIMAL, not FLOAT, for money | `DECIMAL(18,2)` in MySQL, strings in JSON, `decimal.js` and Python `Decimal` |

**Deviations from the brief, each recorded where it was decided:**

| Deviation | Reason |
|---|---|
| Vitest instead of Jest on the frontend | It is the Jest-compatible runner for Vite projects; same API. The backend uses Jest as specified |
| NumPy Isolation Forest instead of scikit-learn | A Windows Application Control policy blocked a scikit-learn library on the development machine ([ai-service/README.md](../ai-service/README.md)) |
| Rule-based question answering instead of a language model | Every figure in an answer can be traced to the user's records, no paid API is needed, and no data leaves the system |
| No background scheduler | Summaries are produced on demand; free hosting sleeps idle services ([ARCHITECTURE.md](ARCHITECTURE.md)) |

## 6. Added after version 1.0

| Version | Feature | Where |
|---|---|---|
| 1.1 | Two-step sign-in: TOTP codes from an authenticator app (QR code setup), 10 single-use recovery codes, codes count towards the lockout | `backend/security/totp.js`, `services/mfa.service.js`, Security page, sign-in page |
| 1.1 | Recurring transactions: weekly, monthly or yearly; past dates filled in; pause, resume, end date; each occurrence created exactly once | `services/recurring.service.js`, Recurring transactions page |
| 1.1 | CSV import: column mapping (FinTrack's own export and common bank-statement layouts recognised), preview with per-row problems and duplicates, batched saving | `services/import.service.js`, Import transactions page |

## 7. Documentation map

| Document | Contents |
|---|---|
| [README](../README.md) | Project summary, quick start, status |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, technology decisions, folder structure, API conventions, security architecture |
| [DIAGRAMS.md](DIAGRAMS.md) | Use-case diagram, data-flow diagrams (levels 0, 1, 2) |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md) | ER diagram, tables, constraints, MySQL accounts |
| [API.md](API.md) | API documentation: conventions, authentication, every endpoint; OpenAPI and Postman files |
| [SECURITY.md](SECURITY.md) | Every security control, where it lives, its test and its limits |
| [INSTALLATION.md](INSTALLATION.md) | Local installation guide |
| [TESTING.md](TESTING.md) | Test strategy, how to run, where each security test is |
| [TEST_REPORT.md](TEST_REPORT.md) | Results, coverage, defects found and fixed |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment guide (Vercel, Render, managed MySQL, CI) |
| [FUTURE_ENHANCEMENTS.md](FUTURE_ENHANCEMENTS.md) | What could come next |
