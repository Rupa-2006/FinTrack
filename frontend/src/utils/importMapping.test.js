import { parseCsv } from './csv.js';
import { guessDateFormat, guessMapping, guessTypeMode, parseAmount, parseDate, toImportRows } from './importMapping.js';

describe('CSV reading', () => {
  test('quotes, doubled quotes, line breaks in quotes, CRLF and a byte-order mark', () => {
    const { headers, rows, separator } = parseCsv(`${String.fromCharCode(0xfeff)}"Date","Description"\r\n"2026-11-01","Dinner, ""Taj"""\r\n"2026-11-02","Two\nlines"\r\n\r\n`);
    expect(separator).toBe(',');
    expect(headers).toEqual(['Date', 'Description']);
    expect(rows).toEqual([['2026-11-01', 'Dinner, "Taj"'], ['2026-11-02', 'Two\nlines']]);
  });

  test('semicolon and tab separated files', () => {
    expect(parseCsv('Datum;Betrag\n01.11.2026;-12,50').rows).toEqual([['01.11.2026', '-12,50']]);
    expect(parseCsv('Date\tAmount\n2026-11-01\t5').rows).toEqual([['2026-11-01', '5']]);
  });
});

describe('mapping columns', () => {
  test("FinTrack's own export is recognised column by column", () => {
    const headers = ['Date', 'Type', 'Category', 'Description', 'Payment method', 'Amount', 'Currency', 'Exchange rate', 'Amount in main currency', 'Main currency', 'Recorded at'];
    const mapping = guessMapping(headers);
    expect(mapping).toMatchObject({ date: 0, type: 1, category: 2, description: 3, paymentMethod: 4, amount: 5, currency: 6, debit: -1, credit: -1 });
    expect(guessTypeMode(mapping)).toBe('column');
  });

  test('a bank statement with narration and debit / credit columns', () => {
    const mapping = guessMapping(['Txn Date', 'Narration', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']);
    expect(mapping).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, amount: -1 });
    expect(guessTypeMode(mapping)).toBe('debitCredit');
  });
});

describe('values', () => {
  test('date formats are told apart from the values', () => {
    expect(guessDateFormat(['2026-11-01'])).toBe('YMD');
    expect(guessDateFormat(['01/11/2026', '25/11/2026'])).toBe('DMY');
    expect(guessDateFormat(['11/01/2026', '11/25/2026'])).toBe('MDY');
    expect(parseDate('5/3/26', 'DMY')).toBe('2026-03-05');
    expect(parseDate('3/5/2026', 'MDY')).toBe('2026-03-05');
    expect(parseDate('18.11.2026', 'DMY')).toBe('2026-11-18');
  });

  test('amounts with symbols, separators, minus, brackets and DR/CR', () => {
    expect(parseAmount('₹ 1,234.50')).toEqual({ amount: '1234.50', negative: false });
    expect(parseAmount('-45')).toEqual({ amount: '45', negative: true });
    expect(parseAmount('(1,000.00)')).toEqual({ amount: '1000.00', negative: true });
    expect(parseAmount('250.00 DR')).toEqual({ amount: '250.00', negative: true });
    expect(parseAmount('-12,50')).toEqual({ amount: '12.50', negative: true }); // decimal comma
    expect(parseAmount('1.234,56 €')).toEqual({ amount: '1234.56', negative: false });
    expect(parseAmount('1,234')).toEqual({ amount: '1234', negative: false }); // thousands, not decimals
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  test('rows become API rows for each way of telling income from expenses', () => {
    const headers = ['Date', 'Narration', 'Debit', 'Credit', 'Amount', 'Type'];
    const rows = [['18/11/2026', 'Rent', '24,000.00', '', '-24000', 'Debit'], ['01/11/2026', 'Salary', '', '85,000.00', '85000', 'Credit']];
    const mapping = guessMapping(headers);
    const base = { dateFormat: 'DMY', defaultCurrency: 'INR' };
    expect(toImportRows(rows, mapping, { ...base, typeMode: 'debitCredit' }).map((r) => [r.type, r.amount, r.date])).toEqual([
      ['EXPENSE', '24000.00', '2026-11-18'], ['INCOME', '85000.00', '2026-11-01'],
    ]);
    expect(toImportRows(rows, mapping, { ...base, typeMode: 'sign' }).map((r) => r.type)).toEqual(['EXPENSE', 'INCOME']);
    expect(toImportRows(rows, mapping, { ...base, typeMode: 'column' }).map((r) => r.type)).toEqual(['EXPENSE', 'INCOME']);
    expect(toImportRows(rows, mapping, { ...base, typeMode: 'EXPENSE' }).map((r) => r.type)).toEqual(['EXPENSE', 'EXPENSE']);
    expect(toImportRows(rows, mapping, { ...base, typeMode: 'sign' })[0]).toMatchObject({ currency: 'INR', description: 'Rent', category: '' });
  });
});
