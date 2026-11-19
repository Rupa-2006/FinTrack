import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthCard } from '../../components/auth/AuthCard.jsx';
import { PasswordChecklist, PasswordField } from '../../components/auth/PasswordField.jsx';
import { Alert, Button, Input, Select } from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { newPasswordError } from '../../utils/passwordRules.js';

const LINK = 'font-medium text-navy-700 underline-offset-2 hover:text-navy-900 hover:underline';

const CURRENCIES = [
  { code: 'INR', name: 'Indian rupee' },
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
  { code: 'JPY', name: 'Japanese yen' },
];

const EMPTY = { fullName: '', email: '', password: '', confirmPassword: '', baseCurrency: 'INR' };

export function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  function localErrors() {
    const errors = {};
    if (form.fullName.trim().length < 2) errors.fullName = 'Enter your full name';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = 'Enter a valid email address';
    const passwordError = newPasswordError(form.password);
    if (passwordError) errors.password = passwordError;
    if (form.confirmPassword !== form.password) errors.confirmPassword = 'The two passwords do not match';
    return errors;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setFormError(null);
    const errors = localErrors();
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      await register({ fullName: form.fullName.trim(), email: form.email.trim(), password: form.password, baseCurrency: form.baseCurrency });
    } catch (err) {
      const serverErrors = err.fieldErrors ?? {};
      setFieldErrors(serverErrors);
      if (!Object.keys(serverErrors).length) setFormError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Free to use. FinTrack works with the figures you enter; it never connects to a bank."
      footer={<>Already have an account? <Link to="/login" className={LINK}>Sign in</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <Input label="Full name" name="fullName" autoComplete="name" required autoFocus value={form.fullName} onChange={set('fullName')} error={fieldErrors.fullName} />
        <Input label="Email address" type="email" name="email" autoComplete="email" required value={form.email} onChange={set('email')} error={fieldErrors.email} />
        <div>
          <PasswordField name="password" autoComplete="new-password" required value={form.password} onChange={set('password')} error={fieldErrors.password} />
          <PasswordChecklist value={form.password} />
        </div>
        <PasswordField
          label="Confirm password" name="confirmPassword" autoComplete="new-password" required
          value={form.confirmPassword} onChange={set('confirmPassword')} error={fieldErrors.confirmPassword}
        />
        <Select label="Main currency" name="baseCurrency" value={form.baseCurrency} onChange={set('baseCurrency')} error={fieldErrors.baseCurrency}>
          {CURRENCIES.map((currency) => (
            <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>
          ))}
        </Select>
        <p className="text-xs text-navy-500">Totals and reports are shown in your main currency. You can still record transactions in any supported currency.</p>
        <Button type="submit" size="lg" className="w-full" loading={submitting}>Create account</Button>
      </form>
    </AuthCard>
  );
}
