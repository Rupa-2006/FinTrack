// Reusable field schemas. Strings are trimmed and length-limited before anything else
// looks at them.
const { z } = require('zod');
const { SUPPORTED_CURRENCIES } = require('../config/constants');
const { basicPasswordProblems } = require('../security/passwords');
const { isRealDate, addDays, today } = require('../utils/period');

const email = z
  .string({ error: 'Enter your email address' })
  .trim()
  .toLowerCase()
  .max(254, 'Email address is too long')
  .pipe(z.email('Enter a valid email address'));

// Letters (any script), spaces and the punctuation real names use. No markup characters.
const fullName = z
  .string({ error: 'Enter your full name' })
  .trim()
  .min(2, 'Enter your full name')
  .max(100, 'Name must be at most 100 characters')
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u, 'Name may only contain letters, spaces, apostrophes, hyphens and full stops');

// A new password: every unmet rule is reported as its own issue.
const newPassword = z.string({ error: 'Enter a password' }).superRefine((value, ctx) => {
  for (const message of basicPasswordProblems(value)) ctx.addIssue({ code: 'custom', message });
});

// A password being checked, not chosen: only bounded, so old passwords keep working.
const existingPassword = z.string({ error: 'Enter your password' }).min(1, 'Enter your password').max(200, 'Password is too long');

// Empty input means "remove my phone number".
const phone = z
  .union([z.literal(''), z.null(), z.string().trim().regex(/^\+?[0-9][0-9 ()-]{6,19}$/, 'Enter a valid phone number, for example +91 98765 43210')])
  .optional()
  .transform((value) => value || null);

const currencyCode = z.enum(SUPPORTED_CURRENCIES, { error: `Currency must be one of ${SUPPORTED_CURRENCIES.join(', ')}` });

const id = z.coerce.number({ error: 'Invalid id' }).int('Invalid id').positive('Invalid id').max(Number.MAX_SAFE_INTEGER, 'Invalid id');

const opaqueToken = z.string({ error: 'Token is required' }).regex(/^[A-Za-z0-9_-]{20,200}$/, 'Token is not valid');

// Money: a positive decimal with at most 2 decimal places. Accepted as a string (preferred)
// or a JSON number, and handed on as a string so it is never a float downstream.
const decimalText = z.union([z.string(), z.number()], { error: 'Enter an amount' }).transform((value) => String(value).trim());
const money = decimalText.pipe(
  z
    .string()
    .regex(/^\d{1,13}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimal places')
    .refine((value) => Number(value) > 0, 'Amount must be greater than 0')
);
// Positive or negative, never zero (goal contributions and withdrawals).
const signedMoney = decimalText.pipe(
  z
    .string()
    .regex(/^-?\d{1,13}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimal places')
    .refine((value) => Number(value) !== 0, 'Amount cannot be zero')
);

const isoDate = z
  .string({ error: 'Enter a date' })
  .refine((value) => isRealDate(value), 'Enter a valid date (YYYY-MM-DD)')
  .refine((value) => value >= '2000-01-01', 'Date is too far in the past');

// Entries may be dated up to one day ahead, which covers every time zone.
const pastOrPresentDate = isoDate.refine((value) => value <= addDays(today(), 1), 'Date cannot be in the future');

const month = z.string({ error: 'Enter a month' }).regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must look like 2026-11');

// Free text shown back to users: trimmed, bounded, no control characters.
const text = (max, message = 'This field is required') =>
  z
    .string({ error: message })
    .trim()
    .min(1, message)
    .max(max, `Use at most ${max} characters`)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/, 'Contains characters that are not allowed');

const optionalText = (max) =>
  z
    .union([z.null(), z.string().trim().max(max, `Use at most ${max} characters`)])
    .optional()
    .transform((value) => value || null);

module.exports = {
  email, fullName, newPassword, existingPassword, phone, currencyCode, id, opaqueToken,
  money, signedMoney, isoDate, pastOrPresentDate, month, text, optionalText,
};
