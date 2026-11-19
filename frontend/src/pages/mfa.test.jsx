// Two-step sign-in in the browser: the code step after the password, and setup on the
// Security page. The API is mocked.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClientError } from '../services/apiClient.js';
import * as authService from '../services/authService.js';
import * as security from '../services/securityService.js';
import { renderApp, TEST_USER } from '../test/renderApp.jsx';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') } }));
vi.mock('../services/healthService.js', () => ({ getReadiness: vi.fn().mockResolvedValue({ status: 'ready' }) }));
vi.mock('../services/authService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn()])), refreshSession: vi.fn().mockRejectedValue(new Error('none')) };
});
vi.mock('../services/securityService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn()]));
});
vi.mock('../services/ledgerService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn().mockResolvedValue(null)])), getUnreadCount: vi.fn().mockResolvedValue(0) };
});
vi.mock('../utils/download.js', () => ({ saveBlob: vi.fn() }));

const findInputs = { selector: 'input' };
const CODES = ['k7mq-2xnd', 'a2b3-c4d5', 'e6f7-g8h9', 'j2k3-m4n5', 'p6q7-r8s9', 't2u3-v4w5', 'x6y7-z8a9', 'b2c3-d4e5', 'f6g7-h8j9', 'k2m3-n4p5'];

beforeEach(() => {
  vi.clearAllMocks();
  authService.refreshSession.mockRejectedValue(new Error('signed out'));
});

async function passwordStep() {
  renderApp('/login');
  await userEvent.type(await screen.findByLabelText(/email address/i, findInputs), 'aarav@example.test');
  await userEvent.type(screen.getByLabelText(/^password/i, findInputs), 'Correct-Horse-9!');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in with two-step sign-in', () => {
  test('after the password, a code completes the sign-in', async () => {
    authService.login.mockResolvedValue({ mfaRequired: true, challengeToken: 'challenge-token-1234567890', expiresInMinutes: 5 });
    authService.verifyMfa.mockResolvedValue({ user: TEST_USER, accessToken: 'token' });
    await passwordStep();
    expect(await screen.findByRole('heading', { level: 1, name: 'Two-step sign-in' })).toBeInTheDocument();
    const code = screen.getByLabelText(/^authentication code/i, findInputs);
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    await userEvent.type(code, '12a34 56');
    expect(code).toHaveValue('1234 56'); // digits and spaces only
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(authService.verifyMfa).toHaveBeenCalledWith('challenge-token-1234567890', '1234 56'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });

  test('a wrong code can be retried; a recovery code can be used instead', async () => {
    authService.login.mockResolvedValue({ mfaRequired: true, challengeToken: 'challenge-token-1234567890', expiresInMinutes: 5 });
    authService.verifyMfa
      .mockRejectedValueOnce(new ApiClientError({ status: 401, code: 'UNAUTHENTICATED', message: 'That code is not correct. Check the time on your phone and try again.' }))
      .mockResolvedValueOnce({ user: TEST_USER, accessToken: 'token' });
    await passwordStep();
    await userEvent.type(await screen.findByLabelText(/^authentication code/i, findInputs), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/That code is not correct/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /use a recovery code/i }));
    await userEvent.type(screen.getByLabelText(/^recovery code/i, findInputs), 'k7mq-2xnd');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(authService.verifyMfa).toHaveBeenLastCalledWith('challenge-token-1234567890', 'k7mq-2xnd'));
  });

  test('an expired challenge or a lockout goes back to the password step with the reason', async () => {
    authService.login.mockResolvedValue({ mfaRequired: true, challengeToken: 'challenge-token-1234567890', expiresInMinutes: 5 });
    authService.verifyMfa.mockRejectedValue(new ApiClientError({ status: 423, code: 'ACCOUNT_LOCKED', message: 'Too many failed sign-in attempts. Try again in 15 minutes.' }));
    await passwordStep();
    await userEvent.type(await screen.findByLabelText(/^authentication code/i, findInputs), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Try again in 15 minutes/)).toBeInTheDocument();
  });

  test('without two-step sign-in, the password alone signs in', async () => {
    authService.login.mockResolvedValue({ user: TEST_USER, accessToken: 'token' });
    await passwordStep();
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(authService.verifyMfa).not.toHaveBeenCalled();
  });
});

describe('setting it up on the Security page', () => {
  beforeEach(() => {
    security.listSessions.mockResolvedValue([]);
    security.listSecurityEvents.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } });
    security.listActivity.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } });
  });

  test('scan, confirm with a code, then save the recovery codes', async () => {
    security.getMfaStatus.mockResolvedValueOnce({ enabled: false, enabledAt: null, recoveryCodesLeft: 0 })
      .mockResolvedValue({ enabled: true, enabledAt: '2026-11-18T06:00:00.000Z', recoveryCodesLeft: 10 });
    security.startMfaSetup.mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/FinTrack:a?secret=JBSWY3DPEHPK3PXP' });
    security.enableMfa.mockResolvedValue({ enabled: true, recoveryCodes: CODES });
    renderApp('/security', { user: TEST_USER });
    const card = await screen.findByRole('region', { name: /two-step sign-in/i });
    expect(within(card).getByText('Off')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Set up two-step sign-in' }));
    expect(await within(card).findByRole('img', { name: 'QR code for your authenticator app' })).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(within(card).getByLabelText('Setup key')).toHaveTextContent('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    await userEvent.type(within(card).getByLabelText('Code from the app', findInputs), '123456');
    await userEvent.click(within(card).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(security.enableMfa).toHaveBeenCalledWith('123456'));
    const list = await within(card).findByRole('list', { name: 'Recovery codes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    await userEvent.click(within(card).getByRole('button', { name: 'Download' }));
    const { saveBlob } = await import('../utils/download.js');
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'fintrack-recovery-codes.txt');
    await userEvent.click(within(card).getByRole('button', { name: 'I have saved them' }));
    expect(await within(card).findByText('On')).toBeInTheDocument();
    expect(within(card).getByText(/10 of 10 recovery codes left/)).toBeInTheDocument();
  });

  test('turning it off needs the password and a code', async () => {
    security.getMfaStatus.mockResolvedValue({ enabled: true, enabledAt: '2026-11-18T06:00:00.000Z', recoveryCodesLeft: 2 });
    security.disableMfa.mockRejectedValueOnce(new ApiClientError({ status: 400, code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details: [{ field: 'body.code', message: 'That code is not correct.' }] }));
    renderApp('/security', { user: TEST_USER });
    const card = await screen.findByRole('region', { name: /two-step sign-in/i });
    expect(within(card).getByText(/2 of 10 recovery codes left: create new ones soon/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Turn off' }));
    const submit = within(card).getByRole('button', { name: 'Turn off two-step sign-in' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(card).getByLabelText('Current password', findInputs), 'Correct-Horse-9!');
    await userEvent.type(within(card).getByLabelText('Authentication or recovery code', findInputs), '000000');
    await userEvent.click(submit);
    expect(await within(card).findByText('That code is not correct.')).toBeInTheDocument();
    expect(security.disableMfa).toHaveBeenCalledWith({ password: 'Correct-Horse-9!', code: '000000' });
  });
});
