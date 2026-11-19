import { Compass } from 'lucide-react';
import { Button } from '../../components/ui/index.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';

// Stands alone (no layout), so it provides its own main landmark and level-one heading.
export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-50 px-4">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-navy-500 ring-1 ring-navy-100">
          <Compass className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-navy-900">Page not found</h1>
        <p className="mt-1 text-sm text-navy-500">The page you are looking for does not exist or has moved.</p>
        <Button to="/" className="mt-6">Back to home</Button>
      </div>
    </main>
  );
}
