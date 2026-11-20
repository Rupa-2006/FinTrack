// The money pages, with the API mocked: what they show, what they send, how they handle errors.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClientError } from '../services/apiClient.js';
import * as ledger from '../services/ledgerService.js';
import { renderApp, TEST_USER } from '../test/renderApp.jsx';
import { currentMonth, todayIso } from '../utils/dates.js';

vi.mock('../services/healthService.js', () => ({ getReadiness: vi.fn().mockResolvedValue({ status: 'ready' }) }));
vi.mock('../services/authService.js', () => ({ logout: vi.fn().mockResolvedValue(), refreshSession: vi.fn() }));
vi.mock('../services/ledgerService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn()]));
});
vi.mock('../utils/download.js', () => ({ saveBlob: vi.fn() }));

const MONTH = currentMonth();
const CATEGORIES = [
  { id: 1, name: 'Salary', type: 'INCOME', isDefault: true },
  { id: 7, name: 'Groceries', type: 'EXPENSE', isDefault: true },
  { id: 9, name: 'Transport', type: 'EXPENSE', isDefault: true },
];
const TXN = {
  id: 41, type: 'EXPENSE', amount: '20.00', currency: 'USD', baseAmount: '1800.00', baseCurrency: 'INR', exchangeRate: '90.00000000',
  description: 'Cloud storage', paymentMethod: 'CARD', date: '2026-11-10', category: { id: 7, name: 'Groceries' }, hasNotes: true,
};
const validation = (details) => new ApiClientError({ status: 400, code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details });
const findInputs = { selector: 'input, select, textarea' };

beforeEach(() => {
  vi.clearAllMocks();
  ledger.getUnreadCount.mockResolvedValue(0);
  ledger.listCategories.mockResolvedValue(CATEGORIES);
});

