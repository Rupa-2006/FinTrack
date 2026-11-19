"""Money, periods, aggregates, Isolation Forest, anomalies, the month-end estimate and suggestions."""
from datetime import date
from decimal import Decimal

import numpy as np
import pytest

from app.money import change_percent, fmt, nice_round_up, percent
from app.schemas import Budget, FinancialData, Transaction
from app.services import analysis
from app.services.anomalies import detect
from app.services.forecast import month_end_estimate
from app.services.iforest import IsolationForest, average_path
from app.services.periods import Period, parse_period, this_month
from app.services.suggestions import budget_suggestions
from tests.conftest import TODAY, make_transactions


def txns(**options):
    return [Transaction(**row) for row in make_transactions(**options)]


# ---- money and periods

def test_money_is_formatted_exactly_per_currency():
    assert fmt(Decimal("1234567.505"), "INR") == "₹1,234,567.51"
    assert fmt(Decimal("1234.5"), "JPY") == "¥1,235"
    assert fmt(Decimal("-20"), "USD") == "-$20.00"
    assert percent(Decimal("1"), Decimal("3")) == 33.3
    assert percent(Decimal("1"), Decimal("0")) is None
    assert change_percent(Decimal("150"), Decimal("100")) == 50.0
    assert nice_round_up(Decimal("4317")) == Decimal("4400")
    assert nice_round_up(Decimal("87")) == Decimal("90")
    assert nice_round_up(Decimal("23001")) == Decimal("23500")


@pytest.mark.parametrize("text, start, end", [
    ("how much this month", "2026-11-01", "2026-11-17"),
    ("spending last month", "2026-10-01", "2026-10-31"),
    ("in March", "2026-03-01", "2026-03-31"),
    ("in december", "2025-12-01", "2025-12-31"),  # a later month name means last year's
    ("feb 2024", "2024-02-01", "2024-02-29"),
    ("over the last 3 months", "2026-09-01", "2026-11-17"),
    ("this year", "2026-01-01", "2026-11-17"),
    ("last week", "2026-11-09", "2026-11-15"),
    ("today", "2026-11-17", "2026-11-17"),
])
def test_periods_in_questions(text, start, end):
    period = parse_period(text, TODAY)
    assert (period.start.isoformat(), period.end.isoformat()) == (start, end)


def test_no_period_named():
    assert parse_period("where does my money go", TODAY) is None


# ---- aggregates

def test_totals_are_exact_decimals():
    data = txns()
    october = Period(date(2026, 10, 1), date(2026, 10, 31), "October")
    totals = analysis.totals(data, october)
    groceries = sum(Decimal(f"{1500 + w * 25}.50") for w in range(4))
    food = sum(Decimal(f"{380 + w * 10}.00") for w in range(4))
    cabs = sum(Decimal(f"{210 + w * 5}.00") for w in range(4))
    assert totals.income == Decimal("85000.00")
    assert totals.expense == Decimal("24000.00") + Decimal("649.00") + groceries + food + cabs
    assert isinstance(totals.expense, Decimal)
    rows = analysis.by_category(data, october)
    assert rows[0]["category"] == "Rent & Housing"
    assert round(sum(row["share"] for row in rows)) == 100


def test_month_to_date_comparison_handles_short_months():
    period = Period(date(2026, 3, 1), date(2026, 3, 31), "March")
    same = analysis.same_days_last_month(period)
    assert (same.start, same.end) == (date(2026, 2, 1), date(2026, 2, 28))


def test_recurring_payments_are_found_and_variable_ones_are_not():
    found = {row["description"]: row for row in analysis.recurring_payments(txns(), TODAY)}
    assert "Monthly rent" in found and "Music streaming" in found
    assert found["Music streaming"]["typicalAmount"] == Decimal("649.00")
    assert "Weekly groceries" not in found  # amounts vary by more than 15%


# ---- Isolation Forest

def test_average_path_matches_the_paper():
    assert average_path(1) == 0 and average_path(2) == 1
    assert average_path(256) == pytest.approx(10.24, abs=0.01)


def test_isolation_forest_isolates_an_obvious_outlier_deterministically():
    rng = np.random.default_rng(0)
    points = np.vstack([rng.normal(0, 1, size=(200, 2)), [[9.0, 9.0]]])
    flags, scores = IsolationForest(contamination=0.01, seed=7).fit_predict(points)
    assert flags[-1] and scores[-1] == scores.max()
    assert flags.sum() <= 3
    again, _ = IsolationForest(contamination=0.01, seed=7).fit_predict(points)
    assert (flags == again).all()


# ---- anomalies

