"""Unusual expenses, found two ways and always explained in plain words.

1. Robust z-score: how far an amount sits from the usual amount, measured in median absolute
   deviations (MAD). Unlike a mean and standard deviation, one huge outlier cannot hide
   itself by inflating the yardstick. "Usual" means, in order of preference:
     - earlier payments with the same description (your electricity bill against your
       electricity bills), when there are at least 3 of them
     - otherwise the whole category
   A category often mixes different things (a cheap music plan and a pricier cloud plan are
   both Subscriptions), so comparing like with like first avoids flagging normal bills.
   An expense must also be at least twice the usual amount: statistically odd but small
   differences are not worth anyone's attention.
2. Isolation Forest (iforest.py) over amount, category, weekday and day of month: catches
   combinations that are rare even when the amount alone is not extreme. Only used once
   there is enough history, and only for expenses above the usual size.

Statistics use floats; every amount shown to the user comes from the exact Decimal values.
These are flags for a person to look at, not accusations or certainties.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from statistics import median

import numpy as np

from ..schemas import Transaction
from .analysis import _normalise
from .iforest import IsolationForest

ROBUST_Z_THRESHOLD = 3.5      # Iglewicz and Hoaglin's usual cut-off
MIN_RATIO = 2.0               # and at least twice the usual amount
MIN_DESCRIPTION_SAMPLES = 3
MIN_CATEGORY_SAMPLES = 6
FOREST_MIN_SAMPLES = 40
FOREST_CONTAMINATION = 0.02
HISTORY_DAYS = 365
REPORT_DAYS = 60              # only recent expenses are worth raising


def _robust_z(value: float, values: list[float]) -> tuple[float, float]:
    """Returns (robust z, median)."""
    mid = median(values)
    mad = median([abs(v - mid) for v in values])
    if mad == 0:
        # Most amounts identical (e.g. a fixed fee): fall back to a scale of 10% of the median.
        mad = max(mid * 0.1, 1e-9)
    return 0.6745 * (value - mid) / mad, mid


def detect(transactions: list[Transaction], today: date) -> list[dict]:
    history = [t for t in transactions if t.type == "EXPENSE" and today - timedelta(days=HISTORY_DAYS) <= t.date <= today]
    recent_since = today - timedelta(days=REPORT_DAYS)

    by_category: dict[str, list[Transaction]] = defaultdict(list)
    by_description: dict[tuple[str, str], list[Transaction]] = defaultdict(list)
    for t in history:
        by_category[t.category].append(t)
        if _normalise(t.description):
            by_description[(t.category, _normalise(t.description))].append(t)

    def baseline(t: Transaction) -> tuple[list[float], str] | None:
        """The amounts to compare `t` with, and what to call them."""
        same = [float(o.amount) for o in by_description.get((t.category, _normalise(t.description)), []) if o.id != t.id]
        if len(same) >= MIN_DESCRIPTION_SAMPLES:
            return same, f"your usual \"{t.description}\" payment"
        peers = [float(o.amount) for o in by_category[t.category] if o.id != t.id]
        if len(peers) + 1 >= MIN_CATEGORY_SAMPLES:
            return peers, f"your typical {t.category} expense"
        return None

    findings: dict[int, dict] = {}
    usual: dict[int, float] = {}

    # 1. robust z-score against the best available baseline
    for t in history:
        if t.date < recent_since:
            continue
        base = baseline(t)
        if base is None:
            continue
        amounts, name = base
        z, mid = _robust_z(float(t.amount), amounts)
        usual[t.id] = mid
        if z >= ROBUST_Z_THRESHOLD and mid > 0 and float(t.amount) >= MIN_RATIO * mid:
            findings[t.id] = {
                "transaction": t,
                "typical": Decimal(str(round(mid, 2))),
                "score": round(z, 1),
                "methods": ["robust_z"],
                "reason": f"About {float(t.amount) / mid:.1f} times {name}.",
            }

    # 2. Isolation Forest across categories and timing
    if len(history) >= FOREST_MIN_SAMPLES:
        categories = sorted(by_category)
        features = np.array([
            [math.log1p(float(t.amount)), categories.index(t.category), t.date.weekday(), t.date.day]
            for t in history
        ])
        outliers, scores = IsolationForest(n_trees=200, contamination=FOREST_CONTAMINATION, seed=42).fit_predict(features)
        for t, is_outlier, score in zip(history, outliers, scores):
            if not is_outlier or t.date < recent_since:
                continue
            if t.id in findings:
                findings[t.id]["methods"].append("isolation_forest")
                continue
            mid = usual.get(t.id, median(float(o.amount) for o in by_category[t.category]))
            if float(t.amount) < 1.5 * mid:
                continue  # an ordinary amount for this kind of expense
            findings[t.id] = {
                "transaction": t,
                "typical": Decimal(str(round(mid, 2))),
                "score": round(float(score), 2),
                "methods": ["isolation_forest"],
                "reason": f"An unusual combination of amount, category ({t.category}) and timing compared with your history.",
            }

    ordered = sorted(findings.values(), key=lambda f: (len(f["methods"]), f["transaction"].amount), reverse=True)
    return [
        {
            "transactionId": f["transaction"].id,
            "date": f["transaction"].date,
            "description": f["transaction"].description,
            "category": f["transaction"].category,
            "amount": f["transaction"].amount,
            "typicalAmount": f["typical"],
            "methods": f["methods"],
            "score": f["score"],
            "reason": f["reason"],
        }
        for f in ordered[:10]
    ]
