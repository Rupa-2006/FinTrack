import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { Button, EmptyState, PageLoader } from '../components/ui/index.js';

// These guards decide what the browser shows. They are a convenience, not a security
// boundary: every API route enforces authentication and roles again on the server.

// Signed-in users only. Anonymous visitors go to /login and return here afterwards.
export function ProtectedRoute() {
  const { status, endedByUser } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoader label="Checking your session" />;
  if (status !== 'authenticated') {
    // After a deliberate sign-out the next person to sign in starts at the dashboard.
    const state = endedByUser ? undefined : { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

function AdminsOnly() {
  useDocumentTitle('Administrators only');
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Administrators only"
      titleAs="h1"
      description="Your account does not have permission to view this page."
      action={<Button to="/dashboard" variant="secondary">Back to dashboard</Button>}
    />
  );
}

// Administrators only. Signed-in non-admins see a 403 page instead of being bounced around.
export function AdminRoute() {
  const { isAdmin } = useAuth();
  return isAdmin ? <Outlet /> : <AdminsOnly />;
}

// Pages such as login and register: a signed-in user is sent to the app instead.
export function PublicOnlyRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoader label="Checking your session" />;
  if (status === 'authenticated') return <Navigate to={location.state?.from || '/dashboard'} replace />;
  return <Outlet />;
}
