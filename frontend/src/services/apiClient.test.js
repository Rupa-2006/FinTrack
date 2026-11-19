import { AxiosError } from 'axios';
import { ApiClientError, createApiClient } from './apiClient.js';
import { clearAccessToken, getAccessToken, setAccessToken } from './tokenStore.js';

// A fake transport: `handler(config)` returns { status, data, headers } and the adapter
// resolves or rejects the way a real HTTP adapter would.
function clientWith(handler) {
  const calls = [];
  const adapter = async (config) => {
    calls.push(config);
    const result = await handler(config, calls.length);
    if (result === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    const response = { status: result.status, statusText: '', headers: result.headers || {}, data: result.data, config };
    if (result.status >= 200 && result.status < 300) return response;
    throw new AxiosError(`Request failed with status code ${result.status}`, 'ERR_BAD_REQUEST', config, null, response);
  };
  return { api: createApiClient({ baseURL: '/api', adapter }), calls };
}

const ok = (data, meta) => ({ status: 200, data: { success: true, data, meta } });
const fail = (status, error) => ({ status, data: { success: false, error } });
const authHeader = (config) => config.headers.Authorization ?? config.headers.get?.('Authorization');

beforeEach(() => clearAccessToken());

describe('api client', () => {
  test('unwraps the success envelope into { data, meta }', async () => {
    const { api } = clientWith(() => ok([{ id: 1 }], { pagination: { page: 1 } }));
    const result = await api.get('/transactions');
    expect(result.data).toEqual([{ id: 1 }]);
    expect(result.meta).toEqual({ pagination: { page: 1 } });
  });

  test('sends credentials, the CSRF header, and the bearer token only when one exists', async () => {
    const { api, calls } = clientWith(() => ok(null));
    await api.get('/health');
    expect(authHeader(calls[0])).toBeUndefined();
    expect(calls[0].withCredentials).toBe(true);
    expect(calls[0].headers['X-Requested-With']).toBe('XMLHttpRequest');
    setAccessToken('token-123');
    await api.get('/health');
    expect(authHeader(calls[1])).toBe('Bearer token-123');
  });

  test('turns an API error into ApiClientError with code, message, request id and field errors', async () => {
    const { api } = clientWith(() =>
      fail(400, {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        requestId: 'req-1',
        details: [{ field: 'body.amount', message: 'Amount must be greater than 0' }, { field: 'body.email', message: 'Enter a valid email' }],
      })
    );
    const error = await api.post('/transactions', {}).catch((err) => err);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Some fields are invalid', requestId: 'req-1' });
    expect(error.fieldErrors).toEqual({ amount: 'Amount must be greater than 0', email: 'Enter a valid email' });
  });

  test('a network failure becomes a readable error, not a raw exception', async () => {
    const { api } = clientWith(() => 'network');
    const error = await api.get('/health').catch((err) => err);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(error.message).toMatch(/cannot reach the server/i);
  });

  test('a non-JSON error response still produces a safe message', async () => {
    const { api } = clientWith(() => ({ status: 502, data: '<html>Bad Gateway</html>' }));
    const error = await api.get('/health').catch((err) => err);
    expect(error).toMatchObject({ status: 502, code: 'UNKNOWN_ERROR' });
    expect(error.message).not.toMatch(/html/i);
  });

  test('without a refresh handler a 401 is simply returned', async () => {
    const { api, calls } = clientWith(() => fail(401, { code: 'UNAUTHENTICATED', message: 'Authentication is required' }));
    const error = await api.get('/transactions').catch((err) => err);
    expect(error.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  test('on 401 it refreshes once, stores the new token and retries the request', async () => {
    setAccessToken('expired');
    const { api, calls } = clientWith((config) =>
      authHeader(config) === 'Bearer fresh' ? ok({ id: 7 }) : fail(401, { code: 'UNAUTHENTICATED', message: 'expired' })
    );
    const refresh = vi.fn().mockResolvedValue('fresh');
    api.setRefreshHandler(refresh);
    const result = await api.get('/transactions/7');
    expect(result.data).toEqual({ id: 7 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('fresh');
    expect(calls).toHaveLength(2);
  });

  test('concurrent 401s share a single refresh', async () => {
    setAccessToken('expired');
    const { api } = clientWith((config) =>
      authHeader(config) === 'Bearer fresh' ? ok(config.url) : fail(401, { code: 'UNAUTHENTICATED', message: 'expired' })
    );
    const refresh = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('fresh'), 10)));
    api.setRefreshHandler(refresh);
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(results.map((r) => r.data)).toEqual(['/a', '/b', '/c']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('when the refresh fails the token is cleared and the session-expired handler runs', async () => {
    setAccessToken('expired');
    const { api, calls } = clientWith(() => fail(401, { code: 'UNAUTHENTICATED', message: 'expired' }));
    const expired = vi.fn();
    api.setRefreshHandler(vi.fn().mockRejectedValue(new Error('refresh rejected')));
    api.setSessionExpiredHandler(expired);
    const error = await api.get('/transactions').catch((err) => err);
    expect(error.status).toBe(401);
    expect(getAccessToken()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1); // not retried
  });

  test('a request that still gets 401 after refreshing is not retried forever', async () => {
    const { api, calls } = clientWith(() => fail(401, { code: 'UNAUTHENTICATED', message: 'no' }));
    const refresh = vi.fn().mockResolvedValue('fresh');
    api.setRefreshHandler(refresh);
    await api.get('/transactions').catch((err) => err);
    expect(calls).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('requests marked skipAuthRefresh never trigger a refresh', async () => {
    const { api } = clientWith(() => fail(401, { code: 'UNAUTHENTICATED', message: 'no' }));
    const refresh = vi.fn().mockResolvedValue('fresh');
    api.setRefreshHandler(refresh);
    await api.post('/auth/refresh', null, { skipAuthRefresh: true }).catch((err) => err);
    expect(refresh).not.toHaveBeenCalled();
  });
});