describe('dashboard', () => {
  const DASHBOARD = {
    month: MONTH,
    currency: 'INR',
    summary: {
      income: '85000.00', expense: '41250.50', net: '43749.50', savingsRate: 51.5, transactionCount: 32,
      changes: { income: 0, expense: -12.4, net: 18 },
    },
    trend: [{ month: MONTH, income: '85000.00', expense: '41250.50', net: '43749.50', savingsRate: 51.5 }],
    topCategories: [{ categoryId: 3, name: 'Rent & Housing', total: '23800.00', percent: 57.7, transactionCount: 1 }],
    recentTransactions: [TXN],
    budgets: [{ id: 5, budgetType: 'CATEGORY', category: { id: 7, name: 'Groceries' }, amount: '6000.00', spent: '6500.00', percentUsed: 108.3, status: 'EXCEEDED' }],
    goals: [{ id: 2, title: 'Emergency fund', percent: 40, status: 'IN_PROGRESS' }],
    unreadNotifications: 2,
  };

  test('shows exact figures from the API, budgets and goals', async () => {
    ledger.getDashboard.mockResolvedValue(DASHBOARD);
    renderApp('/dashboard', { user: TEST_USER });
    expect(await screen.findByText('₹85,000.00')).toBeInTheDocument();
    expect(screen.getByText('₹41,250.50')).toBeInTheDocument();
    expect(screen.getByText('+₹43,749.50')).toBeInTheDocument();
    expect(screen.getByText('51.5%')).toBeInTheDocument();
    expect(screen.getByText('12.4% less than last month to this day')).toBeInTheDocument();
    expect(screen.getByText('Cloud storage')).toBeInTheDocument();
    expect(screen.getByText('−₹1,800.00')).toBeInTheDocument();
    expect(screen.getByText('Over')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Emergency fund progress' })).toHaveAttribute('aria-valuenow', '40');
    expect(ledger.getDashboard).toHaveBeenCalledWith(MONTH);
  });

  test('a new account is invited to add its first transaction', async () => {
    ledger.getDashboard.mockResolvedValue({ ...DASHBOARD, recentTransactions: [], topCategories: [], budgets: [], goals: [] });
    renderApp('/dashboard', { user: TEST_USER });
    expect(await screen.findByText('Nothing recorded yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add a transaction/i })).toHaveAttribute('href', '/transactions/new');
  });

  test('a failure offers a retry', async () => {
    ledger.getDashboard.mockRejectedValueOnce(new ApiClientError({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server.' }));
    ledger.getDashboard.mockResolvedValueOnce(DASHBOARD);
    renderApp('/dashboard', { user: TEST_USER });
    expect(await screen.findByText('Cannot reach the server.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('₹85,000.00')).toBeInTheDocument();
  });
});

describe('transactions list', () => {
  const page = (items, totalItems = items.length) => ({ items, pagination: { page: 1, pageSize: 20, totalItems, totalPages: Math.ceil(totalItems / 20) || 1 } });

  test('shows the converted and the original amount, and filters through the API', async () => {
    ledger.listTransactions.mockResolvedValue(page([TXN]));
    renderApp('/transactions', { user: TEST_USER });
    const row = (await screen.findByText('Cloud storage')).closest('tr');
    expect(within(row).getByText('−₹1,800.00')).toBeInTheDocument();
    expect(within(row).getByText('from $20.00')).toBeInTheDocument();
    expect(within(row).getByLabelText('Has notes')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Type', findInputs), 'EXPENSE');
    await userEvent.selectOptions(screen.getByLabelText('Category', findInputs), '7');
    await waitFor(() => expect(ledger.listTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'EXPENSE', categoryId: '7', page: 1 })));
    // Income categories disappear once "Expense" is chosen.
    expect(within(screen.getByLabelText('Category', findInputs)).queryByText('Salary')).not.toBeInTheDocument();
  });

  test('deleting asks for confirmation and reloads', async () => {
    ledger.listTransactions.mockResolvedValueOnce(page([TXN])).mockResolvedValue(page([]));
    ledger.deleteTransaction.mockResolvedValue();
    renderApp('/transactions', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Cloud storage' }));
    expect(ledger.deleteTransaction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(ledger.deleteTransaction).toHaveBeenCalledWith(41);
    expect(await screen.findByText('"Cloud storage" was deleted.')).toBeInTheDocument();
    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
  });

  test('pagination asks for the next page', async () => {
    ledger.listTransactions.mockResolvedValue({ items: [TXN], pagination: { page: 1, pageSize: 20, totalItems: 45, totalPages: 3 } });
    renderApp('/transactions', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: /next/i }));
    await waitFor(() => expect(ledger.listTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  test('CSV export downloads a file', async () => {
    const { saveBlob } = await import('../utils/download.js');
    ledger.listTransactions.mockResolvedValue(page([TXN]));
    ledger.downloadTransactionsCsv.mockResolvedValue({ blob: new Blob(['x']), filename: 'fintrack.csv' });
    renderApp('/transactions', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'fintrack.csv'));
  });
});

describe('transaction form', () => {
  test('adds an expense in a foreign currency with exact text amounts', async () => {
    ledger.createTransaction.mockResolvedValue(TXN);
    ledger.listTransactions.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 } });
    renderApp('/transactions/new', { user: TEST_USER });
    await userEvent.type(await screen.findByLabelText(/amount/i, findInputs), '20.10');
    await userEvent.selectOptions(screen.getByLabelText('Currency', findInputs), 'USD');
    expect(screen.getByText(/Saved in USD exactly as entered/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/category/i, findInputs), '7');
    await userEvent.type(screen.getByLabelText(/description/i, findInputs), ' Cloud storage ');
    await userEvent.type(screen.getByLabelText('Notes', findInputs), 'Shared plan');
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }));
    await waitFor(() => expect(ledger.createTransaction).toHaveBeenCalledWith({
      type: 'EXPENSE', amount: '20.10', currency: 'USD', categoryId: 7, date: todayIso(), description: 'Cloud storage', paymentMethod: 'CARD', notes: 'Shared plan',
    }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Transactions' })).toBeInTheDocument();
  });

  test('switching to income offers income categories only', async () => {
    renderApp('/transactions/new', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Income' }));
    const options = within(screen.getByLabelText(/category/i, findInputs)).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose a category', 'Salary']);
  });

  test('problems are caught before sending, and server errors land on their fields', async () => {
    ledger.createTransaction.mockRejectedValue(validation([{ field: 'body.amount', message: 'JPY amounts cannot have decimal places' }]));
    renderApp('/transactions/new', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Add transaction' }));
    expect(screen.getByText(/Enter an amount greater than 0/)).toBeInTheDocument();
    expect(screen.getByText('Choose a category', { selector: '[role="alert"]' })).toBeInTheDocument();
    expect(ledger.createTransaction).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/amount/i, findInputs), '100.50');
    await userEvent.selectOptions(screen.getByLabelText('Currency', findInputs), 'JPY');
    await userEvent.selectOptions(screen.getByLabelText(/category/i, findInputs), '7');
    await userEvent.type(screen.getByLabelText(/description/i, findInputs), 'Ramen');
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }));
    expect(await screen.findByText('JPY amounts cannot have decimal places')).toBeInTheDocument();
  });

  test('editing loads the entry, including its notes, and saves with PUT', async () => {
    ledger.getTransaction.mockResolvedValue({ ...TXN, notes: 'Family plan' });
    ledger.updateTransaction.mockResolvedValue(TXN);
    ledger.listTransactions.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 } });
    renderApp('/transactions/41/edit', { user: TEST_USER });
    expect(await screen.findByDisplayValue('Cloud storage')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Family plan')).toBeInTheDocument();
    expect(ledger.getTransaction).toHaveBeenCalledWith('41');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(ledger.updateTransaction).toHaveBeenCalledWith('41', expect.objectContaining({ amount: '20.00', currency: 'USD', notes: 'Family plan' })));
  });
});

