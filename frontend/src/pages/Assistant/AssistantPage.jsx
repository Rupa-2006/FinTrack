import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUp, CheckCircle2, Info, Lightbulb, Repeat, Sparkles, TrendingUp } from 'lucide-react';
import { AsyncSection, PageHeader } from '../../components/app/index.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { askQuestion, getInsights } from '../../services/assistantService.js';
import { cn } from '../../utils/cn.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const STARTERS = [
  'How much did I spend on food this month?',
  'Compare this month with last month',
  'Where does my money go?',
  'Any unusual expenses?',
  'Will I stay within budget this month?',
  'How am I doing on my savings goals?',
];
const MAX_LENGTH = 500;

const TONES = {
  positive: { icon: CheckCircle2, classes: 'bg-emerald-50 text-emerald-900 ring-emerald-200' },
  neutral: { icon: Info, classes: 'bg-navy-50 text-navy-900 ring-navy-200' },
  warning: { icon: AlertTriangle, classes: 'bg-amber-50 text-amber-900 ring-amber-200' },
  alert: { icon: AlertTriangle, classes: 'bg-rose-50 text-rose-900 ring-rose-200' },
};

function Message({ entry, onAsk }) {
  if (entry.role === 'user') {
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-navy-900 px-4 py-2.5 text-sm text-white">{entry.text}</p>
      </li>
    );
  }
  if (entry.error) {
    return <li><Alert tone="error">{entry.error}</Alert></li>;
  }
  const { answer, facts, disclaimer, followUps } = entry.reply;
  return (
    <li className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-100 text-navy-700" aria-hidden="true">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 max-w-[90%] space-y-3 rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm text-navy-800 shadow-card ring-1 ring-navy-100">
        <p>{answer}</p>
        {facts?.length > 0 && (
          <dl className="grid gap-x-4 gap-y-1 border-t border-navy-100 pt-3 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="truncate text-xs text-navy-500">{fact.label}</dt>
                <dd className="tabular font-medium text-navy-900">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {disclaimer && <p className="text-xs italic text-navy-500">{disclaimer}</p>}
        {followUps?.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {followUps.map((question) => (
              <button key={question} type="button" onClick={() => onAsk(question)}
                className="rounded-full bg-navy-50 px-3 py-1 text-xs font-medium text-navy-700 ring-1 ring-inset ring-navy-200 hover:bg-navy-100">
                {question}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function Chat() {
  const [conversation, setConversation] = useState([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [conversation]);

  async function ask(text) {
    const trimmed = text.trim();
    if (trimmed.length < 2 || asking) return;
    setAsking(true);
    setQuestion('');
    setConversation((current) => [...current, { role: 'user', text: trimmed }]);
    try {
      const reply = await askQuestion(trimmed);
      setConversation((current) => [...current, { role: 'assistant', reply }]);
    } catch (err) {
      setConversation((current) => [...current, { role: 'assistant', error: err.fieldErrors?.question || err.message }]);
    } finally {
      setAsking(false);
      inputRef.current?.focus();
    }
  }

  return (
    <Card as="section" aria-labelledby="chat-title" className="flex min-h-[32rem] flex-col">
      <CardHeader title={<span id="chat-title">Ask about your money</span>} description="Answers are worked out from your own FinTrack records." />
      <CardBody className="flex flex-1 flex-col gap-4">
        {conversation.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center">
            <p className="mb-3 text-sm text-navy-600">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((starter) => (
                <button key={starter} type="button" onClick={() => ask(starter)}
                  className="rounded-full bg-white px-3.5 py-1.5 text-sm text-navy-800 shadow-sm ring-1 ring-inset ring-navy-200 hover:bg-navy-50">
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol aria-label="Conversation" aria-live="polite" className="flex-1 space-y-4 overflow-y-auto">
            {conversation.map((entry, index) => <Message key={index} entry={entry} onAsk={ask} />)}
            {asking && <li className="text-sm text-navy-500" role="status">Working it out…</li>}
            <li ref={endRef} aria-hidden="true" />
          </ol>
        )}
        <form onSubmit={(event) => { event.preventDefault(); ask(question); }} className="flex items-end gap-2 border-t border-navy-100 pt-4">
          <label htmlFor="assistant-question" className="sr-only">Your question</label>
          <textarea
            id="assistant-question" ref={inputRef} rows={1} maxLength={MAX_LENGTH} value={question} placeholder="Ask a question…"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(question); } }}
            className="block max-h-32 min-h-10 flex-1 resize-y rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-navy-900 shadow-sm ring-1 ring-inset ring-navy-200 placeholder:text-navy-300 focus:ring-2 focus:ring-navy-500 focus:outline-none"
          />
          <Button type="submit" aria-label="Ask" loading={asking} disabled={question.trim().length < 2}>
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Insights({ data }) {
  const { currency, forecast } = data;
  const money = (amount) => formatMoney(amount, currency);
  return (
    <div className="space-y-6">
      <Card as="section" aria-labelledby="findings-title">
        <CardHeader title={<span id="findings-title">What stands out</span>} />
        <CardBody className="space-y-3">
          {data.cards.length === 0 && <p className="text-sm text-navy-500">Nothing unusual right now.</p>}
          {data.cards.map((card) => {
            const { icon: Icon, classes } = TONES[card.tone] ?? TONES.neutral;
            return (
              <div key={card.id} className={cn('flex gap-3 rounded-xl p-3.5 text-sm ring-1 ring-inset', classes)}>
                <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{card.title}</p>
                  <p className="mt-0.5 opacity-90">{card.message}</p>
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card as="section" aria-labelledby="forecast-title">
        <CardHeader
          title={<span id="forecast-title">Month-end estimate</span>}
          description={`${forecast.month} · ${forecast.daysLeft} day${forecast.daysLeft === 1 ? '' : 's'} left`}
          action={<Badge tone={forecast.confidence === 'medium' ? 'info' : 'warning'}>{forecast.confidence} confidence</Badge>}
        />
        <CardBody className="space-y-2 text-sm">
          <p className="tabular text-2xl font-semibold text-navy-900"><TrendingUp className="mr-2 inline h-5 w-5 text-navy-500" aria-hidden="true" />{money(forecast.projected)}</p>
          <p className="tabular text-navy-600">Likely between {money(forecast.low)} and {money(forecast.high)}. Spent so far: {money(forecast.spentSoFar)}.</p>
          {forecast.overallBudget && (
            <p className={forecast.overallBudget.projectedOver ? 'font-medium text-expense' : 'text-income'}>
              {forecast.overallBudget.projectedOver ? 'Above' : 'Within'} your overall budget of {money(forecast.overallBudget.amount)}.
            </p>
          )}
          <p className="text-xs text-navy-500">Based on {forecast.basis}. {forecast.disclaimer}</p>
        </CardBody>
      </Card>

      {data.anomalies.length > 0 && (
        <Card as="section" aria-labelledby="unusual-title">
          <CardHeader title={<span id="unusual-title">Unusual expenses</span>} description="Worth a second look; unusual does not mean wrong." />
          <CardBody className="pt-2">
            <ul className="divide-y divide-navy-100">
              {data.anomalies.map((item) => (
                <li key={item.transactionId} className="py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <Link to={`/transactions/${item.transactionId}/edit`} className="inline-flex min-h-6 items-center font-medium text-navy-900 hover:underline">{item.description || item.category}</Link>
                    <span className="tabular shrink-0 font-semibold text-expense">{money(item.amount)}</span>
                  </div>
                  <p className="text-xs text-navy-500">{item.category} · {formatDate(item.date)} · usually about {money(item.typicalAmount)}</p>
                  <p className="mt-1 text-xs text-navy-600">{item.reason}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {data.budgetSuggestions.length > 0 && (
        <Card as="section" aria-labelledby="suggestions-title">
          <CardHeader
            title={<span id="suggestions-title">Budget suggestions</span>} description="From your last three complete months."
            action={<Link to="/budgets" className="inline-flex min-h-6 items-center text-sm font-medium text-navy-600 hover:underline">Budgets</Link>}
          />
          <CardBody className="space-y-3 pt-2 text-sm">
            {data.budgetSuggestions.slice(0, 5).map((item) => (
              <div key={item.category} className="flex items-start gap-3">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <div>
                  <p className="font-medium text-navy-900">
                    {item.action === 'ADD' ? 'Add' : item.action === 'RAISE' ? 'Review' : 'Tighten'} {item.category}: about {money(item.suggestedAmount)} a month
                  </p>
                  <p className="text-xs text-navy-500">
                    Typically {money(item.typicalMonthly)}{item.currentBudget ? `, budget now ${money(item.currentBudget)}` : ''}. {item.reason}
                  </p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {data.recurring.length > 0 && (
        <Card as="section" aria-labelledby="recurring-title">
          <CardHeader title={<span id="recurring-title">Regular payments</span>} />
          <CardBody className="pt-2">
            <ul className="space-y-2 text-sm">
              {data.recurring.map((item) => (
                <li key={`${item.description}-${item.category}`} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-navy-800"><Repeat className="h-3.5 w-3.5 shrink-0 text-navy-400" aria-hidden="true" /><span className="truncate">{item.description}</span></span>
                  <span className="tabular shrink-0 text-navy-600">{money(item.typicalAmount)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export function AssistantPage() {
  const insights = useAsync(getInsights);
  return (
    <div className="space-y-6">
      <PageHeader title="AI assistant" description="Plain-language answers and insights about your own spending." />
      <Alert tone="info">
        Answers are calculated by FinTrack&apos;s own analysis service from your records only; nothing is sent to an outside AI
        provider and your questions are not stored. This is not financial advice, and estimates are not guarantees.
      </Alert>
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3"><Chat /></div>
        <div className="xl:col-span-2">
          <AsyncSection state={insights} label="Loading insights" lines={6}>
            {insights.data && <Insights data={insights.data} />}
          </AsyncSection>
        </div>
      </div>
    </div>
  );
}
