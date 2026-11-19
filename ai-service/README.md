# FinTrack AI service

A small, stateless FastAPI service that analyses **one user's records at a time**. It has no
database access and stores nothing: the FinTrack API loads the signed-in user's own records
and sends them in a signed request. Only the API can call it; do not expose it to the internet.

## What it does

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness (no signature) |
| `POST /v1/insights` | Insight cards, unusual expenses, month-end estimate, budget suggestions, regular payments, goal outlook |
| `POST /v1/assistant/ask` | Answers a plain-language question about the records in the request |

| Piece | How |
|---|---|
| Unusual expenses | Robust z-score (median and MAD) against earlier payments with the same description, or the category; must also be at least 2x the usual amount. Plus an Isolation Forest over amount, category and timing. Each finding carries a plain reason. |
| Month-end estimate | Spent so far + what was typically spent in the *remaining days* of the last three complete months, with the lowest and highest as a range. Labelled as an estimate. |
| Budget suggestions | Median of the last three complete months, rounded up with 5% headroom; ADD, RAISE or LOWER against current budgets. |
| Question answering | Rule-based: intent, period and category are recognised, then the answer is computed exactly. Investment, tax, loan and insurance questions are declined. No language model, so every number is traceable to the user's entries. |
| Money | `Decimal` throughout; amounts cross the wire as strings. Floats only inside statistics. |

## Security

- Every request except `/health` needs `X-FinTrack-Timestamp`, `X-FinTrack-Request-Id` and
  `X-FinTrack-Signature` = HMAC-SHA256 of timestamp, method, path, request id and body hash
  (`app/security.py`, matched by `backend/services/aiClient.js`). Requests older than
  `SIGNATURE_MAX_AGE_SECONDS`, signed with another key, altered, or replayed get 401.
- The signature is checked before the body is validated, so unauthenticated callers learn
  nothing about the schema. Validation errors name fields but never echo values.
- Unknown fields are rejected (`extra="forbid"`), so the API cannot start sending notes or
  account details by accident.
- Interactive docs are off unless `AI_DOCS_ENABLED=true`.
- The service will not start without a 64-hex-character shared secret.

## Commands (from `ai-service/`)

| Command | Purpose |
|---|---|
| `py -3.12 -m venv .venv` then `.venv\Scripts\python -m pip install -r requirements-dev.txt` | Set up |
| `.venv\Scripts\python -m uvicorn --factory app.main:create_app --port 8000` | Run (the API expects it at `AI_SERVICE_URL`) |
| `.venv\Scripts\python -m pytest` | Tests (97) |
| `.venv\Scripts\python -m pytest --cov=app --cov-report=term-missing` | Tests with coverage (97% of lines) |
| `.venv\Scripts\pip-audit -r requirements.txt -r requirements-dev.txt` | Known-vulnerability check of the pinned packages |

`AI_SERVICE_SHARED_SECRET` in `ai-service/.env` must equal the one in `backend/.env`
(`npm run init:env` in `backend/` writes both).

## Why there is no scikit-learn

The architecture planned scikit-learn's Isolation Forest. On the development machine a
Windows application-control policy blocks one of scikit-learn's compiled libraries, and that
policy was left alone. The algorithm is short, so `app/services/iforest.py` implements it
with NumPy (Liu, Ting and Zhou, 2008) and `tests/test_calculations.py` checks it. pandas was
not needed either.
