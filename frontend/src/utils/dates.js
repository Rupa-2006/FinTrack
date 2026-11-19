// Calendar helpers for the viewer's own (local) date. Dates are "YYYY-MM-DD", months "YYYY-MM".
const pad = (n) => String(n).padStart(2, '0');

export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function currentMonth(now = new Date()) {
  return todayIso(now).slice(0, 7);
}

export function addMonths(month, count) {
  const [year, monthNumber] = month.split('-').map(Number);
  const d = new Date(year, monthNumber - 1 + count, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// "2026-11" -> { from: "2026-11-01", to: "2026-11-30" }
export function monthRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return { from: `${month}-01`, to: `${month}-${pad(new Date(year, monthNumber, 0).getDate())}` };
}

// "2026-11" -> "November 2026" ("Nov 26" when short)
export function monthLabel(month, { short = false, locale } = {}) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month ?? ''));
  if (!match) return '—';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return new Intl.DateTimeFormat(locale, short ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' }).format(date);
}

// ---- report periods: "day", "week" (Monday to Sunday), "month", "year" around an anchor date

const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function addDays(iso, count) {
  const d = parse(iso);
  d.setDate(d.getDate() + count);
  return todayIso(d);
}

// Inclusive date range of the period that contains `anchor`.
export function periodRange(view, anchor) {
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') {
    const offset = (parse(anchor).getDay() + 6) % 7; // days since Monday
    const from = addDays(anchor, -offset);
    return { from, to: addDays(from, 6) };
  }
  if (view === 'year') return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
  return monthRange(anchor.slice(0, 7));
}

// The anchor of the previous (-1) or next (+1) period. Months and years keep day 1, so a
// 31st never skips a shorter month.
export function shiftPeriod(view, anchor, step) {
  if (view === 'day') return addDays(anchor, step);
  if (view === 'week') return addDays(anchor, 7 * step);
  if (view === 'year') return `${Number(anchor.slice(0, 4)) + step}-01-01`;
  return `${addMonths(anchor.slice(0, 7), step)}-01`;
}

export function periodLabel(view, anchor, { locale } = {}) {
  const format = (iso, options) => new Intl.DateTimeFormat(locale, options).format(parse(iso));
  if (view === 'day') return format(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'week') {
    const { from, to } = periodRange('week', anchor);
    return `${format(from, { day: 'numeric', month: 'short' })} – ${format(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  if (view === 'year') return anchor.slice(0, 4);
  return monthLabel(anchor.slice(0, 7), { locale });
}
