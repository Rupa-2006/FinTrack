import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, LogOut, Menu, X } from 'lucide-react';
import { Badge, Logo, PageLoader } from '../components/ui/index.js';
import { useAuth } from '../hooks/useAuth.js';
import { NotificationCountProvider, useNotificationCount } from '../hooks/useNotificationCount.js';
import { ADMIN_NAV, NAV_SECTIONS } from '../routes/navigation.js';
import { cn } from '../utils/cn.js';
import { initials } from '../utils/format.js';

function SidebarNav({ sections, onNavigate }) {
  return (
    <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-navy-400">{section.title}</p>
          <ul className="mt-2 space-y-1">
            {section.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-white/10 text-white' : 'text-navy-200 hover:bg-white/5 hover:text-white'
                    )
                  }
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// The bell in the top bar, with the number of unread notifications.
function NotificationBell({ active }) {
  const { count } = useNotificationCount();
  const label = count ? `Notifications, ${count} unread` : 'Notifications';
  return (
    <Link
      to="/notifications"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className="relative rounded-lg p-2 text-navy-600 hover:bg-navy-100 hover:text-navy-900"
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {count > 0 && (
        <span aria-hidden="true" className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-expense px-1 text-[10px] font-bold leading-none text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

// Signed-in shell: navy sidebar (a drawer on small screens), top bar, page content.
export function AppLayout() {
  return (
    <NotificationCountProvider>
      <Shell />
    </NotificationCountProvider>
  );
}

function Shell() {
  const { user, isAdmin, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const sections = isAdmin ? [...NAV_SECTIONS, ADMIN_NAV] : NAV_SECTIONS;

  const mainRef = useRef(null);
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const drawerWasOpen = useRef(false);
  const firstPath = useRef(location.pathname);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event) => event.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  // Opening the menu moves focus into it (the page behind is inert); closing it returns focus
  // to the menu button.
  useEffect(() => {
    if (drawerOpen) drawerRef.current?.querySelector('a[href]')?.focus();
    else if (drawerWasOpen.current) menuButtonRef.current?.focus();
    drawerWasOpen.current = drawerOpen;
  }, [drawerOpen]);

  // After moving to another page, focus goes to the page content so screen readers announce it
  // (declared after the menu effect so it wins when a menu link both navigates and closes it).
  useEffect(() => {
    if (location.pathname === firstPath.current) return;
    firstPath.current = null;
    mainRef.current?.focus();
  }, [location.pathname]);

  // Ends the session here and on the server; the route guard then shows the sign-in page.
  const signOut = () => logout();

  const sidebar = (
    <div className="flex h-full flex-col bg-gradient-to-b from-navy-900 to-navy-950">
      <div className="flex h-16 items-center px-6">
        <Link to="/dashboard" aria-label="FinTrack dashboard" onClick={() => setDrawerOpen(false)}>
          <Logo inverse />
        </Link>
      </div>
      <SidebarNav sections={sections} onNavigate={() => setDrawerOpen(false)} />
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white" aria-hidden="true">
            {initials(user?.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user?.fullName}</p>
            <p className="truncate text-xs text-navy-300">{user?.email}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-navy-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lift">
        Skip to content
      </a>

      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {drawerOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-navy-950/50" onClick={() => setDrawerOpen(false)} />
          <aside id="mobile-menu" ref={drawerRef} aria-label="Menu" className="relative h-full w-64 shadow-lift">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64" inert={drawerOpen || undefined}>
        <header className="no-print sticky top-0 z-20 flex h-16 items-center justify-between border-b border-navy-100 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            ref={menuButtonRef}
            type="button"
            className="rounded-lg p-2 text-navy-700 hover:bg-navy-100 lg:hidden"
            aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={drawerOpen}
            aria-controls="mobile-menu"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {drawerOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
          <div className="hidden items-center gap-2 lg:flex">
            {isAdmin && <Badge tone="info">Administrator</Badge>}
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell active={location.pathname === '/notifications'} />
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out" // the text is hidden on small screens, leaving only the icon
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-navy-600 hover:bg-navy-100 hover:text-navy-900"
            >
              <LogOut className="h-4.5 w-4.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8 focus:outline-none sm:px-6 lg:px-8">
          {/* Pages that load on demand show a spinner here while the shell stays in place. */}
          <Suspense fallback={<PageLoader label="Loading page" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
