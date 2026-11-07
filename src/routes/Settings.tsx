import { useEffect, useRef, useState } from 'preact/hooks';
import type { Plan, PlanItem } from '../model/types';
import { COOK_TYPES, PlanSchema } from '../model/schema';
import { defaultPlan } from '../model/defaults';
import { YIELDS } from '../model/cooking';
import { BUILTIN_DISHES } from '../model/dishes';
import { isFixed, planKcalOf, scaleFactor } from '../model/scale';
import { DishesSheet } from '../components/dishEditor';
import { useLang, useT, locale, type Lang } from '../i18n/t';
import { usePlan } from '../lib/usePlan';
import { nowIso, todayKey } from '../lib/dates';
import { allDays, allMeasures, db, getPlan, patchSettings, putDay, putMeasure, putPlan, type LocalSettings } from '../storage/db';
import { foodCsv, parseBackup, shareFile, toBackup, toCsv } from '../storage/export';
import { getSyncStatus, onSyncStatus, syncNow, type SyncStatus } from '../storage/sync';
import { pickNewer } from '../storage/merge';
import { MIN_PASSWORD, authErrorKey, currentUser, isRemoteConfigured, setPassword, signOut } from '../storage/supabase';
import { SignInForm } from '../components/account';
import { Button, Icon, IconButton, Segmented, Sheet, TabBar, TextField, Toggle } from '../components/ui';
import { GroupChip, groupLabel, itemName, newId } from '../components/food';
import { AddProfileForm, ProfileList } from '../components/profiles';
import { useProfiles } from '../lib/profile';
import { isSoundEnabled, setSoundEnabled, sound } from '../lib/sound';

type Theme = LocalSettings['theme'];

