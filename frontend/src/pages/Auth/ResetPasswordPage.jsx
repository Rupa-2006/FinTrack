import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthCard } from '../../components/auth/AuthCard.jsx';
import { PasswordChecklist, PasswordField } from '../../components/auth/PasswordField.jsx';
import { Alert, Button } from '../../components/ui/index.js';
import { resetPassword } from '../../services/authService.js';
import { newPasswordError } from '../../utils/passwordRules.js';

const LINK = 'font-medium text-navy-700 underline-offset-2 hover:text-navy-900 hover:underline';

// Opened from the emailed link: /reset-password#token=...
// The token is in the URL fragment, which is never sent to a server. It is read once into
// memory and then removed from the address bar and the browser history.
export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.hash.replace(/^#/, '')).get('token'));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (location.hash) navigate(location.pathname, { replace: true });
  }, [location.hash, location.pathname, navigate]);

  async function onSubmit(event) {
    event.preventDefault();
    setFormError(null);
    const errors = {};
    const passwordError = newPasswordError(password);
    if (passwordError) errors.password = passwordError;
    if (confirmPassword !== password) errors.confirmPassword = 'The two passwords do not match';
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      const result = await resetPassword(token, password);
      navigate('/login', { replace: true, state: { notice: result.message } });
    } catch (err) {
      const serverErrors = err.fieldErrors ?? {};
      setFieldErrors(serverErrors);
      if (!serverErrors.password) setFormError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Choose a new password" footer={<Link to="/login" className={LINK}>Back to sign in</Link>}>
      {!token ? (
        <Alert tone="error" title="This link is not valid">
          Open the link from your email again, or <Link to="/forgot-password" className="font-semibold underline">request a new one</Link>.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && (
            <Alert tone="error">
              {formError} <Link to="/forgot-password" className="font-semibold underline">Request a new link</Link>
            </Alert>
          )}
          <div>
            <PasswordField
              label="New password" name="password" autoComplete="new-password" required autoFocus
              value={password} onChange={(event) => setPassword(event.target.value)} error={fieldErrors.password}
            />
            <PasswordChecklist value={password} />
          </div>
          <PasswordField
            label="Confirm new password" name="confirmPassword" autoComplete="new-password" required
            value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} error={fieldErrors.confirmPassword}
          />
          <p className="text-xs text-navy-500">Changing your password signs you out on every device.</p>
          <Button type="submit" size="lg" className="w-full" loading={submitting}>Change password</Button>
        </form>
      )}
    </AuthCard>
  );
}
