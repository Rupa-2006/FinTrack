// Charts (Recharts). Values are converted to numbers here for drawing only; every figure
// shown as text is formatted from the exact decimal string. Each chart carries a text
// alternative for screen readers.
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { monthLabel } from '../../utils/dates.js';
import { formatMoney } from '../../utils/format.js';
import { categoryColor } from '../../utils/options.js';

const INCOME = '#059669';
const EXPENSE = '#e11d48';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

// Income and expenses side by side for each month.
export function TrendChart({ months, currency }) {
  const data = months.map((entry) => ({ label: monthLabel(entry.month, { short: true }), Income: Number(entry.income), Expenses: Number(entry.expense) }));
  return (
    <figure>
      <div className="h-64 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer={false} data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
            <CartesianGrid vertical={false} stroke="#e4eaf5" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#4664a8', fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#4664a8', fontSize: 12 }} tickFormatter={(value) => compact.format(value)} />
            <Tooltip cursor={{ fill: '#f3f6fb' }} formatter={(value) => formatMoney(String(value), currency)} contentStyle={{ borderRadius: 12, borderColor: '#e4eaf5' }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Income" fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="Expenses" fill={EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        Income and expenses by month.{' '}
        {months.map((entry) => `${monthLabel(entry.month)}: income ${formatMoney(entry.income, currency)}, expenses ${formatMoney(entry.expense, currency)}.`).join(' ')}
      </figcaption>
    </figure>
  );
}

// Share of each category, with the list beside it doing the labelling.
export function CategoryDonut({ categories, currency }) {
  const data = categories.map((category, index) => ({ name: category.name, value: Number(category.total), fill: categoryColor(category, index) }));
  return (
    <div className="h-52 w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart accessibilityLayer={false}>
          <Pie rootTabIndex={-1} data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={2} stroke="none">
            {data.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
          </Pie>
          <Tooltip formatter={(value) => formatMoney(String(value), currency)} contentStyle={{ borderRadius: 12, borderColor: '#e4eaf5' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// Legend and exact figures for a category breakdown.
export function CategoryList({ categories, currency }) {
  return (
    <ul className="space-y-2.5">
      {categories.map((category, index) => (
        <li key={category.categoryId} className="flex items-center justify-between gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(category, index) }} aria-hidden="true" />
            <span className="truncate text-navy-800">{category.name}</span>
          </span>
          <span className="tabular shrink-0 text-navy-600">
            {formatMoney(category.total, currency)} <span className="text-navy-500">· {category.percent}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
