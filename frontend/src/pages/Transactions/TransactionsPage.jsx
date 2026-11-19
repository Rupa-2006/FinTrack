import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Pencil, Plus, Receipt, Repeat, StickyNote, Upload } from 'lucide-react';
import { Amount, AsyncSection, ConfirmButton, PageHeader, Pagination } from '../../components/app/index.jsx';
import { Alert, Badge, Button, Card, EmptyState, Input, Select } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { deleteTransaction, downloadTransactionsCsv, listCategories, listTransactions } from '../../services/ledgerService.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import { paymentLabel } from '../../utils/options.js';

const NO_FILTERS = { search: '', type: '', categoryId: '', from: '', to: '' };

export function TransactionsPage() {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState(null);
  const query = { ...filters, page, pageSize: 20 };
  const state = useAsync(() => listTransactions(query), { watch: JSON.stringify(query) });
  const categories = useAsync(listCategories);

  const setFilter = (field) => (event) => {
    setFilters((current) => ({ ...current, [field]: event.target.value, ...(field === 'type' ? { categoryId: '' } : {}) }));
    setPage(1);
  };
  const filtered = Object.values(filters).some(Boolean);
  const categoryOptions = (categories.data ?? []).filter((category) => !filters.type || category.type === filters.type);

  async function remove(txn) {
    try {
      await deleteTransaction(txn.id);
      setMessage({ tone: 'success', text: `"${txn.description}" was deleted.` });
      await state.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    }
  }

  async function exportCsv() {
    try {
      const { blob, filename } = await downloadTransactionsCsv({ from: filters.from, to: filters.to, type: filters.type });
      saveBlob(blob, filename);
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    }
  }

  const items = state.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Transactions" description="Every income and expense you have recorded.">
        <Button variant="secondary" onClick={exportCsv}><Download className="h-4 w-4" aria-hidden="true" /> Export CSV</Button>
        <Button to="/transactions/import" variant="secondary"><Upload className="h-4 w-4" aria-hidden="true" /> Import CSV</Button>
        <Button to="/transactions/new"><Plus className="h-4 w-4" aria-hidden="true" /> Add transaction</Button>
      </PageHeader>

      <Card as="form" role="search" aria-label="Filter transactions" className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" onSubmit={(event) => event.preventDefault()}>
        <Input label="Search" type="search" placeholder="Description" value={filters.search} onChange={setFilter('search')} />
        <Select label="Type" value={filters.type} onChange={setFilter('type')}>
          <option value="">All types</option>
          <option value="INCOME">Income</option>
          <option value="EXPENSE">Expense</option>
        </Select>
        <Select label="Category" value={filters.categoryId} onChange={setFilter('categoryId')}>
          <option value="">All categories</option>
          {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </Select>
        <Input label="From" type="date" value={filters.from} onChange={setFilter('from')} />
        <Input label="To" type="date" value={filters.to} onChange={setFilter('to')} />
      </Card>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <AsyncSection state={state} label="Loading transactions" lines={6}>
        {items.length === 0 ? (
          <Card>
            <EmptyState
              icon={Receipt}
              title={filtered ? 'No transactions match these filters' : 'No transactions yet'}
              description={filtered ? 'Try a wider date range or clear the filters.' : 'Record your first income or expense to get started.'}
              action={filtered
                ? <Button variant="secondary" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>Clear filters</Button>
                : <Button to="/transactions/new">Add a transaction</Button>}
            />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {/* relative: keeps the visually hidden header text inside the scroll area on phones */}
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-navy-100 bg-navy-50/60 text-xs uppercase tracking-wide text-navy-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Date</th>
                    <th scope="col" className="px-4 py-3 font-medium">Description</th>
                    <th scope="col" className="px-4 py-3 font-medium">Category</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {items.map((txn) => (
                    <tr key={txn.id} className="hover:bg-navy-50/50">
                      <td className="whitespace-nowrap px-4 py-3 text-navy-600">{formatDate(txn.date)}</td>
                      <td className="px-4 py-3">
                        <p className="flex items-center gap-1.5 font-medium text-navy-900">
                          {txn.description}
                          {txn.hasNotes && <StickyNote className="h-3.5 w-3.5 text-navy-400" aria-label="Has notes" />}
                          {txn.recurringRuleId && <Repeat className="h-3.5 w-3.5 text-navy-400" aria-label="Recurring" />}
                        </p>
                        <p className="text-xs text-navy-500">{paymentLabel(txn.paymentMethod)}</p>
                      </td>
                      <td className="px-4 py-3"><Badge>{txn.category.name}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Amount type={txn.type} amount={txn.baseAmount} currency={txn.baseCurrency} />
                        {txn.currency !== txn.baseCurrency && (
                          <p className="tabular text-xs text-navy-500">from {formatMoney(txn.amount, txn.currency)}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Link to={`/transactions/${txn.id}/edit`} aria-label={`Edit ${txn.description}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-navy-500 hover:bg-navy-100 hover:text-navy-900">
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Link>
                        <ConfirmButton label="Delete" confirmLabel="Delete" aria-label={`Delete ${txn.description}`} onConfirm={() => remove(txn)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-navy-100 p-4">
              <Pagination page={state.data.pagination.page} totalPages={state.data.pagination.totalPages} totalItems={state.data.pagination.totalItems} onChange={setPage} />
            </div>
          </Card>
        )}
      </AsyncSection>
    </div>
  );
}
