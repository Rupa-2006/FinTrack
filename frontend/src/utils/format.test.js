import { cn } from './cn.js';
import { formatDate, formatMoney, formatPercent, initials } from './format.js';

describe('formatMoney', () => {
  test('formats decimal strings per currency and locale', () => {
    expect(formatMoney('1234.50', 'USD', { locale: 'en-US' })).toBe('$1,234.50');
    expect(formatMoney('137648.39', 'INR', { locale: 'en-IN' })).toBe('₹1,37,648.39');
    expect(formatMoney('1500', 'JPY', { locale: 'en-US' })).toBe('¥1,500');
    expect(formatMoney('99.9', 'EUR', { locale: 'en-IE' })).toBe('€99.90');
  });

  test('keeps full precision for amounts a float cannot represent', () => {
    expect(formatMoney('9007199254740993.25', 'USD', { locale: 'en-US' })).toBe('$9,007,199,254,740,993.25');
    expect(formatMoney('0.10', 'USD', { locale: 'en-US' })).toBe('$0.10');
  });

  test('shows an explicit sign when asked', () => {
    expect(formatMoney('250.00', 'USD', { locale: 'en-US', signed: true })).toBe('+$250.00');
    expect(formatMoney('-250.00', 'USD', { locale: 'en-US', signed: true })).toBe('-$250.00');
  });

  test.each([null, undefined, '', 'abc', '12abc', '1,234.50'])('returns a dash for %p instead of NaN', (value) => {
    expect(formatMoney(value, 'USD')).toBe('—');
  });
});

describe('other formatters', () => {
  test('formatDate treats the value as a calendar date', () => {
    expect(formatDate('2026-11-16', { locale: 'en-GB' })).toBe('16 Nov 2026');
    expect(formatDate('2026-01-01 00:00:00.000', { locale: 'en-GB' })).toBe('1 Jan 2026');
    expect(formatDate('not a date')).toBe('—');
    expect(formatDate(null)).toBe('—');
  });

  test('formatPercent and initials', () => {
    expect(formatPercent(72)).toBe('72%');
    expect(formatPercent('91.456', 1)).toBe('91.5%');
    expect(formatPercent('x')).toBe('—');
    expect(initials('Aarav Sharma')).toBe('AS');
    expect(initials('  emma   louise wilson ')).toBe('EW');
    expect(initials('Cher')).toBe('C');
    expect(initials('')).toBe('?');
  });

  test('cn joins truthy class names', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });
});
