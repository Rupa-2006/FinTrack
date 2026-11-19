import {
  ArrowRight, BarChart3, Coins, FileLock2, Fingerprint, History, KeyRound, LockKeyhole, PiggyBank, ShieldCheck, Sparkles, Target, Wallet,
} from 'lucide-react';
import { Badge, Button, Card } from '../../components/ui/index.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { formatMoney } from '../../utils/format.js';

const FEATURES = [
  { icon: Wallet, title: 'Income and expenses', text: 'Record every transaction with a category, date and payment method. Search, filter and page through your history.' },
  { icon: PiggyBank, title: 'Budgets that warn you', text: 'Set monthly limits overall and per category. See how much is used and get alerted before you overspend.' },
  { icon: Target, title: 'Savings goals', text: 'Give each goal a target and a deadline, log contributions and watch progress build.' },
  { icon: Coins, title: 'Multi-currency', text: 'Track INR, USD, EUR, GBP and JPY. The original amount is always kept, with the exchange rate used for conversion.' },
  { icon: BarChart3, title: 'Reports and analytics', text: 'Daily to yearly views of income, spending and savings by category, with CSV export and printable reports.' },
  { icon: Sparkles, title: 'AI assistant', text: 'Ask questions about your own records, get monthly summaries and see unusual spending flagged.' },
];

const SECURITY = [
  { icon: KeyRound, title: 'Hashed passwords', text: 'Passwords are stored only as bcrypt hashes.' },
  { icon: FileLock2, title: 'Field encryption', text: 'Sensitive fields are encrypted with AES-256-GCM before they reach the database.' },
  { icon: Fingerprint, title: 'Short-lived sessions', text: 'Access tokens expire in minutes. Sessions can be reviewed and revoked.' },
  { icon: LockKeyhole, title: 'Your data only', text: 'Every request is checked against your account. Administrators cannot read private transactions.' },
  { icon: History, title: 'Tamper-evident audit log', text: 'Each audit record is chained to the one before it, so changes to history can be detected.' },
  { icon: ShieldCheck, title: 'Hardened API', text: 'Rate limiting, strict input validation, parameterized queries and secure HTTP headers on every route.' },
];

const STEPS = [
  { title: 'Create your account', text: 'Register with an email and password and choose your base currency.' },
  { title: 'Record your money', text: 'Add income and expenses as they happen, in any supported currency.' },
  { title: 'Plan and improve', text: 'Set budgets and goals, then use reports and the assistant to adjust.' },
];

// Sample figures for the marketing illustration only. The real dashboard reads from the API.
const PREVIEW = {
  balance: '137648.39',
  income: '85000.00',
  expenses: '52310.75',
  bars: [42, 58, 51, 74, 63, 88],
  budgets: [
    { name: 'Food & Dining', used: 72 },
    { name: 'Transport', used: 46 },
    { name: 'Shopping', used: 91 },
  ],
};

function DashboardPreview() {
  return (
    <div className="relative">
      <div aria-hidden="true" className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-navy-300/30 via-white/0 to-emerald-200/30 blur-2xl" />
      <Card className="relative p-6 shadow-lift" role="img" aria-label="Illustration of the FinTrack dashboard with sample figures">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-navy-500">Available balance</p>
          <Badge tone="income">+8.2% this month</Badge>
        </div>
        <p className="tabular mt-2 text-3xl font-semibold tracking-tight text-navy-900">{formatMoney(PREVIEW.balance, 'INR', { locale: 'en-IN' })}</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-xs font-medium text-emerald-700">Income</p>
            <p className="tabular mt-1 text-sm font-semibold text-emerald-900">{formatMoney(PREVIEW.income, 'INR', { locale: 'en-IN' })}</p>
          </div>
          <div className="rounded-xl bg-rose-50 p-3">
            <p className="text-xs font-medium text-rose-700">Expenses</p>
            <p className="tabular mt-1 text-sm font-semibold text-rose-900">{formatMoney(PREVIEW.expenses, 'INR', { locale: 'en-IN' })}</p>
          </div>
        </div>

        <div className="mt-6 flex h-24 items-end gap-2">
          {PREVIEW.bars.map((height, index) => (
            <div
              key={index}
              className="flex-1 rounded-t-md bg-gradient-to-t from-navy-700 to-navy-400"
              style={{ height: `${height}%`, opacity: 0.55 + index * 0.09 }}
            />
          ))}
        </div>

        <div className="mt-6 space-y-3">
          {PREVIEW.budgets.map((budget) => (
            <div key={budget.name}>
              <div className="flex justify-between text-xs">
                <span className="font-medium text-navy-700">{budget.name}</span>
                <span className="tabular text-navy-500">{budget.used}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-navy-100">
                <div className={budget.used >= 90 ? 'h-1.5 rounded-full bg-expense' : 'h-1.5 rounded-full bg-navy-600'} style={{ width: `${budget.used}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <p className="relative mt-3 text-center text-xs text-navy-400">Illustration with sample figures</p>
    </div>
  );
}

export function LandingPage() {
  useDocumentTitle(null);
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-b from-navy-50 via-white to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div className="animate-fade-up">
            <Badge tone="info"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Security built in from the first line</Badge>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-navy-900 sm:text-5xl">
              Know where your money goes.{' '}
              <span className="bg-gradient-to-r from-navy-600 to-navy-400 bg-clip-text text-transparent">Keep it private.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-navy-600">
              FinTrack brings your income, expenses, budgets and savings goals into one secure place, across multiple
              currencies, with clear reports and an AI assistant that only ever sees your own data.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button to="/register" size="lg">Get started free <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
              <Button to="/login" size="lg" variant="secondary">Sign in</Button>
            </div>
            <p className="mt-4 text-sm text-navy-400">Demonstration project. Uses fictional data and never connects to a bank.</p>
          </div>
          <div className="animate-fade-up [animation-delay:120ms]">
            <DashboardPreview />
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-20 bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-navy-900">Everything you need to manage personal finances</h2>
            <p className="mt-3 text-navy-600">Six connected tools that share one ledger, so every number agrees with every other.</p>
          </div>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <Card as="li" key={title} className="p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-900 text-white">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-semibold text-navy-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy-600">{text}</p>
              </Card>
            ))}
          </ul>
        </div>
      </section>

      <section id="security" className="scroll-mt-20 bg-gradient-to-b from-navy-900 to-navy-950 py-16 text-white sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight">Secured like a fintech product</h2>
            <p className="mt-3 text-navy-200">Security is part of the architecture, not a feature added at the end.</p>
          </div>
          <ul className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {SECURITY.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-emerald-300">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-navy-200">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight text-navy-900">How it works</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-2xl bg-navy-50 p-6 ring-1 ring-navy-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white">{index + 1}</span>
                <h3 className="mt-4 font-semibold text-navy-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy-600">{step.text}</p>
              </li>
            ))}
          </ol>

          <div className="mt-14 flex flex-col items-start justify-between gap-6 rounded-3xl bg-gradient-to-r from-navy-800 to-navy-600 p-8 text-white sm:flex-row sm:items-center sm:p-10">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Ready to take control of your finances?</h2>
              <p className="mt-2 text-navy-100">Create an account in under a minute.</p>
            </div>
            <Button to="/register" variant="inverse" size="lg">Create your account <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </div>
      </section>
    </>
  );
}
