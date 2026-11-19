"""End-of-month spending estimate.

Estimate = spent so far this month + what was typically spent in the *remaining days* of the
last three complete months. Looking at the same part of earlier months (not an average per
day) matters: rent and bills land early in a month, so a simple daily average would
overestimate the second half.

The range is the lowest and highest of those three months. It is an estimate from past
behaviour, never a promise.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from statistics import median

from ..money import ZERO
from ..schemas import Budget, Transaction
from .periods import complete_months_before, month_end, month_label, month_start

DISCLAIMER = "This is an estimate based on your past entries, not a guarantee. Actual spending can differ."


def _expense_between(transactions: list[Transaction], start: date, end: date) -> Decimal:
    return sum((t.amount for t in transactions if t.type == "EXPENSE" and start <= t.date <= end), ZERO)


def month_end_estimate(transactions: list[Transaction], today: date, budgets: list[Budget] | None = None) -> dict:
    start, end = month_start(today), month_end(today)
    spent = _expense_between(transactions, start, today)
    days_in_month = end.day
    remaining_share = (days_in_month - today.day) / days_in_month

    history = [p for p in complete_months_before(today, 3) if any(p.contains(t.date) for t in transactions)]
    if history:
        rest = []
        for p in history:
            # The same remaining part of that month, by position (day 18 of 30 ~ day 19 of 31).
            first_day = min(p.end.day, max(1, round(p.end.day * (1 - remaining_share)) + 1))
            rest.append(_expense_between(transactions, p.start.replace(day=first_day), p.end) if remaining_share > 0 else ZERO)
        expected_rest, low_rest, high_rest = Decimal(median(rest)), min(rest), max(rest)
        basis = f"what you spent in the same part of {', '.join(p.label for p in history)}"
        confidence = "medium" if len(history) == 3 else "low"
    else:
        # No earlier month: carry the current pace forward. Weak, and labelled so.
        daily = spent / today.day
        expected_rest = low_rest = high_rest = (daily * (days_in_month - today.day)).quantize(Decimal("0.01"))
        basis = "your spending pace so far this month (no earlier months to compare with)"
        confidence = "low"

    overall = next((b for b in budgets or [] if b.budgetType == "OVERALL"), None)
    estimate = {
        "month": month_label(today),
        "daysLeft": days_in_month - today.day,
        "spentSoFar": spent,
        "projected": spent + expected_rest,
        "low": spent + low_rest,
        "high": spent + high_rest,
        "basis": basis,
        "confidence": confidence,
        "disclaimer": DISCLAIMER,
        "overallBudget": None,
    }
    if overall:
        estimate["overallBudget"] = {"amount": overall.amount, "projectedOver": estimate["projected"] > overall.amount}
    return estimate
