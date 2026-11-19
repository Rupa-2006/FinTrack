import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext } from './authContext.js';
import { api } from '../services/apiClient.js';
import * as authService from '../services/authService.js';
import { clearAccessToken, setAccessToken } from '../services/tokenStore.js';

const ANONYMOUS = { status: 'anonymous', user: null };

// Holds who is signed in. Session state is memory-only: nothing about the user or the token
// is written to browser storage. After a page reload the session is restored by exchanging
// the httpOnly refresh cookie (which JavaScript cannot read) for a new access token.
//
// status: 'loading' (restoring a session) | 'authenticated' | 'anonymous'
//
// initialSession: undefined -> restore from the cookie (the real app)
//                 null      -> start signed out, no network call (tests)
//                 { user }  -> start signed in (tests, the /dev preview)
export function AuthProvider({ initialSession, children }) {
  const [session, setSessionState] = useState(() => {
    if (initialSession === undefined) return { status: 'loading', user: null };
    return initialSession ? { status: 'authenticated', user: initialSession.user } : ANONYMOUS;
  });

  const setSession = useCallback(({ user, accessToken }) => {
    setAccessToken(accessToken);
    setSessionState({ status: 'authenticated', user });
  }, []);

  // endedByUser: the user chose to leave (sign-out, deactivation), so the sign-in page
  // should not send the next person back to the page this user was on.
  // notice: a message for the sign-in page.
  const clearSession = useCallback((options) => {
    clearAccessToken();
    setSessionState({ ...ANONYMOUS, endedByUser: options?.endedByUser === true, notice: typeof options?.notice === 'string' ? options.notice : null });
  }, []);

  // Lets the API client renew an expired access token, and tells us when it cannot.
  useEffect(() => {
    api.setRefreshHandler(async () => {
      const refreshed = await authService.refreshSession();
      setSessionState({ status: 'authenticated', user: refreshed.user });
      return refreshed.accessToken;
    });
    api.setSessionExpiredHandler(() => setSessionState(ANONYMOUS));
    return () => {
      api.setRefreshHandler(null);
      api.setSessionExpiredHandler(null);
    };
  }, []);

  // Restore the session once on page load.
  useEffect(() => {
    if (initialSession !== undefined) return undefined;
    let active = true;
    authService.refreshSession().then(
      (restored) => active && setSession(restored),
      () => active && clearSession()
    );
    return () => {
      active = false;
    };
  }, [initialSession, setSession, clearSession]);

  // Resolves { mfaRequired: true, challengeToken } when a code is needed next, else signs in.
  const login = useCallback(async (credentials) => {
    const result = await authService.login(credentials);
    if (result.mfaRequired) return result;
    setSession(result);
    return { mfaRequired: false };
  }, [setSession]);

  const verifyMfa = useCallback(async (challengeToken, code) => setSession(await authService.verifyMfa(challengeToken, code)), [setSession]);

  const register = useCallback(async (details) => setSession(await authService.register(details)), [setSession]);

  // The local session ends at once, even if the server cannot be reached; the server
  // session is revoked in the background (that request needs only the cookie).
  const logout = useCallback(() => {
    const serverLogout = authService.logout().catch(() => {
      // nothing to do: the refresh cookie expires on its own
    });
    clearSession({ endedByUser: true });
    return serverLogout;
  }, [clearSession]);

  const updateUser = useCallback((changes) => {
    setSessionState((current) => (current.user ? { ...current, user: { ...current.user, ...changes } } : current));
  }, []);

  const value = useMemo(() => {
    const roles = session.user?.roles ?? [];
    return {
      status: session.status,
      user: session.user,
      isAuthenticated: session.status === 'authenticated',
      isAdmin: roles.includes('ADMIN'),
      hasRole: (role) => roles.includes(role),
      endedByUser: session.endedByUser === true,
      notice: session.notice ?? null,
      login,
      verifyMfa,
      register,
      logout,
      updateUser,
      setSession,
      clearSession,
    };
  }, [session, login, verifyMfa, register, logout, updateUser, setSession, clearSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
