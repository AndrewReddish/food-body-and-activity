import { useState } from 'preact/hooks';
import { useT } from '../i18n/t';
import { sound } from '../lib/sound';
import { MIN_PASSWORD, authErrorKey, signIn, signUp } from '../storage/supabase';
import { Button, Illustration } from './ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email + password: sign in, or create an account (no email is sent; the account works right away).
 * Field names and autocomplete hints let iCloud Keychain save and fill the password.
 */
export function SignInForm({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const t = useT();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; raw?: string } | null>(null);

  const creating = mode === 'signUp';
  const ok = EMAIL_RE.test(email.trim()) && (creating ? password.length >= MIN_PASSWORD : password.length > 0);

  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (creating) await signUp(email.trim(), password);
      else await signIn(email.trim(), password);
      sound('saved');
      await onSignedIn();
    } catch (x) {
      const key = authErrorKey(x);
      const raw = x instanceof Error ? x.message : String(x);
      setErr(key ? { text: t(key), raw } : { text: t('account.error', { msg: raw }) });
    } finally {
      setBusy(false);
    }
  };
  const switchMode = () => { setMode(creating ? 'signIn' : 'signUp'); setErr(null); };

  return (
    <form class="stack" onSubmit={submit} autoComplete="on">
      <div class="sf-field">
        <label class="sf-field__label" for="email">{t('account.email')}</label>
        <input id="email" name="email" type="email" class="sf-input sf-input--ui" placeholder="you@example.com" value={email}
          autoComplete="username" autoCapitalize="off" autoCorrect="off" spellcheck={false} inputMode="email" enterKeyHint="next"
          onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
      </div>
      <div class="sf-field">
        <label class="sf-field__label" for="password">{t('account.password')}</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="password" name="password" type={show ? 'text' : 'password'} class="sf-input sf-input--ui" style="flex:1" value={password}
            autoComplete={creating ? 'new-password' : 'current-password'} autoCapitalize="off" autoCorrect="off" spellcheck={false}
            minLength={creating ? MIN_PASSWORD : undefined} enterKeyHint="go"
            onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)} />
          <Button variant="ghost" onClick={() => setShow(!show)}>{show ? t('account.hide') : t('account.show')}</Button>
        </div>
        {creating && <p class="sf-meta">{t('account.passwordRule', { n: MIN_PASSWORD })}</p>}
      </div>
      {err && (
        <div class="sf-banner" role="alert">
          {err.text}
          {err.raw && <div class="sf-meta" style="opacity:.7;margin-top:4px">Supabase: {err.raw}</div>}
        </div>
      )}
      {/* lets the keyboard's Go/Enter submit the form (implicit submission needs a submit button) */}
      <button type="submit" tabIndex={-1} aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px" />
      <Button block icon={creating ? 'plus' : 'check'} disabled={busy || !ok} onClick={() => void submit()}>
        {creating ? t('account.signUp') : t('account.signIn')}
      </Button>
      <Button variant="ghost" disabled={busy} onClick={switchMode}>{creating ? t('account.toSignIn') : t('account.toSignUp')}</Button>
    </form>
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
