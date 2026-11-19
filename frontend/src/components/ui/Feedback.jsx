import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const BADGE_TONES = {
  neutral: 'bg-navy-100 text-navy-700',
  income: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  expense: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  warning: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  info: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
};

export function Badge({ tone = 'neutral', className, children }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

const ALERTS = {
  info: { icon: Info, classes: 'bg-sky-50 text-sky-900 ring-sky-200', role: 'status' },
  success: { icon: CheckCircle2, classes: 'bg-emerald-50 text-emerald-900 ring-emerald-200', role: 'status' },
  warning: { icon: AlertTriangle, classes: 'bg-amber-50 text-amber-900 ring-amber-200', role: 'alert' },
  error: { icon: XCircle, classes: 'bg-rose-50 text-rose-900 ring-rose-200', role: 'alert' },
};

// Inline message. Errors and warnings are announced immediately, the others politely.
export function Alert({ tone = 'info', title, children, className }) {
  const { icon: Icon, classes, role } = ALERTS[tone];
  return (
    <div role={role} className={cn('flex gap-3 rounded-xl p-4 text-sm ring-1 ring-inset', classes, className)}>
      <Icon className="mt-0.5 h-4.5 w-4.5 shrink-0" aria-hidden="true" />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}

// Shown where a list or chart has nothing to display yet.
// `titleAs="h1"` when the empty state is the whole page (for example the "not allowed" page).
export function EmptyState({ icon: Icon, title, description, action, titleAs: Title = 'p' }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-navy-100 text-navy-600">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
      )}
      {/* By default a status message, not a section: a heading here would break the outline
          wherever the empty state sits directly under the page's h1. */}
      <Title className="text-base font-semibold text-navy-900">{title}</Title>
      {description && <p className="mt-1 max-w-sm text-sm text-navy-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-navy-100', className)} />;
}