describe('budgets', () => {
  const BUDGETS = {
    month: MONTH, currency: 'INR', income: '85000.00', expense: '9000.00',
    budgets: [
      { id: 5, budgetType: 'CATEGORY', category: { id: 7, name: 'Groceries' }, month: MONTH, amount: '6000.00', spent: '6500.00', remaining: '-500.00', percentUsed: 108.3, alertThresholdPct: 80, status: 'EXCEEDED' },
      { id: 6, budgetType: 'OVERALL', category: null, month: MONTH, amount: '50000.00', spent: '9000.00', remaining: '41000.00', percentUsed: 18, alertThresholdPct: 80, status: 'ON_TRACK' },
    ],
  };

  test('shows spending against each budget', async () => {
    ledger.listBudgets.mockResolvedValue(BUDGETS);
    renderApp('/budgets', { user: TEST_USER });
    expect(await screen.findByText('₹6,500.00 spent of ₹6,000.00')).toBeInTheDocument();
    expect(screen.getByText('Over budget')).toBeInTheDocument();
    expect(screen.getByText(/₹500.00 over/)).toBeInTheDocument();
    expect(screen.getByText(/₹41,000.00 left/)).toBeInTheDocument();
  });

  test('a new category budget offers only categories without one, and is sent for the shown month', async () => {
    ledger.listBudgets.mockResolvedValue(BUDGETS);
    ledger.createBudget.mockResolvedValue({});
    renderApp('/budgets', { user: TEST_USER });
    const category = await screen.findByLabelText('Category', findInputs);
    expect(within(category).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a category', 'Transport']);
    await userEvent.selectOptions(category, '9');
    await userEvent.type(screen.getByLabelText('Amount', findInputs), '3000');
    await userEvent.click(screen.getByRole('button', { name: 'Add budget' }));
    await waitFor(() => expect(ledger.createBudget).toHaveBeenCalledWith({ budgetType: 'CATEGORY', categoryId: 9, month: MONTH, amount: '3000', alertThresholdPct: 80 }));
    expect(ledger.listBudgets).toHaveBeenCalledTimes(2); // reloaded
  });

  test('moving between months loads that month, and last month can be copied', async () => {
    ledger.listBudgets.mockResolvedValue({ ...BUDGETS, budgets: [] });
    ledger.copyBudgets.mockResolvedValue({ copied: 2 });
    renderApp('/budgets', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: /copy last month/i }));
    expect(await screen.findByText(/Copied 2 budgets/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(ledger.listBudgets).toHaveBeenLastCalledWith(expect.not.stringMatching(MONTH)));
  });
});

