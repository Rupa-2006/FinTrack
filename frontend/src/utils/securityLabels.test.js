import { actionLabel, eventLabel } from './securityLabels.js';

test('audit actions read as plain words, including two-step sign-in and recurring rules', () => {
  expect(actionLabel('MFA_DISABLED')).toBe('Two-step sign-in turned off');
  expect(actionLabel('RECURRING_CREATED')).toBe('Recurring transaction created');
  expect(actionLabel('TRANSACTIONS_IMPORTED')).toBe('Transactions imported');
  expect(actionLabel('TRANSACTION_CREATED')).toBe('Transaction created');
});

test('security events have their own labels and failure reasons', () => {
  expect(eventLabel({ eventType: 'MFA_FAILED' })).toBe('Wrong two-step sign-in code');
  expect(eventLabel({ eventType: 'LOGIN_FAILED', metadata: { reason: 'wrong_password' } })).toBe('Failed sign-in attempt (wrong password)');
});
