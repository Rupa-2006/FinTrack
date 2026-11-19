// Exchange rates. Every conversion uses a stored snapshot, so a converted amount can always
// be traced to the exact rate, date and source that produced it.
const { SUPPORTED_CURRENCIES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { logger } = require('../utils/logger');
const { Decimal, convert } = require('../utils/money');
const { daysBetween, today } = require('../utils/period');
const rateModel = require('../models/exchangeRate.model');
const fxClient = require('./fxClient');

const SOURCE = 'frankfurter';
const MAX_SNAPSHOT_AGE_DAYS = 7;
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
let skipLiveUntil = 0; // after a failed call, do not keep a user waiting on every request

// Fetches rates for `base` and stores them, together with the inverse pairs.
async function fetchAndStore(base, date = 'latest') {
  const fetched = await fxClient.fetchRates(base, date);
  for (const [quote, rate] of Object.entries(fetched.rates)) {
    await rateModel.insertSnapshot({ from: base, to: quote, rate: new Decimal(rate).toFixed(8), rateDate: fetched.date, source: SOURCE });
    await rateModel.insertSnapshot({ from: quote, to: base, rate: new Decimal(1).div(rate).toFixed(8), rateDate: fetched.date, source: SOURCE });
  }
  return fetched.date;
}

// The rate for converting `from` into `to` on `date`.
//   1. a stored snapshot from the week up to that date
//   2. otherwise ask the rates API for that date and store the answer (unless live = false)
//   3. otherwise the nearest stored snapshot, however old
// Returns { rate, id, rateDate, source }; id is null when no conversion is needed.
async function getRate(from, to, date = today(), { live = true } = {}) {
  if (from === to) return { rate: '1.00000000', id: null, rateDate: null, source: null };

  let snapshot = await rateModel.findOnOrBefore(from, to, date);
  const stale = !snapshot || daysBetween(snapshot.rate_date, date) > MAX_SNAPSHOT_AGE_DAYS;
  if (stale && live && Date.now() >= skipLiveUntil) {
    try {
      await fetchAndStore(from, date);
      snapshot = (await rateModel.findOnOrBefore(from, to, date)) || snapshot;
    } catch (err) {
      skipLiveUntil = Date.now() + RETRY_AFTER_FAILURE_MS;
      logger.warn({ err: { message: err.message }, from, to }, 'live exchange rate unavailable; using the nearest stored snapshot');
    }
  }
  snapshot = snapshot || (await rateModel.findEarliest(from, to));
  if (!snapshot) throw ApiError.serviceUnavailable(`No exchange rate is available for ${from} to ${to} right now. Please try again later.`);
  return { rate: snapshot.rate, id: snapshot.id, rateDate: snapshot.rate_date, source: snapshot.source };
}

async function listCurrencies() {
  const rows = await rateModel.listCurrencies();
  return rows.map((row) => ({ code: row.code, name: row.name, symbol: row.symbol, decimalPlaces: row.decimal_places }));
}

async function latestRates(base) {
  const rows = await rateModel.latestForBase(base);
  return {
    base,
    rates: rows.map((row) => ({ currency: row.quote_currency, rate: row.rate, rateDate: row.rate_date, source: row.source })),
  };
}

// Pulls today's rates for every supported currency.
async function refresh(base) {
  try {
    await fetchAndStore(base);
    for (const other of SUPPORTED_CURRENCIES.filter((code) => code !== base)) await fetchAndStore(other);
    skipLiveUntil = 0;
  } catch (err) {
    logger.warn({ err: { message: err.message } }, 'exchange-rate refresh failed');
    throw ApiError.serviceUnavailable('The exchange-rate service cannot be reached right now. The stored rates are unchanged.');
  }
  return latestRates(base);
}

async function convertAmount({ amount, from, to }) {
  const rate = await getRate(from, to);
  return { amount, from, to, rate: rate.rate, rateDate: rate.rateDate, source: rate.source, result: convert(amount, rate.rate, to) };
}

module.exports = { getRate, listCurrencies, latestRates, refresh, convertAmount };
