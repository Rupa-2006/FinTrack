// The import page: choose a file, check the columns, preview, import. The API is mocked.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as ledger from '../../services/ledgerService.js';
import { renderApp, TEST_USER } from '../../test/renderApp.jsx';

vi.mock('../../services/healthService.js', () => ({ getReadiness: vi.fn().mockResolvedValue({ status: 'ready' }) }));
vi.mock('../../services/authService.js', () => ({ logout: vi.fn().mockResolvedValue(), refreshSession: vi.fn() }));
vi.mock('../../services/ledgerService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn()]));
});

const findInputs = { selector: 'input, select' };
const BANK_CSV = [
  'Txn Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '18/11/2026,"BigBasket, groceries",1250.50,,10000.00',
  '01/11/2026,Salary November,,"85,000.00",11250.50',
  '25/11/2026,Future thing,10,,0',
].join('\r\n');
const csvFile = (text, name = 'statement.csv') => new File([text], name, { type: 'text/csv' });

const preview = (rows) => ({
  dryRun: true,
  summary: { total: rows.length, ready: rows.filter((r) => r.status === 'ready').length, duplicate: rows.filter((r) => r.status === 'duplicate').length, error: rows.filter((r) => r.status === 'error').length, imported: 0, skipped: 0 },
  rows,
});

beforeEach(() => {
  vi.clearAllMocks();
  ledger.getUnreadCount.mockResolvedValue(0);
  ledger.listCategories.mockResolvedValue([{ id: 7, name: 'Groceries', type: 'EXPENSE' }, { id: 1, name: 'Salary', type: 'INCOME' }]);
});

test('a bank statement is mapped automatically, checked, then imported', async () => {
  ledger.importTransactions
    .mockResolvedValueOnce(preview([
      { row: 1, status: 'ready', date: '2026-11-18', type: 'EXPENSE', amount: '1250.50', currency: 'INR', description: 'BigBasket, groceries', category: 'Groceries' },
      { row: 2, status: 'duplicate', date: '2026-11-01', type: 'INCOME', amount: '85000.00', currency: 'INR', description: 'Salary November', category: 'Salary' },
      { row: 3, status: 'error', errors: ['date: Date cannot be in the future'] },
    ]))
    .mockResolvedValueOnce({ dryRun: false, summary: { total: 3, ready: 0, duplicate: 0, error: 1, imported: 1, skipped: 1 }, rows: [] });
  renderApp('/transactions/import', { user: TEST_USER });
  await userEvent.upload(await screen.findByLabelText('CSV file'), csvFile(BANK_CSV));
  expect(await screen.findByText('statement.csv: 3 rows')).toBeInTheDocument();

  // columns found by name, debit/credit and day-first dates detected
  expect(screen.getByLabelText('Date *', findInputs)).toHaveDisplayValue('Txn Date');
  expect(screen.getByLabelText('Description *', findInputs)).toHaveDisplayValue('Narration');
  expect(screen.getByLabelText(/money out/i, findInputs)).toHaveDisplayValue('Withdrawal Amt.');
  expect(screen.getByLabelText(/money in/i, findInputs)).toHaveDisplayValue('Deposit Amt.');
  expect(screen.getByLabelText('Income or expense', findInputs)).toHaveValue('debitCredit');
  expect(screen.getByLabelText('Dates are written as', findInputs)).toHaveValue('DMY');

  await userEvent.selectOptions(screen.getByLabelText('Expense category when none matches', findInputs), '7');
  await userEvent.click(screen.getByRole('button', { name: 'Check 3 rows' }));
  await waitFor(() => expect(ledger.importTransactions).toHaveBeenCalledTimes(1));
  const sent = ledger.importTransactions.mock.calls[0][0];
  expect(sent).toMatchObject({ dryRun: true, skipDuplicates: true, fallbackCategories: { EXPENSE: 7 } });
  expect(sent.rows[0]).toMatchObject({ date: '2026-11-18', type: 'EXPENSE', amount: '1250.50', currency: 'INR', description: 'BigBasket, groceries' });
  expect(sent.rows[1]).toMatchObject({ date: '2026-11-01', type: 'INCOME', amount: '85000.00' });

  const results = await screen.findByRole('region', { name: '3. Review and import' });
  expect(within(results).getByText('Already recorded')).toBeInTheDocument();
  expect(within(results).getByText('date: Date cannot be in the future')).toBeInTheDocument();
  await userEvent.click(within(results).getByLabelText('Problems only'));
  expect(within(results).queryByText('BigBasket, groceries')).not.toBeInTheDocument();

  const importButton = within(results).getByRole('button', { name: 'Import 1 transaction' });
  await userEvent.click(within(results).getByLabelText(/Import the 1 already recorded as well/));
  expect(within(results).getByRole('button', { name: 'Import 2 transactions' })).toBeInTheDocument();
  await userEvent.click(within(results).getByLabelText(/Import the 1 already recorded as well/));
  await userEvent.click(importButton);
  await waitFor(() => expect(ledger.importTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false, skipDuplicates: true })));
  expect(await screen.findByText('1 imported, 1 skipped, 1 with problems.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'See your transactions' })).toHaveAttribute('href', '/transactions');
});

test('large files are sent in batches with row numbers counted from the top', { timeout: 20000 }, async () => {
  const lines = ['Date,Description,Amount,Type'];
  for (let i = 0; i < 450; i += 1) lines.push(`2026-11-01,Item ${i},10,Expense`);
  ledger.importTransactions.mockImplementation(async ({ rows }) => preview(rows.map((r, i) => ({ row: i + 1, status: 'ready', ...r, amount: '10.00', currency: 'INR' }))));
  renderApp('/transactions/import', { user: TEST_USER });
  await userEvent.upload(await screen.findByLabelText('CSV file'), csvFile(lines.join('\n')));
  await userEvent.click(await screen.findByRole('button', { name: 'Check 450 rows' }));
  await waitFor(() => expect(ledger.importTransactions).toHaveBeenCalledTimes(3)); // 200 + 200 + 50
  expect(ledger.importTransactions.mock.calls.map((c) => c[0].rows.length)).toEqual([200, 200, 50]);
  expect(await screen.findByText('450 ready, 0 already recorded, 0 with problems.', {}, { timeout: 8000 })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '450' })).toBeInTheDocument(); // numbering continues across batches
});

test('a file without rows, or without the needed columns, is explained', async () => {
  renderApp('/transactions/import', { user: TEST_USER });
  await userEvent.upload(await screen.findByLabelText('CSV file'), csvFile('Date,Description\n'));
  expect(await screen.findByText(/No rows found/)).toBeInTheDocument();
  await userEvent.upload(screen.getByLabelText('CSV file'), csvFile('When,What\n2026-11-01,Coffee'));
  expect(await screen.findByText(/Choose the columns marked \*/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check 1 rows' })).toBeDisabled();
});
