import { useState } from 'react';
import { PasswordChecklist, PasswordField } from '../../components/auth/PasswordField.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, Skeleton } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { changePassword, deactivateAccount, getProfile, updateProfile } from '../../services/userService.js';
import { formatDate } from '../../utils/format.js';
import { newPasswordError } from '../../utils/passwordRules.js';

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-navy-500">{label}</dt>
      <dd className="mt-1 text-sm text-navy-900">{children}</dd>
    </div>
  );
}

function ProfileForm({ profile, onSaved }) {
  const [fullName, setFullName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState(null); // { tone, text }
  const [saving, setSaving] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const updated = await updateProfile({ fullName: fullName.trim(), phone: phone.trim() });
      setFullName(updated.fullName);
      setPhone(updated.phone ?? '');
      onSaved(updated);
      setMessage({ tone: 'success', text: 'Your profile has been saved.' });
    } catch (err) {
      const serverErrors = err.fieldErrors ?? {};
      setFieldErrors(serverErrors);
      if (!Object.keys(serverErrors).length) setMessage({ tone: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="profile-details">
      <CardHeader title={<span id="profile-details">Personal details</span>} description="Your phone number is stored encrypted." />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" name="fullName" autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} error={fieldErrors.fullName} />
            <Input
              label="Phone number" name="phone" type="tel" autoComplete="tel" hint="Optional. Leave empty to remove it."
              value={phone} onChange={(event) => setPhone(event.target.value)} error={fieldErrors.phone}
            />
          </div>
          <dl className="grid gap-4 border-t border-navy-100 pt-4 sm:grid-cols-3">
            <Detail label="Email address">{profile.email}</Detail>
            <Detail label="Main currency">{profile.baseCurrency}</Detail>
            <Detail label="Member since">{formatDate(profile.createdAt)}</Detail>
          </dl>
          <p className="text-xs text-navy-500">
            Your email address cannot be changed here. The main currency is managed on the Currencies page, because changing it affects how past totals are converted.
          </p>
          <Button type="submit" loading={saving}>Save changes</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setMessage(null);
    const errors = {};
    if (!currentPassword) errors.currentPassword = 'Enter your current password';
    const passwordError = newPasswordError(newPassword);
    if (passwordError) errors.newPassword = passwordError;
    if (confirmPassword !== newPassword) errors.confirmPassword = 'The two passwords do not match';
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSaving(true);
    try {
      const { otherSessionsRevoked } = await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      const others = otherSessionsRevoked === 1 ? '1 other device was signed out.' : `${otherSessionsRevoked} other devices were signed out.`;
      setMessage({ tone: 'success', text: `Your password has been changed. ${otherSessionsRevoked ? others : ''}`.trim() });
    } catch (err) {
      const serverErrors = err.fieldErrors ?? {};
      setFieldErrors(serverErrors);
      if (!Object.keys(serverErrors).length) setMessage({ tone: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="profile-password">
      <CardHeader title={<span id="profile-password">Password</span>} description="Changing your password signs you out on your other devices." />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <PasswordField
            label="Current password" name="currentPassword" autoComplete="current-password" required
            value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} error={fieldErrors.currentPassword}
          />
          <div>
            <PasswordField
              label="New password" name="newPassword" autoComplete="new-password" required
              value={newPassword} onChange={(event) => setNewPassword(event.target.value)} error={fieldErrors.newPassword}
            />
            <PasswordChecklist value={newPassword} />
          </div>
          <PasswordField
            label="Confirm new password" name="confirmPassword" autoComplete="new-password" required
            value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} error={fieldErrors.confirmPassword}
          />
          <Button type="submit" loading={saving}>Change password</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function DeactivateAccount() {
  const { clearSession } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setWorking(true);
    try {
      await deactivateAccount(password);
      clearSession({ endedByUser: true, notice: 'Your account has been deactivated and you have been signed out.' });
    } catch (err) {
      setError(err.fieldErrors?.password || err.message);
      setWorking(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="profile-deactivate" className="ring-rose-200">
      <CardHeader
        title={<span id="profile-deactivate">Deactivate account</span>}
        description="You will be signed out everywhere and will not be able to sign in again. Your records are kept, not deleted."
      />
      <CardBody>
        {!open ? (
          <Button variant="danger" onClick={() => setOpen(true)}>Deactivate my account</Button>
        ) : (
          <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
            <Alert tone="warning">This cannot be undone from the app. Enter your password to confirm.</Alert>
            <PasswordField
              label="Your password" name="deactivatePassword" autoComplete="current-password" required autoFocus
              value={password} onChange={(event) => setPassword(event.target.value)} error={error}
            />
            <div className="flex gap-3">
              <Button type="submit" variant="danger" loading={working}>Confirm deactivation</Button>
              <Button variant="secondary" onClick={() => { setOpen(false); setPassword(''); setError(null); }}>Cancel</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

export function ProfilePage() {
  useDocumentTitle('Profile');
  const { isAdmin, updateUser } = useAuth();
  const { data: profile, error, loading, reload } = useAsync(getProfile);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Profile</h1>
        {profile?.roles.map((role) => (
          <Badge key={role} tone={role === 'ADMIN' ? 'info' : 'neutral'}>{role === 'ADMIN' ? 'Administrator' : 'User'}</Badge>
        ))}
      </div>

      {loading && (
        <Card role="status" className="space-y-4 p-6" aria-busy="true" aria-label="Loading your profile">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </Card>
      )}
      {error && (
        <Alert tone="error" title="Your profile could not be loaded">
          {error.message} <button type="button" className="font-semibold underline" onClick={reload}>Try again</button>
        </Alert>
      )}
      {profile && (
        <>
          <ProfileForm profile={profile} onSaved={(updated) => updateUser({ fullName: updated.fullName })} />
          <PasswordForm />
          {!isAdmin && <DeactivateAccount />}
        </>
      )}
    </div>
  );
}
