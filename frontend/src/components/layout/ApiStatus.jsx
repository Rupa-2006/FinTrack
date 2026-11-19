import { useAsync } from '../../hooks/useAsync.js';
import { getReadiness } from '../../services/healthService.js';
import { cn } from '../../utils/cn.js';

// Live service status, read from GET /api/health/ready.
export function ApiStatus({ className }) {
  const { data, error, loading } = useAsync(getReadiness);
  let dot = 'bg-navy-300';
  let text = 'Checking service status…';
  if (!loading && data) {
    dot = 'bg-emerald-400';
    text = 'All systems operational';
  } else if (!loading && error) {
    dot = 'bg-rose-400';
    text = 'Service currently unavailable';
  }
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm', className)}>
      <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', dot)} />
      {text}
    </span>
  );
}
