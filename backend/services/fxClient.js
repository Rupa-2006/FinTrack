// The one place that calls the external exchange-rate API (Frankfurter: free, no key,
// European Central Bank reference rates). Only currency codes and a date are sent: no user data.
const { config } = require('../config/env');
const { SUPPORTED_CURRENCIES } = require('../config/constants');

const TIMEOUT_MS = 6000;

// `date` is "latest" or "YYYY-MM-DD". Resolves with { date, rates: { EUR: "0.0106", ... } }
// meaning 1 unit of `base` = rate units of each listed currency. `date` in the result is the
// business day the rates belong to, which can be earlier than the day asked for.
async function fetchRates(base, date = 'latest') {
  if (config.isTest) throw new Error('the exchange-rate API is not called from tests; mock fxClient.fetchRates');
  const symbols = SUPPORTED_CURRENCIES.filter((code) => code !== base).join(',');
  const response = await fetch(`${config.fxApiUrl}/${date}?base=${base}&symbols=${symbols}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`exchange-rate API answered ${response.status}`);
  const body = await response.json();
  // Never trust an external response: keep only well-formed positive rates for known codes.
  const rates = {};
  for (const [code, value] of Object.entries(body?.rates ?? {})) {
    if (SUPPORTED_CURRENCIES.includes(code) && Number.isFinite(value) && value > 0) rates[code] = String(value);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body?.date ?? '') || !Object.keys(rates).length) {
    throw new Error('exchange-rate API returned an unexpected response');
  }
  return { date: body.date, rates };
}

module.exports = { fetchRates };
