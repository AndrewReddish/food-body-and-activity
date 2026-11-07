import { useEffect, useMemo, useState } from 'preact/hooks';
import type { FoodLog, Plan } from '../model/types';
import { makeLog, roundAmount } from '../model/cooking';
import { mealsLeftDefault, suggest, type BuiltDish, type MealIdea } from '../model/dishes';
import { useLang, useT, locale, type Lang } from '../i18n/t';
import { nowIso } from '../lib/dates';
import { sound } from '../lib/sound';
import { getSettings, patchSettings } from '../storage/db';
import { Button, Icon, IconButton, Sheet, domainVars } from './ui';
import { GroupChip, METHOD_ICON, itemName, newId } from './food';

export const dishName = (d: { nameUk: string; nameEn: string }, lang: Lang) => (lang === 'en' ? d.nameEn : d.nameUk);

/** "Що приготувати з залишку": meal ideas sized to what's left, split over the meals still to come. */
export function DishIdeas({ plan, food, isToday, onLog }: {
  plan: Plan; food: FoodLog[]; isToday: boolean; onLog: (logs: FoodLog[]) => void;
}) {
  const t = useT();
  const hour = isToday ? new Date().getHours() : 20;
  const [meals, setMeals] = useState(() => mealsLeftDefault(hour));
  const [seed, setSeed] = useState(0);
  const [open, setOpen] = useState<MealIdea | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => void getSettings().then((st) => setShown(!!st.ideasOpen)), []);
  const ideas = useMemo(() => suggest(plan, food, meals, hour, seed), [plan, food, meals, hour, seed]);
  if (!ideas.length) return null;
  const toggle = () => {
    sound(shown ? 'chipOff' : 'chipOn');
    setShown(!shown);
    void patchSettings({ ideasOpen: !shown });
  };

  return (
    <section class={'ideas' + (shown ? ' is-open' : '')} aria-labelledby="ideas-title">
      <div class="ideas__head">
        <button type="button" class="ideas__toggle" aria-expanded={shown} aria-controls="ideas-body" onClick={toggle}>
          <Icon name="leaf" size={22} />
          <span class="ideas__titles">
            <span class="sf-label" id="ideas-title">{t('ideas.title')}</span>
            {!shown && <span class="sf-meta">{t('ideas.collapsed', { n: ideas.length })}</span>}
          </span>
          <Icon name="chevron-right" size={20} class="ideas__chev" />
        </button>
        {shown && <IconButton icon="sync" label={t('ideas.more')} onClick={() => { sound('toggle'); setSeed(seed + 1); }} />}
      </div>
      {shown && (
        <div class="ideas__body" id="ideas-body">
          <div class="ideas__meals" role="radiogroup" aria-label={t('ideas.meals')}>
            <span class="sf-meta">{t('ideas.meals')}</span>
            {[1, 2, 3, 4].map((n) => (
              <button type="button" role="radio" aria-checked={n === meals} class="sf-chip sf-press" onClick={() => { sound('chipOn'); setMeals(n); }}>{n}</button>
            ))}
          </div>
          <p class="sf-meta" style="padding:0 4px;margin-top:-4px">{meals === 1 ? t('ideas.hint.last') : t('ideas.hint', { n: meals })}</p>
          <div class="ideas__list" key={`${meals}-${seed}`}>
            {ideas.map((idea) => <IdeaCard idea={idea} plan={plan} onOpen={() => setOpen(idea)} />)}
          </div>
        </div>
      )}
      {open && <DishSheet idea={open} plan={plan} onClose={() => setOpen(null)} onLog={onLog} />}
    </section>
  );
}

function IdeaCard({ idea, plan, onOpen }: { idea: MealIdea; plan: Plan; onOpen: () => void }) {
  const t = useT();
  const lang = useLang();
  return (
    <article class="sf-card idea sf-fadeup">
      <DishBlock built={idea.main} plan={plan} />
      {idea.side && (<>
        <span class="idea__plus" aria-hidden="true">+</span>
        <DishBlock built={idea.side} plan={plan} />
      </>)}
      <div class="idea__foot">
        <span class="sf-meta"><Icon name="flame" size={16} /> {new Intl.NumberFormat(locale(lang)).format(idea.kcal)} {t('unit.kcal')} · {Math.round(idea.protein)} {t('log.protein')}</span>
        <Button icon="plus" onClick={onOpen}>{t('ideas.log')}</Button>
      </div>
    </article>
  );
}

