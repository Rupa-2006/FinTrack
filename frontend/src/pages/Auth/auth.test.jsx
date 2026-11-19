import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../context/AuthProvider.jsx';
import { AppRoutes } from '../../routes/AppRoutes.jsx';
import { ApiClientError } from '../../services/apiClient.js';
import * as authService from '../../services/authService.js';
import { clearAccessToken, getAccessToken } from '../../services/tokenStore.js';
import * as userService from '../../services/userService.js';
import { renderApp, TEST_ADMIN, TEST_USER } from '../../test/renderApp.jsx';

vi.mock('../../services/healthService.js', () => ({ getReadiness: vi.fn().mockResolvedValue({ status: 'ready' }) }));
vi.mock('../../services/authService.js', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  refreshSession: vi.fn(),
}));
vi.mock('../../services/userService.js', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  deactivateAccount: vi.fn(),
}));

const STRONG = 'Tr1cky-Horse-Battery!';
const INPUT = { selector: 'input, select' }; // not the show/hide buttons, whose labels also mention the field
const SESSION = { user: TEST_USER, accessToken: 'header.payload.signature' };
const PROFILE = {
  ...TEST_USER, phone: '+91 98765 43210', status: 'ACTIVE', createdAt: '2026-03-02T10:00:00.000Z', lastLoginAt: null, passwordChangedAt: null,
};

const apiError = (fields) => new ApiClientError({ status: 400, code: 'VALIDATION_ERROR', message: 'Some fields are invalid', ...fields });

// The real app: no initial session, so the provider tries to restore one from the cookie.
function renderRealApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAccessToken();
  authService.logout.mockResolvedValue();
  userService.getProfile.mockResolvedValue(PROFILE);
});

describe('session restore on page load', () => {
  test('a visitor with a valid refresh cookie lands back on the page they asked for', async () => {
    authService.refreshSession.mockResolvedValue(SESSION);
    renderRealApp('/budgets');
    expect(screen.getByText('Checking your session')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Budgets' })).toBeInTheDocument();
    expect(getAccessToken()).toBe(SESSION.accessToken);
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  test('a visitor without one is sent to sign in', async () => {
    authService.refreshSession.mockRejectedValue(new ApiClientError({ status: 401, code: 'UNAUTHENTICATED', message: 'ended' }));
    renderRealApp('/budgets');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });
});

describe('sign-in page', () => {
  test('signs in and continues to the page the visitor first asked for', async () => {
    authService.login.mockResolvedValue(SESSION);
    renderApp('/goals');
    await userEvent.type(screen.getByLabelText(/email address/i, INPUT), 'aarav@example.test');
    await userEvent.type(screen.getByLabelText(/^password/i, INPUT), STRONG);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Savings goals' })).toBeInTheDocument();
    expect(authService.login).toHaveBeenCalledWith({ email: 'aarav@example.test', password: STRONG });
    expect(getAccessToken()).toBe(SESSION.accessToken);
  });

  test('shows the server message for wrong credentials and stays on the page', async () => {
    authService.login.mockRejectedValue(new ApiClientError({ status: 401, code: 'UNAUTHENTICATED', message: 'Incorrect email or password' }));
    renderApp('/login');
    await userEvent.type(screen.getByLabelText(/email address/i, INPUT), 'aarav@example.test');
    await userEvent.type(screen.getByLabelText(/^password/i, INPUT), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(getAccessToken()).toBeNull();
  });

  test('the password can be shown and hidden', async () => {
    renderApp('/login');
    const field = screen.getByLabelText(/^password/i, INPUT);
    expect(field).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(field).toHaveAttribute('type', 'password');
  });
});

describe('registration page', () => {
  async function fill({ password = STRONG, confirm = password } = {}) {
    await userEvent.type(screen.getByLabelText(/full name/i, INPUT), 'Aarav Sharma');
    await userEvent.type(screen.getByLabelText(/email address/i, INPUT), 'aarav@example.test');
    await userEvent.type(screen.getByLabelText(/^password/i, INPUT), password);
    await userEvent.type(screen.getByLabelText(/confirm password/i, INPUT), confirm);
  }

  test('creates the account with the chosen currency and opens the dashboard', async () => {
    authService.register.mockResolvedValue(SESSION);
    renderApp('/register');
    await fill();
    await userEvent.selectOptions(screen.getByLabelText(/main currency/i, INPUT), 'EUR');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(authService.register).toHaveBeenCalledWith({ fullName: 'Aarav Sharma', email: 'aarav@example.test', password: STRONG, baseCurrency: 'EUR' });
  });

  test('the checklist follows the password as it is typed', async () => {
    renderApp('/register');
    await userEvent.type(screen.getByLabelText(/^password/i, INPUT), 'abc');
    expect(screen.getByText('A lowercase letter').closest('li')).toHaveTextContent('(met)');
    expect(screen.getByText('At least 10 characters').closest('li')).toHaveTextContent('(not met yet)');
  });

  test('a weak or mismatched password is stopped before anything is sent', async () => {
    renderApp('/register');
    await fill({ password: 'weak', confirm: 'different' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Your password does not meet all the rules below')).toBeInTheDocument();
    expect(screen.getByText('The two passwords do not match')).toBeInTheDocument();
    expect(authService.register).not.toHaveBeenCalled();
  });

  test('server-side field errors appear next to their fields', async () => {
    authService.register.mockRejectedValue(apiError({ details: [{ field: 'body.password', message: 'This password is too common' }] }));
    renderApp('/register');
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('This password is too common')).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i, INPUT)).toHaveAttribute('aria-invalid', 'true');
  });

  test('an address that is already registered is reported', async () => {
    authService.register.mockRejectedValue(new ApiClientError({ status: 409, code: 'CONFLICT', message: 'An account with this email address already exists' }));
    renderApp('/register');
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });
});

describe('password reset pages', () => {
  test('asking for a link shows the same neutral confirmation', async () => {
    authService.forgotPassword.mockResolvedValue({ message: 'If an account exists for that email address, a reset link has been sent.' });
    renderApp('/forgot-password');
    await userEvent.type(screen.getByLabelText(/email address/i, INPUT), ' aarav@example.test ');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an account exists/)).toBeInTheDocument();
    expect(authService.forgotPassword).toHaveBeenCalledWith('aarav@example.test');
  });

  test('the reset page without a token explains what to do', () => {
    renderApp('/reset-password');
    expect(screen.getByText('This link is not valid')).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i, INPUT)).not.toBeInTheDocument();
  });

  test('a new password is sent with the token from the link, then sign-in confirms it', async () => {
    authService.resetPassword.mockResolvedValue({ message: 'Your password has been changed. Please sign in with your new password.' });
    renderApp('/reset-password#token=abc123tokenvalue');
    await userEvent.type(screen.getByLabelText(/^new password/i, INPUT), STRONG);
    await userEvent.type(screen.getByLabelText(/confirm new password/i, INPUT), STRONG);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Your password has been changed/)).toBeInTheDocument();
    expect(authService.resetPassword).toHaveBeenCalledWith('abc123tokenvalue', STRONG);
  });

  test('an expired link is reported with a way to get a new one', async () => {
    authService.resetPassword.mockRejectedValue(new ApiClientError({ status: 400, code: 'BAD_REQUEST', message: 'This reset link is invalid or has expired. Please request a new one.' }));
    renderApp('/reset-password#token=abc123tokenvalue');
    await userEvent.type(screen.getByLabelText(/^new password/i, INPUT), STRONG);
    await userEvent.type(screen.getByLabelText(/confirm new password/i, INPUT), STRONG);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
  });
});

