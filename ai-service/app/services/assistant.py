"""Answers plain-language questions about the user's own records.

A rule-based engine, deliberately: it recognises what is being asked (the intent), which
period and which category, then computes the answer exactly from the data in the request.
Nothing is generated freely, so every number in an answer can be traced to the user's
entries, and a question can never make it reach data it was not given.

It does not give investment, tax, loan or insurance advice.
"""
from __future__ import annotations

import difflib
import re
from decimal import Decimal

from ..money import ZERO, change_percent, fmt
from ..schemas import AskRequest
from . import analysis
from .anomalies import detect
from .forecast import month_end_estimate
from .insights import goal_outlook
from .periods import Period, last_month, month_label, parse_period, this_month
from .suggestions import DISCRETIONARY

def when(period: Period) -> str:
    """"this month (...)" stays as it is; "September 2026" becomes "in September 2026"."""
    return period.label if re.match(r"(this|last|the|today|yesterday)\b", period.label) else f"in {period.label}"


def cap(text: str) -> str:
    """Capitalises the first letter only (str.capitalize would lower-case month names)."""
    return text[:1].upper() + text[1:]


NOT_ADVICE = "FinTrack is not a licensed financial adviser; this describes your own records, not a recommendation."

EXAMPLES = [
    "How much did I spend on food this month?",
    "Compare this month with last month",
    "Where does my money go?",
    "Will I stay within budget this month?",
    "Any unusual expenses?",
    "How am I doing on my savings goals?",
]

# Everyday words for the default categories. A user's own category names are matched first.
SYNONYMS = {
    "Food & Dining": ["eating out", "restaurants", "restaurant", "dining", "food", "lunch", "dinner", "coffee", "takeaway", "delivery"],
    "Groceries": ["groceries", "grocery", "supermarket"],
    "Rent & Housing": ["rent", "housing"],
    "Transport": ["transport", "commute", "cab", "cabs", "taxi", "uber", "metro", "bus", "fuel", "petrol"],
    "Shopping": ["shopping", "clothes", "shoes"],
    "Utilities & Bills": ["utilities", "bills", "electricity", "internet"],
    "Entertainment": ["entertainment", "movies", "movie", "games", "concerts"],
    "Health": ["health", "medical", "doctor", "pharmacy", "medicine", "gym"],
    "Education": ["education", "courses", "course", "books", "tuition"],
    "Travel": ["travel", "trips", "trip", "holiday", "vacation", "flights", "flight", "hotel"],
    "Subscriptions": ["subscriptions", "subscription", "streaming"],
    "Salary": ["salary", "wages", "paycheck"],
    "Freelance": ["freelance", "side jobs", "gigs"],
}

INTENTS = [
    ("out_of_scope", r"\b(invest\w*|stocks?|shares|crypto\w*|bitcoin|mutual funds?|loans?|mortgage|tax(es)?|insurance|trading)\b"),
    ("help", r"^\s*(help|hi|hello|hey)\b|what can (you|i)|example questions?"),
    ("anomalies", r"unusual|anomal\w*|suspicious|strange|\bodd\b|fraud|weird|out of the ordinary"),
    ("forecast", r"forecast|predict\w*|project\w*|end of (the )?month|month[- ]end|will i|on track|stay within"),
    ("goals", r"\bgoals?\b|saving (up )?(for|towards)|reach my"),
    ("subscriptions", r"recurring|regular payments?|subscriptions? (do|have|am)|what subscriptions"),
    ("budget", r"budgets?|over (my )?limit|\blimits?\b"),
    ("tips", r"how (can|could|do|should) i save|save more|cut (back|down)|spend less|reduce|\btips?\b|\badvice\b"),
    ("savings_rate", r"savings? rate|how much (did|have|do) i save|did i save|have i saved"),
    ("compare", r"compar\w*|\bvs\.?\b|versus|than last|difference|changed?"),
    ("biggest", r"biggest|largest|most expensive|highest|top expenses?"),
    ("top_categories", r"where (does|did|is|has) (all )?my money|break ?down|which categor\w*|top categor\w*|most on|spend the most"),
    # Net before income: "what was left over after income and spending" is about both.
    ("net", r"\bbalance\b|\bnet\b|left ?over|\bremaining\b|income (and|vs\.?|versus|minus|against) (my )?(spending|expenses?)"),
    ("income", r"\bincome\b|\bearn\w*|\bsalary\b|\bmade\b|\breceived?\b"),
    ("spending", r"\bspen[dt]\w*|\bexpens\w*|\bcosts?\b|\bpaid\b|\bpay\b|how much"),
]


