// Calendar helpers. Dates are plain "YYYY-MM-DD" strings and months are "YYYY-MM", handled
// in UTC so they never shift with the server's time zone.
const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 24 * 60 * 60 * 1000;

const toUtc = (date) => new Date(`${date}T00:00:00Z`);
const fromUtc = (d) => d.toISOString().slice(0, 10);

function today() {
  return fromUtc(new Date());
}

function currentMonth() {
  return today().slice(0, 7);
}

function addDays(date, days) {
  return fromUtc(new Date(toUtc(date).getTime() + days * DAY_MS));
}

// Whole days from `from` to `to` (negative if `to` is earlier).
function daysBetween(from, to) {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

function addMonths(month, count) {
  const [year, monthNumber] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// "2026-11" -> { start: "2026-11-01", end: "2026-11-30" }
function monthRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${pad(lastDay)}` };
}

function isRealDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = toUtc(date);
  return !Number.isNaN(d.getTime()) && fromUtc(d) === date;
}

module.exports = { today, currentMonth, addDays, daysBetween, addMonths, monthRange, isRealDate };