export function Settings({ theme, setTheme, setLang, toast }: {
  theme: Theme; setTheme: (t: Theme) => void; setLang: (l: Lang) => void; toast: (msg: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const { base: plan, plan: scaled, groups, items, save } = usePlan();
  const k = scaleFactor(plan);
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  const [sheet, setSheet] = useState<'account' | 'plan' | 'dishes' | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const planRef = useRef<HTMLInputElement>(null);
  const { active, switchTo, rename } = useProfiles();
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  useEffect(() => onSyncStatus(setStatus), []);
  useEffect(() => void currentUser().then((u) => setEmail(u?.email ?? null)), [status, sheet]);

  const time = (iso?: string) => (iso ? new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
  const syncLine =
    status.state === 'off' ? t('settings.notSynced')
    : status.state === 'syncing' ? t('settings.syncing')
    : status.state === 'offline' ? t('offline')
    : status.state === 'error' ? t('settings.syncError', { msg: status.message })
    : status.lastSyncAt ? t('settings.synced', { time: time(status.lastSyncAt) }) : t('settings.syncing');

  const exportCsv = async () => {
    const [days, measures, p] = await Promise.all([allDays(), allMeasures(), getPlan()]);
    await shareFile(`tonus-${todayKey()}.csv`, 'text/csv', toCsv(days, measures, p));
  };
  const exportFood = async () => {
    const [days, p] = await Promise.all([allDays(), getPlan()]);
    await shareFile(`tonus-food-${todayKey()}.csv`, 'text/csv', foodCsv(days, p));
  };
  const exportJson = async () => {
    const [days, measures, p] = await Promise.all([allDays(), allMeasures(), getPlan()]);
    await shareFile(`tonus-backup-${todayKey()}.json`, 'application/json', JSON.stringify(toBackup(p, days, measures, nowIso()), null, 2));
  };
  const restore = async (file: File) => {
    try {
      const b = parseBackup(await file.text());
      let n = 0;
      for (const d of b.days) {
        const cur = await db.days.get(d.date);
        if (pickNewer(cur, d) === d && cur?.updatedAt !== d.updatedAt) { await putDay(d); n++; }
      }
      for (const m of b.measures) {
        const cur = await db.measures.get(m.date);
        if (pickNewer(cur, m) === m && cur?.updatedAt !== m.updatedAt) await putMeasure(m);
      }
      if (pickNewer(await getPlan(), b.plan) === b.plan) await putPlan(b.plan);
      toast(t('settings.restore.done', { n }));
      window.dispatchEvent(new CustomEvent('tilo:plan'));
      void syncNow();
    } catch {
      toast(t('settings.restore.error'));
    }
  };
  const importPlan = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const p = PlanSchema.parse(raw.plan ?? raw);
      await save(p);
      toast(t('plan.imported'));
    } catch {
      toast(t('plan.importError'));
    }
  };

  const num = (v: string, fallback: number) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : fallback);

  return (
    <>
      <main class="screen" style="gap:8px">
        <h1 class="sf-title" style="padding-top:10px">{t('settings.title')}</h1>

        <h2 class="sf-section">{t('settings.plan')}</h2>
        <div class="sf-list">
          <div class="sf-row">
            <Icon name="flame" size={22} />
            <label class="sf-row__title" style="flex:1" for="kcal">{t('settings.kcal')}</label>
            <input id="kcal" class="sf-input sf-input--ui settings-num" inputMode="numeric" value={plan.kcalTarget}
              onChange={(e) => void save({ ...plan, kcalTarget: num((e.currentTarget as HTMLInputElement).value, plan.kcalTarget), goalsUpdatedAt: nowIso() })} />
          </div>
          {k !== 1 && <p class="sf-meta" style="padding:0 16px 8px">{t('settings.scaled', { pct: Math.round(k * 100), base: planKcalOf(plan) })}</p>}
          <div class="sf-row">
            <Icon name="protein" size={22} />
            <label class="sf-row__title" style="flex:1" for="protein">{t('settings.protein')}</label>
            <input id="protein" class="sf-input sf-input--ui settings-num" inputMode="numeric" value={plan.macros?.protein ?? ''}
              onChange={(e) => void save({ ...plan, macros: { protein: num((e.currentTarget as HTMLInputElement).value, 0), fat: plan.macros?.fat ?? 0, carbs: plan.macros?.carbs ?? 0 }, goalsUpdatedAt: nowIso() })} />
          </div>
          <div class="sf-row">
            <Icon name="steps" size={22} />
            <label class="sf-row__title" style="flex:1" for="goal">{t('settings.stepsGoal')}</label>
            <input id="goal" class="sf-input sf-input--ui settings-num" inputMode="numeric" value={plan.stepsGoal}
              onChange={(e) => void save({ ...plan, stepsGoal: num((e.currentTarget as HTMLInputElement).value, plan.stepsGoal), goalsUpdatedAt: nowIso() })} />
          </div>
          <button type="button" class="sf-row sf-row--tall" onClick={() => setSheet('plan')}>
            <Icon name="ration" size={22} />
            <span class="sf-row__main">
              <span class="sf-row__title sf-row__title--accent">{t('settings.plan.edit')}</span>
              <span class="sf-row__sub">{t('settings.plan.sub', { g: groups.length, i: items.filter((i) => i.active).length })}</span>
            </span>
            <Icon name="chevron-right" size={20} class="sf-row__chev" />
          </button>
          <button type="button" class="sf-row sf-row--tall" onClick={() => setSheet('dishes')}>
            <Icon name="leaf" size={22} />
            <span class="sf-row__main">
              <span class="sf-row__title sf-row__title--accent">{t('dishes.title')}</span>
              <span class="sf-row__sub">{t('dishes.sub', { n: BUILTIN_DISHES.length - (plan.hiddenDishes?.length ?? 0) + (plan.dishes?.length ?? 0) })}</span>
            </span>
            <Icon name="chevron-right" size={20} class="sf-row__chev" />
          </button>
        </div>

        <h2 class="sf-section">{t('profiles.section')}</h2>
        <ProfileList picked={active.id} onPick={switchTo} />
        <AddProfileForm />
        <div class="sf-field" style="padding-top:4px">
          <label class="sf-meta" for="profile-name" style="padding:0 4px">{t('profiles.rename')} · {active.name}</label>
          <input id="profile-name" class="sf-input sf-input--ui" style="background:var(--surface)" defaultValue={active.name} maxLength={40}
            onChange={(e) => void rename(active.id, (e.currentTarget as HTMLInputElement).value)} />
        </div>

        <h2 class="sf-section">{t('settings.lookLang')}</h2>
        <div class="sf-list settings-group">
          <Segmented<Theme> label={t('settings.theme')} value={theme} onChange={setTheme} options={[
            { value: 'system', label: t('theme.system') }, { value: 'light', label: t('theme.light') }, { value: 'dark', label: t('theme.dark') },
          ]} />
          <Segmented<Lang> label={t('settings.language')} value={lang} onChange={setLang} options={[
            { value: 'uk', label: 'Українська' }, { value: 'en', label: 'English' },
          ]} />
          <div class="sf-row" style="padding:4px 2px 0;min-height:48px">
            <span class="sf-row__main">
              <span class="sf-row__title">{t('settings.sound')}</span>
              <span class="sf-row__sub">{t('settings.sound.hint')}</span>
            </span>
            <Toggle checked={soundOn} label={t('settings.sound')} onChange={(on) => {
              setSoundEnabled(on);
              setSoundOn(on);
              void patchSettings({ sound: on });
              if (on) sound('chipOn');
            }} />
          </div>
        </div>

        <h2 class="sf-section">{t('settings.syncData')}</h2>
        <div class="sf-list">
          {isRemoteConfigured() && (
            <button type="button" class="sf-row sf-row--tall" onClick={() => setSheet('account')}>
              <Icon name="key" size={22} />
              <span class="sf-row__main">
                <span class="sf-row__title">{email ?? t('settings.account')}</span>
                <span class="sf-row__sub">{status.state === 'idle' && <Icon name="check" size={14} />}{syncLine}</span>
              </span>
              <Icon name="chevron-right" size={20} class="sf-row__chev" />
            </button>
          )}
          <button type="button" class="sf-row" onClick={exportCsv}>
            <Icon name="download" size={22} /><span class="sf-row__title" style="flex:1">{t('settings.csv')}</span>
            <Icon name="chevron-right" size={20} class="sf-row__chev" />
          </button>
          <button type="button" class="sf-row" onClick={exportFood}>
            <Icon name="ration" size={22} /><span class="sf-row__title" style="flex:1">{t('settings.foodCsv')}</span>
            <Icon name="chevron-right" size={20} class="sf-row__chev" />
          </button>
          <button type="button" class="sf-row" onClick={exportJson}>
            <Icon name="sync" size={22} /><span class="sf-row__title" style="flex:1">{t('settings.json')}</span>
            <Icon name="chevron-right" size={20} class="sf-row__chev" />
          </button>
          <button type="button" class="sf-row" onClick={() => fileRef.current?.click()}>
            <Icon name="history" size={22} /><span class="sf-row__title" style="flex:1">{t('settings.restore')}</span>
            <Icon name="chevron-right" size={20} class="sf-row__chev" />
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden
            onChange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) void restore(f); (e.currentTarget as HTMLInputElement).value = ''; }} />
          <input ref={planRef} type="file" accept="application/json,.json" hidden
            onChange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) void importPlan(f); (e.currentTarget as HTMLInputElement).value = ''; }} />
        </div>
        <p class="sf-meta" style="text-align:center;padding-top:12px">{t('settings.version', { v: __APP_VERSION__ })}</p>
      </main>
      <TabBar active="settings" />

      {sheet === 'account' && <AccountSheet email={email} syncLine={syncLine} toast={toast} onClose={() => setSheet(null)} />}
      {sheet === 'dishes' && <DishesSheet plan={plan} save={save} onClose={() => setSheet(null)} />}
      {sheet === 'plan' && (
        <PlanSheet plan={plan} scaled={scaled} save={save} onClose={() => setSheet(null)}
          onExport={() => void shareFile(`tonus-plan-${todayKey()}.json`, 'application/json', JSON.stringify(plan, null, 2))}
          onImport={() => planRef.current?.click()} />
      )}
    </>
  );
}

