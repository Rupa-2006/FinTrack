// The Security page and the Admin dashboard, with the API mocked.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClientError } from '../services/apiClient.js';
import * as security from '../services/securityService.js';
import { renderApp, TEST_ADMIN, TEST_USER } from '../test/renderApp.jsx';

vi.mock('../services/healthService.js', () => ({ getReadiness: vi.fn().mockResolvedValue({ status: 'ready' }) }));
vi.mock('../services/authService.js', () => ({ logout: vi.fn().mockResolvedValue(), refreshSession: vi.fn() }));
vi.mock('../services/ledgerService.js', () => ({ getUnreadCount: vi.fn().mockResolvedValue(0) }));
vi.mock('../services/securityService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn()]));
});

const page = (items) => ({ items, pagination: { page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 } });
const SESSIONS = [
  { id: 11, device: 'Chrome on Windows', ipAddress: '203.0.113.5', createdAt: '2026-11-17T08:00:00.000Z', lastUsedAt: '2026-11-17T09:00:00.000Z', current: true },
  { id: 12, device: 'Safari on iOS', ipAddress: '198.51.100.7', createdAt: '2026-11-15T08:00:00.000Z', lastUsedAt: '2026-11-16T09:00:00.000Z', current: false },
];
const EVENTS = [
  { id: 1, eventType: 'LOGIN_FAILED', severity: 'WARNING', ipAddress: '198.51.100.7', device: 'Safari on iOS', metadata: { reason: 'wrong_password' }, createdAt: '2026-11-17T08:00:00.000Z' },
  { id: 2, eventType: 'NEW_DEVICE_LOGIN', severity: 'WARNING', ipAddress: '198.51.100.7', device: 'Safari on iOS', metadata: {}, createdAt: '2026-11-17T08:01:00.000Z' },
];
const ACTIVITY = [{ id: 40, eventType: 'DATA', action: 'TRANSACTION_UPDATED', details: { fields: ['amount', 'description'] }, createdAt: '2026-11-17T08:02:00.000Z' }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('security page', () => {
  beforeEach(() => {
    security.listSessions.mockResolvedValue(SESSIONS);
    security.listSecurityEvents.mockResolvedValue(page(EVENTS));
    security.listActivity.mockResolvedValue(page(ACTIVITY));
  });

  test('lists sessions, marks this device, and explains events in plain words', async () => {
    renderApp('/security', { user: TEST_USER });
    expect(await screen.findByText('Safari on iOS', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out Chrome on Windows' })).not.toBeInTheDocument(); // not for the current one
    expect(await screen.findByText('Failed sign-in attempt (wrong password)')).toBeInTheDocument();
    expect(screen.getByText('Sign-in from a new device')).toBeInTheDocument();
    expect(screen.getByText('Transaction updated')).toBeInTheDocument();
    expect(screen.getByText('Changed: amount, description')).toBeInTheDocument();
  });

  test('ending another session asks first, then reloads', async () => {
    security.revokeSession.mockResolvedValue();
    renderApp('/security', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out Safari on iOS' }));
    expect(security.revokeSession).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(security.revokeSession).toHaveBeenCalledWith(12);
    expect(await screen.findByText('Signed out of Safari on iOS.')).toBeInTheDocument();
    expect(security.listSessions).toHaveBeenCalledTimes(2);
  });

  test('"sign out everywhere else" reports how many sessions ended', async () => {
    security.revokeOtherSessions.mockResolvedValue({ revoked: 1 });
    renderApp('/security', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere else' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out others' }));
    expect(await screen.findByText('Signed out of 1 other session.')).toBeInTheDocument();
  });

  test('the history can be filtered', async () => {
    renderApp('/security', { user: TEST_USER });
    await userEvent.selectOptions(await screen.findByLabelText('Show'), 'LOGIN_FAILED');
    await waitFor(() => expect(security.listSecurityEvents).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, eventType: 'LOGIN_FAILED' }));
  });
});

