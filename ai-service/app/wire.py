"""Converts results to JSON-ready values: Decimal -> "123.45" (never a float), date -> ISO."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from .money import to_str


def wire(value):
    if isinstance(value, Decimal):
        return to_str(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: wire(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [wire(item) for item in value]
    return value
