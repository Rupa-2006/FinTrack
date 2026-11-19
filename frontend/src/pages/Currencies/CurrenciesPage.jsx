import { useState } from 'react';
import { ArrowRightLeft, RefreshCw } from 'lucide-react';
import { AsyncSection, PageHeader } from '../../components/app/index.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, Select } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useSubmit } from '../../hooks/useSubmit.js';
import { changeBaseCurrency, convertAmount, getCurrencies, getRates, refreshRates } from '../../services/ledgerService.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const SOURCE_LABELS = { frankfurter: 'European Central Bank (via Frankfurter)', 'seed-fictional': 'Fictional demo rate' };

function Converter({ currencies, baseCurrency }) {
  const [form, setForm] = useState({ amount: '100', from: currencies.find((c) => c.code !== baseCurrency)?.code ?? 'USD', to: baseCurrency });
  const [result, setResult] = useState(null);
  const { submit, submitting, fieldErrors, formError } = useSubmit(convertAmount, { onSuccess: setResult });
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  return (
    <Card as="section" aria-labelledby="converter">
      <CardHeader title={<span id="converter">Converter</span>} description="Uses the newest stored rate." />
      <CardBody>
        <form noValidate className="grid gap-3 sm:grid-cols-4 sm:items-end" onSubmit={(event) => { event.preventDefault(); submit({ ...form, amount: form.amount.trim() }); }}>
          <Input label="Amount" inputMode="decimal" value={form.amount} onChange={set('amount')} error={fieldErrors.amount} />
          <Select label="From" value={form.from} onChange={set('from')}>
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </Select>
          <Select label="To" value={form.to} onChange={set('to')}>
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </Select>
          <Button type="submit" loading={submitting}><ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Convert</Button>
        </form>
        {formError && <Alert tone="error" className="mt-4">{formError}</Alert>}
        {result && (
          <div className="mt-5 rounded-xl bg-navy-50 p-4" aria-live="polite">
            <p className="tabular text-lg font-semibold text-navy-900">
              {formatMoney(result.amount, result.from)} = {formatMoney(result.result, result.to)}
            </p>
            {result.rateDate && (
              <p className="mt-1 text-xs text-navy-500">
                1 {result.from} = {result.rate} {result.to} · rate of {formatDate(result.rateDate)} · {SOURCE_LABELS[result.source] ?? result.source}
              </p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function BaseCurrency({ currencies, baseCurrency, onChanged }) {
  const [choice, setChoice] = useState(baseCurrency);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);
  const { submit, submitting, formError } = useSubmit(changeBaseCurrency, {
    onSuccess: (result) => { setConfirming(false); setDone(result); onChanged(result.baseCurrency); },
  });

  return (
    <Card as="section" aria-labelledby="base-currency">
      <CardHeader title={<span id="base-currency">Main currency</span>} description="Totals, budgets and reports are shown in this currency." />
      <CardBody className="space-y-4">
        {done && done.transactionsConverted + done.budgetsConverted > 0 && (
          <Alert tone="success">
            Main currency changed to {done.baseCurrency}. {done.transactionsConverted} transactions and {done.budgetsConverted} budgets were re-valued; original amounts are unchanged.
          </Alert>
        )}
        {formError && <Alert tone="error">{formError}</Alert>}
        <Select label="Main currency" value={choice} onChange={(e) => { setChoice(e.target.value); setConfirming(false); }}>
          {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
        </Select>
        {choice !== baseCurrency && !confirming && <Button onClick={() => setConfirming(true)}>Change to {choice}</Button>}
        {confirming && (
          <div className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
            <p className="text-sm text-amber-900">
              Every transaction will be re-valued in {choice} at the rate for its own date, and budgets at today&apos;s rate. The amounts you entered stay exactly as they are.
            </p>
            <div className="flex gap-2">
              <Button loading={submitting} onClick={() => submit(choice)}>Confirm change</Button>
              <Button variant="secondary" onClick={() => { setConfirming(false); setChoice(baseCurrency); }}>Cancel</Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function CurrenciesPage() {
  const { user, updateUser } = useAuth();
  const baseCurrency = user?.baseCurrency ?? 'INR';
  const currencies = useAsync(getCurrencies);
  const rates = useAsync(() => getRates(baseCurrency), { watch: baseCurrency });
  const [refreshState, setRefreshState] = useState(null);

  async function refresh() {
    setRefreshState({ loading: true });
    try {
      await refreshRates();
      await rates.reload();
      setRefreshState({ tone: 'success', text: 'Exchange rates updated.' });
    } catch (err) {
      setRefreshState({ tone: 'error', text: err.message });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Currencies" description="INR, USD, EUR, GBP and JPY. Every amount keeps the currency it was entered in." />
      {refreshState?.text && <Alert tone={refreshState.tone}>{refreshState.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section" aria-labelledby="rates">
          <CardHeader
            title={<span id="rates">Exchange rates</span>}
            description={`Value of 1 ${baseCurrency}`}
            action={<Button variant="secondary" size="sm" loading={refreshState?.loading} onClick={refresh}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh</Button>}
          />
          <CardBody>
            <AsyncSection state={rates} label="Loading rates" lines={4}>
              {rates.data && (rates.data.rates.length === 0 ? (
                <p className="text-sm text-navy-500">No rates stored yet. Use Refresh to fetch today&apos;s rates.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-navy-500">
                    <tr><th scope="col" className="pb-2 font-medium">Currency</th><th scope="col" className="pb-2 text-right font-medium">Rate</th><th scope="col" className="pb-2 text-right font-medium">Date</th></tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {rates.data.rates.map((rate) => (
                      <tr key={rate.currency}>
                        <td className="py-2.5 font-medium text-navy-900">
                          {rate.currency} {rate.source === 'seed-fictional' && <Badge tone="warning" className="ml-1">Demo</Badge>}
                        </td>
                        <td className="tabular py-2.5 text-right text-navy-800">{rate.rate}</td>
                        <td className="py-2.5 text-right text-navy-500">{formatDate(rate.rateDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </AsyncSection>
            <p className="mt-4 text-xs text-navy-500">Rates come from the European Central Bank reference rates. They are for record keeping, not for trading.</p>
          </CardBody>
        </Card>
        <div className="space-y-6">
          <AsyncSection state={currencies} label="Loading currencies" lines={3}>
            {currencies.data && (
              <>
                <Converter currencies={currencies.data.currencies} baseCurrency={baseCurrency} />
                <BaseCurrency currencies={currencies.data.currencies} baseCurrency={baseCurrency} onChanged={(code) => updateUser({ baseCurrency: code })} />
              </>
            )}
          </AsyncSection>
        </div>
      </div>
    </div>
  );
}
