"""Exact money handling. Amounts stay Decimal; floats are used only for statistics."""
from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

SYMBOLS = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥"}
DECIMALS = {"JPY": 0}
ZERO = Decimal("0")
CENT = Decimal("0.01")


def to_str(amount: Decimal) -> str:
    """The API's wire format: a plain decimal string with 2 places."""
    return str(Decimal(amount).quantize(CENT, rounding=ROUND_HALF_UP))


def fmt(amount: Decimal, currency: str) -> str:
    """Display text, for example ₹1,234.50 or ¥1,235."""
    places = DECIMALS.get(currency, 2)
    value = Decimal(amount).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    sign = "-" if value < 0 else ""
    return f"{sign}{SYMBOLS.get(currency, currency + ' ')}{abs(value):,.{places}f}"


def percent(part: Decimal, whole: Decimal) -> float | None:
    if whole == 0:
        return None
    return float((Decimal(part) / Decimal(whole) * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def change_percent(current: Decimal, previous: Decimal) -> float | None:
    if previous == 0:
        return None
    return float(((Decimal(current) - Decimal(previous)) / abs(Decimal(previous)) * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def nice_round_up(amount: Decimal) -> Decimal:
    """Rounds a suggested budget up to a figure people actually set (e.g. 4,317 -> 4,400)."""
    value = Decimal(amount)
    if value <= 0:
        return ZERO
    step = Decimal(10) if value < 100 else Decimal(50) if value < 1_000 else Decimal(100) if value < 10_000 else Decimal(500)
    return (value / step).to_integral_value(rounding=ROUND_CEILING) * step
