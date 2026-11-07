import { useState } from 'preact/hooks';
import { useT } from '../i18n/t';
import { sound } from '../lib/sound';
import { linkToken, sendCode, verifyCode, verifyLink } from '../storage/supabase';
import { Button, Illustration, TextField } from './ui';

/**
 * Where the last email went, so an iPhone app reloaded while the person was in Mail comes back to the
 * code step instead of the email step (sending again would cancel the link they are about to paste).
 */
const PENDING_KEY = 'tonus-pending-signin';
const PENDING_MS = 60 * 60 * 1000;

function loadPending(): string | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as { email: string; at: number } | null;
    return p && Date.now() - p.at < PENDING_MS ? p.email : null;
  } catch {
    return null;
  }
}
function savePending(email: string | null): void {
  try {
    if (email === null) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify({ email, at: Date.now() }));
  } catch {
    // private mode etc.: the form still works, it just won't remember
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email → 6-digit code (or the link from the email). The same form creates an account or signs in.
 * The code works inside an installed iPhone app; the magic link in the same email works in a browser tab.
 */
export function SignInForm({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const t = useT();
  const pending = loadPending();
  const [addr, setAddr] = useState(pending ?? '');
  const [code, setCode] = useState('');
  /** null = email step; '' = code step without a known email (the person already had a code or link). */
  const [sentTo, setSentTo] = useState<string | null>(pending);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Used, expired or replaced by a newer email: say what to do, not only what went wrong.
      setErr(/expired|invalid|not found|otp/i.test(msg) ? t('account.expired') : t('account.error', { msg }));
    } finally {
      setBusy(false);
    }
  };
  const send = () => attempt(async () => {
    await sendCode(addr.trim());
    savePending(addr.trim());
    setSentTo(addr.trim());
    setCode('');
  });
  const isLink = !!linkToken(code);
  const email = sentTo || addr.trim();
  const verify = () => attempt(async () => {
    if (isLink) await verifyLink(code);
    else await verifyCode(email, code.trim());
    savePending(null);
    sound('saved');
    await onSignedIn();
  });
  const back = () => { savePending(null); setSentTo(null); setErr(''); setCode(''); };

  return sentTo !== null ? (
    <div class="stack">
      {sentTo ? <p class="sf-meta">{t('account.codeSent', { email: sentTo })}</p> : (
        <TextField id="email" ui label={t('account.emailForCode')} placeholder="you@example.com" value={addr} onInput={setAddr} />
      )}
      <TextField id="otp" ui label={t('account.code')} placeholder="123456" value={code}
        onInput={(v) => setCode(/^\s*\d{0,10}\s*$/.test(v) ? v.replace(/\D/g, '') : v.trim())} />
      <p class="sf-meta">{t('account.linkHint')}</p>
      {err && <div class="sf-banner" role="alert">{err}</div>}
      <Button block icon="check" disabled={busy || (!isLink && (code.length < 6 || !EMAIL_RE.test(email)))} onClick={() => void verify()}>{t('account.signIn')}</Button>
      <Button variant="ghost" disabled={busy} onClick={back}>{t('account.otherEmail')}</Button>
    </div>
  ) : (
    <div class="stack">
      <TextField id="email" ui label={t('account.email')} placeholder="you@example.com" value={addr} onInput={setAddr} />
      {err && <div class="sf-banner" role="alert">{err}</div>}
      <Button block icon="chevron-right" disabled={busy || !EMAIL_RE.test(addr.trim())} onClick={() => void send()}>
        {t('account.sendCode')}
      </Button>
      <Button variant="ghost" disabled={busy} onClick={() => { setSentTo(''); setErr(''); }}>{t('account.haveCode')}</Button>
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
