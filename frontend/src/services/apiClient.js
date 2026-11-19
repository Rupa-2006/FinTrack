// The single Axios instance every service module uses.
//
//  - attaches the in-memory access token
//  - unwraps the API envelope: resolves with { data, meta }, rejects with ApiClientError
//  - on an expired token, refreshes once (shared by all concurrent requests) and retries
import axios from 'axios';
import { clearAccessToken, getAccessToken, setAccessToken } from './tokenStore.js';

export class ApiClientError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  // { "body.email": "message" } -> { email: "message" } for showing next to form fields
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      this.details.filter((item) => item?.field).map((item) => [item.field.replace(/^(body|query|params)\./, ''), item.message])
    );
  }
}

function toClientError(error) {
  if (error instanceof ApiClientError) return error;
  const response = error.response;
  if (!response) {
    return new ApiClientError({
      status: 0,
      code: error.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: 'Cannot reach the server. Check your connection and try again.',
    });
  }
  const apiError = response.data?.error;
  return new ApiClientError({
    status: response.status,
    code: apiError?.code || 'UNKNOWN_ERROR',
    message: apiError?.message || 'Something went wrong. Please try again.',
    details: apiError?.details,
    requestId: apiError?.requestId || response.headers?.['x-request-id'],
  });
}

export function createApiClient({ baseURL = import.meta.env.VITE_API_BASE_URL || '/api', adapter } = {}) {
  const client = axios.create({
    baseURL,
    timeout: 15000,
    withCredentials: true, // sends the httpOnly refresh cookie to /auth endpoints
    headers: { 'X-Requested-With': 'XMLHttpRequest' }, // custom header: part of the CSRF defence
    ...(adapter ? { adapter } : {}),
  });

  let refreshHandler = null; // () => Promise<string>  resolves with a new access token
  let sessionExpiredHandler = null;
  let refreshInFlight = null;

  function refreshOnce() {
    if (!refreshInFlight) {
      refreshInFlight = Promise.resolve()
        .then(() => refreshHandler())
        .finally(() => {
          refreshInFlight = null;
        });
    }
    return refreshInFlight;
  }

  client.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  client.interceptors.response.use(
    (response) => {
      // File downloads (CSV export) are not wrapped in the JSON envelope.
      if (response.config.responseType === 'blob') return { data: response.data, headers: response.headers, status: response.status };
      return { data: response.data?.data ?? null, meta: response.data?.meta, status: response.status };
    },
    async (error) => {
      const original = error.config;
      const status = error.response?.status;
      const canRefresh = status === 401 && refreshHandler && original && !original._retried && !original.skipAuthRefresh;
      if (!canRefresh) throw toClientError(error);

      original._retried = true;
      try {
        setAccessToken(await refreshOnce());
      } catch {
        clearAccessToken();
        sessionExpiredHandler?.();
        throw toClientError(error);
      }
      return client(original);
    }
  );

  return {
    client,
    get: (url, config) => client.get(url, config),
    post: (url, body, config) => client.post(url, body, config),
    put: (url, body, config) => client.put(url, body, config),
    patch: (url, body, config) => client.patch(url, body, config),
    delete: (url, config) => client.delete(url, config),
    // Registered by the auth layer (Phase 5).
    setRefreshHandler(handler) {
      refreshHandler = handler;
    },
    setSessionExpiredHandler(handler) {
      sessionExpiredHandler = handler;
    },
  };
}

export const api = createApiClient();
