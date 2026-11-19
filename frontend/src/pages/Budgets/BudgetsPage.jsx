import { useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, PiggyBank } from 'lucide-react';
import { AsyncSection, ConfirmButton, PageHeader, ProgressBar } from '../../components/app/index.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Select } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { copyBudgets, createBudget, deleteBudget, listBudgets, listCategories, updateBudget } from '../../services/ledgerService.js';
import { addMonths, currentMonth, monthLabel } from '../../utils/dates.js';
import { formatMoney } from '../../utils/format.js';

const STATUS = {
  ON_TRACK: { tone: 'neutral', bar: 'neutral', label: 'On track' },
  WARNING: { tone: 'warning', bar: 'warning', label: 'Near the limit' },
  EXCEEDED: { tone: 'expense', bar: 'expense', label: 'Over budget' },
  REACHED: { tone: 'income', bar: 'income', label: 'Target reached' },
  IN_PROGRESS: { tone: 'neutral', bar: 'income', label: 'In progress' },
};

const TYPE_LABELS = { CATEGORY: 'Category limit', OVERALL: 'All spending', SAVINGS_TARGET: 'Savings target' };

function budgetName(budget) {
  if (budget.budgetType === 'CATEGORY') return budget.category.name;
  return TYPE_LABELS[budget.budgetType];
}

function BudgetRow({ budget, currency, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(budget.amount);
  const [threshold, setThreshold] = useState(String(budget.alertThresholdPct));
  const { submit, submitting, fieldErrors, formError } = useSubmit(
    (body) => updateBudget(budget.id, body),
    { onSuccess: () => { setEditing(false); onChanged(); } }
  );
  const status = STATUS[budget.status];
  const savings = budget.budgetType === 'SAVINGS_TARGET';

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-navy-900">{budgetName(budget)}</p>
          <p className="tabular text-sm text-navy-500">
            {savings
              ? `${formatMoney(budget.saved, currency)} saved of ${formatMoney(budget.amount, currency)}`
              : `${formatMoney(budget.spent, currency)} spent of ${formatMoney(budget.amount, currency)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <Button variant="ghost" size="sm" onClick={() => setEditing((open) => !open)} aria-expanded={editing}>Edit</Button>
          <ConfirmButton label="Delete" aria-label={`Delete ${budgetName(budget)} budget`} onConfirm={async () => { await deleteBudget(budget.id); onChanged(); }} />
        </div>
      </div>
      <div className="mt-3">
        <ProgressBar value={budget.percentUsed} tone={status.bar} label={`${budgetName(budget)}: ${budget.percentUsed}%`} />
        <p className="tabular mt-1.5 text-xs text-navy-500">
          {budget.percentUsed}% {savings ? 'reached' : 'used'}
          {!savings && (Number(budget.remaining) >= 0
            ? ` · ${formatMoney(budget.remaining, currency)} left`
            : ` · ${formatMoney(budget.remaining.replace('-', ''), currency)} over`)}
        </p>
      </div>
      {editing && (
        <form
          noValidate className="mt-4 grid gap-3 rounded-xl bg-navy-50 p-4 sm:grid-cols-3 sm:items-end"
          onSubmit={(event) => { event.preventDefault(); submit({ amount: amount.trim(), alertThresholdPct: Number(threshold) }); }}
        >
          {formError && <Alert tone="error" className="sm:col-span-3">{formError}</Alert>}
          <Input label={`Amount (${currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={fieldErrors.amount} />
          <Input label="Alert at (%)" type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} error={fieldErrors.alertThresholdPct} />
          <Button type="submit" loading={submitting}>Save</Button>
        </form>
      )}
    </li>
  );
}

