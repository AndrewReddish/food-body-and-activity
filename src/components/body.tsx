import { useEffect, useState } from 'preact/hooks';
import type { Plan } from '../model/types';
import { ACTIVITIES, GOALS, applyTargets, computeTargets, DEFAULT_FORMULA, type Activity, type Body, type Formula, type WeightGoal } from '../model/targets';
import { useLang, useT, locale } from '../i18n/t';
import { db } from '../storage/db';
import { getFormula, goalsStamp, latestWeight } from '../storage/goals';
import { Icon, Segmented, Toggle } from './ui';

/** Formula and latest measured weight, refreshed after a sync or a new measurement. */
export function useTargetInputs() {
  const [formula, setFormula] = useState<Formula>(DEFAULT_FORMULA);
  const [weight, setWeight] = useState<number | undefined>();
  useEffect(() => {
    const load = () => { void getFormula(db).then(setFormula); void latestWeight(db).then(setWeight); };
    load();
    window.addEventListener('tilo:synced', load);
    window.addEventListener('tilo:plan', load);
    return () => { window.removeEventListener('tilo:synced', load); window.removeEventListener('tilo:plan', load); };
  }, []);
  return { formula, weight };
}

/** Weight goal, body data and the switch for automatic targets (Опції → Ціль). */
export function BodySection({ plan, save }: { plan: Plan; save: (p: Plan) => Promise<void> }) {
  const t = useT();
  const lang = useLang();
  const { formula, weight } = useTargetInputs();
  const body: Body = plan.body ?? {};
  const nf = new Intl.NumberFormat(locale(lang));

  const set = (patch: Partial<Body>) => {
    const now = goalsStamp(plan);
    const next = { ...plan, body: { ...body, ...patch }, goalsUpdatedAt: now };
    void save(applyTargets(next, weight, formula, now));
  };
  const numIn = (e: Event, min: number, max: number) => {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value.replace(',', '.'));
    return Number.isFinite(v) && v >= min && v <= max ? v : undefined;
  };

  const r = computeTargets(body, weight, formula);

  return (
    <div class="sf-list">
      <div class="sf-row sf-row--block">
        <Segmented<WeightGoal> label={t('body.goal')} value={body.goal ?? 'lose'} onChange={(goal) => set({ goal })}
          options={GOALS.map((g) => ({ value: g, label: t('body.goal.' + g) }))} />
      </div>
      <div class="sf-row">
        <Icon name="flame" size={22} />
        <span class="sf-row__main">
          <span class="sf-row__title">{t('body.auto')}</span>
          <span class="sf-row__sub">{t('body.auto.sub')}</span>
        </span>
        <Toggle checked={!!body.auto} label={t('body.auto')} onChange={(auto) => set({ auto })} />
      </div>
      <div class="sf-row sf-row--block">
        <Segmented<'f' | 'm'> label={t('body.sex')} value={(body.sex ?? '') as 'f' | 'm'} onChange={(sex) => set({ sex })}
          options={[{ value: 'f', label: t('body.sex.f') }, { value: 'm', label: t('body.sex.m') }]} />
      </div>
      <div class="sf-row">
        <label class="sf-row__title" style="flex:1" for="birth">{t('body.birthYear')}</label>
        <input id="birth" class="sf-input sf-input--ui settings-num" inputMode="numeric" value={body.birthYear ?? ''}
          onChange={(e) => set({ birthYear: numIn(e, 1900, new Date().getFullYear() - 10) })} />
      </div>
      <div class="sf-row">
        <label class="sf-row__title" style="flex:1" for="height">{t('body.height')}</label>
        <input id="height" class="sf-input sf-input--ui settings-num" inputMode="decimal" value={body.height ?? ''}
          onChange={(e) => set({ height: numIn(e, 80, 250) })} />
      </div>
      <div class="sf-row">
        <span class="sf-row__main">
          <label class="sf-row__title" for="startw">{t('body.weight')}</label>
          <span class="sf-row__sub">{weight !== undefined ? t('body.weight.measured', { n: nf.format(weight) }) : t('body.weight.start')}</span>
        </span>
        <input id="startw" class="sf-input sf-input--ui settings-num" inputMode="decimal" value={body.weight ?? ''}
          onChange={(e) => set({ weight: numIn(e, 20, 400) })} />
      </div>
      <div class="sf-row">
        <label class="sf-row__title" style="flex:1" for="activity">{t('body.activity')}</label>
        <select id="activity" class="sf-input sf-input--ui" style="max-width:60%" value={body.activity ?? 'light'}
          onChange={(e) => set({ activity: (e.currentTarget as HTMLSelectElement).value as Activity })}>
          {ACTIVITIES.map((a) => <option value={a}>{t('body.activity.' + a)}</option>)}
        </select>
      </div>
      <p class="sf-meta body-result">
        {r.ok
          ? t('body.result', {
            bmr: nf.format(r.targets.bmr), tdee: nf.format(r.targets.tdee), kcal: nf.format(r.targets.kcal),
            protein: r.targets.protein, steps: nf.format(r.targets.steps), bmi: nf.format(r.targets.bmi),
          }) + (body.kcalAdjust ? ' ' + t('body.adjust', { n: body.kcalAdjust > 0 ? `+${body.kcalAdjust}` : body.kcalAdjust }) : '')
            + (body.auto ? '' : ' ' + t('body.manualNote'))
          : t('body.missing', { list: r.missing.map((m) => t('body.missing.' + m)).join(', ') })}
      </p>
    </div>
  );
}
