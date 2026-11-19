"""The insights bundle: short findings in plain words, plus the unusual expenses, the
month-end estimate, budget suggestions and recurring payments behind them."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from ..money import ZERO, change_percent, fmt, percent
from ..schemas import FinancialData
from . import analysis
from .anomalies import detect
from .forecast import month_end_estimate
from .periods import complete_months_before, month_end, month_key, this_month
from .suggestions import budget_suggestions

DISCLAIMER = (
    "Insights are calculated from the records you entered in FinTrack. They describe your past spending and are "
    "not financial advice; estimates are not guarantees."
)


def _card(kind: str, tone: str, title: str, message: str) -> dict:
    return {"id": kind, "kind": kind, "tone": tone, "title": title, "message": message}


def _monthly_net(data: FinancialData) -> Decimal | None:
    """Median net saving over the last three complete months that have entries."""
    nets = []
    for p in complete_months_before(data.today, 3):
        t = analysis.totals(data.transactions, p)
        if t.income_count or t.expense_count:
            nets.append(t.net)
    if not nets:
        return None
    nets.sort()
    return nets[len(nets) // 2]


def goal_outlook(data: FinancialData) -> list[dict]:
    pace = _monthly_net(data)
    outlook = []
    for goal in data.goals:
        if goal.status != "IN_PROGRESS" or goal.currency != data.currency:
            continue  # goals kept in another currency are not compared with main-currency savings
        remaining = max(goal.targetAmount - goal.savedAmount, ZERO)
        item = {"title": goal.title, "remaining": remaining, "deadline": goal.deadline, "neededPerMonth": None, "onTrack": None, "recentMonthlySaving": pace}
        if goal.deadline and goal.deadline > data.today:
            months_left = max(1, (goal.deadline.year - data.today.year) * 12 + goal.deadline.month - data.today.month)
            item["neededPerMonth"] = (remaining / months_left).quantize(Decimal("0.01"))
            if pace is not None:
                item["onTrack"] = pace >= item["neededPerMonth"]
        outlook.append(item)
    return outlook


def build(data: FinancialData) -> dict:
    today, currency, txns = data.today, data.currency, data.transactions
    money = lambda amount: fmt(amount, currency)  # noqa: E731
    month = this_month(today)
    previous = analysis.same_days_last_month(month)
    now, before = analysis.totals(txns, month), analysis.totals(txns, previous)

    anomalies = detect(txns, today)
    estimate = month_end_estimate(txns, today, data.budgets)
    suggestions = budget_suggestions(txns, data.budgets, today)
    recurring = analysis.recurring_payments(txns, today)
    goals = goal_outlook(data)
    cards: list[dict] = []

    if not txns:
        cards.append(_card("GET_STARTED", "neutral", "Nothing to analyse yet", "Add a few weeks of income and expenses and insights will appear here."))

    # Spending pace against the same days of last month
    change = change_percent(now.expense, before.expense)
    if change is not None and abs(change) >= 10:
        more = change > 0
        cards.append(_card(
            "SPENDING_PACE", "warning" if more else "positive",
            f"Spending is {'up' if more else 'down'} {abs(change):.0f}% on last month",
            f"You have spent {money(now.expense)} so far this month, against {money(before.expense)} by the same day last month.",
        ))

    # Categories already past a typical whole month
    months = [month_key(p.start) for p in complete_months_before(today, 3)]
    per_category = analysis.monthly_category_totals(txns)
    this_month_by_category = {row["category"]: row["total"] for row in analysis.by_category(txns, month)}
    for category, spent in sorted(this_month_by_category.items(), key=lambda item: -item[1]):
        typical = analysis.typical_monthly(per_category.get(category, {}), months)
        if typical > 0 and spent >= typical * Decimal("1.1") and today.day < month_end(today).day:
            cards.append(_card(
                f"CATEGORY_SPIKE_{category}", "warning", f"{category} is above a normal month already",
                f"{money(spent)} so far, while a typical month is about {money(typical)} ({percent(spent, typical):.0f}%).",
            ))
            break

    # Budgets on course to be exceeded at the current pace
    elapsed = today.day / month_end(today).day
    for budget in data.budgets:
        if budget.budgetType != "CATEGORY" or not budget.category:
            continue
        spent = this_month_by_category.get(budget.category, ZERO)
        if spent > budget.amount:
            cards.append(_card(f"BUDGET_OVER_{budget.category}", "alert", f"{budget.category} budget exceeded",
                               f"{money(spent)} spent against a budget of {money(budget.amount)}."))
        elif elapsed < 0.9 and spent / Decimal(str(elapsed)) > budget.amount * Decimal("1.1"):
            cards.append(_card(f"BUDGET_PACE_{budget.category}", "warning", f"{budget.category} budget at risk",
                               f"At the current pace you would spend about {money(spent / Decimal(str(elapsed)))} this month, over the {money(budget.amount)} budget."))

    if estimate["overallBudget"] and estimate["overallBudget"]["projectedOver"]:
        cards.append(_card("FORECAST_OVER", "warning", "Month-end estimate is over your overall budget",
                           f"Estimated spending is about {money(estimate['projected'])} against {money(estimate['overallBudget']['amount'])}. This is an estimate, not a certainty."))

    # Last complete month's savings rate
    last = complete_months_before(today, 1)[0]
    last_totals = analysis.totals(txns, last)
    if last_totals.income > 0:
        rate = last_totals.savings_rate
        if rate < 0:
            cards.append(_card("SAVINGS_RATE", "alert", f"You spent more than you earned in {last.label}", f"Expenses exceeded income by {money(-last_totals.net)}."))
        elif rate < 10:
            cards.append(_card("SAVINGS_RATE", "warning", f"Low savings in {last.label}", f"You kept {rate:.0f}% of your income ({money(last_totals.net)})."))
        elif rate >= 20:
            cards.append(_card("SAVINGS_RATE", "positive", f"Good savings in {last.label}", f"You kept {rate:.0f}% of your income ({money(last_totals.net)})."))

    for goal in goals:
        if goal["onTrack"] is False:
            cards.append(_card(f"GOAL_{goal['title']}", "warning", f"\"{goal['title']}\" needs a faster pace",
                               f"It needs about {money(goal['neededPerMonth'])} a month to meet its deadline; you have recently saved about {money(goal['recentMonthlySaving'])} a month overall."))
        elif goal["onTrack"] is True:
            cards.append(_card(f"GOAL_{goal['title']}", "positive", f"\"{goal['title']}\" is within reach",
                               f"It needs about {money(goal['neededPerMonth'])} a month, and you have recently saved about {money(goal['recentMonthlySaving'])} a month overall."))

    if recurring:
        total = sum((r["typicalAmount"] for r in recurring), ZERO)
        cards.append(_card("RECURRING", "neutral", f"{len(recurring)} regular payment{'s' if len(recurring) != 1 else ''} found",
                           f"Together about {money(total)} a month, for example {recurring[0]['description']} ({money(recurring[0]['typicalAmount'])})."))

    if anomalies:
        cards.append(_card("ANOMALIES", "warning", f"{len(anomalies)} unusual expense{'s' if len(anomalies) != 1 else ''} to check",
                           f"The largest is \"{anomalies[0]['description']}\" ({money(anomalies[0]['amount'])}). {anomalies[0]['reason']}"))

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "currency": currency,
        "month": {"income": now.income, "expense": now.expense, "net": now.net, "savingsRate": now.savings_rate,
                  "expenseChange": change, "comparedWith": previous.as_dict()},
        "cards": cards,
        "anomalies": anomalies,
        "forecast": estimate,
        "budgetSuggestions": suggestions,
        "recurring": recurring,
        "goals": goals,
        "disclaimer": DISCLAIMER,
    }
