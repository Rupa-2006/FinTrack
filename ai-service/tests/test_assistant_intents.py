"""Every answer the assistant can give, with figures checked by hand against the sample data.

Sample data (conftest.make_transactions, today 17 November 2026), October 2026 in full:
salary 85,000; rent 24,000; music streaming 649; groceries 1,500.50 + 1,525.50 + 1,550.50 +
1,575.50 = 6,152; lunch 380 + 390 + 400 + 410 = 1,580; cab rides 210 + 215 + 220 + 225 = 870.
Spending 33,251, net 51,749, savings rate 60.9%.
November so far: salary 85,000; rent 24,000; music 649; groceries 3,026; lunch 770;
cab rides 425 plus the planted airport limousine 5,200.
"""
from datetime import timedelta
from decimal import Decimal

from app.schemas import AskRequest, Budget, Goal
from app.services.assistant import EXAMPLES, answer
from tests.conftest import TODAY, make_transactions

ROWS = make_transactions()


def ask(question: str, **overrides) -> dict:
    data = {"currency": "INR", "today": TODAY, "transactions": ROWS, "budgets": [], "goals": [], "question": question}
    data.update(overrides)
    return answer(AskRequest(**data))


def budget(kind: str, amount: str, category: str | None = None, threshold: int = 80) -> Budget:
    return Budget(budgetType=kind, category=category, amount=Decimal(amount), alertThresholdPct=threshold)


def test_income_lists_its_sources():
    result = ask("How much income did I get this month?")
    assert result["intent"] == "income"
    assert result["answer"] == "Your income this month (November 2026, so far) was ₹85,000.00: Salary ₹85,000.00."


def test_net_for_a_named_month():
    result = ask("How much was left over in October after income and spending?")
    assert result["intent"] == "net"
    assert "income ₹85,000.00, spending ₹33,251.00, ₹51,749.00 left over" in result["answer"]
    assert [f["value"] for f in result["facts"]] == ["₹85,000.00", "₹33,251.00", "₹51,749.00"]


def test_savings_rate_for_a_named_month():
    result = ask("What was my savings rate in October?")
    assert "60.9%" in result["answer"] and "₹51,749.00 of ₹85,000.00" in result["answer"]


def test_savings_rate_without_income_says_so():
    expenses_only = [r for r in ROWS if r["type"] == "EXPENSE"]
    assert "no income recorded" in ask("What was my savings rate last month?", transactions=expenses_only)["answer"]


def test_top_categories_this_month():
    result = ask("Where does my money go?")
    assert result["intent"] == "top_categories"
    assert result["answer"].startswith("This month (November 2026, so far) your money went mostly to Rent & Housing (₹24,000.00")
    assert result["facts"][0]["label"] == "Rent & Housing"


def test_biggest_expense_this_month():
    result = ask("What was my biggest expense this month?")
    assert '"Monthly rent" (Rent & Housing), ₹24,000.00 on 2026-11-03' in result["answer"]
    assert [f["value"] for f in result["facts"]] == ["₹24,000.00", "₹5,200.00", "₹1,525.50"]


def test_periods_without_records_are_named_not_invented():
    assert ask("What was my biggest expense in January?")["answer"].startswith("No expenses recorded")
    assert ask("Where did my money go in January?")["answer"].startswith("No spending recorded")


def test_budget_status_over_close_and_within():
    budgets = [
        budget("CATEGORY", "1000", "Transport"),             # 5,625 spent: over
        budget("CATEGORY", "3200", "Groceries", 90),         # 3,026 spent, 95%: close
        budget("OVERALL", "100000"),                         # 34,070 spent: within
        budget("SAVINGS_TARGET", "20000"),                   # not a spending limit: ignored
    ]
    result = ask("Am I over budget?", budgets=budgets)
    assert result["intent"] == "budget"
    assert result["answer"] == "Over budget this month: Transport."
    assert [f["label"] for f in result["facts"]] == ["Transport", "Groceries", "All spending"]
    assert result["facts"][1]["value"] == "₹3,026.00 of ₹3,200.00 (95%)"

    close = ask("Am I over budget?", budgets=budgets[1:])
    assert close["answer"] == "Within budget so far, but close to the limit on Groceries."
    assert ask("Am I over budget?", budgets=budgets[2:])["answer"] == "You are within all your budgets so far this month."
    assert "no budgets" in ask("Am I over budget?")["answer"]


