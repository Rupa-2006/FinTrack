import { addDays, periodLabel, periodRange, shiftPeriod } from './dates.js';

describe('report periods', () => {
  test('ranges around an anchor date (weeks run Monday to Sunday)', () => {
    expect(periodRange('day', '2026-11-18')).toEqual({ from: '2026-11-18', to: '2026-11-18' });
    expect(periodRange('week', '2026-11-18')).toEqual({ from: '2026-11-16', to: '2026-11-22' }); // a Wednesday
    expect(periodRange('week', '2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22' }); // Sunday ends the week
    expect(periodRange('week', '2026-11-16')).toEqual({ from: '2026-11-16', to: '2026-11-22' }); // Monday starts it
    expect(periodRange('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('year', '2026-11-18')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  test('a week can span two years', () => {
    expect(periodRange('week', '2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });

  test('moving to the previous and next period', () => {
    expect(shiftPeriod('day', '2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftPeriod('week', '2026-11-18', 1)).toBe('2026-11-25');
    expect(shiftPeriod('month', '2026-01-31', 1)).toBe('2026-02-01'); // never skips February
    expect(shiftPeriod('year', '2026-11-18', -1)).toBe('2025-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  test('labels', () => {
    expect(periodLabel('day', '2026-11-18', { locale: 'en-GB' })).toBe('Wednesday, 18 November 2026');
    expect(periodLabel('week', '2026-11-18', { locale: 'en-GB' })).toBe('16 Nov – 22 Nov 2026');
    expect(periodLabel('month', '2026-11-18', { locale: 'en-GB' })).toBe('November 2026');
    expect(periodLabel('year', '2026-11-18')).toBe('2026');
  });
});
