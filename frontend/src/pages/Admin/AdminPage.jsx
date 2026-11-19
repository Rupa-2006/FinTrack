import { useState } from 'react';
import { Activity, AlertOctagon, Lock, ShieldCheck, Users } from 'lucide-react';
import { AsyncSection, ConfirmButton, PageHeader, Pagination } from '../../components/app/index.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Select, StatCard } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../hooks/useAuth.js';
import {
  getAdminOverview, listAllSecurityEvents, listAuditLogs, listUsers, setUserRole, setUserStatus, unlockUser, verifyAuditChain,
} from '../../services/securityService.js';
import { cn } from '../../utils/cn.js';
import { actionLabel, eventLabel, formatDateTime, SEVERITY_TONES } from '../../utils/securityLabels.js';

const STATUS_TONES = { ACTIVE: 'income', SUSPENDED: 'expense', DEACTIVATED: 'neutral' };
const STATUS_LABELS = { ACTIVE: 'Active', SUSPENDED: 'Suspended', DEACTIVATED: 'Closed by owner' };

function Overview() {
  const state = useAsync(getAdminOverview);
  const data = state.data;
  return (
    <AsyncSection state={state} label="Loading overview" lines={5}>
      {data && (
        <div className="space-y-6">
          <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Accounts" value={data.users.total} hint={`${data.users.active} active · ${data.users.newLast30Days} new in 30 days`} icon={Users} />
            <StatCard label="Active sessions" value={data.activeSessions} hint={`${data.users.activeLast7Days} accounts signed in this week`} icon={Activity} />
            <StatCard
              label="Failed sign-ins (24 h)" value={data.security.failedSignInsLast24h}
              hint={`${data.security.signInsLast24h} successful · ${data.users.lockedNow} locked now`} icon={Lock}
              tone={data.security.failedSignInsLast24h > 20 ? 'warning' : 'neutral'}
            />
            <StatCard
              label="Critical events (7 days)" value={data.security.criticalEventsLast7Days}
              hint={`${data.security.warningsLast7Days} warnings`} icon={AlertOctagon} tone={data.security.criticalEventsLast7Days ? 'expense' : 'neutral'}
            />
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card as="section">
              <CardHeader title="Usage" description="Totals across all accounts. Individual records are not visible to administrators." />
              <CardBody>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    ['Transactions', data.usage.transactions], ['Added in 30 days', data.usage.transactionsLast30Days],
                    ['Budgets', data.usage.budgets], ['Savings goals', data.usage.savingsGoals],
                    ['Suspended accounts', data.users.suspended], ['Closed accounts', data.users.deactivated],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-navy-500">{label}</dt>
                      <dd className="tabular text-lg font-semibold text-navy-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
            <Card as="section">
              <CardHeader title="Possible password guessing" description="Addresses with 5 or more failed sign-ins in the last 24 hours." />
              <CardBody className="pt-2">
                {data.suspiciousIps.length === 0 ? (
                  <p className="py-4 text-sm text-navy-500">Nothing suspicious in the last 24 hours.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-navy-500">
                      <tr><th scope="col" className="py-2 font-medium">IP address</th><th scope="col" className="py-2 text-right font-medium">Failures</th><th scope="col" className="py-2 text-right font-medium">Accounts</th></tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      {data.suspiciousIps.map((ip) => (
                        <tr key={ip.ipAddress}>
                          <td className="py-2 font-mono text-navy-900">{ip.ipAddress}</td>
                          <td className="tabular py-2 text-right text-expense">{ip.failures}</td>
                          <td className="tabular py-2 text-right text-navy-700">{ip.accounts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </AsyncSection>
  );
}

function UserActions({ user, isSelf, onChanged, onError }) {
  const run = async (action) => {
    try {
      await action();
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  };
  if (isSelf) return <span className="text-xs text-navy-500">Your account</span>;
  if (user.status === 'DEACTIVATED') return <span className="text-xs text-navy-500">No actions</span>;
  const isAdmin = user.roles.includes('ADMIN');
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {user.locked && <Button variant="ghost" size="sm" onClick={() => run(() => unlockUser(user.id))}>Unlock</Button>}
      <ConfirmButton
        label={isAdmin ? 'Remove admin' : 'Make admin'} confirmLabel={isAdmin ? 'Remove admin' : 'Make admin'}
        aria-label={`${isAdmin ? 'Remove admin role from' : 'Make admin:'} ${user.email}`}
        onConfirm={() => run(() => setUserRole(user.id, 'ADMIN', !isAdmin))}
      />
      {user.status === 'ACTIVE' ? (
        <ConfirmButton label="Suspend" confirmLabel="Suspend" aria-label={`Suspend ${user.email}`} onConfirm={() => run(() => setUserStatus(user.id, 'SUSPENDED'))} />
      ) : (
        <Button variant="ghost" size="sm" onClick={() => run(() => setUserStatus(user.id, 'ACTIVE'))} aria-label={`Reactivate ${user.email}`}>Reactivate</Button>
      )}
    </div>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const query = { ...filters, page, pageSize: 15 };
  const state = useAsync(() => listUsers(query), { watch: JSON.stringify(query) });
  const set = (field) => (event) => { setFilters((current) => ({ ...current, [field]: event.target.value })); setPage(1); };

  return (
    <div className="space-y-4">
      <Card as="form" role="search" aria-label="Find accounts" className="grid gap-4 p-4 sm:grid-cols-3" onSubmit={(e) => e.preventDefault()}>
        <Input label="Search" type="search" placeholder="Name or email" value={filters.search} onChange={set('search')} className="sm:col-span-2" />
        <Select label="Status" value={filters.status} onChange={set('status')}>
          <option value="">All</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DEACTIVATED">Closed by owner</option>
        </Select>
      </Card>
      {error && <Alert tone="error">{error}</Alert>}
      <AsyncSection state={state} label="Loading accounts" lines={6}>
        {state.data && (state.data.items.length === 0 ? (
          <Card><EmptyState icon={Users} title="No accounts match" /></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-navy-100 bg-navy-50/60 text-xs uppercase tracking-wide text-navy-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Account</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Roles</th>
                    <th scope="col" className="px-4 py-3 font-medium">Last sign-in</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {state.data.items.map((user) => (
                    <tr key={user.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-navy-900">{user.fullName}</p>
                        <p className="text-xs text-navy-500">{user.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={STATUS_TONES[user.status]}>{STATUS_LABELS[user.status]}</Badge>
                          {user.locked && <Badge tone="warning">Locked</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-navy-700">{user.roles.map((role) => (role === 'ADMIN' ? 'Admin' : 'User')).join(', ')}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-navy-600">
                        {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}
                        <p className="text-xs text-navy-500">{user.activeSessions} active session{user.activeSessions === 1 ? '' : 's'}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <UserActions user={user} isSelf={user.id === me?.id} onChanged={() => { setError(null); state.reload(); }} onError={setError} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-navy-100 p-4"><Pagination {...state.data.pagination} onChange={setPage} /></div>
          </Card>
        ))}
      </AsyncSection>
    </div>
  );
}

function EventsTab() {
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const state = useAsync(() => listAllSecurityEvents({ severity, page, pageSize: 20 }), { watch: `${severity}:${page}` });
  return (
    <Card as="section" aria-label="Security events">
      <CardHeader
        title="Security events" description="Sign-ins, failures, lockouts and account changes across all accounts."
        action={(
          <Select label="Severity" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} className="w-40">
            <option value="">All</option>
            <option value="CRITICAL">Critical</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
          </Select>
        )}
      />
      <CardBody className="pt-2">
        <AsyncSection state={state} label="Loading events" lines={6}>
          {state.data && (
            <>
              <ul className="divide-y divide-navy-100">
                {state.data.items.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-navy-900">
                        <Badge tone={SEVERITY_TONES[event.severity]}>{event.severity}</Badge> {eventLabel(event)}
                      </p>
                      <p className="mt-0.5 text-xs text-navy-500">
                        {[event.userEmail ?? 'No matching account', event.ipAddress && `IP ${event.ipAddress}`, event.device].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <p className="text-xs text-navy-500">{formatDateTime(event.createdAt)}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-4"><Pagination {...state.data.pagination} onChange={setPage} /></div>
            </>
          )}
        </AsyncSection>
      </CardBody>
    </Card>
  );
}

function AuditTab() {
  const [eventType, setEventType] = useState('');
  const [page, setPage] = useState(1);
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const state = useAsync(() => listAuditLogs({ eventType, page, pageSize: 20 }), { watch: `${eventType}:${page}` });

  async function verify() {
    setChecking(true);
    try {
      setCheck(await verifyAuditChain());
      await state.reload();
    } catch (err) {
      setCheck({ error: err.message });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="max-w-2xl text-sm text-navy-700">
          <p className="font-semibold text-navy-900">Tamper-evident audit log</p>
          <p className="mt-1">
            Each entry is linked to the one before it with a keyed hash, so a changed, removed or reordered entry breaks the chain. Verification
            recomputes every link. It detects tampering; it cannot undo it.
          </p>
        </div>
        <Button onClick={verify} loading={checking}><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Verify chain</Button>
      </Card>
      {check?.error && <Alert tone="error">{check.error}</Alert>}
      {check && !check.error && (check.valid
        ? <Alert tone="success" title="Chain intact">{check.checkedRows} entries checked, ending at entry {check.lastId}.</Alert>
        : <Alert tone="error" title="Chain broken">{check.reason} {check.checkedRows} entries were sound before that point.</Alert>)}
      <Card as="section" aria-label="Audit log">
        <CardHeader
          title="Audit log" description="Who changed what, and when. Entries name records and fields, never amounts or notes."
          action={(
            <Select label="Area" value={eventType} onChange={(e) => { setEventType(e.target.value); setPage(1); }} className="w-40">
              <option value="">All</option>
              <option value="AUTH">Sign-in</option>
              <option value="ACCOUNT">Account</option>
              <option value="DATA">Records</option>
              <option value="ADMIN">Administration</option>
            </Select>
          )}
        />
        <CardBody className="pt-2">
          <AsyncSection state={state} label="Loading audit log" lines={6}>
            {state.data && (
              <>
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-navy-500">
                      <tr>
                        <th scope="col" className="py-2 pr-4 font-medium">#</th>
                        <th scope="col" className="py-2 pr-4 font-medium">When</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Who</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Action</th>
                        <th scope="col" className="py-2 font-medium">Record</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      {state.data.items.map((row) => (
                        <tr key={row.id}>
                          <td className="tabular py-2 pr-4 text-navy-500">{row.id}</td>
                          <td className="whitespace-nowrap py-2 pr-4 text-navy-600">{formatDateTime(row.createdAt)}</td>
                          <td className="py-2 pr-4 text-navy-700">{row.userEmail ?? 'System'}</td>
                          <td className="py-2 pr-4">
                            <span className={cn('font-medium', row.eventType === 'ADMIN' ? 'text-navy-900' : 'text-navy-800')}>{actionLabel(row.action)}</span>
                            {row.details?.fields && <span className="block text-xs text-navy-500">{row.details.fields.join(', ')}</span>}
                          </td>
                          <td className="py-2 text-navy-600">{row.resourceType ? `${row.resourceType} ${row.resourceId ?? ''}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4"><Pagination {...state.data.pagination} onChange={setPage} /></div>
              </>
            )}
          </AsyncSection>
        </CardBody>
      </Card>
    </div>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview', Panel: Overview },
  { id: 'users', label: 'Accounts', Panel: UsersTab },
  { id: 'events', label: 'Security events', Panel: EventsTab },
  { id: 'audit', label: 'Audit log', Panel: AuditTab },
];

export function AdminPage() {
  const [active, setActive] = useState('overview');
  const { Panel } = TABS.find((tab) => tab.id === active);

  function onKeyDown(event) {
    const index = TABS.findIndex((tab) => tab.id === active);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = TABS[(index + step + TABS.length) % TABS.length];
    setActive(next.id);
    document.getElementById(`admin-tab-${next.id}`)?.focus();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Admin dashboard" description="Accounts, security monitoring and the audit log." />
      <Alert tone="info">
        Administrators manage accounts and monitor security. Users&apos; transactions, budgets, goals and notes are private and are not shown here.
      </Alert>
      <div role="tablist" aria-label="Admin sections" className="flex gap-1 overflow-x-auto border-b border-navy-200" onKeyDown={onKeyDown}>
        {TABS.map((tab) => (
          <button
            key={tab.id} id={`admin-tab-${tab.id}`} type="button" role="tab" aria-selected={active === tab.id} aria-controls="admin-panel"
            tabIndex={active === tab.id ? 0 : -1} onClick={() => setActive(tab.id)}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              active === tab.id ? 'border-navy-900 text-navy-900' : 'border-transparent text-navy-500 hover:text-navy-800')}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${active}`}>
        <Panel />
      </div>
    </div>
  );
}
