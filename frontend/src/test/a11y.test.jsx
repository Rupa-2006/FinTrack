// Accessibility regression checks (Phase 9): axe-core on public pages and the signed-in shell,
// page titles, and where keyboard focus goes. Colour contrast cannot be measured in jsdom; it
// was checked with axe in a real browser (see docs/TEST_REPORT.md).
import axe from 'axe-core';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as ledger from '../services/ledgerService.js';
import { renderApp, TEST_USER } from './renderApp.jsx';

vi.mock('../services/healthService.js', () => ({ getReadiness: vi.fn().mockResolvedValue({ status: 'ready' }) }));
vi.mock('../services/authService.js', () => ({ logout: vi.fn().mockResolvedValue(), refreshSession: vi.fn().mockRejectedValue(new Error('signed out')) }));
vi.mock('../services/ledgerService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn()]));
});

const EMPTY_PAGE = { items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 }, unreadCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  ledger.getUnreadCount.mockResolvedValue(0);
  ledger.listNotifications.mockResolvedValue(EMPTY_PAGE);
});

async function violations(container) {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } }, // needs real layout; checked in the browser
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe.each([
  ['/', null, /./],
  ['/login', 'Sign in', /sign in/i],
  ['/register', 'Create your account', /create your account/i],
  ['/forgot-password', 'Reset your password', /reset your password/i],
  ['/no-such-page', 'Page not found', /page not found/i],
])('public page %s', (path, title, heading) => {
  test('has no axe violations, one h1 and its own title', async () => {
    const { container } = renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
    expect(document.title).toBe(title ? `${title} · FinTrack` : 'FinTrack');
  });
});

describe('signed-in shell', () => {
  test('has no axe violations and names the page in the title', async () => {
    const { container } = renderApp('/notifications', { user: TEST_USER });
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
    expect(document.title).toBe('Notifications · FinTrack');
  });

  test('a skip link leads to the main content', async () => {
    renderApp('/notifications', { user: TEST_USER });
    await screen.findByRole('heading', { level: 1, name: 'Notifications' });
    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  test('moving to another page puts focus on the new page content', async () => {
    renderApp('/notifications', { user: TEST_USER });
    await screen.findByRole('heading', { level: 1, name: 'Notifications' });
    expect(screen.getByRole('main')).not.toHaveFocus(); // not on first load
    await userEvent.click(screen.getAllByRole('link', { name: 'Security' })[0]);
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });

  test('the mobile menu takes focus, makes the page behind inert and gives focus back on Escape', async () => {
    renderApp('/notifications', { user: TEST_USER });
    await screen.findByRole('heading', { level: 1, name: 'Notifications' });
    const menuButton = screen.getByRole('button', { name: 'Open menu' });
    await userEvent.click(menuButton);
    const drawer = screen.getByRole('complementary', { name: 'Menu' });
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
    expect(screen.getByRole('main').closest('[inert]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Menu' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
    expect(screen.getByRole('main').closest('[inert]')).toBeNull();
  });
});
