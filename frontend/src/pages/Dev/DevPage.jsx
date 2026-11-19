import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Select, Skeleton, Spinner, StatCard } from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const PREVIEW_USERS = {
  user: { id: 0, fullName: 'Preview User', email: 'preview.user@example.test', roles: ['USER'], baseCurrency: 'INR' },
  admin: { id: 0, fullName: 'Preview Admin', email: 'preview.admin@example.test', roles: ['ADMIN', 'USER'], baseCurrency: 'INR' },
};

// Development-only page (the route is not registered in production builds).
// Shows every UI component in one place, and can open the signed-in shell with a fake,
// memory-only session so layouts can be reviewed before real sign-in exists. The fake
// session has no token, so it cannot read anything from the API.
export function DevPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  function previewShell(kind) {
    setSession({ user: PREVIEW_USERS[kind], accessToken: null });
    navigate('/dashboard');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
      <div>
        <Badge tone="warning">Development only</Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-navy-900">Design system</h1>
        <p className="mt-2 text-navy-600">Reusable components and tokens used across FinTrack.</p>
      </div>

      <Card>
        <CardHeader title="Preview the signed-in shell" description="Opens the app layout with a fake in-memory session. A page reload ends it." />
        <CardBody className="flex flex-wrap gap-3">
          <Button onClick={() => previewShell('user')}>Open as user</Button>
          <Button variant="secondary" onClick={() => previewShell('admin')}>Open as administrator</Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Buttons" />
        <CardBody className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </CardBody>
      </Card>

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard label="Total income" value={formatMoney('85000.00', 'INR', { locale: 'en-IN' })} hint="Sample figure" icon={TrendingUp} tone="income" />
        <StatCard label="Total expenses" value={formatMoney('52310.75', 'INR', { locale: 'en-IN' })} hint="Sample figure" icon={TrendingDown} tone="expense" />
        <StatCard label="Balance" value={formatMoney('4456.20', 'USD', { locale: 'en-US' })} hint={formatDate('2026-11-16')} icon={Wallet} />
      </div>

      <Card>
        <CardHeader title="Form controls" description="Labels, hints and errors are linked to their field for screen readers." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Input label="Full name" placeholder="Aarav Sharma" value={name} onChange={(event) => setName(event.target.value)} hint="As it should appear on reports." required />
          <Input label="Amount" inputMode="decimal" defaultValue="-20" error="Amount must be greater than 0" />
          <Select label="Currency" defaultValue="INR">
            {['INR', 'USD', 'EUR', 'GBP', 'JPY'].map((code) => <option key={code}>{code}</option>)}
          </Select>
          <Input label="Disabled" defaultValue="Read only" disabled />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Feedback" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="income">Income</Badge>
            <Badge tone="expense">Expense</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="info">Info</Badge>
          </div>
          <Alert tone="success" title="Transaction saved">Your expense was recorded.</Alert>
          <Alert tone="warning" title="Budget almost used">You have spent 91% of your Shopping budget.</Alert>
          <Alert tone="error" title="Could not save">Check the highlighted fields and try again.</Alert>
          <Alert tone="info">Exchange rates are refreshed once a day.</Alert>
          <div className="flex items-center gap-6 text-navy-600">
            <Spinner size="sm" /> <Spinner /> <Spinner size="lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <EmptyState icon={Inbox} title="No transactions yet" description="Add your first income or expense to see it here." action={<Button>Add transaction</Button>} />
      </Card>
    </div>
  );
}
