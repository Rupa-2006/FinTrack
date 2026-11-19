import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { Card } from '../ui/index.js';

// Centred card used by the sign-in, registration and password pages.
export function AuthCard({ title, subtitle, children, footer }) {
  useDocumentTitle(title);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 sm:py-16">
      <Card className="animate-fade-up p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-navy-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </Card>
      {footer && <p className="mt-6 text-center text-sm text-navy-500">{footer}</p>}
    </div>
  );
}
