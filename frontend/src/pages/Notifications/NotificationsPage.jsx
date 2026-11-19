import { useState } from 'react';
import { AlertTriangle, Bell, CheckCheck, Info, Receipt, ShieldAlert, TrendingUp } from 'lucide-react';
import { AsyncSection, PageHeader, Pagination } from '../../components/app/index.jsx';
import { Alert, Badge, Button, Card, EmptyState } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useNotificationCount } from '../../hooks/useNotificationCount.js';
import { deleteNotification, listNotifications, markAllNotificationsRead, markNotificationRead } from '../../services/ledgerService.js';
import { cn } from '../../utils/cn.js';

const ICONS = { BUDGET_THRESHOLD: AlertTriangle, UNUSUAL_SPENDING: TrendingUp, SECURITY: ShieldAlert, MONTHLY_SUMMARY: Info, TRANSACTION: Receipt, SYSTEM: Info };
const SEVERITY_TONES = { INFO: 'info', WARNING: 'warning', CRITICAL: 'expense' };

function formatWhen(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState(null);
  const { refresh: refreshCount } = useNotificationCount();
  const state = useAsync(() => listNotifications({ page, pageSize: 20, unreadOnly: unreadOnly || undefined }), { watch: `${page}:${unreadOnly}` });

  async function run(action) {
    setError(null);
    try {
      await action();
      await state.reload();
      refreshCount();
    } catch (err) {
      setError(err.message);
    }
  }

  const data = state.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="Budget alerts, unusual spending and monthly summaries.">
        <Button variant={unreadOnly ? 'primary' : 'secondary'} size="sm" aria-pressed={unreadOnly} onClick={() => { setUnreadOnly((on) => !on); setPage(1); }}>
          Unread only
        </Button>
        <Button variant="secondary" size="sm" disabled={!data?.unreadCount} onClick={() => run(markAllNotificationsRead)}>
          <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark all as read
        </Button>
      </PageHeader>
      {error && <Alert tone="error">{error}</Alert>}

      <AsyncSection state={state} label="Loading notifications" lines={5}>
        {data && (data.items.length === 0 ? (
          <Card><EmptyState icon={Bell} title={unreadOnly ? 'Nothing unread' : 'No notifications yet'} description="Alerts about your budgets and spending will appear here." /></Card>
        ) : (
          <Card>
            <ul className="divide-y divide-navy-100">
              {data.items.map((item) => {
                const Icon = ICONS[item.type] ?? Info;
                return (
                  <li key={item.id} className={cn('flex gap-4 p-5', !item.read && 'bg-sky-50/40')}>
                    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', item.severity === 'CRITICAL' ? 'bg-rose-50 text-expense' : item.severity === 'WARNING' ? 'bg-amber-50 text-warning' : 'bg-navy-100 text-navy-700')}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-navy-900">{item.title}</p>
                        {!item.read && <Badge tone="info">New</Badge>}
                        {item.severity !== 'INFO' && <Badge tone={SEVERITY_TONES[item.severity]}>{item.severity === 'CRITICAL' ? 'Important' : 'Warning'}</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-navy-700">{item.message}</p>
                      <p className="mt-1 text-xs text-navy-500">{formatWhen(item.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-start">
                      {!item.read && <Button variant="ghost" size="sm" onClick={() => run(() => markNotificationRead(item.id))}>Mark read</Button>}
                      <Button variant="ghost" size="sm" aria-label={`Delete notification: ${item.title}`} onClick={() => run(() => deleteNotification(item.id))}>Delete</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-navy-100 p-4">
              <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} totalItems={data.pagination.totalItems} onChange={setPage} />
            </div>
          </Card>
        ))}
      </AsyncSection>
    </div>
  );
}
