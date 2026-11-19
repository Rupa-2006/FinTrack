import { useState } from 'react';
import { CalendarClock, Target } from 'lucide-react';
import { AsyncSection, ConfirmButton, PageHeader, ProgressBar } from '../../components/app/index.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Select } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { contributeToGoal, createGoal, deleteGoal, listGoals, updateGoal } from '../../services/ledgerService.js';
import { todayIso } from '../../utils/dates.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { CURRENCY_CODES } from '../../utils/options.js';

const STATUS = { IN_PROGRESS: ['neutral', 'In progress'], COMPLETED: ['income', 'Completed'], CANCELLED: ['warning', 'Cancelled'] };

function deadlineText(goal) {
  if (!goal.deadline) return 'No deadline';
  if (goal.status !== 'IN_PROGRESS') return `Deadline ${formatDate(goal.deadline)}`;
  if (goal.daysLeft < 0) return `Deadline passed on ${formatDate(goal.deadline)}`;
  if (goal.daysLeft === 0) return 'Deadline is today';
  return `${goal.daysLeft} day${goal.daysLeft === 1 ? '' : 's'} left · ${formatDate(goal.deadline)}`;
}

function ContributionForm({ goal, onSaved }) {
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('add');
  const { submit, submitting, fieldErrors, formError } = useSubmit((body) => contributeToGoal(goal.id, body), {
    onSuccess: () => { setAmount(''); onSaved(); },
  });
  return (
    <form
      noValidate className="mt-4 flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = amount.trim();
        submit({ amount: mode === 'withdraw' && value ? `-${value}` : value, date: todayIso() });
      }}
    >
      <Select label="Action" value={mode} onChange={(e) => setMode(e.target.value)} className="w-32">
        <option value="add">Add</option>
        <option value="withdraw">Withdraw</option>
      </Select>
      <Input label={`Amount (${goal.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={fieldErrors.amount} className="min-w-32 flex-1" />
      <Button type="submit" variant="secondary" loading={submitting}>Save</Button>
      {formError && <Alert tone="error" className="w-full">{formError}</Alert>}
    </form>
  );
}

function GoalCard({ goal, onChanged }) {
  const [tone, label] = STATUS[goal.status];
  const [error, setError] = useState(null);
  const toggleCancel = () => {
    setError(null);
    return updateGoal(goal.id, {
      title: goal.title, targetAmount: goal.targetAmount, deadline: goal.deadline, notes: goal.notes,
      status: goal.status === 'CANCELLED' ? 'IN_PROGRESS' : 'CANCELLED',
    }).then(onChanged, (err) => setError(err.message));
  };

  return (
    <Card as="article" aria-labelledby={`goal-${goal.id}`} className="flex flex-col p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 id={`goal-${goal.id}`} className="text-base font-semibold text-navy-900">{goal.title}</h2>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="tabular mt-3 text-2xl font-semibold tracking-tight text-navy-900">{formatMoney(goal.savedAmount, goal.currency)}</p>
      <p className="tabular text-sm text-navy-500">of {formatMoney(goal.targetAmount, goal.currency)} · {formatMoney(goal.remaining, goal.currency)} to go</p>
      <div className="mt-4"><ProgressBar value={goal.percent} tone={goal.status === 'CANCELLED' ? 'warning' : 'income'} label={`${goal.title}: ${goal.percent}%`} /></div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-navy-500">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {deadlineText(goal)}
      </p>
      {goal.notes && <p className="mt-3 rounded-lg bg-navy-50 p-3 text-sm text-navy-700">{goal.notes}</p>}
      {goal.status !== 'CANCELLED' && <ContributionForm goal={goal} onSaved={onChanged} />}
      <div className="mt-4 flex gap-2 border-t border-navy-100 pt-4">
        <Button variant="ghost" size="sm" onClick={toggleCancel}>{goal.status === 'CANCELLED' ? 'Reopen' : 'Cancel goal'}</Button>
        <ConfirmButton label="Delete" aria-label={`Delete goal ${goal.title}`} onConfirm={() => deleteGoal(goal.id).then(onChanged)} />
      </div>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
    </Card>
  );
}

function NewGoalForm({ baseCurrency, onCreated }) {
  const empty = { title: '', targetAmount: '', currency: baseCurrency, deadline: '', notes: '' };
  const [form, setForm] = useState(empty);
  const { submit, submitting, fieldErrors, formError } = useSubmit(createGoal, { onSuccess: () => { setForm(empty); onCreated(); } });
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  return (
    <Card as="section" aria-labelledby="new-goal">
      <CardHeader title={<span id="new-goal">New goal</span>} description="Something you are saving towards." />
      <CardBody>
        <form
          noValidate className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit({ ...form, title: form.title.trim(), targetAmount: form.targetAmount.trim(), deadline: form.deadline || null, notes: form.notes.trim() || null });
          }}
        >
          {formError && <Alert tone="error">{formError}</Alert>}
          <Input label="Title" required maxLength={100} value={form.title} onChange={set('title')} error={fieldErrors.title} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="Target" inputMode="decimal" required value={form.targetAmount} onChange={set('targetAmount')} error={fieldErrors.targetAmount} className="col-span-2" />
            <Select label="Currency" value={form.currency} onChange={set('currency')}>
              {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          </div>
          <Input label="Deadline" type="date" min={todayIso()} value={form.deadline} onChange={set('deadline')} error={fieldErrors.deadline} hint="Optional." />
          <Input label="Notes" maxLength={2000} value={form.notes} onChange={set('notes')} error={fieldErrors.notes} hint="Optional. Stored encrypted." />
          <Button type="submit" loading={submitting} className="w-full">Create goal</Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function GoalsPage() {
  const { user } = useAuth();
  const state = useAsync(listGoals);
  return (
    <div className="space-y-6">
      <PageHeader title="Savings goals" description="Track what you are saving for. Each goal keeps its own currency." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AsyncSection state={state} label="Loading goals" lines={4}>
            {state.data && (state.data.length === 0 ? (
              <Card><EmptyState icon={Target} title="No savings goals yet" description="Create one to start tracking your progress." /></Card>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {state.data.map((goal) => <GoalCard key={goal.id} goal={goal} onChanged={state.reload} />)}
              </div>
            ))}
          </AsyncSection>
        </div>
        <NewGoalForm baseCurrency={user?.baseCurrency ?? 'INR'} onCreated={state.reload} />
      </div>
    </div>
  );
}