describe('savings goals', () => {
  const GOAL = { id: 3, title: 'Emergency fund', targetAmount: '10000.00', savedAmount: '4000.00', remaining: '6000.00', percent: 40, currency: 'INR', deadline: null, daysLeft: null, status: 'IN_PROGRESS', notes: null };

  test('adds and withdraws money', async () => {
    ledger.listGoals.mockResolvedValue([GOAL]);
    ledger.contributeToGoal.mockResolvedValue(GOAL);
    renderApp('/goals', { user: TEST_USER });
    expect(await screen.findByText('₹4,000.00')).toBeInTheDocument();
    expect(screen.getByText(/₹6,000.00 to go/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Amount (INR)', findInputs), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ledger.contributeToGoal).toHaveBeenCalledWith(3, { amount: '500', date: todayIso() }));
    await userEvent.selectOptions(screen.getByLabelText('Action', findInputs), 'withdraw');
    await userEvent.type(screen.getByLabelText('Amount (INR)', findInputs), '250');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ledger.contributeToGoal).toHaveBeenLastCalledWith(3, { amount: '-250', date: todayIso() }));
  });

  test('creates a goal in the chosen currency', async () => {
    ledger.listGoals.mockResolvedValue([]);
    ledger.createGoal.mockResolvedValue(GOAL);
    renderApp('/goals', { user: TEST_USER });
    expect(await screen.findByText('No savings goals yet')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/title/i, findInputs), 'Tokyo trip');
    await userEvent.type(screen.getByLabelText(/target/i, findInputs), '300000');
    await userEvent.selectOptions(screen.getByLabelText('Currency', findInputs), 'JPY');
    await userEvent.click(screen.getByRole('button', { name: 'Create goal' }));
    await waitFor(() => expect(ledger.createGoal).toHaveBeenCalledWith({ title: 'Tokyo trip', targetAmount: '300000', currency: 'JPY', deadline: null, notes: null }));
  });
});

describe('currencies', () => {
  const CURRENCIES = { baseCurrency: 'INR', currencies: ['EUR', 'GBP', 'INR', 'JPY', 'USD'].map((code) => ({ code, name: code, symbol: code, decimalPlaces: 2 })) };

  test('shows rates, converts and labels demo rates', async () => {
    ledger.getCurrencies.mockResolvedValue(CURRENCIES);
    ledger.getRates.mockResolvedValue({ base: 'INR', rates: [{ currency: 'USD', rate: '0.01111111', rateDate: '2026-11-16', source: 'seed-fictional' }] });
    ledger.convertAmount.mockResolvedValue({ amount: '100', from: 'EUR', to: 'INR', result: '10000.00', rate: '100.00000000', rateDate: '2026-11-16', source: 'frankfurter' });
    renderApp('/currencies', { user: TEST_USER });
    expect(await screen.findByText('0.01111111')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /convert/i }));
    expect(await screen.findByText('€100.00 = ₹10,000.00')).toBeInTheDocument();
    expect(ledger.convertAmount).toHaveBeenCalledWith({ amount: '100', from: 'EUR', to: 'INR' });
  });

  test('changing the main currency needs a confirmation and updates the signed-in user', async () => {
    ledger.getCurrencies.mockResolvedValue(CURRENCIES);
    ledger.getRates.mockResolvedValue({ base: 'INR', rates: [] });
    ledger.changeBaseCurrency.mockResolvedValue({ baseCurrency: 'USD', previousBaseCurrency: 'INR', transactionsConverted: 12, budgetsConverted: 3 });
    renderApp('/currencies', { user: TEST_USER });
    await userEvent.selectOptions(await screen.findByLabelText('Main currency', findInputs), 'USD');
    await userEvent.click(screen.getByRole('button', { name: 'Change to USD' }));
    expect(ledger.changeBaseCurrency).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    expect(await screen.findByText(/12 transactions and 3 budgets were re-valued/)).toBeInTheDocument();
    await waitFor(() => expect(ledger.getRates).toHaveBeenLastCalledWith('USD'));
  });

  test('a failed refresh is reported without losing the table', async () => {
    ledger.getCurrencies.mockResolvedValue(CURRENCIES);
    ledger.getRates.mockResolvedValue({ base: 'INR', rates: [{ currency: 'EUR', rate: '0.01000000', rateDate: '2026-11-16', source: 'frankfurter' }] });
    ledger.refreshRates.mockRejectedValue(new ApiClientError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'The exchange-rate service cannot be reached right now.' }));
    renderApp('/currencies', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: /refresh/i }));
    expect(await screen.findByText(/cannot be reached right now/)).toBeInTheDocument();
    expect(screen.getByText('0.01000000')).toBeInTheDocument();
  });
});

