import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, Smartphone } from 'lucide-react';
import { AsyncSection } from '../../components/app/index.jsx';
import { PasswordField } from '../../components/auth/PasswordField.jsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input } from '../../components/ui/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { disableMfa, enableMfa, getMfaStatus, regenerateRecoveryCodes, startMfaSetup } from '../../services/securityService.js';
import { saveBlob } from '../../utils/download.js';
import { formatDate } from '../../utils/format.js';

const groups = (secret) => secret.match(/.{1,4}/g).join(' ');

// Recovery codes are shown once. The user copies or downloads them before moving on.
function RecoveryCodes({ codes, onDone }) {
  const [copied, setCopied] = useState(false);
  const text = `FinTrack recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="space-y-4">
      <Alert tone="warning">
        Save these recovery codes now. They are shown only once, and each lets you sign in a single time if you lose your phone.
      </Alert>
      <ol aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-xl bg-navy-50 p-4 font-mono text-sm text-navy-900 sm:grid-cols-5">
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}</Button>
        <Button variant="secondary" size="sm" onClick={() => saveBlob(new Blob([text], { type: 'text/plain' }), 'fintrack-recovery-codes.txt')}>
          <Download className="h-4 w-4" aria-hidden="true" /> Download
        </Button>
        <Button size="sm" onClick={onDone}>I have saved them</Button>
      </div>
    </div>
  );
}

function Setup({ onEnabled, onCancel }) {
  const [details, setDetails] = useState(null);
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    startMfaSetup()
      .then(async (setup) => {
        if (!active) return;
        setDetails(setup);
        const image = await QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 192, color: { dark: '#14213d', light: '#ffffff' } });
        if (active) setQr(image);
      })
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await enableMfa(code.replace(/\s/g, ''));
      onEnabled(result.recoveryCodes);
    } catch (err) {
      setError(err.fieldErrors?.code || err.message);
      setBusy(false);
    }
  }

  if (!details) return error ? <Alert tone="error">{error}</Alert> : <p className="text-sm text-navy-500" role="status">Preparing…</p>;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-navy-700">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Aegis…).</li>
        <li>Scan the QR code, or enter the key by hand.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-5">
        {qr ? <img src={qr} alt="QR code for your authenticator app" width={192} height={192} className="rounded-lg ring-1 ring-navy-100" /> : <div className="h-48 w-48 rounded-lg bg-navy-50" />}
        <div className="min-w-0 text-sm">
          <p className="font-medium text-navy-800">Key</p>
          <p className="mt-1 break-all font-mono text-navy-900" aria-label="Setup key">{groups(details.secret)}</p>
          <p className="mt-2 text-xs text-navy-500">Time-based, 6 digits, every 30 seconds.</p>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <Input
          label="Code from the app" name="one-time-code" autoComplete="one-time-code" inputMode="numeric" maxLength={7}
          value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} className="w-40"
        />
        <Button type="submit" loading={busy} disabled={code.replace(/\s/g, '').length !== 6}>Turn on</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function PasswordAction({ needsCode, submitLabel, danger, onSubmit, onCancel }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      noValidate className="mt-4 space-y-3 rounded-xl bg-navy-50 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSubmit({ password, code: code.trim() });
        } catch (err) {
          setError(err.fieldErrors?.password || err.fieldErrors?.code || err.message);
          setBusy(false);
        }
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <PasswordField label="Current password" name="current-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {needsCode && (
        <Input label="Authentication or recovery code" name="one-time-code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      )}
      <div className="flex gap-2">
        <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!password || (needsCode && code.trim().length < 6)}>{submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function TwoStepCard() {
  const state = useAsync(getMfaStatus);
  const [mode, setMode] = useState(null); // 'setup' | 'disable' | 'regenerate'
  const [codes, setCodes] = useState(null);
  const [notice, setNotice] = useState(null);
  const status = state.data;

  const finish = async (message) => {
    setMode(null);
    setNotice(message);
    await state.reload();
  };

  return (
    <Card as="section" aria-labelledby="two-step-title">
      <CardHeader
        title={<span id="two-step-title" className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-navy-500" aria-hidden="true" /> Two-step sign-in</span>}
        description="Ask for a code from your phone as well as your password, so a stolen password alone cannot open your account."
        action={status && <Badge tone={status.enabled ? 'income' : 'neutral'}>{status.enabled ? 'On' : 'Off'}</Badge>}
      />
      <CardBody className="pt-2">
        {notice && !codes && <Alert tone="success" className="mb-4">{notice}</Alert>}
        <AsyncSection state={state} label="Loading two-step sign-in" lines={2}>
          {status && (codes ? (
            <RecoveryCodes codes={codes} onDone={() => { setCodes(null); finish(notice); }} />
          ) : mode === 'setup' ? (
            <Setup onCancel={() => setMode(null)} onEnabled={(newCodes) => { setNotice('Two-step sign-in is on.'); setCodes(newCodes); }} />
          ) : status.enabled ? (
            <>
              <p className="text-sm text-navy-700">
                On since {formatDate(status.enabledAt)}. {status.recoveryCodesLeft} of 10 recovery codes left
                {status.recoveryCodesLeft <= 3 && ': create new ones soon.'}
                {status.recoveryCodesLeft > 3 && '.'}
              </p>
              {mode === null && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => { setNotice(null); setMode('regenerate'); }}>New recovery codes</Button>
                  <Button variant="ghost" size="sm" onClick={() => { setNotice(null); setMode('disable'); }}>Turn off</Button>
                </div>
              )}
              {mode === 'regenerate' && (
                <PasswordAction
                  submitLabel="Create new codes" onCancel={() => setMode(null)}
                  onSubmit={async ({ password }) => {
                    const result = await regenerateRecoveryCodes(password);
                    setMode(null);
                    setNotice('New recovery codes created. The old ones no longer work.');
                    setCodes(result.recoveryCodes);
                  }}
                />
              )}
              {mode === 'disable' && (
                <PasswordAction
                  needsCode danger submitLabel="Turn off two-step sign-in" onCancel={() => setMode(null)}
                  onSubmit={async (body) => { await disableMfa(body); await finish('Two-step sign-in is off.'); }}
                />
              )}
            </>
          ) : (
            <Button onClick={() => { setNotice(null); setMode('setup'); }}>Set up two-step sign-in</Button>
          ))}
        </AsyncSection>
      </CardBody>
    </Card>
  );
}