function NewBudgetForm({ month, currency, categories, existing, onCreated }) {
  const [form, setForm] = useState({ budgetType: 'CATEGORY', categoryId: '', amount: '', alertThresholdPct: '80' });
  const { submit, submitting, fieldErrors, formError } = useSubmit(createBudget, {
    onSuccess: () => { setForm((current) => ({ ...current, categoryId: '', amount: '' })); onCreated(); },
  });
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const taken = new Set(existing.filter((b) => b.budgetType === 'CATEGORY').map((b) => b.category.id));
  const available = categories.filter((category) => category.type === 'EXPENSE' && !taken.has(category.id));

  function onSubmit(event) {
    event.preventDefault();
    submit({
      budgetType: form.budgetType,
      categoryId: form.budgetType === 'CATEGORY' ? Number(form.categoryId) || null : null,
      month,
      amount: form.amount.trim(),
      alertThresholdPct: Number(form.alertThresholdPct),
    });
  }

  return (
    <Card as="section" aria-labelledby="new-budget">
      <CardHeader title={<span id="new-budget">New budget</span>} description={`For ${monthLabel(month)}, in ${currency}.`} />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <Select label="Kind" value={form.budgetType} onChange={set('budgetType')}>
            <option value="CATEGORY">Limit for one category</option>
            <option value="OVERALL">Limit for all spending</option>
            <option value="SAVINGS_TARGET">Savings target (income minus spending)</option>
          </Select>
          {form.budgetType === 'CATEGORY' && (
            <Select label="Category" value={form.categoryId} onChange={set('categoryId')} error={fieldErrors.categoryId}>
              <option value="">Choose a category</option>
              {available.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Amount" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={set('amount')} error={fieldErrors.amount} />
            <Input
              label="Alert at (%)" type="number" min={1} max={100} value={form.alertThresholdPct} onChange={set('alertThresholdPct')}
              error={fieldErrors.alertThresholdPct} hint="You get a notification at this share."
            />
          </div>
          <Button type="submit" loading={submitting} className="w-full">Add budget</Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function BudgetsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [notice, setNotice] = useState(null);
  const state = useAsync(() => listBudgets(month), { watch: month });
  const categories = useAsync(() => listCategories({ type: 'EXPENSE' }));
  const data = state.data;

  async function copyFromPrevious() {
    try {
      const { copied } = await copyBudgets(addMonths(month, -1), month);
      setNotice({ tone: copied ? 'success' : 'info', text: copied ? `Copied ${copied} budget${copied === 1 ? '' : 's'} from ${monthLabel(addMonths(month, -1))}.` : 'Nothing new to copy from the previous month.' });
      await state.reload();
    } catch (err) {
      setNotice({ tone: 'error', text: err.message });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Budgets" description="Monthly limits and savings targets in your main currency.">
        <div className="flex items-center gap-1 rounded-lg bg-white p-1 ring-1 ring-navy-200">
          <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => { setMonth(addMonths(month, -1)); setNotice(null); }}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="min-w-36 text-center text-sm font-semibold text-navy-900" aria-live="polite">{monthLabel(month)}</span>
          <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => { setMonth(addMonths(month, 1)); setNotice(null); }}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </PageHeader>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <AsyncSection state={state} label="Loading budgets" lines={5}>
        {data && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card as="section" aria-label="Month totals" className="grid grid-cols-2 divide-x divide-navy-100">
                <div className="p-5">
                  <p className="text-sm text-navy-500">Income</p>
                  <p className="tabular mt-1 text-xl font-semibold text-income">{formatMoney(data.income, data.currency)}</p>
                </div>
                <div className="p-5">
                  <p className="text-sm text-navy-500">Spent</p>
                  <p className="tabular mt-1 text-xl font-semibold text-expense">{formatMoney(data.expense, data.currency)}</p>
                </div>
              </Card>
              <Card as="section" aria-labelledby="budget-list">
                <CardHeader
                  title={<span id="budget-list">Budgets for {monthLabel(month)}</span>}
                  action={<Button variant="secondary" size="sm" onClick={copyFromPrevious}><Copy className="h-4 w-4" aria-hidden="true" /> Copy last month</Button>}
                />
                <CardBody className="pt-2">
                  {data.budgets.length === 0 ? (
                    <EmptyState icon={PiggyBank} title="No budgets for this month" description="Add one on the right, or copy last month's budgets." />
                  ) : (
                    <ul className="divide-y divide-navy-100">
                      {data.budgets.map((budget) => <BudgetRow key={budget.id} budget={budget} currency={data.currency} onChanged={state.reload} />)}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>
            <div>
              <NewBudgetForm month={month} currency={data.currency} categories={categories.data ?? []} existing={data.budgets} onCreated={state.reload} />
            </div>
          </div>
        )}
      </AsyncSection>
    </div>
  );
}
