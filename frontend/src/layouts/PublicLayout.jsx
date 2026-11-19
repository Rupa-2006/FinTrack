import { Link, Outlet } from 'react-router-dom';
import { Button, Logo } from '../components/ui/index.js';
import { ApiStatus } from '../components/layout/ApiStatus.jsx';

const SECTION_LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/#security', label: 'Security' },
  { href: '/#how-it-works', label: 'How it works' },
];

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lift">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-navy-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="FinTrack home">
            <Logo />
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-8 md:flex">
            {SECTION_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="inline-flex min-h-6 items-center text-sm font-medium text-navy-600 transition-colors hover:text-navy-900">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button to="/login" variant="ghost" size="sm">Sign in</Button>
            <Button to="/register" size="sm">Get started</Button>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-navy-100 bg-navy-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-navy-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <Logo />
            <p className="mt-2 text-sm">A portfolio project. All financial data shown is fictional.</p>
          </div>
          <ApiStatus />
        </div>
      </footer>
    </div>
  );
}
