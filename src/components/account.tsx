import { useState } from 'preact/hooks';
import { useT } from '../i18n/t';
import { sound } from '../lib/sound';
import { sendCode, verifyCode } from '../storage/supabase';
import { Button, Illustration, TextField } from './ui';

/**
 * Email → 6-digit code. The same form creates an account or signs in to an existing one.
 * The code works inside an installed iPhone app; the magic link in the same email works in a browser tab.
 */
export function SignInForm({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const t = useT();
  const [addr, setAddr] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(t('account.error', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  const send = () => attempt(async () => { await sendCode(addr.trim()); setSentTo(addr.trim()); setCode(''); });
  const verify = () => attempt(async () => { await verifyCode(sentTo, code.trim()); sound('saved'); await onSignedIn(); });

  return sentTo ? (
    <div class="stack">
      <p class="sf-meta">{t('account.codeSent', { email: sentTo })}</p>
      <TextField id="otp" ui label={t('account.code')} placeholder="123456" value={code} onInput={(v) => setCode(v.replace(/\D/g, '').slice(0, 10))} />
      <p class="sf-meta">{t('account.linkHint')}</p>
      {err && <div class="sf-banner" role="alert">{err}</div>}
      <Button block icon="check" disabled={busy || code.length < 6} onClick={() => void verify()}>{t('account.signIn')}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => { setSentTo(''); setErr(''); }}>{t('account.otherEmail')}</Button>
    </div>
  ) : (
    <div class="stack">
      <TextField id="email" ui label={t('account.email')} placeholder="you@example.com" value={addr} onInput={setAddr} />
      {err && <div class="sf-banner" role="alert">{err}</div>}
      <Button block icon="chevron-right" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim())} onClick={() => void send()}>
        {t('account.sendCode')}
      </Button>
    </div>
  );
}

/** First screen when sync is configured and nobody is signed in on this device. */
export function Welcome({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const t = useT();
  return (
    <main class="screen" style="padding-top:calc(40px + var(--safe-top))">
      <div class="screen__head" style="display:grid;justify-items:center;text-align:center;gap:8px">
        <Illustration name="first-launch" width={200} height={150} />
        <h1 class="sf-title">{t('welcome.title')}</h1>
        <p class="sf-meta">{t('welcome.hint')}</p>
      </div>
      <SignInForm onSignedIn={onSignedIn} />
    </main>
  );
}
