# FinTrack web app

React 19 single-page application built with Vite, Tailwind CSS 4, React Router, Axios and
Recharts. Holds no secrets: everything prefixed `VITE_` ends up in the public bundle.

## Commands (run from `frontend/`)

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Dev server on http://localhost:5180 (proxies `/api` to the backend on port 5000) |
| `npm test` | Vitest + React Testing Library (includes axe-core accessibility checks) |
| `npm run test:coverage` | Tests with a coverage summary (HTML report in `coverage/`) |
| `npm run lint` | ESLint |
| `npm run build` | Production bundle in `dist/` |

Start the backend first (`npm run dev` in `backend/`), otherwise the footer shows
"Service currently unavailable".

The dev port is 5180. If you change it, update `CLIENT_ORIGINS` and `APP_PUBLIC_URL` in
`backend/.env` to match.

## Layout

| Path | Contents |
|---|---|
| `src/main.jsx`, `src/App.jsx` | Entry point; router and auth provider |
| `src/styles/index.css` | Tailwind entry and design tokens (navy palette, shadows, motion) |
| `src/routes/` | `AppRoutes.jsx` (route table), `guards.jsx` (ProtectedRoute, AdminRoute, PublicOnlyRoute), `navigation.js` (one list drives sidebar and routes) |
| `src/layouts/` | `PublicLayout` (marketing pages), `AppLayout` (signed-in shell: sidebar, top bar, mobile drawer) |
| `src/pages/` | One folder per page |
| `src/components/ui/` | Button, Card, StatCard, Input, Select, Badge, Alert, EmptyState, Skeleton, Spinner, Logo |
| `src/components/layout/` | Pieces shared by layouts (`ApiStatus`) |
| `src/services/` | `apiClient.js` (the only Axios instance), `tokenStore.js`, one module per API resource |
| `src/context/`, `src/hooks/` | `AuthProvider`, `useAuth`, `useAsync` |
| `src/utils/` | `format.js` (money, dates, percent), `cn.js` |
| `src/test/` | Test setup and `renderApp` helper |

## Rules for new code

- Call the API only through `services/`; components never import Axios.
- Never put tokens or user data in `localStorage`, `sessionStorage` or cookies. The access
  token lives in memory (`tokenStore.js`); the refresh token is an httpOnly cookie the
  browser manages.
- Amounts are decimal strings from the API. Format them with `formatMoney`; do not convert
  them to numbers for arithmetic.
- Route guards only decide what is shown. Authorization is enforced by the API.
- Every form control goes through `Input` / `Select` so labels and errors stay accessible.
- A page whose feature is not built shows `UpcomingPage`, never invented data.

## Sign-in flow

- `AuthProvider` restores the session on page load by calling `/auth/refresh` (the httpOnly
  cookie does the work), so a reload keeps you signed in without anything in browser storage.
  A signed-out visitor therefore causes one expected `401` in the browser console.
- `services/authService.js` shares a single in-flight refresh between all callers, because a
  refresh token works only once.
