import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { I18n, makeT, type Lang } from './i18n/t';
import { useRoute } from './lib/router';
import { nowIso } from './lib/dates';
import { ProfileContext, type ProfileCtx } from './lib/profile';
import { getSettings, patchSettings, type LocalSettings } from './storage/db';
import { initSync } from './storage/sync';
import { setSoundEnabled, sound } from './lib/sound';
import { hasChosen, listProfiles, newProfileId, putProfile, setActiveId, type Profile } from './storage/profiles';
import { openActiveProfile, switchProfile } from './storage/session';
import { Today } from './routes/Today';
import { Ration } from './routes/Ration';
import { Steps } from './routes/Steps';
import { Measures } from './routes/Measures';
import { Settings } from './routes/Settings';
import { InstallHint } from './components/InstallHint';
import { ProfilePicker } from './components/profiles';

type Theme = LocalSettings['theme'];

export function App() {
  const route = useRoute();
  const [lang, setLangState] = useState<Lang>('uk');
  const [theme, setThemeState] = useState<Theme>('system');
  const [ready, setReady] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [toast, setToast] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveIdState] = useState('');
  const [chosen, setChosen] = useState(true);

  const loadSettings = useCallback(async () => {
    const s = await getSettings();
    setLangState(s.lang);
    setThemeState(s.theme);
    setSoundEnabled(s.sound !== false);
    return s;
  }, []);

  useEffect(() => {
    void (async () => {
      const id = await openActiveProfile();
      setActiveIdState(id);
      setProfiles(await listProfiles());
      setChosen(await hasChosen());
      const s = await loadSettings();
      const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
      setShowHint(!standalone && !s.installHintSeen && /iPhone|iPad|iPod/.test(navigator.userAgent));
      setReady(true);
      void initSync();
    })();
    const reload = () => void listProfiles().then(setProfiles);
    window.addEventListener('tilo:profiles', reload);
    return () => window.removeEventListener('tilo:profiles', reload);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    const r = document.documentElement;
    if (theme === 'system') r.removeAttribute('data-theme');
    else r.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const setLang = (l: Lang) => { setLangState(l); void patchSettings({ lang: l }); };
  const setTheme = (th: Theme) => { setThemeState(th); void patchSettings({ theme: th }); };
  const ctx = useMemo(() => ({ lang, t: makeT(lang) }), [lang]);

  const profileCtx = useMemo<ProfileCtx | null>(() => {
    const active = profiles.find((p) => p.id === activeId);
    if (!active) return null;
    return {
      active,
      profiles,
      switchTo: async (id) => {
        if (id === activeId) return;
        sound('switch');
        await switchProfile(id);
        await loadSettings();
        setActiveIdState(id);
        location.hash = '#/today';
      },
      add: async (name) => {
        const now = nowIso();
        // Prefer a colour no other user has yet.
        const order = ['sleep', 'nature', 'work', 'leisure', 'growth', 'mood', 'money', 'relationships', 'body', 'home'];
        const color = order.find((c) => !profiles.some((p) => p.color === c)) ?? order[profiles.length % order.length];
        await putProfile({ id: newProfileId(name), name, color, createdAt: now, updatedAt: now });
        setProfiles(await listProfiles());
      },
      rename: async (id, name) => {
        const p = profiles.find((x) => x.id === id);
        if (!p || !name.trim()) return;
        await putProfile({ ...p, name: name.trim(), updatedAt: nowIso() });
        setProfiles(await listProfiles());
      },
    };
  }, [profiles, activeId, loadSettings]);

  if (!ready || !profileCtx) return null;
  return (
    <I18n.Provider value={ctx}>
      <ProfileContext.Provider value={profileCtx}>
        {!chosen ? (
          <ProfilePicker
            onDone={async (id) => {
              await setActiveId(id);
              if (id !== activeId) await profileCtx.switchTo(id);
              setChosen(true);
            }}
          />
        ) : (
          // Keyed by user: every screen remounts on a switch and binds to that user's database.
          <div key={activeId}>
            {route.name === 'today' && <Today key={route.date ?? 'today'} date={route.date} />}
            {route.name === 'ration' && <Ration key={route.date ?? 'today'} date={route.date} />}
            {route.name === 'steps' && <Steps key={route.date ?? 'today'} date={route.date} />}
            {route.name === 'measures' && <Measures />}
            {route.name === 'settings' && (
              <Settings theme={theme} setTheme={setTheme} setLang={setLang} toast={setToast} />
            )}
          </div>
        )}
        {chosen && showHint && <InstallHint onClose={() => { setShowHint(false); void patchSettings({ installHintSeen: true }); }} />}
        {toast && <div class="toast" role="status">{toast}</div>}
      </ProfileContext.Provider>
    </I18n.Provider>
  );
}
