import { useId } from 'react';
import { cn } from '../../utils/cn.js';

const FIELD =
  'block w-full rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-navy-900 shadow-sm ring-1 ring-inset ' +
  'placeholder:text-navy-300 focus:ring-2 focus:ring-inset focus:outline-none disabled:bg-navy-50 disabled:text-navy-400';

// Label, control, hint and error wired together for assistive technology:
// the error is announced and linked to the control with aria-describedby.
export function Input({ label, hint, error, id, className, required, ...rest }) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-navy-800">
        {label}
        {required && <span className="text-expense" aria-hidden="true"> *</span>}
      </label>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
        className={cn(FIELD, error ? 'ring-expense focus:ring-expense' : 'ring-navy-200 focus:ring-navy-500')}
        {...rest}
      />
      {hint && !error && <p id={hintId} className="mt-1.5 text-xs text-navy-500">{hint}</p>}
      {error && <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-expense">{error}</p>}
    </div>
  );
}

export function Select({ label, error, id, className, children, required, ...rest }) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const errorId = error ? `${selectId}-error` : undefined;
  return (
    <div className={className}>
      <label htmlFor={selectId} className="mb-1.5 block text-sm font-medium text-navy-800">
        {label}
        {required && <span className="text-expense" aria-hidden="true"> *</span>}
      </label>
      <select
        id={selectId}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId}
        className={cn(FIELD, 'pr-8', error ? 'ring-expense focus:ring-expense' : 'ring-navy-200 focus:ring-navy-500')}
        {...rest}
      >
        {children}
      </select>
      {error && <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-expense">{error}</p>}
    </div>
  );
}