def test_forecast_compares_with_the_overall_budget():
    tight = ask("Will I stay within budget by the end of the month?", budgets=[budget("OVERALL", "30000")])
    loose = ask("Will I stay within budget by the end of the month?", budgets=[budget("OVERALL", "500000")])
    assert "above your overall budget of ₹30,000.00" in tight["answer"]
    assert "within your overall budget of ₹500,000.00" in loose["answer"]


def test_no_unusual_expenses():
    result = ask("Any unusual expenses?", transactions=make_transactions(with_anomaly=False))
    assert result["answer"].startswith("Nothing stands out")


def test_goals_only_counts_goals_in_progress():
    done = Goal(title="Laptop", targetAmount=Decimal("50000"), savedAmount=Decimal("50000"), currency="INR", status="COMPLETED")
    assert ask("How are my goals going?", goals=[done])["answer"] == "You have no savings goals in progress."
    open_ended = Goal(title="Rainy day", targetAmount=Decimal("100000"), savedAmount=Decimal("25000"), currency="INR", status="IN_PROGRESS")
    result = ask("How are my goals going?", goals=[done, open_ended])
    assert result["answer"] == "You have 1 goal in progress."
    assert result["facts"] == [{"label": "Rainy day", "value": "₹25,000.00 of ₹100,000.00 (25%)"}]


def test_goal_behind_schedule_is_said_plainly():
    goal = Goal(title="House deposit", targetAmount=Decimal("5000000"), savedAmount=Decimal("0"), currency="INR",
                deadline=TODAY + timedelta(days=60), status="IN_PROGRESS")
    assert "more than you have recently saved" in ask("How are my goals going?", goals=[goal])["answer"]


def test_regular_payments_are_rent_and_streaming_not_groceries():
    result = ask("What subscriptions do I pay for?")
    assert result["intent"] == "subscriptions"
    assert result["answer"] == "2 regular payments, about ₹24,649.00 a month together."
    assert [f["label"] for f in result["facts"]] == ["Monthly rent (Rent & Housing)", "Music streaming (Subscriptions)"]


def test_no_regular_payments_in_a_single_month():
    november = [r for r in ROWS if r["date"] >= "2026-11-01"]
    assert ask("What subscriptions do I pay for?", transactions=november)["answer"].startswith("I didn't find")


def test_tips_use_last_month_and_leave_fixed_costs_out():
    result = ask("How can I save more?")
    assert result["intent"] == "tips"
    assert "Groceries (₹6,152.00 in October 2026): trimming it by 10% would free about ₹615.20 a month" in result["answer"]
    assert "Rent" not in result["answer"].replace("such as rent", "")
    assert [f["label"] for f in result["facts"]] == ["Groceries", "Food & Dining", "Transport"]
    assert "not financial advice" in result["disclaimer"].lower() or "adviser" in result["disclaimer"].lower()


def test_tips_need_a_month_of_history():
    november = [r for r in ROWS if r["date"] >= "2026-11-01"]
    assert ask("How can I save more?", transactions=november)["answer"].startswith("I need at least a month")


def test_help_and_unknown_offer_examples():
    assert ask("help")["followUps"] == EXAMPLES
    unknown = ask("purple elephants")
    assert unknown["intent"] == "unknown" and unknown["followUps"] == EXAMPLES


def test_follow_ups_never_repeat_the_question():
    question = EXAMPLES[0]
    assert question not in ask(question)["followUps"]