describe('profile page', () => {
  test('shows the profile and saves changes, updating the name in the shell', async () => {
    userService.updateProfile.mockResolvedValue({ ...PROFILE, fullName: 'Aarav K Sharma', phone: null });
    renderApp('/profile', { user: TEST_USER });
    const name = await screen.findByLabelText(/full name/i, INPUT);
    expect(name).toHaveValue('Aarav Sharma');
    expect(screen.getByLabelText(/phone number/i, INPUT)).toHaveValue('+91 98765 43210');
    expect(screen.getByText('aarav@example.test', { selector: 'dd' })).toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, 'Aarav K Sharma');
    await userEvent.clear(screen.getByLabelText(/phone number/i, INPUT));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Your profile has been saved.')).toBeInTheDocument();
    expect(userService.updateProfile).toHaveBeenCalledWith({ fullName: 'Aarav K Sharma', phone: '' });
    expect(screen.getAllByText('Aarav K Sharma').length).toBeGreaterThan(0); // sidebar
  });

  test('a load failure offers a retry', async () => {
    userService.getProfile.mockRejectedValueOnce(new ApiClientError({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server.' }));
    renderApp('/profile', { user: TEST_USER });
    expect(await screen.findByText('Your profile could not be loaded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText(/full name/i, INPUT)).toBeInTheDocument();
  });

  test('changes the password and reports how many other devices were signed out', async () => {
    userService.changePassword.mockResolvedValue({ otherSessionsRevoked: 2 });
    renderApp('/profile', { user: TEST_USER });
    await userEvent.type(await screen.findByLabelText(/current password/i, INPUT), 'Old-Passw0rd-Here!');
    await userEvent.type(screen.getByLabelText(/^new password/i, INPUT), STRONG);
    await userEvent.type(screen.getByLabelText(/confirm new password/i, INPUT), STRONG);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your password has been changed. 2 other devices were signed out.')).toBeInTheDocument();
    expect(userService.changePassword).toHaveBeenCalledWith({ currentPassword: 'Old-Passw0rd-Here!', newPassword: STRONG });
    expect(screen.getByLabelText(/current password/i, INPUT)).toHaveValue('');
  });

  test('a wrong current password is shown on that field', async () => {
    userService.changePassword.mockRejectedValue(apiError({ details: [{ field: 'body.currentPassword', message: 'Your current password is incorrect' }] }));
    renderApp('/profile', { user: TEST_USER });
    await userEvent.type(await screen.findByLabelText(/current password/i, INPUT), 'Wrong-Passw0rd!!');
    await userEvent.type(screen.getByLabelText(/^new password/i, INPUT), STRONG);
    await userEvent.type(screen.getByLabelText(/confirm new password/i, INPUT), STRONG);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your current password is incorrect')).toBeInTheDocument();
  });

  test('deactivation asks for the password, then signs the user out', async () => {
    userService.deactivateAccount.mockResolvedValue();
    renderApp('/profile', { user: TEST_USER });
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate my account' }));
    expect(userService.deactivateAccount).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/your password/i, INPUT), STRONG);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Your account has been deactivated/)).toBeInTheDocument();
    expect(userService.deactivateAccount).toHaveBeenCalledWith(STRONG);
    await waitFor(() => expect(getAccessToken()).toBeNull());
  });

  test('administrators are not offered self-deactivation', async () => {
    userService.getProfile.mockResolvedValue({ ...PROFILE, ...TEST_ADMIN });
    renderApp('/profile', { user: TEST_ADMIN });
    expect(await screen.findByLabelText(/full name/i, INPUT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate my account' })).not.toBeInTheDocument();
  });
});
