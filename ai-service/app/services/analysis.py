"""Exact aggregates over a user's transactions (Decimal arithmetic throughout)."""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from statistics import median

from ..money import ZERO, change_percent, percent
from ..schemas import Transaction
from .periods import Period, add_months, month_end, month_key, month_label, month_start


@dataclass(frozen=True)
class Totals:
    income: Decimal
    expense: Decimal
    income_count: int
    expense_count: int

    @property
    def net(self) -> Decimal:
        return self.income - self.expense

    @property
    def savings_rate(self) -> float | None:
        return percent(self.net, self.income) if self.income > 0 else None


def in_period(transactions: list[Transaction], period: Period) -> list[Transaction]:
    return [t for t in transactions if period.contains(t.date)]


def totals(transactions: list[Transaction], period: Period) -> Totals:
    income = expense = ZERO
    income_count = expense_count = 0
    for t in in_period(transactions, period):
        if t.type == "INCOME":
            income += t.amount
            income_count += 1
        else:
            expense += t.amount
            expense_count += 1
    return Totals(income, expense, income_count, expense_count)


def by_category(transactions: list[Transaction], period: Period, kind: str = "EXPENSE") -> list[dict]:
    sums: dict[str, Decimal] = defaultdict(lambda: ZERO)
    counts: dict[str, int] = defaultdict(int)
    for t in in_period(transactions, period):
        if t.type == kind:
            sums[t.category] += t.amount
            counts[t.category] += 1
    total = sum(sums.values(), ZERO)
    rows = [{"category": c, "total": s, "count": counts[c], "share": percent(s, total) or 0.0} for c, s in sums.items()]
    return sorted(rows, key=lambda row: (-row["total"], row["category"]))


def monthly_category_totals(transactions: list[Transaction], kind: str = "EXPENSE") -> dict[str, dict[str, Decimal]]:
    """{category: {"2026-10": total, ...}}"""
    result: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: ZERO))
    for t in transactions:
        if t.type == kind:
            result[t.category][month_key(t.date)] += t.amount
    return result


def typical_monthly(totals_by_month: dict[str, Decimal], months: list[str]) -> Decimal:
    """Median monthly amount over the given months (a month with nothing counts as zero)."""
    values = [totals_by_month.get(m, ZERO) for m in months]
    return Decimal(median(values)) if values else ZERO


def compare(current: Totals, previous: Totals) -> dict:
    return {
        "income": change_percent(current.income, previous.income),
        "expense": change_percent(current.expense, previous.expense),
    }


def category_changes(transactions: list[Transaction], current: Period, previous: Period) -> list[dict]:
    """Per expense category: this period against the previous one, biggest moves first."""
    now = {row["category"]: row["total"] for row in by_category(transactions, current)}
    before = {row["category"]: row["total"] for row in by_category(transactions, previous)}
    rows = []
    for category in set(now) | set(before):
        a, b = now.get(category, ZERO), before.get(category, ZERO)
        rows.append({"category": category, "current": a, "previous": b, "difference": a - b, "change": change_percent(a, b)})
    return sorted(rows, key=lambda row: -abs(row["difference"]))


def previous_period(period: Period, today) -> Period:
    """What a period is compared with: the same days of last month while the current month is
    still running, otherwise the whole previous month."""
    if period.start == month_start(today) and period.end >= today:
        return same_days_last_month(period)
    start = add_months(period.start, -1)
    return Period(start, month_end(start), month_label(start))


def same_days_last_month(period: Period) -> Period:
    """The matching days of the previous month (1st..same day), for fair month-to-date comparison."""
    start = add_months(period.start, -1)
    end = start.replace(day=min(period.end.day, month_end(start).day))
    return Period(start, end, "the same days last month")


_NOISE = re.compile(r"[^a-z ]+")


def _normalise(description: str) -> str:
    return " ".join(_NOISE.sub(" ", description.lower()).split())


def recurring_payments(transactions: list[Transaction], today, months: int = 6) -> list[dict]:
    """Monthly payments: the same description in at least 3 different recent months, about
    once a month, at a steady amount (every payment within 15% of the median). That is
    subscriptions, rent and bills, not weekly shopping."""
    since = add_months(today, -months)
    groups: dict[tuple[str, str], list[Transaction]] = defaultdict(list)
    for t in transactions:
        if t.type == "EXPENSE" and t.date >= since and t.description.strip():
            groups[(_normalise(t.description), t.category)].append(t)
    found = []
    for (key, category), items in groups.items():
        months_seen = len({month_key(t.date) for t in items})
        if not key or months_seen < 3 or len(items) > months_seen * 1.5:
            continue
        amounts = [t.amount for t in items]
        mid = Decimal(median(amounts))
        if mid <= 0 or any(abs(a - mid) > mid * Decimal("0.15") for a in amounts):
            continue
        latest = max(items, key=lambda t: t.date)
        found.append({"description": latest.description, "category": category, "typicalAmount": mid, "occurrences": len(items), "lastDate": latest.date})
    return sorted(found, key=lambda row: -row["typicalAmount"])
