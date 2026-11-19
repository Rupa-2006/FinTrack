// Fixed policy values shared across the API.
const MINUTE = 60 * 1000;

module.exports = Object.freeze({
  SUPPORTED_CURRENCIES: Object.freeze(['INR', 'USD', 'EUR', 'GBP', 'JPY']),

  // The refresh cookie is only ever sent to /api/auth, never to the rest of the API.
  REFRESH_COOKIE: 'ft_refresh',
  REFRESH_COOKIE_PATH: '/api/auth',

  // Five wrong passwords in a row lock the account for 15 minutes.
  LOCKOUT: Object.freeze({ maxAttempts: 5, minutes: 15 }),

  PASSWORD_RESET_TTL_MINUTES: 30,
  BCRYPT_COST: 12,

  JWT_ISSUER: 'fintrack-api',
  JWT_AUDIENCE: 'fintrack-web',

  // Stricter limits for the endpoints attackers aim at (per client IP).
  AUTH_RATE_LIMITS: Object.freeze({
    login: { windowMs: 15 * MINUTE, limit: 10, message: 'Too many sign-in attempts. Please try again later.' },
    register: { windowMs: 60 * MINUTE, limit: 10, message: 'Too many registrations from this address. Please try again later.' },
    passwordReset: { windowMs: 60 * MINUTE, limit: 5, message: 'Too many password reset requests. Please try again later.' },
    refresh: { windowMs: 15 * MINUTE, limit: 120 },
  }),

  // Each call sends the user's history to the AI service, so it is limited per user.
  ASSISTANT_RATE_LIMIT: Object.freeze({ windowMs: 5 * MINUTE, limit: 30, message: 'You have asked a lot of questions in a short time. Please wait a few minutes.' }),
});
