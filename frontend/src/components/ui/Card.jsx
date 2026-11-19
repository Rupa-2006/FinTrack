import { cn } from '../../utils/cn.js';

export function Card({ as: Tag = 'div', className, children, ...rest }) {
  return (
    <Tag className={cn('rounded-2xl bg-white shadow-card ring-1 ring-navy-100', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, action }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-6">
      <div>
        <h2 className="text-base font-semibold text-navy-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-navy-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn('p-6', className)}>{children}</div>;
}

const TONES = {
  neutral: 'bg-navy-100 text-navy-700',
  income: 'bg-emerald-50 text-income',
  expense: 'bg-rose-50 text-expense',
  warning: 'bg-amber-50 text-warning',
};

// A headline figure: label, value, optional icon and supporting line.
export function StatCard({ label, value, hint, icon: Icon, tone = 'neutral' }) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-navy-500">{label}</p>
        {Icon && (
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', TONES[tone])}>
            <Icon className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
        )}
      </div>
      <p className="tabular mt-3 text-2xl font-semibold tracking-tight text-navy-900">{value}</p>
      {hint && <p className="mt-1 text-sm text-navy-500">{hint}</p>}
    </Card>
  );
}
