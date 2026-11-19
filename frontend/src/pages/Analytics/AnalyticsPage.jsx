import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react';
import { AsyncSection, PageHeader, ProgressBar } from '../../components/app/index.jsx';
import { CategoryDonut, CategoryList, TrendChart } from '../../components/charts/Charts.jsx';
import { Alert, Button, Card, CardBody, CardHeader, Select, StatCard } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import {
  downloadTransactionsCsv, getCategoryBreakdown, getMonthlyReport, getMonthlyTrend, getSummary, listTransactions,
} from '../../services/ledgerService.js';
import { saveBlob } from '../../utils/download.js';
import { currentMonth, monthLabel, periodLabel, periodRange, shiftPeriod, todayIso } from '../../utils/dates.js';
import { formatDate, formatMoney, formatPercent } from '../../utils/format.js';
import { paymentLabel } from '../../utils/options.js';

// What each period is compared with (previousPeriod in the API): a period that is still
// running only up to the same point of the previous one.
const AGAINST = {
  day: () => 'the day before',
  week: (running) => (running ? 'last week to this day' : 'the week before'),
  month: (running) => (running ? 'last month to this day' : 'the month before'),
  year: (running) => (running ? 'last year to this date' : 'the year before'),
};

function changeHintFor(change, running, view = 'month') {
  const against = AGAINST[view](running);
  if (change === null || change === undefined) return 'Nothing to compare with';
  return change === 0 ? `Same as ${against}` : `${change > 0 ? '+' : ''}${change}% on ${against}`;
}

