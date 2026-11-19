"""Budget suggestions from the last three complete months of spending."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from ..money import ZERO, nice_round_up
from ..schemas import Budget, Transaction
from .analysis import monthly_category_totals, typical_monthly
from .periods import complete_months_before, month_key

# Categories people can usually adjust; fixed costs are left out of "save more" tips.
DISCRETIONARY = {"Food & Dining", "Shopping", "Entertainment", "Travel", "Subscriptions", "Groceries", "Transport"}


def budget_suggestions(transactions: list[Transaction], budgets: list[Budget], today: date) -> list[dict]:
    months = [month_key(p.start) for p in complete_months_before(today, 3)]
    per_category = monthly_category_totals(transactions)
    current = {b.category: b for b in budgets if b.budgetType == "CATEGORY" and b.category}
    suggestions = []
    for category, by_month in per_category.items():
        active_months = sum(1 for m in months if by_month.get(m, ZERO) > 0)
        if active_months < 2:
            continue
        typical = typical_monthly(by_month, months)
        suggested = nice_round_up(typical * Decimal("1.05"))  # a little headroom
        budget = current.get(category)
        if budget is None:
            action, why = "ADD", "You spend here most months but have no budget for it."
        elif budget.amount < typical * Decimal("0.85"):
            action, why = "RAISE", "Your budget is well below what you have typically spent; either raise it or plan specific cuts."
        elif budget.amount > typical * Decimal("1.5"):
            action, why = "LOWER", "Your budget is far above what you usually spend; a tighter one would free money for savings."
        else:
            continue
        suggestions.append({
            "category": category, "action": action, "typicalMonthly": typical, "suggestedAmount": suggested,
            "currentBudget": budget.amount if budget else None, "reason": why,
        })
    order = {"ADD": 0, "RAISE": 1, "LOWER": 2}
    return sorted(suggestions, key=lambda s: (order[s["action"]], -s["typicalMonthly"]))