describe('admin dashboard', () => {
  const OVERVIEW = {
    users: { total: 42, active: 40, suspended: 1, deactivated: 1, newLast30Days: 5, activeLast7Days: 30, lockedNow: 2 },
    activeSessions: 18,
    usage: { transactions: 9001, transactionsLast30Days: 800, budgets: 120, savingsGoals: 33 },
    security: { signInsLast24h: 50, failedSignInsLast24h: 26, criticalEventsLast7Days: 3, warningsLast7Days: 40 },
    suspiciousIps: [{ ipAddress: '203.0.113.66', failures: 19, accounts: 7, lastSeen: '2026-11-17T08:00:00.000Z' }],
  };
  const USERS = [
    { id: 2, fullName: 'Priya Nair', email: 'priya@example.test', status: 'ACTIVE', roles: ['ADMIN', 'USER'], locked: false, activeSessions: 1, lastLoginAt: null },
    { id: 7, fullName: 'Ravi Kumar', email: 'ravi@example.test', status: 'ACTIVE', roles: ['USER'], locked: true, activeSessions: 0, lastLoginAt: '2026-11-16T10:00:00.000Z' },
    { id: 9, fullName: 'Mia Chen', email: 'mia@example.test', status: 'SUSPENDED', roles: ['USER'], locked: false, activeSessions: 0, lastLoginAt: null },
  ];

  beforeEach(() => {
    security.getAdminOverview.mockResolvedValue(OVERVIEW);
    security.listUsers.mockResolvedValue(page(USERS));
  });

  test('non-administrators never reach it', () => {
    renderApp('/admin', { user: TEST_USER });
    expect(screen.getByRole('heading', { name: 'Administrators only' })).toBeInTheDocument();
    expect(security.getAdminOverview).not.toHaveBeenCalled();
  });

  test('overview shows counts and suspicious addresses, and states the privacy boundary', async () => {
    renderApp('/admin', { user: TEST_ADMIN });
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('9001')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.66')).toBeInTheDocument();
    expect(screen.getByText(/transactions, budgets, goals and notes are private/)).toBeInTheDocument();
  });

  test('tabs work with the keyboard', async () => {
    renderApp('/admin', { user: TEST_ADMIN });
    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Accounts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Accounts' })).toHaveFocus();
    expect(await screen.findByText('ravi@example.test')).toBeInTheDocument();
  });

  test('account actions: unlock, suspend after confirmation, reactivate; none on your own account', async () => {
    security.unlockUser.mockResolvedValue({});
    security.setUserStatus.mockResolvedValue({});
    renderApp('/admin', { user: TEST_ADMIN });
    await userEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
    const own = (await screen.findByText('priya@example.test', { selector: 'td p' })).closest('tr');
    expect(within(own).getByText('Your account')).toBeInTheDocument();
    expect(within(own).queryByRole('button')).not.toBeInTheDocument();

    const ravi = screen.getByText('ravi@example.test').closest('tr');
    expect(within(ravi).getByText('Locked')).toBeInTheDocument();
    await userEvent.click(within(ravi).getByRole('button', { name: 'Unlock' }));
    expect(security.unlockUser).toHaveBeenCalledWith(7);

    await userEvent.click(within(ravi).getByRole('button', { name: 'Suspend ravi@example.test' }));
    expect(security.setUserStatus).not.toHaveBeenCalled();
    await userEvent.click(within(ravi).getByRole('button', { name: 'Suspend' }));
    expect(security.setUserStatus).toHaveBeenCalledWith(7, 'SUSPENDED');

    await userEvent.click(within(screen.getByText('mia@example.test').closest('tr')).getByRole('button', { name: 'Reactivate mia@example.test' }));
    expect(security.setUserStatus).toHaveBeenLastCalledWith(9, 'ACTIVE');
  });

  test('a refused action shows the server\'s reason', async () => {
    security.setUserRole.mockRejectedValue(new ApiClientError({ status: 409, code: 'CONFLICT', message: 'This is the last active administrator' }));
    renderApp('/admin', { user: { ...TEST_ADMIN, id: 99 } });
    await userEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
    const priya = (await screen.findByText('priya@example.test', { selector: 'td p' })).closest('tr');
    await userEvent.click(within(priya).getByRole('button', { name: 'Remove admin role from priya@example.test' }));
    await userEvent.click(within(priya).getByRole('button', { name: 'Remove admin' }));
    expect(await screen.findByText('This is the last active administrator')).toBeInTheDocument();
  });

  test('search is sent to the API', async () => {
    renderApp('/admin', { user: TEST_ADMIN });
    await userEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
    await userEvent.type(await screen.findByLabelText('Search'), 'ravi');
    await waitFor(() => expect(security.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ravi', page: 1 })));
  });

  test('security events across accounts, filtered by severity', async () => {
    security.listAllSecurityEvents.mockResolvedValue(page([{ ...EVENTS[0], severity: 'CRITICAL', eventType: 'ACCOUNT_LOCKED', userEmail: 'ravi@example.test' }]));
    renderApp('/admin', { user: TEST_ADMIN });
    await userEvent.click(screen.getByRole('tab', { name: 'Security events' }));
    expect(await screen.findByText(/Account locked after failed attempts/)).toBeInTheDocument();
    expect(screen.getByText(/ravi@example.test/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'CRITICAL');
    await waitFor(() => expect(security.listAllSecurityEvents).toHaveBeenLastCalledWith({ severity: 'CRITICAL', page: 1, pageSize: 20 }));
  });

  test('verifying the audit chain reports intact and broken results', async () => {
    security.listAuditLogs.mockResolvedValue(page([{ id: 55, eventType: 'ADMIN', action: 'USER_SUSPENDED', resourceType: 'user', resourceId: '7', userEmail: 'priya@example.test', createdAt: '2026-11-17T08:00:00.000Z' }]));
    security.verifyAuditChain
      .mockResolvedValueOnce({ valid: true, checkedRows: 55, lastId: 55 })
      .mockResolvedValueOnce({ valid: false, checkedRows: 12, reason: 'Row 13: its contents do not match its hash (the row was changed).' });
    renderApp('/admin', { user: TEST_ADMIN });
    await userEvent.click(screen.getByRole('tab', { name: 'Audit log' }));
    expect(await screen.findByText('User suspended')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /verify chain/i }));
    expect(await screen.findByText('Chain intact')).toBeInTheDocument();
    expect(screen.getByText(/55 entries checked/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /verify chain/i }));
    expect(await screen.findByText('Chain broken')).toBeInTheDocument();
    expect(screen.getByText(/Row 13/)).toBeInTheDocument();
  });
});