function Report({ report }) {
  const { summary, currency } = report;
  const changeHint = (change) => changeHintFor(change, report.month === currentMonth());
  return (
    <>
      <section aria-label="Month summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Income" value={formatMoney(summary.income, currency)} hint={changeHint(summary.changes.income)} tone="income" />
        <StatCard label="Expenses" value={formatMoney(summary.expense, currency)} hint={changeHint(summary.changes.expense)} tone="expense" />
        <StatCard label="Net" value={formatMoney(summary.net, currency, { signed: true })} hint={`${summary.transactionCount} transactions`} />
        <StatCard label="Savings rate" value={summary.savingsRate === null ? '—' : formatPercent(summary.savingsRate, 1)} hint="Share of income left over" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section" className="break-inside-avoid">
          <CardHeader title="Spending by category" />
          <CardBody>
            {report.expenseCategories.length ? (
              <div className="grid items-center gap-4 sm:grid-cols-2">
                <CategoryDonut categories={report.expenseCategories} currency={currency} />
                <CategoryList categories={report.expenseCategories} currency={currency} />
              </div>
            ) : <p className="text-sm text-navy-500">No expenses this month.</p>}
          </CardBody>
        </Card>
        <Card as="section" className="break-inside-avoid">
          <CardHeader title="Income by category" />
          <CardBody>
            {report.incomeCategories.length ? <CategoryList categories={report.incomeCategories} currency={currency} /> : <p className="text-sm text-navy-500">No income this month.</p>}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section" className="break-inside-avoid">
          <CardHeader title="Largest expenses" />
          <CardBody className="pt-2">
            {report.largestExpenses.length === 0 && <p className="text-sm text-navy-500">None.</p>}
            <ol className="divide-y divide-navy-100">
              {report.largestExpenses.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-navy-900">{item.description}</span>
                    <span className="text-xs text-navy-500">{item.category} · {formatDate(item.date)}</span>
                  </span>
                  <span className="tabular shrink-0 font-semibold text-expense">{formatMoney(item.amount, currency)}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
        <Card as="section" className="break-inside-avoid">
          <CardHeader title="Budgets" />
          <CardBody className="space-y-4">
            {report.budgets.length === 0 && <p className="text-sm text-navy-500">No budgets were set for this month.</p>}
            {report.budgets.map((budget) => {
              const name = budget.category?.name ?? (budget.budgetType === 'OVERALL' ? 'All spending' : 'Savings target');
              return (
                <div key={budget.id}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="font-medium text-navy-800">{name}</span>
                    <span className="tabular text-navy-500">{budget.percentUsed}%</span>
                  </div>
                  <ProgressBar value={budget.percentUsed} tone={budget.status === 'EXCEEDED' ? 'expense' : budget.status === 'WARNING' ? 'warning' : 'neutral'} label={`${name}: ${budget.percentUsed}%`} />
                </div>
              );
            })}
            {report.paymentMethods.length > 0 && (
              <div className="border-t border-navy-100 pt-4">
                <p className="mb-2 text-sm font-medium text-navy-800">Spending by payment method</p>
                <ul className="space-y-1.5 text-sm">
                  {report.paymentMethods.map((method) => (
                    <li key={method.paymentMethod} className="flex justify-between">
                      <span className="text-navy-600">{paymentLabel(method.paymentMethod)}</span>
                      <span className="tabular text-navy-800">{formatMoney(method.total, currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

const VIEWS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

// Day, week and year: totals with their comparison, both category breakdowns, and the
// transactions themselves (day and week) or the month-by-month trend (year). The month view
// keeps the fuller monthly report below.
function PeriodReport({ view, anchor }) {
  const { from, to } = periodRange(view, anchor);
  const today = todayIso();
  const running = view !== 'day' && from <= today && today <= to;
  const key = `${from}:${to}`;
  const summary = useAsync(() => getSummary({ from, to }), { watch: key });
  const expenses = useAsync(() => getCategoryBreakdown({ from, to, type: 'EXPENSE' }), { watch: key });
  const income = useAsync(() => getCategoryBreakdown({ from, to, type: 'INCOME' }), { watch: key });
  const year = view === 'year' ? anchor.slice(0, 4) : null;
  const lastMonth = year && `${year}-12` > currentMonth() ? currentMonth() : `${year}-12`;
  const trend = useAsync(
    () => (year && lastMonth >= `${year}-01` ? getMonthlyTrend({ months: Number(lastMonth.slice(5)), until: lastMonth }) : Promise.resolve(null)),
    { watch: `${view}:${year}` }
  );
  const entries = useAsync(
    () => (view === 'year' ? Promise.resolve(null) : listTransactions({ from, to, pageSize: 50, sort: 'date', order: 'desc' })),
    { watch: `${view}:${key}` }
  );
  const hint = (change) => changeHintFor(change, running, view);
  const totalEntries = entries.data?.pagination?.totalItems ?? 0;

  return (
    <>
      <AsyncSection state={summary} label="Loading totals" lines={2}>
        {summary.data && (
          <section aria-label="Period summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Income" value={formatMoney(summary.data.income, summary.data.currency)} hint={hint(summary.data.changes.income)} tone="income" />
            <StatCard label="Expenses" value={formatMoney(summary.data.expense, summary.data.currency)} hint={hint(summary.data.changes.expense)} tone="expense" />
            <StatCard label="Net" value={formatMoney(summary.data.net, summary.data.currency, { signed: true })} hint={`${summary.data.transactionCount} transactions`} />
            <StatCard label="Savings rate" value={summary.data.savingsRate === null ? '—' : formatPercent(summary.data.savingsRate, 1)} hint="Share of income left over" />
          </section>
        )}
      </AsyncSection>

      {view === 'year' && (
        <Card as="section" className="break-inside-avoid">
          <CardHeader title="Month by month" description={`Income and expenses in ${year}`} />
          <CardBody>
            <AsyncSection state={trend} label="Loading trend" lines={4}>
              {trend.data ? <TrendChart months={trend.data.months} currency={trend.data.currency} /> : <p className="text-sm text-navy-500">No months to show yet.</p>}
            </AsyncSection>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section" className="break-inside-avoid">
          <CardHeader title="Spending by category" />
          <CardBody>
            <AsyncSection state={expenses} label="Loading spending" lines={3}>
              {expenses.data && (expenses.data.categories.length ? (
                <div className="grid items-center gap-4 sm:grid-cols-2">
                  <CategoryDonut categories={expenses.data.categories} currency={expenses.data.currency} />
                  <CategoryList categories={expenses.data.categories} currency={expenses.data.currency} />
                </div>
              ) : <p className="text-sm text-navy-500">No expenses in this period.</p>)}
            </AsyncSection>
          </CardBody>
        </Card>
        <Card as="section" className="break-inside-avoid">
          <CardHeader title="Income by category" />
          <CardBody>
            <AsyncSection state={income} label="Loading income" lines={3}>
              {income.data && (income.data.categories.length
                ? <CategoryList categories={income.data.categories} currency={income.data.currency} />
                : <p className="text-sm text-navy-500">No income in this period.</p>)}
            </AsyncSection>
          </CardBody>
        </Card>
      </div>

      {view !== 'year' && (
        <Card as="section" className="break-inside-avoid">
          <CardHeader
            title="Transactions"
            description={totalEntries > 50 ? `The latest 50 of ${totalEntries}` : undefined}
            action={<Link to="/transactions" className="no-print inline-flex min-h-6 items-center text-sm font-medium text-navy-600 hover:underline">All transactions</Link>}
          />
          <CardBody className="pt-2">
            <AsyncSection state={entries} label="Loading transactions" lines={3}>
              {entries.data && (entries.data.items.length === 0 ? <p className="text-sm text-navy-500">No transactions in this period.</p> : (
                <ul className="divide-y divide-navy-100">
                  {entries.data.items.map((txn) => (
                    <li key={txn.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-navy-900">{txn.description}</span>
                        <span className="text-xs text-navy-500">{txn.category.name} · {formatDate(txn.date)}</span>
                      </span>
                      <span className={`tabular shrink-0 font-semibold ${txn.type === 'INCOME' ? 'text-income' : 'text-expense'}`}>
                        {txn.type === 'INCOME' ? '+' : '−'}{formatMoney(txn.baseAmount, txn.baseCurrency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
            </AsyncSection>
          </CardBody>
        </Card>
      )}
    </>
  );
}

export function AnalyticsPage() {
  const [view, setView] = useState('month');
  const [anchor, setAnchor] = useState(todayIso());
  const [months, setMonths] = useState('6');
  const [error, setError] = useState(null);
  const month = anchor.slice(0, 7);
  const isMonth = view === 'month';
  const report = useAsync(() => (isMonth ? getMonthlyReport(month) : Promise.resolve(null)), { watch: `${view}:${month}` });
  const trend = useAsync(() => (isMonth ? getMonthlyTrend({ months, until: month }) : Promise.resolve(null)), { watch: `${view}:${months}:${month}` });
  const unit = VIEWS.find((option) => option.id === view).label.toLowerCase();
  const label = periodLabel(view, anchor);
  const nextIsFuture = periodRange(view, shiftPeriod(view, anchor, 1)).from > todayIso();

  async function exportPeriod() {
    setError(null);
    try {
      const { blob, filename } = await downloadTransactionsCsv(periodRange(view, anchor));
      saveBlob(blob, filename);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description={`Report for ${label}, in your main currency.`}>
        <div role="group" aria-label="Report period" className="flex rounded-lg bg-white p-1 ring-1 ring-navy-200">
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={view === option.id}
              onClick={() => setView(option.id)}
              className={`min-h-8 rounded-md px-3 text-sm font-medium transition-colors ${view === option.id ? 'bg-navy-900 text-white' : 'text-navy-600 hover:bg-navy-100'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-white p-1 ring-1 ring-navy-200">
          <Button variant="ghost" size="sm" aria-label={`Previous ${unit}`} onClick={() => setAnchor(shiftPeriod(view, anchor, -1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
          <span className="min-w-36 text-center text-sm font-semibold text-navy-900" aria-live="polite">{label}</span>
          <Button variant="ghost" size="sm" aria-label={`Next ${unit}`} disabled={nextIsFuture} onClick={() => setAnchor(shiftPeriod(view, anchor, 1))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <Button variant="secondary" onClick={exportPeriod}><Download className="h-4 w-4" aria-hidden="true" /> CSV</Button>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden="true" /> Print</Button>
      </PageHeader>
      {error && <Alert tone="error">{error}</Alert>}

      {isMonth ? (
        <>
          <Card as="section" className="break-inside-avoid">
            <CardHeader
              title="Trend"
              description={`Income and expenses up to ${monthLabel(month)}`}
              action={(
                <Select label="Period" value={months} onChange={(e) => setMonths(e.target.value)} className="no-print w-36">
                  <option value="3">3 months</option>
                  <option value="6">6 months</option>
                  <option value="12">12 months</option>
                </Select>
              )}
            />
            <CardBody>
              <AsyncSection state={trend} label="Loading trend" lines={4}>
                {trend.data && <TrendChart months={trend.data.months} currency={trend.data.currency} />}
              </AsyncSection>
            </CardBody>
          </Card>

          <AsyncSection state={report} label="Loading report" lines={6}>
            {report.data && <Report report={report.data} />}
          </AsyncSection>
        </>
      ) : <PeriodReport view={view} anchor={anchor} />}
    </div>
  );
}
