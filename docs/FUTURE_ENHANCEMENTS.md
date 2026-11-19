# FinTrack future enhancements

Ideas for after version 1.0, grouped by theme and roughly ordered by value. Each says why it
matters and what it would take in this codebase. None is promised; all respect the project's
rules: fictional data, no real payments, and security first.

Already built since 1.0 (version 1.1): two-step sign-in, recurring transactions and CSV import.

## Security

| Enhancement | Why | What it takes |
|---|---|---|
| **Shared rate-limit store** (Redis or the database) | Counters live in one process; a second API instance would double every limit | `express-rate-limit` store adapter; Upstash Redis has a free tier |
| **Breached-password check** | The built-in list of common passwords is short | Have I Been Pwned "range" API (k-anonymity: only 5 hash characters leave the server), cached, failing open |
| **Automatic audit anchoring** | Anchors are saved on demand today | A scheduled GitHub Actions run of the operations workflow, publishing each anchor somewhere the database administrators cannot write (a separate repository or object storage with retention lock) |
| **Audit-key rotation** | The HMAC key cannot be changed without starting a new chain segment | A `chain_segments` table recording the key version and closing hash of each segment; the verifier walks segment by segment |
| **Content Security Policy reporting** | CSP violations in production are invisible | `report-to` endpoint on the API that records violations as security events |
| **Device management** | Users see sessions but cannot name or trust devices | Named devices, "trust this device" to skip new-device notices |

## Money features

| Enhancement | Why | What it takes |
|---|---|---|
| **Split transactions and tags** | One receipt can span categories | `transaction_splits` table; tags as a many-to-many table |
| **Shared budgets** (households) | Couples and flatmates share costs | Groups with membership and roles; every query scoped by group as well as user. A substantial change to the authorisation model |
| **More currencies** | Only five are supported | Reference data in a new migration; the ECB publishes about 30 |
| **Attachments** (receipt photos) | Proof of purchase | Object storage, virus scanning, size and type limits, files encrypted at rest |
| **PDF reports** | Printing works, but a file is easier to keep and share | Server-side rendering of the report page, or a print stylesheet saved as PDF |

## AI assistant

| Enhancement | Why | What it takes |
|---|---|---|
| **Optional language-model phrasing** | Answers are precise but follow fixed patterns | Keep the rule engine as the source of every figure; let a model only rephrase the computed answer, behind a setting that is off by default, with nothing personal sent beyond the computed facts |
| **Learning from feedback** | Users could mark a flagged expense as normal | Store "not unusual" feedback per description and category, and use it as a baseline in the anomaly detector |
| **Smarter forecasting** | The month-end estimate uses the recent average pattern | Seasonal patterns over 12+ months; confidence intervals from past forecast errors |
| **Goal planning** | "How much should I save each month to reach X by Y?" | A new assistant intent using the existing goal outlook |
| **More languages** | English only | Intent patterns and answer templates per language |

## Product and platform

| Enhancement | Why | What it takes |
|---|---|---|
| **Scheduler for summaries and reminders** | Monthly summaries appear only when notifications are opened | A job runner (Render cron job or GitHub Actions on a schedule) calling an internal, signed endpoint |
| **Email notifications** | Security notices and budget alerts only appear in the app | User preferences per notification type; the existing mail service |
| **Progressive web app** | Install on a phone, faster repeat visits | Web app manifest and a service worker that never caches API responses |
| **Dark mode** | Comfort | The colour tokens are already centralised in `styles/index.css` |
| **Internationalisation** | Formats already follow the browser's locale, but the text is English | Message catalogue (for example `react-intl`) |
| **End-to-end browser tests** | Browser checks are manual today | Playwright suite in CI running the main journeys against the production build (`serve:dist`) |
| **Observability** | Logs only | Error tracking (for example Sentry's free tier) with the same redaction rules, and uptime monitoring of `/api/health/ready` |
| **Paid-tier hardening** | Free hosting limits | Private network for the AI service (`pserv`), static outbound IPs with a database allow-list, no cold starts, point-in-time database recovery |
