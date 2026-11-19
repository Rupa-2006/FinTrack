import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { AsyncSection, ConfirmButton, PageHeader } from '../../components/app/index.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Select } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { createRecurring, deleteRecurring, listCategories, listRecurring, updateRecurring } from '../../services/ledgerService.js';
import { todayIso } from '../../utils/dates.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { CURRENCY_CODES, PAYMENT_METHODS, paymentLabel } from '../../utils/options.js';

const STATUS = { ACTIVE: ['income', 'Active'], PAUSED: ['warning', 'Paused'], FINISHED: ['neutral', 'Finished'] };
const FREQUENCIES = [
  { value: 'MONTHLY', label: 'Every month' },
  { value: 'WEEKLY', label: 'Every week' },
  { value: 'YEARLY', label: 'Every year' },
];

const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;

// "Every month on the 15th", "Every week on Monday", "Every year on 15 March".
function scheduleText(rule, locale) {
  const [y, m, d] = rule.startDate.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  if (rule.frequency === 'WEEKLY') return `Every week on ${new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(start)}`;
  if (rule.frequency === 'YEARLY') return `Every year on ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(start)}`;
  return d >= 29 ? `Every month on the ${ordinal(d)} (or the last day)` : `Every month on the ${ordinal(d)}`;
}

const emptyForm = (currency) => ({
  type: 'EXPENSE', categoryId: '', amount: '', currency, description: '', paymentMethod: 'BANK_TRANSFER',
  frequency: 'MONTHLY', startDate: todayIso(), endDate: '',
});

