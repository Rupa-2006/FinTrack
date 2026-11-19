"""Calendar periods and understanding period words in questions."""
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta

MONTHS = {name.lower(): number for number, name in enumerate(calendar.month_name) if name}
MONTHS.update({name.lower(): number for number, name in enumerate(calendar.month_abbr) if name})
MONTHS["sept"] = 9


@dataclass(frozen=True)
class Period:
    start: date
    end: date  # inclusive
    label: str

    def contains(self, day: date) -> bool:
        return self.start <= day <= self.end

    def as_dict(self) -> dict:
        return {"from": self.start.isoformat(), "to": self.end.isoformat(), "label": self.label}


def month_start(day: date) -> date:
    return day.replace(day=1)


def month_end(day: date) -> date:
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


def add_months(day: date, count: int) -> date:
    """First day of the month `count` months from `day`'s month."""
    index = day.year * 12 + day.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def month_key(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def month_label(day: date) -> str:
    return f"{calendar.month_name[day.month]} {day.year}"


def this_month(today: date) -> Period:
    return Period(month_start(today), today, f"this month ({month_label(today)}, so far)")


def last_month(today: date) -> Period:
    start = add_months(today, -1)
    return Period(start, month_end(start), f"last month ({month_label(start)})")


def complete_months_before(today: date, count: int) -> list[Period]:
    """The `count` calendar months before the current one, oldest first."""
    periods = []
    for back in range(count, 0, -1):
        start = add_months(today, -back)
        periods.append(Period(start, month_end(start), month_label(start)))
    return periods


def parse_period(text: str, today: date) -> Period | None:
    """Finds a time period in a question, or None if it names none."""
    q = text.lower()
    if re.search(r"\btoday\b", q):
        return Period(today, today, "today")
    if re.search(r"\byesterday\b", q):
        day = today - timedelta(days=1)
        return Period(day, day, "yesterday")
    if re.search(r"\bthis week\b", q):
        start = today - timedelta(days=today.weekday())
        return Period(start, today, "this week")
    if re.search(r"\blast week\b", q):
        start = today - timedelta(days=today.weekday() + 7)
        return Period(start, start + timedelta(days=6), "last week")
    if match := re.search(r"\b(?:last|past|previous)\s+(\d{1,2}|two|three|six|twelve)\s+months?\b", q):
        words = {"two": 2, "three": 3, "six": 6, "twelve": 12}
        count = max(1, min(24, int(words.get(match.group(1), match.group(1)))))
        start = add_months(today, -(count - 1))
        return Period(start, today, f"the last {count} months")
    if re.search(r"\b(?:last|previous) month\b", q):
        return last_month(today)
    if re.search(r"\bthis month\b|\bso far\b|\bcurrent month\b", q):
        return this_month(today)
    if re.search(r"\b(?:last|previous) year\b", q):
        return Period(date(today.year - 1, 1, 1), date(today.year - 1, 12, 31), f"last year ({today.year - 1})")
    if re.search(r"\bthis year\b|\byear to date\b|\bytd\b", q):
        return Period(date(today.year, 1, 1), today, f"this year ({today.year}, so far)")
    month_names = "|".join(sorted(MONTHS, key=len, reverse=True))
    if match := re.search(rf"\b({month_names})\b(?:\s+(\d{{4}}))?", q):
        number = MONTHS[match.group(1)]
        year = int(match.group(2)) if match.group(2) else (today.year if number <= today.month else today.year - 1)
        start = date(year, number, 1)
        end = min(month_end(start), today) if (year, number) == (today.year, today.month) else month_end(start)
        return Period(start, end, month_label(start))
    return None
