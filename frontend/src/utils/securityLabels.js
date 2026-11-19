// Plain-language names for security event codes and audit actions.
const EVENT_LABELS = {
  REGISTERED: 'Account created',
  LOGIN_SUCCESS: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in attempt',
  NEW_DEVICE_LOGIN: 'Sign-in from a new device',
  ACCOUNT_LOCKED: 'Account locked after failed attempts',
  LOGOUT: 'Signed out',
  REFRESH_TOKEN_REUSE: 'Reused sign-in token blocked',
  PASSWORD_RESET_REQUESTED: 'Password reset requested',
  PASSWORD_RESET_COMPLETED: 'Password reset',
  PASSWORD_CHANGED: 'Password changed',
  PROFILE_UPDATED: 'Profile updated',
  SESSION_REVOKED: 'Session ended',
  ACCOUNT_DEACTIVATED: 'Account deactivated',
  ACCOUNT_SUSPENDED: 'Account suspended by an administrator',
  ACCOUNT_REACTIVATED: 'Account reactivated by an administrator',
  ACCOUNT_UNLOCKED: 'Account unlocked by an administrator',
  ROLE_GRANTED: 'Role granted',
  ROLE_REVOKED: 'Role removed',
  BASE_CURRENCY_CHANGED: 'Main currency changed',
  ACCESS_DENIED: 'Access denied',
  MFA_ENABLED: 'Two-step sign-in turned on',
  MFA_DISABLED: 'Two-step sign-in turned off',
  MFA_FAILED: 'Wrong two-step sign-in code',
  MFA_RECOVERY_CODE_USED: 'Signed in with a recovery code',
  MFA_RECOVERY_CODES_REGENERATED: 'New recovery codes created',
};

const FAILURE_REASONS = {
  wrong_password: 'wrong password',
  unknown_email: 'no account with that email',
  account_locked: 'while the account was locked',
  account_not_active: 'account not active',
};

export function eventLabel(event) {
  const label = EVENT_LABELS[event.eventType] ?? humanize(event.eventType);
  const reason = FAILURE_REASONS[event.metadata?.reason];
  return reason ? `${label} (${reason})` : label;
}

// Audit actions whose code does not read well when humanized ("MFA_ENABLED" -> "Mfa enabled").
const ACTION_LABELS = {
  MFA_ENABLED: 'Two-step sign-in turned on',
  MFA_DISABLED: 'Two-step sign-in turned off',
  MFA_RECOVERY_CODES_REGENERATED: 'New recovery codes created',
  RECURRING_CREATED: 'Recurring transaction created',
  RECURRING_UPDATED: 'Recurring transaction changed',
  RECURRING_DELETED: 'Recurring transaction deleted',
};

export function actionLabel(action) {
  return ACTION_LABELS[action] ?? humanize(action);
}

// "TRANSACTION_CREATED" -> "Transaction created"
export function humanize(code) {
  const text = String(code ?? '').toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const SEVERITY_TONES = { INFO: 'neutral', WARNING: 'warning', CRITICAL: 'expense' };

export function formatDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
