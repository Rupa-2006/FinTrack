import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthCard } from '../../components/auth/AuthCard.jsx';
import { Alert, Button, Input } from '../../components/ui/index.js';
import { forgotPassword } from '../../services/authService.js';

const LINK = 'font-medium text-navy-700 underline-offset-2 hover:text-navy-900 hover:underline';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [sentMessage, setSentMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await forgotPassword(email.trim());
      setSentMessage(result.message);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldErrors = error?.fieldErrors ?? {};

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter the email address of your account and we will send you a link to choose a new password."
      footer={<Link to="/login" className={LINK}>Back to sign in</Link>}
    >
      {sentMessage ? (
        <Alert tone="success" title="Check your inbox">
          {sentMessage} The link works once and expires after 30 minutes.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && !fieldErrors.email && <Alert tone="error">{error.message}</Alert>}
          <Input
            label="Email address" type="email" name="email" autoComplete="email" required autoFocus
            value={email} onChange={(event) => setEmail(event.target.value)} error={fieldErrors.email}
          />
          <Button type="submit" size="lg" className="w-full" loading={submitting}>Send reset link</Button>
        </form>
      )}
    </AuthCard>
  );
}