// Used for a new rule (with frequency and start) and for editing (without).
function RuleForm({ categories, initial, editing, onSubmit, submitLabel, onCancel }) {
  const [form, setForm] = useState(initial);
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value, ...(field === 'type' ? { categoryId: '' } : {}) }));
  const { submit, submitting, fieldErrors, formError } = useSubmit(onSubmit);
  const options = categories.filter((category) => category.type === form.type);

  return (
    <form
      noValidate className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const body = {
          type: form.type, categoryId: Number(form.categoryId) || null, amount: form.amount.trim(), currency: form.currency,
          description: form.description.trim(), paymentMethod: form.paymentMethod, endDate: form.endDate || null,
        };
        submit(editing ? body : { ...body, frequency: form.frequency, startDate: form.startDate });
      }}
    >
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Type" value={form.type} onChange={set('type')}>
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
        </Select>
        <Select label="Category" value={form.categoryId} onChange={set('categoryId')} error={fieldErrors.categoryId}>
          <option value="">Choose a category</option>
          {options.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </Select>
      </div>
      <Input label="Description" value={form.description} onChange={set('description')} error={fieldErrors.description} placeholder="Monthly rent" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Amount" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={set('amount')} error={fieldErrors.amount} />
        <Select label="Currency" value={form.currency} onChange={set('currency')} error={fieldErrors.currency}>
          {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
        </Select>
      </div>
      <Select label="Payment method" value={form.paymentMethod} onChange={set('paymentMethod')}>
        {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
      </Select>
      {!editing && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="How often" value={form.frequency} onChange={set('frequency')} error={fieldErrors.frequency}>
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
          <Input label="First date" type="date" value={form.startDate} onChange={set('startDate')} error={fieldErrors.startDate} hint="Past dates are filled in at once (up to a year back)." />
        </div>
      )}
      <Input label="Last date (optional)" type="date" value={form.endDate} onChange={set('endDate')} error={fieldErrors.endDate} />
      <div className="flex gap-2">
        <Button type="submit" loading={submitting} className={editing ? '' : 'w-full'}>{submitLabel}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function RuleRow({ rule, categories, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const [tone, label] = STATUS[rule.status];
  const bodyFor = (overrides = {}) => ({
    type: rule.type, categoryId: rule.category.id, amount: rule.amount, currency: rule.currency, description: rule.description,
    paymentMethod: rule.paymentMethod, endDate: rule.endDate, paused: rule.status === 'PAUSED', ...overrides,
  });

  async function togglePause() {
    setError(null);
    try {
      const result = await updateRecurring(rule.id, bodyFor({ paused: rule.status !== 'PAUSED' }));
      onChanged(result.generated ? `Resumed. ${result.generated} missed transaction${result.generated === 1 ? ' was' : 's were'} recorded.` : null);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-navy-900">
            <Repeat className="h-4 w-4 shrink-0 text-navy-500" aria-hidden="true" /> {rule.description}
          </p>
          <p className="mt-0.5 text-sm text-navy-500">
            {rule.category.name} · {paymentLabel(rule.paymentMethod)} · {scheduleText(rule)}
          </p>
          <p className="mt-0.5 text-xs text-navy-500">
            {rule.nextDate ? `Next on ${formatDate(rule.nextDate)}` : `Ended ${formatDate(rule.endDate)}`}
            {' · '}{rule.generatedCount} recorded{rule.endDate && rule.nextDate ? ` · until ${formatDate(rule.endDate)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`tabular font-semibold ${rule.type === 'INCOME' ? 'text-income' : 'text-expense'}`}>
            {rule.type === 'INCOME' ? '+' : '−'}{formatMoney(rule.amount, rule.currency)}
          </span>
          <Badge tone={tone}>{label}</Badge>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {rule.status !== 'FINISHED' && (
          <Button variant="ghost" size="sm" onClick={togglePause}>{rule.status === 'PAUSED' ? 'Resume' : 'Pause'}</Button>
        )}
        <Button variant="ghost" size="sm" aria-expanded={editing} onClick={() => setEditing((open) => !open)}>Edit</Button>
        <ConfirmButton
          label="Delete" aria-label={`Delete recurring ${rule.description}`}
          onConfirm={async () => { await deleteRecurring(rule.id); onChanged(`"${rule.description}" will not repeat any more. Transactions already recorded stay.`); }}
        />
      </div>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
      {editing && (
        <div className="mt-4 rounded-xl bg-navy-50 p-4">
          <RuleForm
            editing categories={categories} submitLabel="Save changes" onCancel={() => setEditing(false)}
            initial={{ ...bodyFor(), categoryId: String(rule.category.id), endDate: rule.endDate ?? '' }}
            onSubmit={async (body) => {
              await updateRecurring(rule.id, { ...body, paused: rule.status === 'PAUSED' });
              setEditing(false);
              onChanged('Saved. Changes apply to future transactions.');
            }}
          />
        </div>
      )}
    </li>
  );
}

export function RecurringPage() {
  const { user } = useAuth();
  const state = useAsync(listRecurring);
  const categories = useAsync(() => listCategories());
  const [notice, setNotice] = useState(null);
  const [formKey, setFormKey] = useState(0);

  const changed = async (message) => {
    setNotice(message);
    await state.reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Recurring transactions" description="Rent, salary, subscriptions: recorded automatically on their dates." />
      {notice && <Alert tone="success">{notice}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card as="section" aria-labelledby="recurring-list" className="lg:col-span-2">
          <CardHeader title={<span id="recurring-list">Your recurring transactions</span>} description="Each one is recorded when it falls due, converted at that day's rate." />
          <CardBody className="pt-2">
            <AsyncSection state={state} label="Loading recurring transactions" lines={4}>
              {state.data && (state.data.length === 0 ? (
                <EmptyState icon={Repeat} title="Nothing recurring yet" description="Add rent, salary or a subscription and it will be recorded on its dates." />
              ) : (
                <ul className="divide-y divide-navy-100">
                  {state.data.map((rule) => <RuleRow key={rule.id} rule={rule} categories={categories.data ?? []} onChanged={changed} />)}
                </ul>
              ))}
            </AsyncSection>
          </CardBody>
        </Card>
        <Card as="section" aria-labelledby="new-recurring">
          <CardHeader title={<span id="new-recurring">New recurring transaction</span>} />
          <CardBody>
            <RuleForm
              key={formKey} categories={categories.data ?? []} initial={emptyForm(user?.baseCurrency ?? 'INR')} submitLabel="Add"
              onSubmit={async (body) => {
                const result = await createRecurring(body);
                setFormKey((k) => k + 1);
                await changed(result.generated
                  ? `Added. ${result.generated} transaction${result.generated === 1 ? ' was' : 's were'} recorded for dates up to today.`
                  : `Added. The first one will be recorded on ${formatDate(result.rule.nextDate)}.`);
              }}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
