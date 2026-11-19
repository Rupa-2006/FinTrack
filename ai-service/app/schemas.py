"""Request models. Everything the service knows arrives in one request and is validated here.

The API sends only the signed-in user's own records, already converted to their main
currency. Notes, phone numbers and account details are never sent.
Unknown fields are rejected so the contract with the API cannot drift silently.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Currency = Literal["INR", "USD", "EUR", "GBP", "JPY"]
Amount = Annotated[Decimal, Field(gt=0, max_digits=15, decimal_places=2)]
NonNegative = Annotated[Decimal, Field(ge=0, max_digits=15, decimal_places=2)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Transaction(Strict):
    id: int = Field(gt=0)
    date: date
    type: Literal["INCOME", "EXPENSE"]
    amount: Amount  # in the user's main currency
    category: str = Field(min_length=1, max_length=50)
    description: str = Field(default="", max_length=255)


class Budget(Strict):
    budgetType: Literal["CATEGORY", "OVERALL", "SAVINGS_TARGET"]
    category: str | None = Field(default=None, max_length=50)
    amount: Amount
    alertThresholdPct: int = Field(ge=1, le=100)


class Goal(Strict):
    title: str = Field(min_length=1, max_length=100)
    targetAmount: Amount
    savedAmount: NonNegative
    currency: Currency
    deadline: date | None = None
    status: Literal["IN_PROGRESS", "COMPLETED", "CANCELLED"]


class FinancialData(Strict):
    currency: Currency
    today: date
    transactions: list[Transaction] = Field(default_factory=list, max_length=20_000)
    budgets: list[Budget] = Field(default_factory=list, max_length=200)  # the current month's
    goals: list[Goal] = Field(default_factory=list, max_length=100)


class AskRequest(FinancialData):
    question: str = Field(min_length=1, max_length=500)
