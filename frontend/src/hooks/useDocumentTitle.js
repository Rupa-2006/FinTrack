import { useEffect } from 'react';

export const APP_NAME = 'FinTrack';

// Gives each page its own browser-tab title (WCAG 2.4.2), which screen readers also announce
// after navigation. `title` null or empty means the bare app name.
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = typeof title === 'string' && title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}
