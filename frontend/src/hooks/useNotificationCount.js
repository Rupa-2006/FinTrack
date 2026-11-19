import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getUnreadCount } from '../services/ledgerService.js';

const POLL_MS = 60 * 1000;
const NotificationCountContext = createContext({ count: 0, refresh: () => {} });

// Keeps the unread-notification count for the bell in the top bar. It is fetched when the
// signed-in shell opens, every minute while it stays open, and after any page reports a change.
export function NotificationCountProvider({ children }) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    getUnreadCount().then(setCount, () => {
      // a failed count is not worth an error message; the bell just keeps its last value
    });
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return createElement(NotificationCountContext.Provider, { value }, children);
}

export function useNotificationCount() {
  return useContext(NotificationCountContext);
}
