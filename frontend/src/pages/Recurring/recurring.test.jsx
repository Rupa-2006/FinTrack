// The Recurring transactions page with the API mocked.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as ledger from '../../services/ledgerService.js';
import { renderApp, TEST_USER } from '../../test/renderApp.jsx';
import { todayIso } from '../../utils/dates.js';

vi.mock('../../services/healthService.js', () => ({ getReadiness: vi.fn().mockResolvedValue({ status: 'ready' }) }));
vi.mock('../../services/authService.js', () => ({ logout: vi.fn().mockResolvedValue(), refreshSession: vi.fn() }));
vi.mock('../../services/ledgerService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn()]));
});

const findInputs = { selector: 'input, select' };
const CATEGORIES = [
  { id: 1, name: 'Salary', type: 'INCOME' },
  { id: 3, name: 'Rent & Housing', type: 'EXPENSE' },
  { id: 8, name: 'Subscriptions', type: 'EXPENSE' },
];
const RULE = {
  id: 4, type: 'EXPENSE', amount: '24000.00', currency: 'INR', description: 'Monthly rent', paymentMethod: 'BANK_TRANSFER',
  frequency: 'MONTHLY', startDate: '2026-01-31', endDate: null, nextDate: '2026-11-30', status: 'ACTIVE',
  category: { id: 3, name: 'Rent & Housing' }, generatedCount: 10, lastGeneratedDate: '2026-10-31',
};

beforeEach(() => {
  vi.clearAllMocks();
  ledger.getUnreadCount.mockResolvedValue(0);
  ledger.listCategories.mockResolvedValue(CATEGORIES);
});

test('lists rules with their schedule, next date and status', async () => {
  ledger.listRecurring.mockResolvedValue([
    RULE,
    { ...RULE, id: 5, type: 'INCOME', amount: '85000.00', description: 'Salary', frequency: 'WEEKLY', startDate: '2026-11-16', status: 'PAUSED', category: { id: 1, name: 'Salary' } },
    { ...RULE, id: 6, description: 'Gym', frequency: 'YEARLY', startDate: '2025-03-15', endDate: '2026-03-15', nextDate: null, status: 'FINISHED' },
  ]);
  renderApp('/recurring', { user: TEST_USER });
  const rent = (await screen.findByText('Monthly rent')).closest('li');
  expect(within(rent).getByText(/Every month on the 31st \(or the last day\)/)).toBeInTheDocument();
  expect(within(rent).getByText(/Next on 30 Nov 2026 · 10 recorded/)).toBeInTheDocument();
  expect(within(rent).getByText('−₹24,000.00')).toBeInTheDocument();
  const salary = screen.getByText('Salary', { selector: 'p' }).closest('li');
  expect(within(salary).getByText(/Every week on Monday/)).toBeInTheDocument();
  expect(within(salary).getByText('Paused')).toBeInTheDocument();
  expect(within(salary).getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  const gym = screen.getByText('Gym').closest('li');
  expect(within(gym).getByText(/Every year on 15 March/)).toBeInTheDocument();
  expect(within(gym).getByText(/Ended 15 Mar 2026/)).toBeInTheDocument();
  expect(within(gym).queryByRole('button', { name: /pause|resume/i })).not.toBeInTheDocument();
  expect(document.title).toBe('Recurring transactions · FinTrack');
});

test('adding a rule sends it and reports what was filled in', async () => {
  ledger.listRecurring.mockResolvedValue([]);
  ledger.createRecurring.mockResolvedValue({ rule: RULE, generated: 3 });
  renderApp('/recurring', { user: TEST_USER });
  expect(await screen.findByText('Nothing recurring yet')).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole('option', { name: 'Rent & Housing' }).length).toBeGreaterThan(0));
  const form = screen.getByRole('region', { name: 'New recurring transaction' });
  await userEvent.selectOptions(within(form).getByLabelText('Category', findInputs), '3');
  expect(within(within(form).getByLabelText('Category', findInputs)).queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument();
  await userEvent.type(within(form).getByLabelText('Description', findInputs), 'Monthly rent');
  await userEvent.type(within(form).getByLabelText('Amount', findInputs), '24000');
  await userEvent.click(within(form).getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(ledger.createRecurring).toHaveBeenCalledWith({
    type: 'EXPENSE', categoryId: 3, amount: '24000', currency: 'INR', description: 'Monthly rent', paymentMethod: 'BANK_TRANSFER',
    endDate: null, frequency: 'MONTHLY', startDate: todayIso(),
  }));
  expect(await screen.findByText(/3 transactions were recorded for dates up to today/)).toBeInTheDocument();
});

test('pausing, editing and deleting', async () => {
  ledger.listRecurring.mockResolvedValue([RULE]);
  ledger.updateRecurring.mockResolvedValue({ rule: { ...RULE, status: 'PAUSED' }, generated: 0 });
  ledger.deleteRecurring.mockResolvedValue();
  renderApp('/recurring', { user: TEST_USER });
  const row = (await screen.findByText('Monthly rent')).closest('li');
  await userEvent.click(within(row).getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(ledger.updateRecurring).toHaveBeenCalledWith(4, expect.objectContaining({ paused: true, amount: '24000.00', categoryId: 3 })));

  await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  expect(within(row).queryByLabelText('How often', findInputs)).not.toBeInTheDocument(); // the schedule itself is fixed
  const amount = within(row).getByLabelText('Amount', findInputs);
  await userEvent.clear(amount);
  await userEvent.type(amount, '25000');
  await userEvent.click(within(row).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(ledger.updateRecurring).toHaveBeenLastCalledWith(4, expect.objectContaining({ amount: '25000', paused: false })));
  expect(await screen.findByText('Saved. Changes apply to future transactions.')).toBeInTheDocument();

  await userEvent.click(within(row).getByRole('button', { name: 'Delete recurring Monthly rent' }));
  await userEvent.click(within(row).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(ledger.deleteRecurring).toHaveBeenCalledWith(4));
  expect(await screen.findByText(/Transactions already recorded stay/)).toBeInTheDocument();
});
