import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { logout } from '../services/authService.js';
import { getReadiness } from '../services/healthService.js';
import { getUnreadCount } from '../services/ledgerService.js';
import { getAccessToken } from '../services/tokenStore.js';
import { renderApp, TEST_ADMIN, TEST_USER } from '../test/renderApp.jsx';
import { ADMIN_NAV, EXTRA_APP_ROUTES, NAV_SECTIONS, PUBLIC_AUTH_ROUTES } from './navigation.js';

vi.mock('../services/healthService.js', () => ({ getReadiness: vi.fn() }));
vi.mock('../services/authService.js', () => ({ logout: vi.fn().mockResolvedValue(), refreshSession: vi.fn() }));
vi.mock('../services/userService.js', () => ({ getProfile: vi.fn(() => new Promise(() => {})) }));
vi.mock('../services/securityService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn(() => new Promise(() => {}))]));
});
vi.mock('../services/assistantService.js', () => ({ getInsights: vi.fn(() => new Promise(() => {})), askQuestion: vi.fn() }));
// Page data never arrives here: these tests are about routing, so pages stay in their loading state.
vi.mock('../services/ledgerService.js', async (importOriginal) => {
  const actual = await importOriginal();
  const pending = () => new Promise(() => {});
  return Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn(name === 'getUnreadCount' ? () => Promise.resolve(0) : pending)]));
});

const USER_PAGES = [...NAV_SECTIONS.flatMap((section) => section.items), ...EXTRA_APP_ROUTES];

beforeEach(() => {
  getReadiness.mockResolvedValue({ status: 'ready', checks: { database: 'up' }, schemaVersion: '006' });
});

describe('landing page', () => {
  test('shows the headline, the three sections and working calls to action', async () => {
    renderApp('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/know where your money goes/i);
    for (const name of [/everything you need/i, /secured like a fintech product/i, /how it works/i]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('link', { name: /get started/i })[0]).toHaveAttribute('href', '/register');
    expect(screen.getAllByRole('link', { name: /sign in/i })[0]).toHaveAttribute('href', '/login');
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
  });

  test('reports when the API is unavailable', async () => {
    getReadiness.mockRejectedValue(new Error('down'));
    renderApp('/');
    expect(await screen.findByText('Service currently unavailable')).toBeInTheDocument();
  });

  test('labels its sample figures as an illustration', () => {
    renderApp('/');
    expect(screen.getByRole('img', { name: /illustration of the fintrack dashboard with sample figures/i })).toBeInTheDocument();
  });
});

describe('route protection', () => {
  test.each(USER_PAGES.map((page) => page.to).concat('/admin'))('an anonymous visitor to %s is sent to sign in', (path) => {
    renderApp(path);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  test.each(USER_PAGES)('a signed-in user can open $to', async (page) => {
    renderApp(page.to, { user: TEST_USER });
    expect(await screen.findByRole('heading', { level: 1, name: page.label })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  test('a signed-in non-admin is refused the admin page and has no admin link', () => {
    renderApp('/admin', { user: TEST_USER });
    expect(screen.getByRole('heading', { name: 'Administrators only' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: ADMIN_NAV.items[0].label })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin dashboard' })).not.toBeInTheDocument();
  });

  test('an administrator sees the admin page and the admin link', () => {
    renderApp('/admin', { user: TEST_ADMIN });
    expect(screen.getByRole('heading', { level: 1, name: 'Admin dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Admin dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Administrator')).toBeInTheDocument();
  });

  test.each(PUBLIC_AUTH_ROUTES.map((page) => page.to))('a signed-in user visiting %s is sent to the dashboard', async (path) => {
    renderApp(path, { user: TEST_USER });
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });

  test('unknown addresses show the not-found page', () => {
    renderApp('/definitely/not/here');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  test('the development page is available in development builds', async () => {
    renderApp('/dev');
    expect(await screen.findByRole('heading', { level: 1, name: 'Design system' })).toBeInTheDocument();
  });
});

describe('app shell', () => {
  test('lists every section, marks the current page and shows who is signed in', () => {
    renderApp('/budgets', { user: TEST_USER });
    const nav = within(screen.getByRole('navigation', { name: 'Main' }));
    for (const item of NAV_SECTIONS.flatMap((section) => section.items)) {
      expect(nav.getByRole('link', { name: item.label })).toHaveAttribute('href', item.to);
    }
    expect(nav.getByRole('link', { name: 'Budgets' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Aarav Sharma')).toBeInTheDocument();
    expect(screen.getByText('aarav@example.test')).toBeInTheDocument();
  });

  test('navigating between pages keeps the shell and changes the content', async () => {
    renderApp('/dashboard', { user: TEST_USER });
    await userEvent.click(screen.getByRole('link', { name: 'Savings goals' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Savings goals' })).toBeInTheDocument();
    // The bell in the top bar is a second route to the same page.
    await userEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Notifications' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
  });

  test('the mobile menu opens, closes with Escape and closes after choosing a page', async () => {
    renderApp('/dashboard', { user: TEST_USER });
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(2); // desktop sidebar + drawer
    await userEvent.keyboard('{Escape}');
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getAllByRole('link', { name: 'Transactions' })[1]);
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Transactions' })).toBeInTheDocument();
  });

  test('signing out clears the session and locks the app again', async () => {
    renderApp('/dashboard', { user: TEST_USER });
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1); // the server session is ended too
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.queryByText('Aarav Sharma')).not.toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });

  test('the bell shows how many notifications are unread', async () => {
    getUnreadCount.mockResolvedValue(3);
    renderApp('/dashboard', { user: TEST_USER });
    expect(await within(screen.getByRole('banner')).findByRole('link', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
  });

  test.each(USER_PAGES.concat(ADMIN_NAV.items))('$to is a built page, not a placeholder', async (page) => {
    renderApp(page.to, { user: TEST_ADMIN });
    await screen.findByRole('heading', { level: 1, name: page.label });
    expect(screen.queryByText(/Not built yet/)).not.toBeInTheDocument();
    expect(document.title).toBe(`${page.label} · FinTrack`); // WCAG 2.4.2: each page names itself
  });

  test('the refusal page for non-admins has its own title', () => {
    renderApp('/admin', { user: TEST_USER });
    expect(document.title).toBe('Administrators only · FinTrack');
  });
});

describe('session storage', () => {
  test('nothing about the session is written to browser storage', async () => {
    renderApp('/dev');
    await userEvent.click(await screen.findByRole('button', { name: 'Open as administrator' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });
});