def detect_intent(question: str) -> str:
    q = question.lower()
    for name, pattern in INTENTS:
        if re.search(pattern, q):
            return name
    return "unknown"


def find_category(question: str, categories: set[str]) -> str | None:
    """The category a question is about, or None."""
    q = f" {question.lower()} "
    for name in sorted(categories, key=len, reverse=True):
        if f" {name.lower()} " in q or name.lower() in q:
            return name
    words = []
    for name, synonyms in SYNONYMS.items():
        words += [(word, name) for word in synonyms]
    for word, name in sorted(words, key=lambda pair: -len(pair[0])):
        if re.search(rf"\b{re.escape(word)}\b", q) and (name in categories or not categories):
            return name
    # A small typo ("groceires") still finds the category.
    tokens = re.findall(r"[a-z&]+", q)
    for token in tokens:
        if len(token) >= 5:
            match = difflib.get_close_matches(token, [n.lower() for n in categories], n=1, cutoff=0.85)
            if match:
                return next(n for n in categories if n.lower() == match[0])
    return None


class Answerer:
    def __init__(self, request: AskRequest):
        self.r = request
        self.txns = request.transactions
        self.currency = request.currency
        self.categories = {t.category for t in self.txns}

    def money(self, amount: Decimal) -> str:
        return fmt(amount, self.currency)

    def respond(self, intent: str, answer: str, facts=None, period: Period | None = None, follow_ups=None, disclaimer=None) -> dict:
        return {
            "intent": intent,
            "answer": answer,
            "facts": facts or [],
            "period": period.as_dict() if period else None,
            "followUps": follow_ups or [e for e in EXAMPLES if e.lower() != self.r.question.lower()][:3],
            "disclaimer": disclaimer,
        }

    def answer(self) -> dict:
        question = self.r.question
        intent = detect_intent(question)
        if intent == "out_of_scope":
            return self.respond("out_of_scope",
                                "I can't help with investments, loans, tax or insurance: FinTrack is not a licensed financial adviser. "
                                "I can answer questions about your own spending, income, budgets and savings goals.",
                                disclaimer=NOT_ADVICE)
        if intent == "help":
            return self.respond("help", "Ask me about your own FinTrack records: spending by category or period, comparisons, "
                                "budgets, savings goals, unusual expenses and month-end estimates.", follow_ups=EXAMPLES)
        if not self.txns:
            return self.respond(intent, "You haven't recorded any transactions yet, so there is nothing to analyse. Add some income and expenses first.")

        category = find_category(question, self.categories)
        period = parse_period(question, self.r.today)
        if category and intent in {"spending", "top_categories", "biggest", "compare", "income", "unknown"}:
            return self.category_amount(category, period, compare=intent == "compare")

        handler = getattr(self, f"on_{intent}", None)
        if handler is None:
            return self.respond("unknown", "I'm not sure what you're asking. I can answer questions about your spending, income, "
                                "budgets, savings goals, unusual expenses and month-end estimates.", follow_ups=EXAMPLES)
        return handler(period)

    # ---- intents

    def category_amount(self, category: str, period: Period | None, compare: bool = False) -> dict:
        period = period or this_month(self.r.today)
        kind = "INCOME" if any(t.category == category and t.type == "INCOME" for t in self.txns) else "EXPENSE"
        items = [t for t in analysis.in_period(self.txns, period) if t.category == category and t.type == kind]
        total = sum((t.amount for t in items), ZERO)
        verb = "received" if kind == "INCOME" else "spent"
        joiner = "from" if kind == "INCOME" else "on"
        answer = f"You {verb} {self.money(total)} {joiner} {category} {when(period)}, across {len(items)} transaction{'s' if len(items) != 1 else ''}."
        facts = [{"label": f"{category}, {period.label}", "value": self.money(total)}]
        if compare or period.label.startswith("this month"):
            previous = analysis.previous_period(period, self.r.today)
            before = sum((t.amount for t in analysis.in_period(self.txns, previous) if t.category == category and t.type == kind), ZERO)
            change = change_percent(total, before)
            if change == 0:
                answer += f" That is the same as for {previous.label}."
            elif change is not None:
                answer += f" That is {abs(change):.0f}% {'more' if change > 0 else 'less'} than for {previous.label} ({self.money(before)})."
            facts.append({"label": cap(previous.label), "value": self.money(before)})
        if items:
            biggest = max(items, key=lambda t: t.amount)
            facts.append({"label": "Largest", "value": f"{biggest.description or category}: {self.money(biggest.amount)} on {biggest.date.isoformat()}"})
        return self.respond("category_spending", answer, facts, period)

    def on_spending(self, period: Period | None) -> dict:
        period = period or this_month(self.r.today)
        t = analysis.totals(self.txns, period)
        top = analysis.by_category(self.txns, period)[:3]
        answer = f"You spent {self.money(t.expense)} {when(period)} across {t.expense_count} expense{'s' if t.expense_count != 1 else ''}."
        if top:
            answer += " Most went to " + ", ".join(f"{row['category']} ({self.money(row['total'])})" for row in top) + "."
        return self.respond("spending", answer, [{"label": "Total spending", "value": self.money(t.expense)}], period)

    def on_income(self, period: Period | None) -> dict:
        period = period or this_month(self.r.today)
        t = analysis.totals(self.txns, period)
        sources = analysis.by_category(self.txns, period, "INCOME")
        answer = f"Your income {when(period)} was {self.money(t.income)}"
        answer += (": " + ", ".join(f"{row['category']} {self.money(row['total'])}" for row in sources) + ".") if sources else "."
        return self.respond("income", answer, [{"label": "Income", "value": self.money(t.income)}], period)

    def on_net(self, period: Period | None) -> dict:
        period = period or this_month(self.r.today)
        t = analysis.totals(self.txns, period)
        state = "left over" if t.net >= 0 else "more spent than earned"
        answer = f"{cap(when(period))}: income {self.money(t.income)}, spending {self.money(t.expense)}, {self.money(abs(t.net))} {state}."
        return self.respond("net", answer, [{"label": "Income", "value": self.money(t.income)}, {"label": "Spending", "value": self.money(t.expense)},
                                            {"label": "Net", "value": self.money(t.net)}], period)

    def on_savings_rate(self, period: Period | None) -> dict:
        period = period or last_month(self.r.today)
        t = analysis.totals(self.txns, period)
        if t.income == 0:
            return self.respond("savings_rate", f"There is no income recorded {when(period)}, so a savings rate can't be worked out.", period=period)
        answer = f"{cap(when(period))} you kept {t.savings_rate:.1f}% of your income: {self.money(t.net)} of {self.money(t.income)}."
        return self.respond("savings_rate", answer, [{"label": "Savings rate", "value": f"{t.savings_rate:.1f}%"}, {"label": "Saved", "value": self.money(t.net)}], period)

    def on_compare(self, period: Period | None) -> dict:
        # "this month with last month" names both; the current one is the subject.
        if period is None or re.search(r"\bthis month\b", self.r.question.lower()):
            period = this_month(self.r.today)
        current = period
        previous = analysis.previous_period(current, self.r.today)
        now, before = analysis.totals(self.txns, current), analysis.totals(self.txns, previous)
        change = change_percent(now.expense, before.expense)
        movers = [row for row in analysis.category_changes(self.txns, current, previous) if row["difference"] != 0][:3]
        answer = f"You spent {self.money(now.expense)} {when(current)}, against {self.money(before.expense)} for {previous.label}"
        answer += f" ({'+' if change > 0 else ''}{change:.0f}%)." if change is not None else "."
        if movers:
            answer += " Biggest changes: " + "; ".join(
                f"{row['category']} {'+' if row['difference'] > 0 else '-'}{self.money(abs(row['difference']))}" for row in movers) + "."
        facts = [{"label": cap(current.label), "value": self.money(now.expense)}, {"label": cap(previous.label), "value": self.money(before.expense)}]
        return self.respond("compare", answer, facts, current)

    def on_top_categories(self, period: Period | None) -> dict:
        period = period or this_month(self.r.today)
        rows = analysis.by_category(self.txns, period)
        if not rows:
            return self.respond("top_categories", f"No spending recorded {when(period)}.", period=period)
        answer = f"{cap(when(period))} your money went mostly to " + ", ".join(
            f"{row['category']} ({self.money(row['total'])}, {row['share']:.0f}%)" for row in rows[:3]) + "."
        return self.respond("top_categories", answer, [{"label": row["category"], "value": f"{self.money(row['total'])} ({row['share']:.0f}%)"} for row in rows[:6]], period)

    def on_biggest(self, period: Period | None) -> dict:
        period = period or this_month(self.r.today)
        items = sorted((t for t in analysis.in_period(self.txns, period) if t.type == "EXPENSE"), key=lambda t: -t.amount)[:3]
        if not items:
            return self.respond("biggest", f"No expenses recorded {when(period)}.", period=period)
        answer = f"Your largest expense {when(period)} was \"{items[0].description or items[0].category}\" ({items[0].category}), {self.money(items[0].amount)} on {items[0].date.isoformat()}."
        facts = [{"label": f"{t.description or t.category} ({t.date.isoformat()})", "value": self.money(t.amount)} for t in items]
        return self.respond("biggest", answer, facts, period)

    def on_budget(self, period: Period | None) -> dict:
        budgets = self.r.budgets
        if not budgets:
            return self.respond("budget", "You have no budgets for this month. Setting one for your biggest categories is a good way to start.")
        month = this_month(self.r.today)
        spent_by = {row["category"]: row["total"] for row in analysis.by_category(self.txns, month)}
        total_spent = analysis.totals(self.txns, month).expense
        facts, over, warn = [], [], []
        for b in budgets:
            if b.budgetType == "SAVINGS_TARGET":
                continue
            spent = total_spent if b.budgetType == "OVERALL" else spent_by.get(b.category, ZERO)
            name = "All spending" if b.budgetType == "OVERALL" else b.category
            used = float(spent / b.amount * 100)
            facts.append({"label": name, "value": f"{self.money(spent)} of {self.money(b.amount)} ({used:.0f}%)"})
            if spent > b.amount:
                over.append(name)
            elif used >= b.alertThresholdPct:
                warn.append(name)
        if over:
            answer = "Over budget this month: " + ", ".join(over) + "."
        elif warn:
            answer = "Within budget so far, but close to the limit on " + ", ".join(warn) + "."
        else:
            answer = "You are within all your budgets so far this month."
        return self.respond("budget", answer, facts, month)

    def on_forecast(self, period: Period | None) -> dict:
        e = month_end_estimate(self.txns, self.r.today, self.r.budgets)
        answer = (f"By the end of {e['month']} you would spend about {self.money(e['projected'])} "
                  f"(likely between {self.money(e['low'])} and {self.money(e['high'])}), based on {e['basis']}. "
                  f"So far: {self.money(e['spentSoFar'])}.")
        if e["overallBudget"]:
            answer += (" That is above your overall budget of " if e["overallBudget"]["projectedOver"] else " That stays within your overall budget of ") + self.money(e["overallBudget"]["amount"]) + "."
        facts = [{"label": "Estimate", "value": self.money(e["projected"])}, {"label": "Range", "value": f"{self.money(e['low'])} to {self.money(e['high'])}"},
                 {"label": "Confidence", "value": e["confidence"]}]
        return self.respond("forecast", answer, facts, this_month(self.r.today), disclaimer=e["disclaimer"])

    def on_anomalies(self, period: Period | None) -> dict:
        found = detect(self.txns, self.r.today)
        if not found:
            return self.respond("anomalies", "Nothing stands out: none of your expenses in the last 60 days is far from your usual amounts.")
        answer = f"{len(found)} expense{'s' if len(found) != 1 else ''} in the last 60 days look unusual. The most notable: \"{found[0]['description']}\" ({self.money(found[0]['amount'])}). {found[0]['reason']}"
        facts = [{"label": f"{a['description']} ({a['date'].isoformat()})", "value": f"{self.money(a['amount'])}, usually about {self.money(a['typicalAmount'])}"} for a in found[:5]]
        return self.respond("anomalies", answer, facts, disclaimer="Unusual does not mean wrong: these are entries worth a second look.")

    def on_goals(self, period: Period | None) -> dict:
        active = [g for g in self.r.goals if g.status == "IN_PROGRESS"]
        if not active:
            return self.respond("goals", "You have no savings goals in progress.")
        outlook = {o["title"]: o for o in goal_outlook(self.r)}
        facts, lines = [], []
        for g in active:
            share = float(g.savedAmount / g.targetAmount * 100)
            facts.append({"label": g.title, "value": f"{fmt(g.savedAmount, g.currency)} of {fmt(g.targetAmount, g.currency)} ({share:.0f}%)"})
            o = outlook.get(g.title)
            if o and o["neededPerMonth"] is not None:
                lines.append(f"\"{g.title}\" needs about {self.money(o['neededPerMonth'])} a month to meet its deadline"
                             + ("" if o["onTrack"] is None else (", which your recent saving covers" if o["onTrack"] else ", more than you have recently saved")))
        answer = f"You have {len(active)} goal{'s' if len(active) != 1 else ''} in progress. " + (". ".join(lines) + "." if lines else "")
        return self.respond("goals", answer.strip(), facts, disclaimer="Based on your recent saving; future months may differ.")

    def on_subscriptions(self, period: Period | None) -> dict:
        found = analysis.recurring_payments(self.txns, self.r.today)
        if not found:
            return self.respond("subscriptions", "I didn't find payments that repeat at a steady amount in at least three of the last six months.")
        total = sum((r["typicalAmount"] for r in found), ZERO)
        answer = f"{len(found)} regular payment{'s' if len(found) != 1 else ''}, about {self.money(total)} a month together."
        return self.respond("subscriptions", answer, [{"label": f"{r['description']} ({r['category']})", "value": self.money(r["typicalAmount"])} for r in found])

    def on_tips(self, period: Period | None) -> dict:
        current, previous = this_month(self.r.today), last_month(self.r.today)
        rows = [row for row in analysis.by_category(self.txns, previous) if row["category"] in DISCRETIONARY][:3]
        if not rows:
            return self.respond("tips", "I need at least a month of expenses to point to where you could cut back.", disclaimer=NOT_ADVICE)
        lines = [f"{row['category']} ({self.money(row['total'])} in {month_label(previous.start)}): trimming it by 10% would free about {self.money(row['total'] * Decimal('0.1'))} a month"
                 for row in rows]
        answer = "Your largest flexible categories: " + "; ".join(lines) + ". Fixed costs such as rent are left out."
        return self.respond("tips", answer, [{"label": row["category"], "value": self.money(row["total"])} for row in rows], previous, disclaimer=NOT_ADVICE)


def answer(request: AskRequest) -> dict:
    return Answerer(request).answer()