/** Signed in: sync now, set or change the password, sign out. Signed out: the same form as the first screen. */
function AccountSheet({ email, syncLine, toast, onClose }: { email: string | null; syncLine: string; toast: (msg: string) => void; onClose: () => void }) {
  const t = useT();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const savePassword = async () => {
    setBusy(true);
    setErr('');
    try {
      await setPassword(pw);
      setPw('');
      sound('saved');
      toast(t('account.passwordSaved'));
    } catch (x) {
      const key = authErrorKey(x);
      setErr(key ? t(key) : t('account.error', { msg: x instanceof Error ? x.message : String(x) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet onClose={onClose} labelledBy="account-title">
      {(close) => (<>
        <div class="sf-sheet__head">
          <span class="sf-dchip sf-dchip--lg" style="background:var(--accent-soft);color:var(--accent-ink)"><Icon name="key" size={22} /></span>
          <h2 class="sf-h2" id="account-title" style="flex:1">{t('settings.account')}</h2>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>
        {email ? (<>
          <p class="sf-meta">{t('account.signedIn', { email })}</p>
          <p class="sf-meta">{syncLine}</p>
          <Button block icon="sync" onClick={() => { void syncNow(); close(); }}>{t('settings.syncNow')}</Button>
          <form class="stack" onSubmit={(e) => { e.preventDefault(); if (pw.length >= MIN_PASSWORD) void savePassword(); }}>
            <input type="email" name="email" value={email} autoComplete="username" hidden readOnly />
            <label class="sf-field__label" for="new-password">{t('account.newPassword')}</label>
            <input id="new-password" name="new-password" type="password" class="sf-input sf-input--ui" value={pw}
              autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellcheck={false}
              onInput={(e) => setPw((e.currentTarget as HTMLInputElement).value)} />
            <p class="sf-meta">{t('account.passwordRule', { n: MIN_PASSWORD })}</p>
            {err && <div class="sf-banner" role="alert">{err}</div>}
            <Button variant="secondary" icon="check" disabled={busy || pw.length < MIN_PASSWORD} onClick={() => void savePassword()}>{t('account.savePassword')}</Button>
          </form>
          <div class="sf-sheet__actions">
            <Button variant="ghost" onClick={() => void signOut().then(onClose)}>{t('account.signOut')}</Button>
          </div>
          <p class="sf-meta">{t('account.signOut.hint')}</p>
        </>) : (<>
          <p class="sf-meta">{t('account.hint')}</p>
          <SignInForm onSignedIn={() => { void syncNow(); onClose(); }} />
        </>)}
      </>)}
    </Sheet>
  );
}

/** Edit groups and foods: names, 100% amounts, food type (drives raw ↔ cooked), protein. */
function PlanSheet({ plan, scaled, save, onClose, onExport, onImport }: {
  plan: Plan; scaled: Plan; save: (p: Plan) => Promise<void>; onClose: () => void; onExport: () => void; onImport: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const groups = [...plan.groups].sort((a, b) => a.order - b.order);
  const setItem = (id: string, patch: Partial<PlanItem>) => void save({ ...plan, items: plan.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const addItem = (group: string) => {
    const id = `custom-${newId()}`.slice(0, 40);
    void save({ ...plan, items: [...plan.items, { id, group, nameUk: t('plan.newItem'), nameEn: 'New food', max: 100, unit: 'g', cook: 'none', protein: 0, order: plan.items.length, active: true }] });
    setEditing(id);
  };
  const num = (e: Event) => parseFloat((e.currentTarget as HTMLInputElement).value.replace(',', '.'));
  const k = scaleFactor(plan);
  const scaledGroup = (id: string) => scaled.groups.find((g) => g.id === id);
  const scaledItem = (id: string) => scaled.items.find((i) => i.id === id);

  return (
    <Sheet onClose={onClose} labelledBy="plan-title">
      {(close) => (<>
        <div class="sf-sheet__head">
          <h2 class="sf-h2" id="plan-title" style="flex:1">{t('settings.plan.edit')}</h2>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>
        <p class="sf-meta">{t('plan.hint')}</p>
        <div class="sf-list">
          <div class="sf-row">
            <label class="sf-row__title" style="flex:1" for="plan-kcal">{t('plan.baseKcal')}</label>
            <input id="plan-kcal" class="sf-input sf-input--ui settings-num" inputMode="numeric" value={planKcalOf(plan)}
              onChange={(e) => { const v = Math.round(num(e)); if (v >= 500 && v <= 10000) void save({ ...plan, planKcal: v }); }} />
          </div>
        </div>
        <p class="sf-meta">{k === 1 ? t('plan.scaleNone') : t('plan.scaleHint', { pct: Math.round(k * 100), kcal: plan.kcalTarget })}</p>
        {groups.map((g) => {
          const items = plan.items.filter((i) => i.group === g.id).sort((a, b) => a.order - b.order);
          return (
            <div class="sf-list">
              <button type="button" class="sf-row sf-row--tall" aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
                <GroupChip group={g} size={34} />
                <span class="sf-row__main">
                  <span class="sf-row__title">{groupLabel(g, lang)}</span>
                  <span class="sf-row__sub">~{g.kcal}{k !== 1 && !isFixed(g) ? ` → ${scaledGroup(g.id)?.kcal ?? g.kcal}` : ''} {t('unit.kcal')} · {items.filter((i) => i.active).length}</span>
                </span>
                <span style={`display:grid;transition:transform var(--dur-2) var(--ease)${open === g.id ? ';transform:rotate(90deg)' : ''}`}><Icon name="chevron-right" size={20} class="sf-row__chev" /></span>
              </button>
              {open === g.id && (<>
                <div class="sf-row">
                  <label class="sf-row__title" style="flex:1" for={`gk-${g.id}`}>{t('plan.groupKcal')}</label>
                  <input id={`gk-${g.id}`} class="sf-input sf-input--ui settings-num" inputMode="numeric" value={g.kcal}
                    onChange={(e) => { const v = num(e); if (v >= 0) void save({ ...plan, groups: plan.groups.map((x) => (x.id === g.id ? { ...x, kcal: Math.round(v) } : x)) }); }} />
                </div>
                <div class="sf-row">
                  <span class="sf-row__title" style="flex:1">{t('plan.scales')}</span>
                  <Toggle checked={!isFixed(g)} label={`${t('plan.scales')}: ${groupLabel(g, lang)}`}
                    onChange={(on) => void save({ ...plan, groups: plan.groups.map((x) => (x.id === g.id ? { ...x, fixed: !on } : x)) })} />
                </div>
                {items.map((i) => (
                  <div class="sf-row" style="flex-wrap:wrap;padding-block:4px">
                    <button type="button" class="sf-row__main" style="border:0;background:none;text-align:left;min-height:44px;padding:0;cursor:pointer;color:inherit"
                      onClick={() => setEditing(editing === i.id ? null : i.id)}>
                      <span class="sf-row__title" style={i.active ? '' : 'color:var(--ink-3)'}>{itemName(i, lang)}</span>
                      <span class="sf-row__sub">{i.max}{scaledItem(i.id) && scaledItem(i.id)!.max !== i.max ? ` → ${scaledItem(i.id)!.max}` : ''} {t('unit.' + i.unit)} · {t('cook.' + i.cook)}</span>
                    </button>
                    <Toggle checked={i.active} label={`${t('plan.active')}: ${itemName(i, lang)}`} onChange={(active) => setItem(i.id, { active })} />
                    {editing === i.id && (
                      <div class="plan-item">
                        <TextField id={`nu-${i.id}`} ui label={t('plan.nameUk')} value={i.nameUk} maxLength={80} onInput={(v) => v.trim() && setItem(i.id, { nameUk: v })} />
                        <TextField id={`ne-${i.id}`} ui label={t('plan.nameEn')} value={i.nameEn} maxLength={80} onInput={(v) => v.trim() && setItem(i.id, { nameEn: v })} />
                        <div class="plan-item__row">
                          <label class="sf-field"><span class="sf-field__label">{t('plan.max')}</span>
                            <input class="sf-input sf-input--ui" inputMode="decimal" value={i.max} onChange={(e) => { const v = num(e); if (v > 0) setItem(i.id, { max: v }); }} /></label>
                          <label class="sf-field"><span class="sf-field__label">{t('plan.unit')}</span>
                            <select class="sf-input sf-input--ui" value={i.unit} onChange={(e) => setItem(i.id, { unit: (e.currentTarget as HTMLSelectElement).value as PlanItem['unit'] })}>
                              <option value="g">{t('unit.g')}</option><option value="pcs">{t('unit.pcs')}</option>
                            </select></label>
                          <label class="sf-field"><span class="sf-field__label">{t('plan.protein')}</span>
                            <input class="sf-input sf-input--ui" inputMode="decimal" value={i.protein} onChange={(e) => { const v = num(e); if (v >= 0) setItem(i.id, { protein: v }); }} /></label>
                        </div>
                        <label class="sf-field"><span class="sf-field__label">{t('plan.cook')}</span>
                          <select class="sf-input sf-input--ui" value={i.cook} onChange={(e) => setItem(i.id, { cook: (e.currentTarget as HTMLSelectElement).value as PlanItem['cook'] })}>
                            {COOK_TYPES.map((c) => <option value={c}>{t('cook.' + c)}{yieldText(c, t)}</option>)}
                          </select></label>
                      </div>
                    )}
                  </div>
                ))}
                <button type="button" class="sf-row" onClick={() => addItem(g.id)}>
                  <Icon name="plus" size={22} /><span class="sf-row__title sf-row__title--accent" style="flex:1">{t('plan.addItem')}</span>
                </button>
              </>)}
            </div>
          );
        })}
        <div class="sf-sheet__actions">
          <Button variant="secondary" icon="download" onClick={onExport}>{t('plan.export')}</Button>
          <Button variant="secondary" icon="history" onClick={onImport}>{t('plan.import')}</Button>
          <Button variant="ghost" onClick={() => { if (confirm(t('plan.resetConfirm'))) void save(defaultPlan()); }}>{t('plan.reset')}</Button>
          <Button block onClick={close}>{t('common.done')}</Button>
        </div>
      </>)}
    </Sheet>
  );
}

function yieldText(c: (typeof COOK_TYPES)[number], t: ReturnType<typeof useT>) {
  const y = Object.entries(YIELDS[c]).filter(([, v]) => v !== 1);
  return y.length ? ` (${y.map(([m, v]) => `${t('method.' + m + '.short')} ×${v}`).join(', ')})` : '';
}
