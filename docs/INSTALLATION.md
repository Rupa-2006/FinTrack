# FinTrack installation guide (local development)

Sets up the complete system on one machine: MySQL, the API, the web app and the AI service,
with fictional demo data. About 15 minutes. For hosting it on the internet, see
[DEPLOYMENT.md](DEPLOYMENT.md).

## 1. Requirements

| Tool | Version | Check with |
|---|---|---|
| Node.js | 20 or newer (developed on 24, CI uses 22) | `node --version` |
| npm | comes with Node | `npm --version` |
| Python | 3.12 | `py -3.12 --version` (Windows) or `python3.12 --version` |
| MySQL Server | 8.0, with a root (or other admin) login | `mysql --version` |
| Git | any recent version | `git --version` |

Ports used: **5000** (API), **5180** (web app), **8000** (AI service), **3306** (MySQL).

No paid service or API key is needed:

- Exchange rates come from the free Frankfurter API. Without internet, the stored rates are used.
- Emails are written to files.
- The AI runs locally.

## 2. Get the code

```bash
git clone <repository-url> FinTech
```

```bash
cd FinTech
```

## 3. Database and secrets

All commands in this section run from `backend/`.

1. Install the API's packages:
   ```bash
   npm install
   ```
2. Generate the configuration and secrets:
   ```bash
   npm run init:env
   ```
   This writes `backend/.env`, `ai-service/.env` and `database/setup/setup.local.sql`. All
   three are git-ignored, hold random passwords and keys, and are never printed. It refuses to
   overwrite existing files.
3. Create the two databases (`fintrack`, `fintrack_test`) and the three least-privilege
   accounts, once, as MySQL root:
   ```bash
   mysql -u root -p -e "source ../database/setup/setup.local.sql"
   ```
   Or open the file in MySQL Workbench and run it. FinTrack itself never connects as root.
4. Build the schema and apply the per-table privileges:
   ```bash
   npm run migrate
   ```
5. Load the fictional demo data: four accounts and six months of history.
   ```bash
   npm run seed:demo
   ```

## 4. AI service

From `ai-service/`:

**Windows**

```bash
py -3.12 -m venv .venv
```

```bash
.venv\Scripts\python -m pip install -r requirements-dev.txt
```

**macOS / Linux**

```bash
python3.12 -m venv .venv
```

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
```

## 5. Web app

From `frontend/`:

```bash
npm install
```

## 6. Run everything

Three terminals:

| Terminal | Folder | Command |
|---|---|---|
| API | `backend/` | `npm run dev` |
| Web app | `frontend/` | `npm run dev` |
| AI service | `ai-service/` | `.venv\Scripts\python -m uvicorn --factory app.main:create_app --port 8000` (Windows; use `.venv/bin/python` elsewhere) |

Open http://localhost:5180 and sign in as:

- `aarav.sharma@fintrack.demo` (user)
- `admin@fintrack.demo` (administrator)

The demo password is in `backend/scripts/seed-demo.js`. It is for development only, and the seed
refuses to run in production.

Useful addresses:

- http://localhost:5000/api/health/ready (database status and schema version)
- http://localhost:5000/api/docs (interactive API documentation)
- `backend/docs/FinTrack.postman_collection.json` (Postman)

## 7. Check the installation

| Check | Folder | Command | Expected |
|---|---|---|---|
| API tests | `backend/` | `npm test` | 250+ tests pass |
| Web app tests | `frontend/` | `npm test` | 170+ tests pass |
| AI tests | `ai-service/` | `.venv\Scripts\python -m pytest` | 97 tests pass |
| Live security checks (all three services running) | `backend/` | `npm run security:smoke` | 34/34 checks pass |
| Audit chain | `backend/` | `npm run audit:verify` | "Chain intact" |

The tests use the separate `fintrack_test` database and never touch your demo data. More in
[TESTING.md](TESTING.md).

## 8. Trying password reset locally

With `SMTP_HOST` empty (the default), emails are written to `backend/tmp/mail/`. To try a reset:

1. Request one on the Forgot password page.
2. Open the newest file in that folder.
3. Follow the link in it.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `npm run init:env` says it refuses to overwrite | The files already exist. Keep them; new keys would make existing encrypted data unreadable. Delete them only for a completely fresh start (then also recreate the databases) |
| `ER_ACCESS_DENIED_ERROR` when migrating | The setup SQL was not run, or was run before a newer `init:env`. Run step 3 again |
| Migration fails creating triggers ("SUPER privilege… binary logging") | The setup SQL sets `log_bin_trust_function_creators`; it needs root. Run the setup file as root again |
| The API stops at start with a message naming a variable | `backend/.env` is missing a value or still has a placeholder. The message names the variable, never its value |
| Web app footer says "Service currently unavailable" | The API is not running on port 5000 |
| One `401` in the browser console when signed out | Expected: the app checks for an existing session on load |
| Assistant says it is unavailable | The AI service is not running on port 8000, or `AI_SERVICE_SHARED_SECRET` differs between `backend/.env` and `ai-service/.env` |
| Port already in use | Stop the other process, or change `PORT` in `backend/.env` (and `CLIENT_ORIGINS`/`APP_PUBLIC_URL` if you move the web app off 5180) |
| `pip install` blocked by Windows "Application Control" | A device policy blocks some compiled Python packages. FinTrack only needs NumPy, FastAPI and their dependencies, which install normally; do not weaken the policy |
