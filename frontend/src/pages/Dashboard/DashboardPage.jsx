import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, PiggyBank, Plus, Wallet } from 'lucide-react';
import { Amount, AsyncSection, PageHeader, ProgressBar } from '../../components/app/index.jsx';
import { CategoryDonut, CategoryList, TrendChart } from '../../components/charts/Charts.jsx';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, StatCard } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../hooks/useAuth.js';
import { getDashboard } from '../../services/ledgerService.js';
import { currentMonth, monthLabel } from '../../utils/dates.js';
import { formatDate, formatMoney, formatPercent } from '../../utils/format.js';

// At least 24px tall so it is an easy touch target (WCAG 2.5.8).
const LINK = 'inline-flex min-h-6 items-center text-sm font-medium text-navy-600 hover:text-navy-900 hover:underline';

function changeHint(change) {
  if (change === null || change === undefined) return 'Nothing last month to compare with';
  if (change === 0) return 'Same as last month to this day';
  return `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than last month to this day`;
}

const BUDGET_TONE = { ON_TRACK: 'neutral', WARNING: 'warning', EXCEEDED: 'expense', REACHED: 'income', IN_PROGRESS: 'neutral' };

function budgetName(budget) {
  if (budget.budgetType === 'OVERALL') return 'All spending';
  if (budget.budgetType === 'SAVINGS_TARGET') return 'Savings target';
  return budget.category.name;
}

function Overview({ data }) {
  const { summary, currency } = data;
  const hasActivity = data.recentTransactions.length > 0;

  if (!hasActivity) {
    return (
      <Card>
        <EmptyState
          icon={Wallet}
          title="Nothing recorded yet"
          description="Add your first income or expense and your dashboard will fill in from there."
          action={<Button to="/transactions/new"><Plus className="h-4 w-4" aria-hidden="true" /> Add a transaction</Button>}
        />
      </Card>
    );
  }

  return (
    <>
      <section aria-label="This month" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Income" value={formatMoney(summary.income, currency)} hint={changeHint(summary.changes.income)} icon={ArrowUpRight} tone="income" />
        <StatCard label="Expenses" value={formatMoney(summary.expense, currency)} hint={changeHint(summary.changes.expense)} icon={ArrowDownRight} tone="expense" />
        <StatCard label="Net balance" value={formatMoney(summary.net, currency, { signed: true })} hint={`${summary.transactionCount} transactions this month`} icon={Wallet} />
        <StatCard
          label="Savings rate" icon={PiggyBank}
          value={summary.savingsRate === null ? '—' : formatPercent(summary.savingsRate, 1)}
          hint={summary.savingsRate === null ? 'No income recorded this month' : 'Share of income left over'}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card as="section" className="xl:col-span-2">
          <CardHeader title="Income and expenses" description="Last six months" action={<Link to="/analytics" className={LINK}>Analytics</Link>} />
          <CardBody><TrendChart months={data.trend} currency={currency} /></CardBody>
        </Card>
        <Card as="section">
          <CardHeader title="Where the money went" description={monthLabel(data.month)} />
          <CardBody>
            {data.topCategories.length ? (
              <>
                <CategoryDonut categories={data.topCategories} currency={currency} />
                <div className="mt-4"><CategoryList categories={data.topCategories} currency={currency} /></div>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-navy-500">No expenses this month.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card as="section" className="xl:col-span-2">
          <CardHeader title="Recent transactions" action={<Link to="/transactions" className={LINK}>View all</Link>} />
          <CardBody className="pt-2">
            <ul className="divide-y divide-navy-100">
              {data.recentTransactions.map((txn) => (
                <li key={txn.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">{txn.description}</p>
                    <p className="text-xs text-navy-500">{txn.category.name} · {formatDate(txn.date)}</p>
                  </div>
                  <Amount type={txn.type} amount={txn.baseAmount} currency={txn.baseCurrency} className="shrink-0 text-sm" />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card as="section">
            <CardHeader title="Budgets" description={monthLabel(data.month)} action={<Link to="/budgets" className={LINK}>Manage</Link>} />
            <CardBody className="space-y-4">
              {data.budgets.length === 0 && <p className="text-sm text-navy-500">No budgets set for this month.</p>}
              {data.budgets.slice(0, 4).map((budget) => (
                <div key={budget.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-navy-800">{budgetName(budget)}</span>
                    {budget.status === 'EXCEEDED' ? <Badge tone="expense">Over</Badge> : <span className="tabular text-navy-500">{budget.percentUsed}%</span>}
                  </div>
                  <ProgressBar value={budget.percentUsed} tone={BUDGET_TONE[budget.status]} label={`${budgetName(budget)} budget used`} />
                </div>
              ))}
            </CardBody>
          </Card>
          <Card as="section">
            <CardHeader title="Savings goals" action={<Link to="/goals" className={LINK}>Manage</Link>} />
            <CardBody className="space-y-4">
              {data.goals.length === 0 && <p className="text-sm text-navy-500">No goals in progress.</p>}
              {data.goals.map((goal) => (
                <div key={goal.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-navy-800">{goal.title}</span>
                    <span className="tabular text-navy-500">{goal.percent}%</span>
                  </div>
                  <ProgressBar value={goal.percent} tone="income" label={`${goal.title} progress`} />
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const month = currentMonth();
  const state = useAsync(() => getDashboard(month));
  const firstName = user?.fullName?.split(' ')[0];

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={`${firstName ? `Hello ${firstName}. ` : ''}Here is ${monthLabel(month)} so far.`}>
        <Button to="/transactions/new"><Plus className="h-4 w-4" aria-hidden="true" /> Add transaction</Button>
      </PageHeader>
      <AsyncSection state={state} label="Loading your dashboard" lines={6}>
        {state.data && <Overview data={state.data} />}
      </AsyncSection>
    </div>
  );
}
