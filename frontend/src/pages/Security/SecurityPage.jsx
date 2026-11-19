import { useState } from 'react';
import { History, KeyRound, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { AsyncSection, ConfirmButton, PageHeader, Pagination } from '../../components/app/index.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Select } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { listActivity, listSecurityEvents, listSessions, revokeOtherSessions, revokeSession } from '../../services/securityService.js';
import { actionLabel, eventLabel, formatDateTime, SEVERITY_TONES } from '../../utils/securityLabels.js';
import { TwoStepCard } from './TwoStepCard.jsx';

function Sessions() {
  const state = useAsync(listSessions);
  const [message, setMessage] = useState(null);

  async function run(action, success) {
    setMessage(null);
    try {
      const result = await action();
      setMessage({ tone: 'success', text: success(result) });
      await state.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    }
  }

  const others = (state.data ?? []).filter((session) => !session.current);
  return (
    <Card as="section" aria-labelledby="sessions-title">
      <CardHeader
        title={<span id="sessions-title">Where you are signed in</span>}
        description="End any session you do not recognise. Its sign-in stops working immediately."
        action={others.length > 0 && (
          <ConfirmButton
            label="Sign out everywhere else" confirmLabel="Sign out others" variant="secondary"
            onConfirm={() => run(revokeOtherSessions, (r) => `Signed out of ${r.revoked} other session${r.revoked === 1 ? '' : 's'}.`)}
          />
        )}
      />
      <CardBody className="pt-2">
        {message && <Alert tone={message.tone} className="mb-4">{message.text}</Alert>}
        <AsyncSection state={state} label="Loading sessions" lines={3}>
          {state.data && (
            <ul className="divide-y divide-navy-100">
              {state.data.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-100 text-navy-700">
                      <MonitorSmartphone className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-navy-900">
                        {session.device}
                        {session.current && <Badge tone="income">This device</Badge>}
                      </p>
                      <p className="text-xs text-navy-500">
                        IP {session.ipAddress ?? 'unknown'} · signed in {formatDateTime(session.createdAt)} · last active {formatDateTime(session.lastUsedAt)}
                      </p>
                    </div>
                  </div>
                  {!session.current && (
                    <ConfirmButton
                      label="Sign out" confirmLabel="End session" aria-label={`Sign out ${session.device}`}
                      onConfirm={() => run(() => revokeSession(session.id), () => `Signed out of ${session.device}.`)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>
      </CardBody>
    </Card>
  );
}

function SecurityEvents() {
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState('');
  const state = useAsync(() => listSecurityEvents({ page, pageSize: 10, eventType }), { watch: `${page}:${eventType}` });

  return (
    <Card as="section" aria-labelledby="events-title">
      <CardHeader
        title={<span id="events-title">Sign-in and security history</span>}
        description="Sign-ins, failed attempts and changes to your account security."
        action={(
          <Select label="Show" value={eventType} onChange={(e) => { setEventType(e.target.value); setPage(1); }} className="w-48">
            <option value="">Everything</option>
            <option value="LOGIN_SUCCESS">Sign-ins</option>
            <option value="LOGIN_FAILED">Failed sign-ins</option>
            <option value="NEW_DEVICE_LOGIN">New devices</option>
            <option value="PASSWORD_CHANGED">Password changes</option>
          </Select>
        )}
      />
      <CardBody className="pt-2">
        <AsyncSection state={state} label="Loading security history" lines={4}>
          {state.data && (state.data.items.length === 0 ? (
            <EmptyState icon={History} title="Nothing to show" description="No events of this kind yet." />
          ) : (
            <>
              <ul className="divide-y divide-navy-100">
                {state.data.items.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div>
                      <p className="text-sm font-medium text-navy-900">{eventLabel(event)}</p>
                      <p className="text-xs text-navy-500">{[event.device, event.ipAddress && `IP ${event.ipAddress}`].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-navy-500">
                      {event.severity !== 'INFO' && <Badge tone={SEVERITY_TONES[event.severity]}>{event.severity === 'CRITICAL' ? 'Important' : 'Warning'}</Badge>}
                      {formatDateTime(event.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4"><Pagination {...state.data.pagination} onChange={setPage} /></div>
            </>
          ))}
        </AsyncSection>
      </CardBody>
    </Card>
  );
}

function Activity() {
  const [page, setPage] = useState(1);
  const state = useAsync(() => listActivity({ page, pageSize: 10 }), { watch: page });
  return (
    <Card as="section" aria-labelledby="activity-title">
      <CardHeader
        title={<span id="activity-title">Account activity</span>}
        description="Every change to your account and records, from the tamper-evident audit log. It names what changed, never the amounts."
      />
      <CardBody className="pt-2">
        <AsyncSection state={state} label="Loading activity" lines={4}>
          {state.data && (state.data.items.length === 0 ? (
            <EmptyState icon={History} title="No activity recorded yet" description="Changes you make to your account and records will be listed here." />
          ) : (
            <>
              <ul className="divide-y divide-navy-100">
                {state.data.items.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div>
                      <p className="text-sm font-medium text-navy-900">{actionLabel(row.action)}</p>
                      {row.details?.fields && <p className="text-xs text-navy-500">Changed: {row.details.fields.join(', ')}</p>}
                    </div>
                    <p className="text-xs text-navy-500">{formatDateTime(row.createdAt)}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-4"><Pagination {...state.data.pagination} onChange={setPage} /></div>
            </>
          ))}
        </AsyncSection>
      </CardBody>
    </Card>
  );
}

export function SecurityPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Security" description="Your sessions, sign-in history and account activity.">
        <Button to="/profile" variant="secondary"><KeyRound className="h-4 w-4" aria-hidden="true" /> Change password</Button>
      </PageHeader>
      <Card className="flex flex-wrap items-start gap-4 p-5">
        <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-income" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm text-navy-700">
          <p className="font-semibold text-navy-900">How your account is protected</p>
          <p className="mt-1">
            Passwords are stored as one-way hashes. Phone numbers and notes are encrypted. Five wrong passwords or codes lock sign-in for 15 minutes,
            and you get a notification when that happens or when someone signs in from a new device. Turn on two-step sign-in for the strongest protection.
          </p>
        </div>
      </Card>
      <TwoStepCard />
      <Sessions />
      <div className="grid gap-6 xl:grid-cols-2">
        <SecurityEvents />
        <Activity />
      </div>
    </div>
  );
}
