"""Shared fixtures: a known secret, a fixed clock, a signing client and sample records."""
from __future__ import annotations

import json
import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.security import sign

SECRET = bytes.fromhex("ab" * 32)
NOW = 1_800_000_000  # fixed Unix time for signatures
TODAY = date(2026, 11, 17)


@pytest.fixture
def settings() -> Settings:
    return Settings(shared_secret=SECRET, max_age_seconds=60, docs_enabled=False)


@pytest.fixture
def client(settings) -> TestClient:
    return TestClient(create_app(settings, clock=lambda: NOW))


def signed_headers(path: str, body: bytes, *, secret: bytes = SECRET, timestamp: int = NOW, request_id: str | None = None, method: str = "POST") -> dict:
    request_id = request_id or str(uuid.uuid4())
    return {
        "content-type": "application/json",
        "x-fintrack-timestamp": str(timestamp),
        "x-fintrack-request-id": request_id,
        "x-fintrack-signature": sign(secret, str(timestamp), method, path, request_id, body),
    }


@pytest.fixture
def post_signed(client):
    def post(path: str, payload: dict, **options):
        body = json.dumps(payload).encode()
        return client.post(path, content=body, headers=signed_headers(path, body, **options))
    return post


def make_transactions(today: date = TODAY, months: int = 6, with_anomaly: bool = True) -> list[dict]:
    """Six steady months of fictional activity, plus one planted unusual expense."""
    rows: list[dict] = []
    next_id = iter(range(1, 100_000))

    def add(day: date, kind: str, amount: str, category: str, description: str):
        if day <= today:
            rows.append({"id": next(next_id), "date": day.isoformat(), "type": kind, "amount": amount, "category": category, "description": description})

    for back in range(months - 1, -1, -1):
        index = today.year * 12 + today.month - 1 - back
        first = date(index // 12, index % 12 + 1, 1)
        add(first, "INCOME", "85000.00", "Salary", "Monthly salary")
        add(first + timedelta(days=2), "EXPENSE", "24000.00", "Rent & Housing", "Monthly rent")
        add(first + timedelta(days=5), "EXPENSE", "649.00", "Subscriptions", "Music streaming")
        for week in range(4):
            add(first + timedelta(days=3 + week * 7), "EXPENSE", f"{1500 + week * 25}.50", "Groceries", "Weekly groceries")
            add(first + timedelta(days=4 + week * 7), "EXPENSE", f"{380 + week * 10}.00", "Food & Dining", "Lunch")
            add(first + timedelta(days=6 + week * 7), "EXPENSE", f"{210 + week * 5}.00", "Transport", "Cab ride")
    if with_anomaly:
        add(today - timedelta(days=3), "EXPENSE", "5200.00", "Transport", "Airport limousine")
    return rows


def payload(**overrides) -> dict:
    data = {"currency": "INR", "today": TODAY.isoformat(), "transactions": make_transactions(), "budgets": [], "goals": []}
    data.update(overrides)
    return data
