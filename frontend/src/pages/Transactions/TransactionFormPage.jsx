import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AsyncSection, PageHeader } from '../../components/app/index.jsx';
import { Alert, Button, Card, CardBody, Input, Select } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { createTransaction, getTransaction, listCategories, updateTransaction } from '../../services/ledgerService.js';
import { cn } from '../../utils/cn.js';
import { todayIso } from '../../utils/dates.js';
import { CURRENCY_CODES, PAYMENT_METHODS } from '../../utils/options.js';

const TEXTAREA =
  'block w-full rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-navy-900 shadow-sm ring-1 ring-inset ring-navy-200 focus:ring-2 focus:ring-inset focus:ring-navy-500 focus:outline-none';

function TransactionForm({ initial, categories, baseCurrency, onSave, onCancel, saveLabel }) {
  const [form, setForm] = useState(initial);
  const { submit, submitting, fieldErrors, formError } = useSubmit(onSave);
  const [localErrors, setLocalErrors] = useState({});
  const errors = { ...fieldErrors, ...localErrors };

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const setType = (type) => setForm((current) => ({ ...current, type, categoryId: '' }));
  const options = categories.filter((category) => category.type === form.type);

  function onSubmit(event) {
    event.preventDefault();
    const problems = {};
    if (!/^\d+(\.\d{1,2})?$/.test(form.amount.trim()) || Number(form.amount) <= 0) problems.amount = 'Enter an amount greater than 0, with at most 2 decimal places';
    if (!form.categoryId) problems.categoryId = 'Choose a category';
    if (!form.description.trim()) problems.description = 'Enter a description';
    if (!form.date) problems.date = 'Choose a date';
    setLocalErrors(problems);
    if (Object.keys(problems).length) return;
    submit({ ...form, amount: form.amount.trim(), categoryId: Number(form.categoryId), description: form.description.trim(), notes: form.notes.trim() || null });
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {formError && <Alert tone="error">{formError}</Alert>}

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-navy-800">Type</legend>
            <div className="inline-flex rounded-lg bg-navy-100 p-1">
              {[['EXPENSE', 'Expense'], ['INCOME', 'Income']].map(([value, label]) => (
                <button
                  key={value} type="button" aria-pressed={form.type === value} onClick={() => setType(value)}
                  className={cn('rounded-md px-4 py-1.5 text-sm font-medium transition-colors', form.type === value ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-600 hover:text-navy-900')}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Amount" name="amount" inputMode="decimal" required placeholder="0.00" value={form.amount} onChange={set('amount')} error={errors.amount} className="sm:col-span-2" />
            <Select label="Currency" name="currency" value={form.currency} onChange={set('currency')} error={errors.currency}>
              {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          </div>
          {form.currency !== baseCurrency && (
            <p className="-mt-2 text-xs text-navy-500">
              Saved in {form.currency} exactly as entered. Totals use its value in {baseCurrency} at the exchange rate for the date below.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Category" name="categoryId" required value={form.categoryId} onChange={set('categoryId')} error={errors.categoryId}>
              <option value="">Choose a category</option>
              {options.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
            <Input label="Date" name="date" type="date" required max={todayIso()} value={form.date} onChange={set('date')} error={errors.date} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Description" name="description" required maxLength={255} value={form.description} onChange={set('description')} error={errors.description} className="sm:col-span-2" />
            <Select label="Payment method" name="paymentMethod" value={form.paymentMethod} onChange={set('paymentMethod')} error={errors.paymentMethod}>
              {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
            </Select>
          </div>

          <div>
            <label htmlFor="txn-notes" className="mb-1.5 block text-sm font-medium text-navy-800">Notes</label>
            <textarea id="txn-notes" name="notes" rows={3} maxLength={2000} className={TEXTAREA} value={form.notes} onChange={set('notes')} aria-describedby="txn-notes-hint" />
            <p id="txn-notes-hint" className="mt-1.5 text-xs text-navy-500">Optional. Notes are stored encrypted.</p>
            {errors.notes && <p role="alert" className="mt-1.5 text-xs font-medium text-expense">{errors.notes}</p>}
          </div>

          <div className="flex gap-3">
            <Button type="submit" loading={submitting}>{saveLabel}</Button>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

const fromTransaction = (txn) => ({
  type: txn.type, amount: txn.amount, currency: txn.currency, categoryId: String(txn.category.id), date: txn.date,
  description: txn.description, paymentMethod: txn.paymentMethod, notes: txn.notes ?? '',
});

// One page for both "add" (/transactions/new) and "edit" (/transactions/:id/edit).
export function TransactionFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const baseCurrency = user?.baseCurrency ?? 'INR';
  const state = useAsync(async () => {
    const [categories, transaction] = await Promise.all([listCategories(), editing ? getTransaction(id) : null]);
    return { categories, transaction };
  });

  const done = () => navigate('/transactions');
  const save = (body) => (editing ? updateTransaction(id, body) : createTransaction(body)).then(done);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={editing ? 'Edit transaction' : 'Add transaction'} description={editing ? 'Change the details of this entry.' : 'Record a new income or expense.'} />
      <AsyncSection state={state} label="Loading the form" lines={5}>
        {state.data && (
          <TransactionForm
            initial={state.data.transaction
              ? fromTransaction(state.data.transaction)
              : { type: 'EXPENSE', amount: '', currency: baseCurrency, categoryId: '', date: todayIso(), description: '', paymentMethod: 'CARD', notes: '' }}
            categories={state.data.categories}
            baseCurrency={baseCurrency}
            onSave={save}
            onCancel={done}
            saveLabel={editing ? 'Save changes' : 'Add transaction'}
          />
        )}
      </AsyncSection>
    </div>
  );
}
