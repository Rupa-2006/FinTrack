// Building blocks shared by the signed-in pages.
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Alert, Button, Card, Skeleton } from '../ui/index.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { cn } from '../../utils/cn.js';
import { formatMoney } from '../../utils/format.js';

export function PageHeader({ title, description, children }) {
  useDocumentTitle(title);
  return (
    // A div, not <header>: the shell's top bar is the page's only banner landmark.
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-navy-500">{description}</p>}
      </div>
      {children && <div className="no-print flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

// Shows a skeleton while loading and an error with a retry; renders children once data exists.
export function AsyncSection({ state, label = 'Loading', lines = 3, children }) {
  if (state.error && !state.data) {
    return (
      <Alert tone="error" title="This could not be loaded">
        {state.error.message}{' '}
        <button type="button" className="font-semibold underline" onClick={state.reload}>Try again</button>
      </Alert>
    );
  }
  if (!state.data) {
    return (
      <Card role="status" className="space-y-3 p-6" aria-busy="true" aria-label={label}>
        {Array.from({ length: lines }, (_, index) => <Skeleton key={index} className={cn('h-5', index % 2 ? 'w-2/3' : 'w-full')} />)}
      </Card>
    );
  }
  return children;
}

const BAR_TONES = { neutral: 'bg-navy-600', income: 'bg-income', warning: 'bg-warning', expense: 'bg-expense' };

export function ProgressBar({ value, tone = 'neutral', label }) {
  const shown = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown)} className="h-2 w-full overflow-hidden rounded-full bg-navy-100">
      <div className={cn('h-full rounded-full transition-all', BAR_TONES[tone])} style={{ width: `${shown}%` }} />
    </div>
  );
}

// Signed, coloured amount: green for money in, red for money out.
export function Amount({ type, amount, currency, className }) {
  const sign = type === 'INCOME' ? '+' : type === 'EXPENSE' ? '−' : '';
  return (
    <span className={cn('tabular font-semibold', type === 'INCOME' && 'text-income', type === 'EXPENSE' && 'text-expense', className)}>
      {sign}{formatMoney(amount, currency)}
    </span>
  );
}

export function Pagination({ page, totalPages, totalItems, onChange }) {
  if (totalPages <= 1) return <p className="text-sm text-navy-500">{totalItems} {totalItems === 1 ? 'entry' : 'entries'}</p>;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-4">
      <p className="text-sm text-navy-500">Page {page} of {totalPages} · {totalItems} entries</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

// A destructive action that asks once more before running.
export function ConfirmButton({ label, confirmLabel = 'Confirm', onConfirm, variant = 'ghost', size = 'sm', ...rest }) {
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  // A failure the caller did not handle itself is shown next to the button, never lost.
  const failure = error && <span role="alert" className="text-xs font-medium text-expense">{error}</span>;
  if (!asking) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Button variant={variant} size={size} onClick={() => { setError(null); setAsking(true); }} {...rest}>{label}</Button>
        {failure}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="danger" size={size} loading={working}
        onClick={async () => {
          setWorking(true);
          try {
            await onConfirm();
          } catch (err) {
            setError(err?.message || 'That did not work. Please try again.');
          } finally {
            setWorking(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" size={size} onClick={() => setAsking(false)}>Cancel</Button>
    </span>
  );
}
