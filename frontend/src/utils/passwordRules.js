// The password rules shown while typing. They mirror backend/security/passwords.js; the
// server remains the authority and also checks things the browser cannot (common passwords).
export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 10 characters', test: (value) => value.length >= 10 },
  { id: 'lower', label: 'A lowercase letter', test: (value) => /[a-z]/.test(value) },
  { id: 'upper', label: 'An uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { id: 'number', label: 'A number', test: (value) => /[0-9]/.test(value) },
  { id: 'symbol', label: 'A symbol', test: (value) => /[^A-Za-z0-9]/.test(value) },
];

export function passwordMeetsRules(value) {
  return PASSWORD_RULES.every((rule) => rule.test(value));
}

// Returns an error message for a new password and its confirmation, or null.
export function newPasswordError(password) {
  return passwordMeetsRules(password) ? null : 'Your password does not meet all the rules below';
}
