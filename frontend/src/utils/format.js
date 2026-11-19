// Display formatting. Amounts arrive from the API as decimal strings ("1234.50") and are
// passed to Intl as strings, so nothing is ever rounded through a JavaScript float.

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function formatMoney(amount, currency = 'INR', { locale, signed = false } = {}) {
  const value = String(amount ?? '').trim();
  if (!DECIMAL_PATTERN.test(value)) return '—';
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    signDisplay: signed ? 'exceptZero' : 'auto',
  });
  return formatter.format(value);
}

export function formatPercent(value, fractionDigits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number.toFixed(fractionDigits)}%`;
}

// "2026-11-16" -> "16 Nov 2026". Parsed as a calendar date, not a UTC instant, so the day
// never shifts with the viewer's time zone.
export function formatDate(isoDate, { locale, month = 'short' } = {}) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? ''));
  if (!match) return '—';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month, year: 'numeric' }).format(date);
}

export function initials(fullName) {
  const words = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}