describe('analytics', () => {
  test('shows the monthly report and the trend', async () => {
    ledger.getMonthlyTrend.mockResolvedValue({ currency: 'INR', months: [{ month: MONTH, income: '1.00', expense: '1.00', net: '0.00' }] });
    ledger.getMonthlyReport.mockResolvedValue({
      month: MONTH, currency: 'INR',
      summary: { income: '85000.00', expense: '41250.50', net: '43749.50', savingsRate: 51.5, transactionCount: 30, changes: { income: null, expense: 5, net: null } },
      expenseCategories: [{ categoryId: 3, name: 'Rent & Housing', total: '23800.00', percent: 57.7 }],
      incomeCategories: [{ categoryId: 1, name: 'Salary', total: '85000.00', percent: 100 }],
      budgets: [], daily: [],
      paymentMethods: [{ paymentMethod: 'BANK_TRANSFER', total: '23800.00', transactionCount: 1 }],
      largestExpenses: [{ id: 1, description: 'Monthly rent', date: '2026-11-03', amount: '23800.00', category: 'Rent & Housing' }],
    });
    renderApp('/analytics', { user: TEST_USER });
    expect(await screen.findByText('Monthly rent')).toBeInTheDocument();
    expect(screen.getByText('+5% on last month to this day')).toBeInTheDocument();
    expect(screen.getByText('Bank transfer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled(); // no reports for the future
    await userEvent.selectOptions(screen.getByLabelText('Period', findInputs), '12');
    await waitFor(() => expect(ledger.getMonthlyTrend).toHaveBeenLastCalledWith({ months: '12', until: MONTH }));
  });
});

describe('analytics by day, week and year', () => {
  const SUMMARY = {
    currency: 'INR', income: '0.00', expense: '1310.00', net: '-1310.00', savingsRate: null, transactionCount: 1,
    changes: { income: null, expense: 25, net: null },
  };
  const breakdown = (type) => ({
    currency: 'INR', type, total: type === 'EXPENSE' ? '1310.00' : '0.00',
    categories: type === 'EXPENSE' ? [{ categoryId: 7, name: 'Groceries', total: '1310.00', percent: 100 }] : [],
  });

  beforeEach(() => {
    ledger.getMonthlyReport.mockResolvedValue(null);
    ledger.getSummary.mockResolvedValue(SUMMARY);
    ledger.getCategoryBreakdown.mockImplementation(async ({ type }) => breakdown(type));
    ledger.listTransactions.mockResolvedValue({ items: [{ ...TXN, amount: '1310.00', currency: 'INR', baseAmount: '1310.00', description: 'Weekly groceries' }], pagination: { totalItems: 1 } });
    ledger.getMonthlyTrend.mockResolvedValue({ currency: 'INR', months: [{ month: '2026-01', income: '1.00', expense: '1.00', net: '0.00' }] });
  });

  test('the week view asks for Monday to Sunday and lists that week\'s transactions', async () => {
    renderApp('/analytics', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Week' }));
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(ledger.getSummary).toHaveBeenCalled());
    const { from, to } = ledger.getSummary.mock.calls.at(-1)[0];
    expect(new Date(`${from}T12:00:00`).getDay()).toBe(1); // Monday
    expect((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000).toBe(6);
    expect(await screen.findByText('Weekly groceries')).toBeInTheDocument();
    expect(screen.getByText(/% on last week to this day/)).toBeInTheDocument();
    expect(screen.getByText('No income in this period.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
  });

  test('the day view moves back a day and exports exactly that day', async () => {
    const { saveBlob } = await import('../utils/download.js');
    ledger.downloadTransactionsCsv.mockResolvedValue({ blob: new Blob(['a']), filename: 'day.csv' });
    renderApp('/analytics', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const iso = todayIso(yesterday);
    await waitFor(() => expect(ledger.getSummary).toHaveBeenLastCalledWith({ from: iso, to: iso }));
    expect(await screen.findByText('+25% on the day before')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /csv/i }));
    await waitFor(() => expect(ledger.downloadTransactionsCsv).toHaveBeenCalledWith({ from: iso, to: iso }));
    expect(saveBlob).toHaveBeenCalled();
  });

  test('the year view shows the whole year with its months', async () => {
    renderApp('/analytics', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Year' }));
    const year = String(new Date().getFullYear());
    await waitFor(() => expect(ledger.getSummary).toHaveBeenLastCalledWith({ from: `${year}-01-01`, to: `${year}-12-31` }));
    expect(await screen.findByRole('heading', { name: 'Month by month' })).toBeInTheDocument();
    expect(ledger.getMonthlyTrend).toHaveBeenLastCalledWith({ months: new Date().getMonth() + 1, until: currentMonth() });
    expect(screen.queryByRole('heading', { name: 'Transactions' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    await waitFor(() => expect(ledger.getMonthlyTrend).toHaveBeenLastCalledWith({ months: 12, until: `${Number(year) - 1}-12` }));
  });
});

describe('notifications', () => {
  const NOTE = { id: 8, type: 'BUDGET_THRESHOLD', severity: 'WARNING', title: 'Budget alert: Groceries', message: 'You have used 85%.', read: false, createdAt: '2026-11-16T10:00:00.000Z' };

  test('lists, marks read and deletes', async () => {
    ledger.listNotifications.mockResolvedValue({ items: [NOTE], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 }, unreadCount: 1 });
    ledger.markNotificationRead.mockResolvedValue();
    ledger.deleteNotification.mockResolvedValue();
    renderApp('/notifications', { user: TEST_USER });
    expect(await screen.findByText('Budget alert: Groceries')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    expect(ledger.markNotificationRead).toHaveBeenCalledWith(8);
    await userEvent.click(screen.getByRole('button', { name: 'Delete notification: Budget alert: Groceries' }));
    expect(ledger.deleteNotification).toHaveBeenCalledWith(8);
    await waitFor(() => expect(ledger.getUnreadCount.mock.calls.length).toBeGreaterThan(1)); // bell refreshed
  });

  test('unread-only filter and mark all as read', async () => {
    ledger.listNotifications.mockResolvedValue({ items: [NOTE], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 }, unreadCount: 1 });
    ledger.markAllNotificationsRead.mockResolvedValue({ updated: 1 });
    renderApp('/notifications', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Unread only' }));
    await waitFor(() => expect(ledger.listNotifications).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, unreadOnly: true }));
    await userEvent.click(screen.getByRole('button', { name: /mark all as read/i }));
    expect(ledger.markAllNotificationsRead).toHaveBeenCalled();
  });
});

describe('failures and less common paths (Phase 9)', () => {
  const REPORT = {
    month: MONTH, currency: 'INR',
    summary: { income: '0.00', expense: '0.00', net: '0.00', savingsRate: null, transactionCount: 0, changes: { income: null, expense: 0, net: null } },
    expenseCategories: [], incomeCategories: [], daily: [], paymentMethods: [], largestExpenses: [],
    budgets: [{ id: 2, budgetType: 'CATEGORY', category: { id: 7, name: 'Groceries' }, percentUsed: 120, status: 'EXCEEDED' }],
  };
  const BUDGETS = {
    month: MONTH, currency: 'INR', income: '85000.00', expense: '9000.00',
    budgets: [
      { id: 5, budgetType: 'CATEGORY', category: { id: 7, name: 'Groceries' }, month: MONTH, amount: '6000.00', spent: '4000.00', remaining: '2000.00', percentUsed: 66.7, alertThresholdPct: 80, status: 'ON_TRACK' },
      { id: 6, budgetType: 'SAVINGS_TARGET', category: null, month: MONTH, amount: '20000.00', saved: '25000.00', spent: null, remaining: null, percentUsed: 125, alertThresholdPct: 100, status: 'REACHED' },
    ],
  };
  const offline = () => new ApiClientError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Service currently unavailable' });

  test('analytics exports the shown month as CSV and reports a failed export', async () => {
    const { saveBlob } = await import('../utils/download.js');
    ledger.getMonthlyTrend.mockResolvedValue({ currency: 'INR', months: [] });
    ledger.getMonthlyReport.mockResolvedValue(REPORT);
    ledger.downloadTransactionsCsv.mockResolvedValueOnce({ blob: new Blob(['a']), filename: 'fintrack.csv' }).mockRejectedValueOnce(offline());
    renderApp('/analytics', { user: TEST_USER });
    expect(await screen.findByText('No expenses this month.')).toBeInTheDocument();
    expect(screen.getByText('Same as last month to this day')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument(); // no savings rate without income
    expect(screen.getByRole('progressbar', { name: 'Groceries: 120%' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /csv/i }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'fintrack.csv'));
    const [from, to] = [ledger.downloadTransactionsCsv.mock.calls[0][0].from, ledger.downloadTransactionsCsv.mock.calls[0][0].to];
    expect(from).toBe(`${MONTH}-01`);
    expect(to.startsWith(MONTH)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /csv/i }));
    expect(await screen.findByText('Service currently unavailable')).toBeInTheDocument();
  });

  test('analytics moves to an earlier month and compares it with the month before', async () => {
    ledger.getMonthlyTrend.mockResolvedValue({ currency: 'INR', months: [] });
    ledger.getMonthlyReport.mockImplementation(async (month) => ({ ...REPORT, month, summary: { ...REPORT.summary, changes: { income: null, expense: -12, net: null } } }));
    renderApp('/analytics', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(ledger.getMonthlyReport).toHaveBeenLastCalledWith(expect.not.stringMatching(MONTH)));
    expect(await screen.findByText('-12% on the month before')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();
  });

  test('a budget can be edited, and a savings target shows what was saved', async () => {
    ledger.listBudgets.mockResolvedValue(BUDGETS);
    ledger.updateBudget.mockResolvedValue({});
    renderApp('/budgets', { user: TEST_USER });
    expect(await screen.findByText('₹25,000.00 saved of ₹20,000.00')).toBeInTheDocument();
    expect(screen.getByText('Target reached')).toBeInTheDocument();
    expect(screen.getByText('125% reached')).toBeInTheDocument();
    const [edit] = screen.getAllByRole('button', { name: 'Edit' });
    await userEvent.click(edit);
    expect(edit).toHaveAttribute('aria-expanded', 'true');
    const amount = screen.getByLabelText('Amount (INR)', findInputs);
    await userEvent.clear(amount);
    await userEvent.type(amount, ' 6500 ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ledger.updateBudget).toHaveBeenCalledWith(5, { amount: '6500', alertThresholdPct: 80 }));
    await waitFor(() => expect(screen.queryByLabelText('Amount (INR)', findInputs)).not.toBeInTheDocument());
  });

  test('a failed delete says so instead of failing silently', async () => {
    ledger.listBudgets.mockResolvedValue(BUDGETS);
    ledger.deleteBudget.mockRejectedValue(offline());
    renderApp('/budgets', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Groceries budget' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Service currently unavailable');
    expect(ledger.listBudgets).toHaveBeenCalledTimes(1); // nothing pretended to change
  });

  test('a failed copy of last month is reported', async () => {
    ledger.listBudgets.mockResolvedValue({ ...BUDGETS, budgets: [] });
    ledger.copyBudgets.mockRejectedValue(offline());
    renderApp('/budgets', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: /copy last month/i }));
    expect(await screen.findByText('Service currently unavailable')).toBeInTheDocument();
  });

  test('goal delete and cancel failures are shown, and deadlines read naturally', async () => {
    const goal = (over) => ({ id: 3, title: 'Emergency fund', targetAmount: '10000.00', savedAmount: '4000.00', remaining: '6000.00', percent: 40, currency: 'INR', deadline: '2026-12-01', daysLeft: 1, status: 'IN_PROGRESS', notes: null, ...over });
    ledger.listGoals.mockResolvedValue([goal(), goal({ id: 4, title: 'Old plan', daysLeft: -3 }), goal({ id: 5, title: 'Due now', daysLeft: 0 }), goal({ id: 6, title: 'Done', status: 'COMPLETED' })]);
    ledger.deleteGoal.mockRejectedValue(offline());
    ledger.updateGoal.mockRejectedValue(offline());
    renderApp('/goals', { user: TEST_USER });
    expect(await screen.findByText(/^1 day left/)).toBeInTheDocument();
    expect(screen.getByText(/Deadline passed on/)).toBeInTheDocument();
    expect(screen.getByText('Deadline is today')).toBeInTheDocument();
    expect(screen.getByText(/^Deadline (?!passed|is today)/)).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Emergency fund' });
    await userEvent.click(within(card).getByRole('button', { name: 'Delete goal Emergency fund' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Service currently unavailable');
    await userEvent.click(within(card).getByRole('button', { name: 'Cancel goal' }));
    await waitFor(() => expect(within(card).getAllByText('Service currently unavailable')).toHaveLength(2));
  });
});