- Built pages: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/profile`.
  `/reset-password` reads its token from the URL fragment and removes it from the address bar.
- Password rules shown while typing live in `utils/passwordRules.js` and mirror the server.

## Money pages (Phase 6)

- Built pages: `/dashboard`, `/transactions`, `/transactions/new`, `/transactions/:id/edit`,
  `/budgets`, `/goals`, `/currencies`, `/analytics`, `/notifications`.
- All calls go through `services/ledgerService.js`. Amounts are sent and received as strings.
- Charts (`components/charts/Charts.jsx`, Recharts) convert to numbers only to draw; every
  figure shown as text is formatted from the exact string, and each chart has a text summary
  for screen readers.
- The dashboard and analytics pages, which carry the chart library, load on first visit.
- `components/app/` holds the shared page pieces: `PageHeader`, `AsyncSection` (loading,
  error with retry), `ProgressBar`, `Amount`, `Pagination`, `ConfirmButton`.
- `hooks/useSubmit.js` turns API validation errors into per-field messages;
  `hooks/useNotificationCount.js` keeps the unread count on the bell (refreshed every minute).
- The Analytics page prints cleanly (`window.print()`; controls are hidden with `no-print`).

## Security and admin pages (Phase 7)

- `/security`: the user's active sessions (end one, or all others), sign-in and security
  history, and their own audit trail. Calls go through `services/securityService.js`.
- `/admin` (ADMIN role): tabs for overview counts, account management (suspend, reactivate,
  grant or remove admin, unlock), security events across accounts, and the audit log with
  chain verification. It states on screen that users' financial records are not visible, and
  the API enforces that.
- Event codes and audit actions are shown in plain words by `utils/securityLabels.js`.

## AI assistant page (Phase 8)

`/assistant`: a chat (starter questions, follow-up suggestions, Enter to send, 500-character
limit) beside the insights panel (findings, month-end estimate with range, unusual expenses
linked to their entries, budget suggestions, regular payments). The conversation lives only in
the page's memory. Calls go through `services/assistantService.js`. Every page in the
navigation is now built; `UpcomingPage` remains for future routes.

## Reports and deployment (Phase 10)

- Analytics has **Day, Week, Month and Year** views (a button group with `aria-pressed`).
  - Month keeps the full monthly report.
  - Day and week list the period's transactions.
  - Year shows the month-by-month trend.
  - Each view shows totals with the comparison, both category breakdowns, CSV export of exactly
    that period, and printing.
  - Period maths lives in `utils/dates.js` (`periodRange`, `shiftPeriod`, `periodLabel`).
- `vercel.json`:
  - build settings
  - the `/api` rewrite to the API on Render, which keeps the refresh cookie first-party
  - SPA fallback and long caching for hashed assets
  - security headers: a CSP with no inline scripts, HSTS, frame denial, no referrer and a
    Permissions-Policy
- `npm run serve:dist` serves `dist/` with exactly those headers and the proxy (API at
  `--api`, default `http://localhost:5000`), so a production build can be checked locally.
  CSP violations show in the browser console.

## Version 1.1 pages

- **Sign-in** asks for a 6-digit code (or a recovery code) when the account has two-step
  sign-in on; an expired challenge or a lockout returns to the password step.
- **Security** has a Two-step sign-in card: QR code (drawn locally with `qrcode`) and key,
  confirmation code, recovery codes shown once (copy or download), new codes, turning it off.
- **Recurring transactions** (`/recurring`): rules with their schedule in words, next date and
  status; add, edit, pause, resume, delete. Generated transactions show a repeat icon in the
  transactions list.
- **Import transactions** (`/transactions/import`): the file is read in the browser
  (`utils/csv.js`), columns are matched by name (`utils/importMapping.js`: FinTrack's export,
  debit/credit statements, signed amounts, DMY/MDY/ISO dates, decimal commas), checked with a
  dry run in batches of 200, then imported.

## Accessibility (Phase 9)

Target: WCAG 2.2 AA. Every page was checked with axe-core in a real browser (including colour
contrast) and has no violations; `src/test/a11y.test.jsx` repeats the checks that work in jsdom.

- Each page sets its browser-tab title (`hooks/useDocumentTitle.js`, called by `PageHeader` and
  `AuthCard`); `routes.test.jsx` checks every page.
- After navigation, focus moves to `<main>` so screen readers announce the new page. The skip
  link leads there too.
- The mobile menu takes focus when it opens, makes the page behind it `inert`, closes on Escape
  and returns focus to the menu button.
- Text colours meet 4.5:1: secondary text uses `navy-500` or darker (`navy-400` only for icons
  and dark backgrounds); `income` and `warning` tokens are the 700 shades.
- Charts are hidden from assistive technology and not focusable; each has a text equivalent.
- Empty states are status text, not headings, unless they are the whole page (`titleAs="h1"`).
- Stand-alone links are at least 24px tall (WCAG 2.5.8).
- A failed confirm action (for example a delete while offline) shows its error next to the
  button (`ConfirmButton`).

## Development page

`/dev` (development builds only) shows every UI component and can open the signed-in shell
with a fake in-memory session, so layouts can be reviewed before sign-in exists. The fake
session has no token and cannot read anything from the API.
