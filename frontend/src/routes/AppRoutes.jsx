import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { PageLoader } from '../components/ui/index.js';
import { AppLayout } from '../layouts/AppLayout.jsx';
import { PublicLayout } from '../layouts/PublicLayout.jsx';
import { AdminPage } from '../pages/Admin/AdminPage.jsx';
import { AssistantPage } from '../pages/Assistant/AssistantPage.jsx';
import { BudgetsPage } from '../pages/Budgets/BudgetsPage.jsx';
import { SecurityPage } from '../pages/Security/SecurityPage.jsx';
import { CurrenciesPage } from '../pages/Currencies/CurrenciesPage.jsx';
import { GoalsPage } from '../pages/Goals/GoalsPage.jsx';
import { NotificationsPage } from '../pages/Notifications/NotificationsPage.jsx';
import { TransactionFormPage } from '../pages/Transactions/TransactionFormPage.jsx';
import { TransactionsPage } from '../pages/Transactions/TransactionsPage.jsx';
import { RecurringPage } from '../pages/Recurring/RecurringPage.jsx';
import { ImportPage } from '../pages/Transactions/ImportPage.jsx';
import { ForgotPasswordPage } from '../pages/Auth/ForgotPasswordPage.jsx';
import { LoginPage } from '../pages/Auth/LoginPage.jsx';
import { RegisterPage } from '../pages/Auth/RegisterPage.jsx';
import { ResetPasswordPage } from '../pages/Auth/ResetPasswordPage.jsx';
import { LandingPage } from '../pages/Landing/LandingPage.jsx';
import { ProfilePage } from '../pages/Profile/ProfilePage.jsx';
import { NotFoundPage } from '../pages/NotFound/NotFoundPage.jsx';
import { UpcomingPage } from '../pages/Upcoming/UpcomingPage.jsx';
import { AdminRoute, ProtectedRoute, PublicOnlyRoute } from './guards.jsx';
import { ADMIN_NAV, EXTRA_APP_ROUTES, NAV_SECTIONS, PUBLIC_AUTH_ROUTES } from './navigation.js';

// The chart pages carry the charting library, so they load on first visit rather than
// with the landing page.
const DashboardPage = lazy(() => import('../pages/Dashboard/DashboardPage.jsx').then((module) => ({ default: module.DashboardPage })));
const AnalyticsPage = lazy(() => import('../pages/Analytics/AnalyticsPage.jsx').then((module) => ({ default: module.AnalyticsPage })));

// Loaded only in development; the import is removed from production bundles.
const DevPage = import.meta.env.DEV ? lazy(() => import('../pages/Dev/DevPage.jsx').then((module) => ({ default: module.DevPage }))) : null;

const USER_PAGES = [...NAV_SECTIONS.flatMap((section) => section.items), ...EXTRA_APP_ROUTES];

// Pages that are built. Any other route in navigation.js shows a "not built yet" notice.
const BUILT_PAGES = {
  '/login': LoginPage,
  '/register': RegisterPage,
  '/forgot-password': ForgotPasswordPage,
  '/reset-password': ResetPasswordPage,
  '/profile': ProfilePage,
  '/dashboard': DashboardPage,
  '/transactions': TransactionsPage,
  '/transactions/new': TransactionFormPage,
  '/transactions/:id/edit': TransactionFormPage,
  '/recurring': RecurringPage,
  '/transactions/import': ImportPage,
  '/budgets': BudgetsPage,
  '/goals': GoalsPage,
  '/currencies': CurrenciesPage,
  '/analytics': AnalyticsPage,
  '/notifications': NotificationsPage,
  '/security': SecurityPage,
  '/admin': AdminPage,
  '/assistant': AssistantPage,
};

const pageElement = (page, back) => {
  const Page = BUILT_PAGES[page.to];
  if (Page) return <Page />;
  return (
    <UpcomingPage title={page.label} description={page.description} phase={page.phase} icon={page.icon} backTo={back?.to} backLabel={back?.label} />
  );
};

// Route map:
//   public            /                       landing
//   public only       /login /register /forgot-password /reset-password
//   signed in         /dashboard … /profile   inside the app shell
//   administrators    /admin
export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<LandingPage />} />
          <Route element={<PublicOnlyRoute />}>
            {PUBLIC_AUTH_ROUTES.map((page) => (
              <Route key={page.to} path={page.to} element={pageElement(page, { to: '/', label: 'Back to home' })} />
            ))}
          </Route>
          {DevPage && <Route path="/dev" element={<DevPage />} />}
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            {USER_PAGES.map((page) => (
              <Route key={page.to} path={page.to} element={pageElement(page)} />
            ))}
            <Route element={<AdminRoute />}>
              {ADMIN_NAV.items.map((page) => (
                <Route key={page.to} path={page.to} element={pageElement(page)} />
              ))}
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
