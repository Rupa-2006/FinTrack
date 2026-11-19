import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AuthCard } from '../../components/auth/AuthCard.jsx';
import { PasswordField } from '../../components/auth/PasswordField.jsx';
import { Alert, Button, Input } from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';

const LINK = 'font-medium text-navy-700 underline-offset-2 hover:text-navy-900 hover:underline';

// Second step, shown when the account has two-step sign-in on.
function CodeStep({ challengeToken, onRestart }) {
  const { verifyMfa } = useAuth();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyMfa(challengeToken, code.trim()); // the route guard moves on from here
    } catch (err) {
      setSubmitting(false);
      // The challenge has ended (expired, used up, or the account locked): start again.
      if (err.status === 423 || /expired/i.test(err.message)) return onRestart(err.message);
      setError(err.message);
      setCode('');
    }
  }

  return (
    <AuthCard
      title="Two-step sign-in"
      subtitle={useRecovery
        ? 'Enter one of the recovery codes you saved when you turned on two-step sign-in. Each code works once.'
        : 'Open your authenticator app and enter the 6-digit code for FinTrack.'}
      footer={<button type="button" className={LINK} onClick={() => onRestart(null)}>Sign in with a different account</button>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {useRecovery ? (
          <Input
            key="recovery" label="Recovery code" name="recovery-code" autoComplete="off" autoFocus required
            placeholder="xxxx-xxxx" value={code} onChange={(event) => setCode(event.target.value)}
          />
        ) : (
          <Input
            key="totp" label="Authentication code" name="one-time-code" autoComplete="one-time-code" inputMode="numeric" autoFocus required
            maxLength={7} placeholder="123456" value={code} onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, ''))}
          />
        )}
        <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={code.trim().length < 6}>Verify</Button>
        <div className="text-center">
          <button type="button" className={`text-sm ${LINK}`} onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(null); }}>
            {useRecovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}
          </button>
        </div>
      </form>
    </AuthCard>
  );
}

export function LoginPage() {
  const { login, notice: sessionNotice } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState(null);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // On success the route guard sends the user on to where they were going.
      const result = await login({ email, password });
      if (result?.mfaRequired) {
        setChallenge(result.challengeToken);
        setPassword('');
        setSubmitting(false);
      }
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  if (challenge) {
    return (
      <CodeStep
        challengeToken={challenge}
        onRestart={(message) => {
          setChallenge(null);
          setError(message ? { message } : null);
        }}
      />
    );
  }

  const notice = location.state?.notice || sessionNotice; // e.g. "password changed", "account deactivated"
  const fieldErrors = error?.fieldErrors ?? {};
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back. Enter your details to open your dashboard."
      footer={<>New to FinTrack? <Link to="/register" className={LINK}>Create an account</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {notice && !error && <Alert tone="success">{notice}</Alert>}
        {error && !hasFieldErrors && <Alert tone="error">{error.message}</Alert>}
        <Input
          label="Email address" type="email" name="email" autoComplete="email" required autoFocus
          value={email} onChange={(event) => setEmail(event.target.value)} error={fieldErrors.email}
        />
        <PasswordField
          name="password" autoComplete="current-password" required
          value={password} onChange={(event) => setPassword(event.target.value)} error={fieldErrors.password}
        />
        <div className="flex justify-end">
          <Link to="/forgot-password" className={`text-sm ${LINK}`}>Forgot your password?</Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={submitting}>Sign in</Button>
      </form>
    </AuthCard>
  );
}
