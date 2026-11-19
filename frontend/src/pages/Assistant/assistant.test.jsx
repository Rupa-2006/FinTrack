import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClientError } from '../../services/apiClient.js';
import { askQuestion, getInsights } from '../../services/assistantService.js';
import { renderApp, TEST_USER } from '../../test/renderApp.jsx';

vi.mock('../../services/healthService.js', () => ({ getReadiness: vi.fn().mockResolvedValue({ status: 'ready' }) }));
vi.mock('../../services/authService.js', () => ({ logout: vi.fn().mockResolvedValue(), refreshSession: vi.fn() }));
vi.mock('../../services/ledgerService.js', () => ({ getUnreadCount: vi.fn().mockResolvedValue(0) }));
vi.mock('../../services/assistantService.js', () => ({ getInsights: vi.fn(), askQuestion: vi.fn() }));

const INSIGHTS = {
  currency: 'INR',
  cards: [
    { id: 'SPENDING_PACE', kind: 'SPENDING_PACE', tone: 'warning', title: 'Spending is up 18% on last month', message: 'You have spent ₹34,070.00 so far.' },
    { id: 'SAVINGS_RATE', kind: 'SAVINGS_RATE', tone: 'positive', title: 'Good savings in October 2026', message: 'You kept 61% of your income.' },
  ],
  forecast: {
    month: 'November 2026', daysLeft: 13, spentSoFar: '34070.00', projected: '36900.50', low: '36500.00', high: '38451.00',
    basis: 'what you spent in the same part of the last three months', confidence: 'medium',
    disclaimer: 'This is an estimate based on your past entries, not a guarantee.', overallBudget: { amount: '35000.00', projectedOver: true },
  },
  anomalies: [{ transactionId: 77, date: '2026-11-14', description: 'Airport limousine', category: 'Transport', amount: '5200.00', typicalAmount: '220.00', reason: 'About 23.6 times your typical Transport expense.' }],
  budgetSuggestions: [{ category: 'Transport', action: 'ADD', typicalMonthly: '870.00', suggestedAmount: '950.00', currentBudget: null, reason: 'You spend here most months but have no budget for it.' }],
  recurring: [{ description: 'Music streaming', category: 'Subscriptions', typicalAmount: '649.00' }],
};

const REPLY = {
  intent: 'category_spending',
  answer: 'You spent ₹770.00 on Food & Dining this month (November 2026, so far), across 2 transactions.',
  facts: [{ label: 'Food & Dining, this month', value: '₹770.00' }],
  disclaimer: null,
  followUps: ['Where does my money go?'],
};

beforeEach(() => {
  vi.clearAllMocks();
  getInsights.mockResolvedValue(INSIGHTS);
});

test('shows insights, the estimate with its range and disclaimer, and links unusual expenses to the entry', async () => {
  renderApp('/assistant', { user: TEST_USER });
  expect(await screen.findByText('Spending is up 18% on last month')).toBeInTheDocument();
  expect(screen.getByText('₹36,900.50')).toBeInTheDocument();
  expect(screen.getByText(/Likely between ₹36,500.00 and ₹38,451.00/)).toBeInTheDocument();
  expect(screen.getByText(/not a guarantee/)).toBeInTheDocument();
  expect(screen.getByText(/Above your overall budget/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Airport limousine' })).toHaveAttribute('href', '/transactions/77/edit');
  expect(screen.getByText(/Add Transport: about ₹950.00 a month/)).toBeInTheDocument();
  expect(screen.getByText('Music streaming')).toBeInTheDocument();
  expect(screen.getByText(/not financial advice/)).toBeInTheDocument();
});

test('a starter question is asked and the answer appears with its figures and follow-ups', async () => {
  askQuestion.mockResolvedValue(REPLY);
  renderApp('/assistant', { user: TEST_USER });
  await userEvent.click(await screen.findByRole('button', { name: 'How much did I spend on food this month?' }));
  expect(askQuestion).toHaveBeenCalledWith('How much did I spend on food this month?');
  const conversation = await screen.findByRole('list', { name: 'Conversation' });
  expect(await within(conversation).findByText(REPLY.answer)).toBeInTheDocument();
  expect(within(conversation).getByText('₹770.00')).toBeInTheDocument();

  askQuestion.mockResolvedValue({ ...REPLY, answer: 'Mostly rent.' });
  await userEvent.click(within(conversation).getByRole('button', { name: 'Where does my money go?' }));
  expect(await within(conversation).findByText('Mostly rent.')).toBeInTheDocument();
});

test('typing a question and pressing Enter asks it; the box is cleared and very short input is ignored', async () => {
  askQuestion.mockResolvedValue(REPLY);
  renderApp('/assistant', { user: TEST_USER });
  const box = screen.getByLabelText('Your question');
  await userEvent.type(box, 'a{Enter}');
  expect(askQuestion).not.toHaveBeenCalled();
  await userEvent.clear(box);
  await userEvent.type(box, '  spending on groceries in October  {Enter}');
  expect(askQuestion).toHaveBeenCalledWith('spending on groceries in October');
  await waitFor(() => expect(box).toHaveValue(''));
  expect(box).toHaveAttribute('maxlength', '500');
});

test('an unavailable assistant is reported in the conversation and insights offer a retry', async () => {
  const down = new ApiClientError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'The AI assistant is unavailable right now. Please try again in a moment.' });
  getInsights.mockRejectedValueOnce(down);
  askQuestion.mockRejectedValue(down);
  renderApp('/assistant', { user: TEST_USER });
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Any unusual expenses?' }));
  expect(await screen.findAllByText(/assistant is unavailable right now/)).not.toHaveLength(0);
});

test('nothing about the conversation is written to browser storage', async () => {
  askQuestion.mockResolvedValue(REPLY);
  renderApp('/assistant', { user: TEST_USER });
  await userEvent.click(await screen.findByRole('button', { name: 'Where does my money go?' }));
  await screen.findByText(REPLY.answer);
  expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
});
