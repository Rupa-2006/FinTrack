import { saveBlob } from './download.js';

test('saves through a temporary link and releases the object URL', () => {
  const blob = new Blob(['date,amount\n'], { type: 'text/csv' });
  URL.createObjectURL = vi.fn(() => 'blob:fintrack/1');
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function check() {
    expect(this.href).toBe('blob:fintrack/1');
    expect(this.download).toBe('fintrack-2026-11.csv');
    expect(document.body.contains(this)).toBe(true);
  });
  saveBlob(blob, 'fintrack-2026-11.csv');
  expect(click).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fintrack/1');
  expect(document.querySelector('a[download]')).toBeNull();
});
