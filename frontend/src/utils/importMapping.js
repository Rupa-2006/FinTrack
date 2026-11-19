// Turns the rows of a CSV file into transactions for the import API: which column is which,
// how dates are written, and how income is told apart from expenses.

export const FIELDS = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount' },
  { key: 'debit', label: 'Money out (debit)' },
  { key: 'credit', label: 'Money in (credit)' },
  { key: 'type', label: 'Type (income or expense)' },
  { key: 'category', label: 'Category' },
  { key: 'currency', label: 'Currency' },
  { key: 'paymentMethod', label: 'Payment method' },
  { key: 'notes', label: 'Notes' },
];

const GUESSES = {
  date: [/^date$/i, /transaction date/i, /value date/i, /posted/i, /date/i],
  description: [/^description$/i, /narration/i, /particulars/i, /details/i, /payee/i, /memo/i, /description/i],
  amount: [/^amount$/i, /^amount \(/i, /^value$/i],
  debit: [/debit|withdrawal|paid out|money out/i],
  credit: [/credit|deposit|paid in|money in/i],
  type: [/^type$/i, /dr\s*\/\s*cr/i, /direction/i],
  category: [/^category$/i, /category/i],
  currency: [/^currency$/i, /^ccy$/i],
  paymentMethod: [/payment method/i, /^method$/i, /^mode$/i],
  notes: [/^notes?$/i, /remarks/i],
};

// { date: 0, description: 3, ... } column indexes, -1 for "not in the file".
export function guessMapping(headers) {
  const mapping = {};
  const taken = new Set();
  for (const { key } of FIELDS) {
    mapping[key] = -1;
    for (const pattern of GUESSES[key]) {
      const index = headers.findIndex((h, i) => !taken.has(i) && pattern.test(h));
      if (index !== -1) {
        mapping[key] = index;
        taken.add(index);
        break;
      }
    }
  }
  return mapping;
}

export function guessTypeMode(mapping) {
  if (mapping.type !== -1) return 'column';
  if (mapping.debit !== -1 && mapping.credit !== -1) return 'debitCredit';
  return 'sign';
}

const DATE_PATTERN = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/;

// 'YMD' (2026-11-18), 'DMY' (18/11/2026) or 'MDY' (11/18/2026), from the values themselves.
export function guessDateFormat(values) {
  let dmy = false;
  let mdy = false;
  for (const value of values) {
    const m = DATE_PATTERN.exec(String(value).trim());
    if (!m) continue;
    if (m[1].length === 4) return 'YMD';
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  if (mdy && !dmy) return 'MDY';
  return 'DMY'; // also when it cannot be told apart: the user can change it
}

export function parseDate(value, format) {
  const m = DATE_PATTERN.exec(String(value ?? '').trim());
  if (!m) return String(value ?? '').trim(); // left for the server to reject with a clear message
  const [a, b, c] = [m[1], m[2], m[3]];
  const [year, month, day] = format === 'YMD' ? [a, b, c] : format === 'MDY' ? [c, a, b] : [c, b, a];
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// "₹ -1,234.50", "(1,234.50)", "1234.5 CR" -> { amount: "1234.50", negative: true/false }
export function parseAmount(value) {
  let text = String(value ?? '').trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/\bDR\b/i.test(text)) negative = true;
  text = text.replace(/\b(CR|DR)\b/gi, '').replace(/[^\d.,-]/g, '');
  if (text.startsWith('-')) negative = true;
  text = text.replace(/-/g, '');
  // Decimal comma ("12,50", "1.234,56"): the last separator is a comma followed by 1-2 digits.
  const decimalComma = /,\d{1,2}$/.test(text) && (text.lastIndexOf(',') > text.lastIndexOf('.'));
  text = decimalComma ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return { amount: text, negative };
}

// One API row per CSV row. `options`: { dateFormat, typeMode, defaultCurrency }.
export function toImportRows(rows, mapping, { dateFormat, typeMode, defaultCurrency }) {
  const cell = (row, key) => (mapping[key] === -1 ? '' : String(row[mapping[key]] ?? '').trim());
  return rows.map((row) => {
    let amount = '';
    let type = '';
    if (typeMode === 'debitCredit') {
      const out = parseAmount(cell(row, 'debit'));
      const into = parseAmount(cell(row, 'credit'));
      if (out && Number(out.amount) > 0) [amount, type] = [out.amount, 'EXPENSE'];
      else if (into) [amount, type] = [into.amount, 'INCOME'];
    } else {
      const parsed = parseAmount(cell(row, 'amount'));
      amount = parsed?.amount ?? cell(row, 'amount');
      if (typeMode === 'column') {
        const raw = cell(row, 'type').toLowerCase();
        type = /^(income|credit|cr|in|deposit)/.test(raw) ? 'INCOME' : /^(expense|debit|dr|out|withdrawal)/.test(raw) ? 'EXPENSE' : raw;
      } else if (typeMode === 'sign') {
        type = parsed?.negative ? 'EXPENSE' : 'INCOME';
      } else {
        type = typeMode; // 'EXPENSE' or 'INCOME' for every row
      }
    }
    return {
      date: parseDate(cell(row, 'date'), dateFormat),
      type,
      amount,
      currency: cell(row, 'currency') || defaultCurrency,
      description: cell(row, 'description'),
      category: cell(row, 'category'),
      paymentMethod: cell(row, 'paymentMethod').replace(/_/g, ' '),
      notes: cell(row, 'notes') || null,
    };
  });
}
