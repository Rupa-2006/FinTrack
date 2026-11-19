"""Insight cards for budgets, goals and savings rate, against the sample data (today is
17 November 2026, 17 of 30 days gone). November so far: Transport 5,625; Groceries 3,026;
Food & Dining 770. October: income 85,000, spending 33,251."""
from datetime import timedelta
from decimal import Decimal

from app.schemas import Budget, FinancialData, Goal
from app.services.insights import build
from tests.conftest import TODAY, make_transactions


def cards(**overrides) -> dict:
    data = {"currency": "INR", "today": TODAY, "transactions": make_transactions(), "budgets": [], "goals": []}
    data.update(overrides)
    return {card["id"]: card for card in build(FinancialData(**data))["cards"]}


def category_budget(category: str, amount: str) -> Budget:
    return Budget(budgetType="CATEGORY", category=category, amount=Decimal(amount), alertThresholdPct=80)


def test_budget_exceeded_and_at_risk_and_fine():
    found = cards(budgets=[category_budget("Transport", "5000"), category_budget("Food & Dining", "1000"), category_budget("Groceries", "10000")])
    assert found["BUDGET_OVER_Transport"]["tone"] == "alert"
    assert found["BUDGET_OVER_Transport"]["message"] == "₹5,625.00 spent against a budget of ₹5,000.00."
    assert found["BUDGET_PACE_Food & Dining"]["tone"] == "warning"  # 770 in 17 days is about 1,359 a month
    assert not any("Groceries" in key for key in found if key.startswith("BUDGET_"))


def test_overall_and_savings_budgets_do_not_make_category_cards():
    found = cards(budgets=[Budget(budgetType="OVERALL", amount=Decimal("1000"), alertThresholdPct=80),
                           Budget(budgetType="SAVINGS_TARGET", amount=Decimal("1000"), alertThresholdPct=80)])
    assert not any(key.startswith("BUDGET_") for key in found)
    assert "FORECAST_OVER" in found


def test_goal_within_reach_and_goal_behind():
    reachable = Goal(title="Bike", targetAmount=Decimal("30000"), savedAmount=Decimal("0"), currency="INR",
                     deadline=TODAY + timedelta(days=150), status="IN_PROGRESS")
    behind = Goal(title="House", targetAmount=Decimal("5000000"), savedAmount=Decimal("0"), currency="INR",
                  deadline=TODAY + timedelta(days=60), status="IN_PROGRESS")
    found = cards(goals=[reachable, behind])
    assert found["GOAL_Bike"]["tone"] == "positive"
    assert found["GOAL_House"]["tone"] == "warning"
    assert "a month to meet its deadline" in found["GOAL_House"]["message"]


def test_goals_in_another_currency_are_not_judged():
    euro = Goal(title="Paris", targetAmount=Decimal("3000"), savedAmount=Decimal("0"), currency="EUR",
                deadline=TODAY + timedelta(days=60), status="IN_PROGRESS")
    assert "GOAL_Paris" not in cards(goals=[euro])


def with_october_extra(amount: str) -> list[dict]:
    rows = make_transactions()
    rows.append({"id": 99_999, "date": "2026-10-20", "type": "EXPENSE", "amount": amount, "category": "Shopping", "description": "Sofa"})
    return rows


def test_savings_rate_good_low_and_negative():
    assert cards()["SAVINGS_RATE"]["title"] == "Good savings in October 2026"  # 60.9%
    low = cards(transactions=with_october_extra("47499.00"))["SAVINGS_RATE"]  # 85,000 - 80,750 = 5%
    assert low["tone"] == "warning" and low["message"].startswith("You kept 5%")
    negative = cards(transactions=with_october_extra("100000.00"))["SAVINGS_RATE"]
    assert negative["tone"] == "alert"
    assert negative["message"] == "Expenses exceeded income by ₹48,251.00."