def test_the_planted_unusual_expense_is_found_and_explained():
    found = detect(txns(), TODAY)
    assert found and found[0]["description"] == "Airport limousine"
    assert "robust_z" in found[0]["methods"]
    assert found[0]["amount"] == Decimal("5200.00")
    assert "times your typical Transport expense" in found[0]["reason"]


def test_a_dearer_regular_bill_is_judged_against_its_own_history_not_its_category():
    # A cheap and a dearer subscription share a category; neither is unusual.
    rows = []
    for back in range(6):
        month = 11 - back
        rows.append(Transaction(id=100 + back, date=date(2026, month, 5), type="EXPENSE", amount=Decimal("649.00"), category="Subscriptions", description="Music streaming"))
        rows.append(Transaction(id=200 + back, date=date(2026, month, 15 if month != 11 else 14), type="EXPENSE", amount=Decimal("1890.00") + back, category="Subscriptions", description="Cloud storage plan"))
    assert detect(rows, TODAY) == []
    # ...but a cloud bill four times its usual amount still is.
    rows.append(Transaction(id=999, date=date(2026, 11, 16), type="EXPENSE", amount=Decimal("7600.00"), category="Subscriptions", description="Cloud storage plan"))
    found = detect(rows, TODAY)
    assert [f["transactionId"] for f in found] == [999]
    assert 'usual "Cloud storage plan" payment' in found[0]["reason"]


def test_small_differences_are_not_flagged_even_if_statistically_odd():
    rows = [Transaction(id=i, date=date(2026, 10, i), type="EXPENSE", amount=Decimal("1000.00"), category="Education", description=f"Course {i}") for i in range(1, 9)]
    rows.append(Transaction(id=50, date=date(2026, 11, 10), type="EXPENSE", amount=Decimal("1500.00"), category="Education", description="Workshop"))
    assert detect(rows, TODAY) == []  # 1.5x is not worth raising


def test_steady_spending_raises_nothing():
    assert detect(txns(with_anomaly=False), TODAY) == []


def test_too_little_history_raises_nothing():
    assert detect(txns(months=1), TODAY) == []


# ---- month-end estimate

def test_estimate_uses_the_rest_of_earlier_months_and_gives_a_range():
    estimate = month_end_estimate(txns(), TODAY)
    assert estimate["confidence"] == "medium"
    assert estimate["low"] <= estimate["projected"] <= estimate["high"]
    assert estimate["projected"] > estimate["spentSoFar"]
    # Rent fell on the 3rd, so the second half of a month should add far less than rent.
    assert estimate["projected"] - estimate["spentSoFar"] < Decimal("10000")
    assert "not a guarantee" in estimate["disclaimer"]


def test_estimate_without_history_is_labelled_low_confidence():
    estimate = month_end_estimate(txns(months=1), TODAY)
    assert estimate["confidence"] == "low"
    assert "pace" in estimate["basis"]


def test_estimate_against_an_overall_budget():
    budget = Budget(budgetType="OVERALL", amount=Decimal("1000"), alertThresholdPct=80)
    assert month_end_estimate(txns(), TODAY, [budget])["overallBudget"]["projectedOver"] is True


# ---- budget suggestions

def test_suggestions_add_raise_and_lower():
    budgets = [
        Budget(budgetType="CATEGORY", category="Groceries", amount=Decimal("1000"), alertThresholdPct=80),       # far too low
        Budget(budgetType="CATEGORY", category="Food & Dining", amount=Decimal("20000"), alertThresholdPct=80),  # far too high
    ]
    by_category = {s["category"]: s for s in budget_suggestions(txns(), budgets, TODAY)}
    assert by_category["Groceries"]["action"] == "RAISE"
    assert by_category["Food & Dining"]["action"] == "LOWER"
    assert by_category["Transport"]["action"] == "ADD"
    assert by_category["Transport"]["suggestedAmount"] % 10 == 0


def test_insights_bundle_on_the_sample(post_signed):
    res = post_signed("/v1/insights", {"currency": "INR", "today": TODAY.isoformat(), "transactions": make_transactions(), "budgets": [], "goals": []})
    data = res.json()["data"]
    assert res.status_code == 200
    # Money crosses the wire as strings, never floats.
    assert isinstance(data["month"]["expense"], str) and isinstance(data["forecast"]["projected"], str)
    assert data["anomalies"][0]["amount"] == "5200.00"
    kinds = {card["kind"] for card in data["cards"]}
    assert {"ANOMALIES", "RECURRING", "SAVINGS_RATE"} <= kinds
    assert "not financial advice" in data["disclaimer"]


def test_this_month_period_label():
    assert this_month(TODAY).label.startswith("this month")
    assert FinancialData(currency="INR", today=TODAY).transactions == []