function DishBlock({ built, plan }: { built: BuiltDish; plan: Plan }) {
  const t = useT();
  const lang = useLang();
  return (
    <div class="idea__dish">
      <div class="idea__name">
        <span class="sf-label">{dishName(built.dish, lang)}</span>
        <span class="idea__kind">{t('dish.kind.' + built.dish.kind)}</span>
      </div>
      <ul class="idea__parts">
        {built.parts.map((p) => {
          const g = plan.groups.find((x) => x.id === p.item.group)!;
          return (
            <li style={domainVars(g.palette)}>
              <GroupChip group={g} size={22} />
              <span>{itemName(p.item, lang)}</span>
              <b>{partAmount(p.log, p.item.unit, t, lang)}</b>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "40 г" raw, or "108 г вареного (40 г сирого)" when cooked. */
function partAmount(l: FoodLog, unit: 'g' | 'pcs', t: ReturnType<typeof useT>, lang: Lang) {
  const nf = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 });
  const u = t('unit.' + unit);
  if (l.method === 'raw' || l.weighed === l.raw) return <>{nf.format(l.weighed)} {u}</>;
  return <>{nf.format(l.weighed)} {u} {t('method.' + l.method + '.short')}<small>{t('ideas.rawEq', { n: nf.format(Math.round(l.raw)), unit: u })}</small></>;
}

/** Check and adjust every ingredient, then log them all at once. */
function DishSheet({ idea, plan, onClose, onLog }: { idea: MealIdea; plan: Plan; onClose: () => void; onLog: (logs: FoodLog[]) => void }) {
  const t = useT();
  const lang = useLang();
  const parts = [...idea.main.parts, ...(idea.side?.parts ?? [])];
  const [amounts, setAmounts] = useState(() => parts.map((p) => p.log.weighed));
  const at = nowIso();
  const logs = parts.map((p, i) => makeLog(p.item, plan.groups.find((g) => g.id === p.item.group)!, p.method, amounts[i], newId() + i, at));
  const kcal = logs.reduce((s, l) => s + l.kcal, 0);
  const set = (i: number, v: number) => setAmounts(amounts.map((a, k) => (k === i ? Math.max(0, roundAmount(v, parts[i].item.unit)) : a)));
  const title = [idea.main, idea.side].filter(Boolean).map((d) => dishName(d!.dish, lang)).join(' + ');

  return (
    <Sheet onClose={onClose} labelledBy="dish-title">
      {(close) => (<>
        <div class="sf-sheet__head">
          <span class="sf-dchip sf-dchip--lg" style="background:var(--accent-soft);color:var(--accent-ink)"><Icon name="ration" size={22} /></span>
          <h2 class="sf-h2" id="dish-title" style="flex:1;line-height:1.2">{title}</h2>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>
        <p class="sf-meta">{t('ideas.sheetHint')}</p>
        <div class="sf-list">
          {parts.map((p, i) => {
            const g = plan.groups.find((x) => x.id === p.item.group)!;
            const step = p.item.unit === 'pcs' ? 1 : p.item.max <= 40 ? 1 : 5;
            return (
              <div class="sf-row dish-row" style={domainVars(g.palette)}>
                <GroupChip group={g} size={30} />
                <span class="sf-row__main">
                  <span class="sf-row__title">{itemName(p.item, lang)}</span>
                  {p.method !== 'raw' && (
                    <span class="sf-row__sub"><Icon name={METHOD_ICON[p.method]} size={14} /> {t('method.' + p.method)} · {t('ideas.rawEq', { n: Math.round(logs[i].raw), unit: t('unit.' + p.item.unit) })}</span>
                  )}
                </span>
                <IconButton icon="minus" label={t('log.less')} tone="sunk" size={18} onClick={() => { sound('tick', 2); set(i, amounts[i] - step); }} />
                <span class="dish-row__v">{amounts[i]}<small> {t('unit.' + p.item.unit)}</small></span>
                <IconButton icon="plus" label={t('log.more')} tone="sunk" size={18} onClick={() => { sound('tick', 4); set(i, amounts[i] + step); }} />
              </div>
            );
          })}
        </div>
        <Button block icon="check" disabled={!logs.some((l) => l.weighed > 0)} onClick={() => { onLog(logs.filter((l) => l.weighed > 0)); close(); }}>
          {t('ideas.confirm', { kcal })}
        </Button>
      </>)}
    </Sheet>
  );
}

/** Short teaser for Home: the first idea's dish names. */
export function firstIdeaName(plan: Plan, food: FoodLog[], hour: number, lang: Lang): string | undefined {
  const [idea] = suggest(plan, food, mealsLeftDefault(hour), hour, 0, 1);
  if (!idea) return undefined;
  return [idea.main, idea.side].filter(Boolean).map((d) => dishName(d!.dish, lang)).join(' + ');
}

