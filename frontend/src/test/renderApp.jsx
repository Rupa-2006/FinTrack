import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthProvider.jsx';
import { AppRoutes } from '../routes/AppRoutes.jsx';

export const TEST_USER = { id: 1, fullName: 'Aarav Sharma', email: 'aarav@example.test', roles: ['USER'], baseCurrency: 'INR' };
export const TEST_ADMIN = { id: 2, fullName: 'Priya Nair', email: 'priya@example.test', roles: ['ADMIN', 'USER'], baseCurrency: 'INR' };

// Renders the whole route tree at `path`, optionally signed in as `user`.
export function renderApp(path = '/', { user = null } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={user ? { user } : null}>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>
  );
}

export function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}
