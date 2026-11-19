import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn.js';
import { Spinner } from './Spinner.jsx';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-all duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]';

const VARIANTS = {
  primary: 'bg-navy-900 text-white shadow-sm hover:bg-navy-800',
  secondary: 'bg-white text-navy-900 ring-1 ring-inset ring-navy-200 hover:bg-navy-50',
  ghost: 'text-navy-700 hover:bg-navy-100',
  inverse: 'bg-white text-navy-900 shadow-sm hover:bg-navy-50',
  danger: 'bg-expense text-white shadow-sm hover:bg-rose-700',
};

const SIZES = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

// Renders a <button>, or a router <Link> when `to` is given.
export function Button({
  variant = 'primary',
  size = 'md',
  to,
  loading = false,
  disabled = false,
  type = 'button',
  className,
  children,
  ...rest
}) {
  const classes = cn(BASE, VARIANTS[variant], SIZES[size], className);
  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner size="sm" label="" />}
      {children}
    </button>
  );
}
