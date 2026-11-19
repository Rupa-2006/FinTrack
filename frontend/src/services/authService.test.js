// The refresh token works once, so callers that ask at the same moment must share one request.
import { api } from './apiClient.js';
import { login, logout, refreshSession, resetPassword } from './authService.js';

vi.mock('./apiClient.js', () => ({ api: { post: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

test('simultaneous refreshes share one request, and a later one sends a new request', async () => {
  let release;
  api.post.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  const first = refreshSession();
  const second = refreshSession();
  expect(api.post).toHaveBeenCalledTimes(1);
  release({ data: { accessToken: 'a', user: { id: 1 } } });
  await expect(first).resolves.toEqual({ accessToken: 'a', user: { id: 1 } });
  await expect(second).resolves.toEqual({ accessToken: 'a', user: { id: 1 } });

  api.post.mockResolvedValueOnce({ data: { accessToken: 'b' } });
  await expect(refreshSession()).resolves.toEqual({ accessToken: 'b' });
  expect(api.post).toHaveBeenCalledTimes(2);
});

test('a failed refresh is not cached', async () => {
  api.post.mockRejectedValueOnce(new Error('expired')).mockResolvedValueOnce({ data: { accessToken: 'c' } });
  await expect(refreshSession()).rejects.toThrow('expired');
  await expect(refreshSession()).resolves.toEqual({ accessToken: 'c' });
});

test('auth calls never trigger the automatic refresh-and-retry', async () => {
  api.post.mockResolvedValue({ data: {} });
  await login({ email: 'a@example.test', password: 'x' });
  await logout();
  await resetPassword('token', 'New-Passw0rd!!');
  await refreshSession();
  for (const call of api.post.mock.calls) expect(call[2]).toEqual({ skipAuthRefresh: true });
  expect(api.post).toHaveBeenCalledWith('/auth/reset-password', { token: 'token', password: 'New-Passw0rd!!' }, { skipAuthRefresh: true });
});
