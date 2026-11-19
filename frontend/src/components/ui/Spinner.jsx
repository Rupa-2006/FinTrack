import { cn } from '../../utils/cn.js';

const SIZES = { sm: 'h-4 w-4 border-2', md: 'h-6 w-6 border-2', lg: 'h-10 w-10 border-[3px]' };

// Pass label="" when the spinner sits inside something that already announces loading.
export function Spinner({ size = 'md', label = 'Loading', className }) {
  return (
    <span role={label ? 'status' : undefined} className={cn('inline-flex items-center', className)}>
      <span aria-hidden="true" className={cn('animate-spin rounded-full border-current border-t-transparent', SIZES[size])} />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-navy-500">
      <Spinner size="lg" label={label} />
    </div>
  );
}
