// Money arithmetic. Amounts are decimal strings end to end; decimal.js does the maths, so
// no amount ever passes through a JavaScript float.
const Decimal = require('decimal.js');
const ApiError = require('./ApiError');

const CURRENCY_DECIMALS = Object.freeze({ INR: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0 });

const decimalsOf = (currency) => CURRENCY_DECIMALS[currency] ?? 2;

// Rounds to the currency's minor unit (half up) and returns the DECIMAL(18,2) string.
function roundMoney(value, currency) {
  return new Decimal(value).toDecimalPlaces(decimalsOf(currency), Decimal.ROUND_HALF_UP).toFixed(2);
}

// original amount x rate -> amount in the base currency
function convert(amount, rate, toCurrency) {
  return roundMoney(new Decimal(amount).mul(rate), toCurrency);
}

// Yen has no minor unit: 100.50 JPY is not a valid amount.
function assertCurrencyPrecision(amount, currency, field) {
  if (!new Decimal(amount).toDecimalPlaces(decimalsOf(currency)).eq(amount)) {
    throw ApiError.validation([{ field, message: `${currency} amounts cannot have decimal places` }]);
  }
}

const sum = (values) => values.reduce((total, value) => total.plus(value), new Decimal(0));

// part / whole as a percentage with one decimal place (0 when whole is 0).
function percent(part, whole) {
  const divisor = new Decimal(whole);
  if (divisor.isZero()) return 0;
  return new Decimal(part).div(divisor).mul(100).toDecimalPlaces(1).toNumber();
}

module.exports = { Decimal, CURRENCY_DECIMALS, decimalsOf, roundMoney, convert, assertCurrencyPrecision, sum, percent };
