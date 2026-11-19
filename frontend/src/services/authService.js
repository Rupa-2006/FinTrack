// Calls to /api/auth. These never trigger the automatic "refresh and retry" themselves.
import { api } from './apiClient.js';

const NO_REFRESH = { skipAuthRefresh: true };

export const login = (credentials) => api.post('/auth/login', credentials, NO_REFRESH).then((res) => res.data);

// Second step of a two-step sign-in: the challenge from login() plus an authenticator or recovery code.
export const verifyMfa = (challengeToken, code) => api.post('/auth/mfa/verify', { challengeToken, code }, NO_REFRESH).then((res) => res.data);

export const register = (details) => api.post('/auth/register', details, NO_REFRESH).then((res) => res.data);

export const logout = () => api.post('/auth/logout', null, NO_REFRESH);

export const forgotPassword = (email) => api.post('/auth/forgot-password', { email }, NO_REFRESH).then((res) => res.data);

export const resetPassword = (token, password) =>
  api.post('/auth/reset-password', { token, password }, NO_REFRESH).then((res) => res.data);

// Exchanges the httpOnly refresh cookie for { user, accessToken }.
// A refresh token works once, so simultaneous callers must share a single request:
// sending it twice would look like token theft to the server and end the session.
let refreshInFlight = null;
export function refreshSession() {
  refreshInFlight ??= api
    .post('/auth/refresh', null, NO_REFRESH)
    .then((res) => res.data)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}
