import { useEffect, useState } from 'preact/hooks';
import type { DateKey, FoodLog, Method, PlanGroup, PlanItem } from '../model/types';
import { DONE_AT, groupUse, makeLog, remainingWeighed, roundAmount, summarize } from '../model/cooking';
import { useLang, useT, locale } from '../i18n/t';
import { capFirst, fromDateKey, nowIso, todayKey } from '../lib/dates';
import { useDay } from '../lib/useDay';
import { usePlan } from '../lib/usePlan';
import { go } from '../lib/router';
import { sound } from '../lib/sound';
import { getSettings, patchSettings } from '../storage/db';
import { Button, Icon, IconButton, PetalRain, TabBar, domainVars } from '../components/ui';
import { DishIdeas } from '../components/dishes';
import { Bar, GroupChip, LogSheet, METHOD_ICON, OilSheet, Ring, RulesSheet, itemName, groupLabel, newId, pct } from '../components/food';

/** Oil lives in group г (id 'g') in the coach's plan; fall back to any item called "oil". */
const OIL_ID = 'oil';

export function Ration({ date: dateParam }: { date?: DateKey }) {
  const t = useT();
  const lang = useLang();
  const today = todayKey();
  const date = dateParam && dateParam <= today ? dateParam : today;
  const { day, update } = useDay(date);
  const { plan, groups, items } = usePlan();
  /** Started-but-unfinished groups are open by default; a tap overrides that per group. */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [log, setLog] = useState<{ item: PlanItem; editing?: FoodLog } | null>(null);
  const [oil, setOil] = useState(false);
  const [rules, setRules] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [lastMethod, setLastMethod] = useState<Record<string, string>>({});
  useEffect(() => void getSettings().then((s) => setLastMethod(s.lastMethod ?? {})), []);

  const sum = summarize(day, plan);
  const use = sum.use;
  const nf = new Intl.NumberFormat(locale(lang));
  const groupOf = (id: string) => groups.find((g) => g.id === id)!;
  const isToday = date === today;
  const isOpen = (id: string) => toggled[id] ?? ((use[id] ?? 0) > 0 && (use[id] ?? 0) < DONE_AT);

  /** Add or replace log rows (one food from the sheet, or every ingredient of a dish idea). */
  const saveMany = (entries: FoodLog[]) => {
    if (!entries.length) return;
    const before = summarize(day, plan).groupsDone;
    let food = day.food;
    for (const entry of entries) food = food.some((f) => f.id === entry.id) ? food.map((f) => (f.id === entry.id ? entry : f)) : [...food, entry];
    update({ food });
    const after = summarize({ food }, plan);
    const g = groupUse(food)[entries[0].group] ?? 0;
    const allDone = after.groupsDone === after.groupsTotal && before < after.groupsTotal;
    sound(allDone ? 'saved' : 'bloom', Math.max(1, Math.min(5, Math.ceil(g * 5))));
    if (allDone) setCelebrate(true);
    const next = { ...lastMethod, ...Object.fromEntries(entries.map((e) => [e.item, e.method])) };
    setLastMethod(next);
    void patchSettings({ lastMethod: next });
    const oilGroup = items.find((i) => i.id === OIL_ID)?.group;
    if (entries.some((e) => e.method === 'fried' && e.group !== oilGroup) && !entries.some((e) => e.group === oilGroup)) setOil(true);
  };
  const save = (entry: FoodLog) => saveMany([entry]);
  const remove = (id: string) => update({ food: day.food.filter((f) => f.id !== id) });

  const addOil = (grams: number) => {
    const item = items.find((i) => i.id === OIL_ID);
    if (!item) return;
    save(makeLog(item, groupOf(item.group), 'raw', grams, newId(), nowIso()));
  };

  return (
    <>
      <main class="screen">
        <header class="screen__head">
          <div class="screen__row" style="align-items:center;margin-bottom:-8px">
            <div class="screen__sub">{capFirst(new Intl.DateTimeFormat(locale(lang), { weekday: 'long', day: 'numeric', month: 'long' }).format(fromDateKey(date)))}</div>
            <span style="display:flex;margin:-10px -10px -10px 0">
              <IconButton icon="history" label={t('history.title')} onClick={() => go('history')} />
              <IconButton icon="info" label={t('rules.title')} onClick={() => setRules(true)} />
            </span>
          </div>
          <h1 class="sf-title">{t('tab.ration')}</h1>
        </header>
        {!isToday && <Button variant="ghost" icon="chevron-left" onClick={() => go('ration')}>{t('today.backToToday')}</Button>}

        <div class="ration-sum sf-card">
          <div><b>{nf.format(sum.kcal)}</b><span>{t('ration.kcal', { n: nf.format(plan.kcalTarget) })}</span></div>
          <div><b>{Math.round(sum.protein)}</b><span>{t('ration.protein', { n: plan.macros?.protein ?? 0 })}</span></div>
          <div><b>{sum.groupsDone}/{sum.groupsTotal}</b><span>{t('ration.groups')}</span></div>
        </div>
        <p class="sf-meta ration-hint"><Icon name="leaf" size={16} />{t('ration.rawHint')}</p>

        {day.food.length > 0 && <DishIdeas plan={plan} food={day.food} isToday={isToday} onLog={saveMany} />}

        {groups.map((g) => (
          <GroupCard
            group={g} items={items.filter((i) => i.group === g.id && i.active)} used={use[g.id] ?? 0}
            logs={day.food.filter((f) => f.group === g.id)} open={isOpen(g.id)}
            onToggle={() => { sound(isOpen(g.id) ? 'chipOff' : 'chipOn'); setToggled({ ...toggled, [g.id]: !isOpen(g.id) }); }}
            onPick={(item) => setLog({ item })}
            onEdit={(f) => { const item = items.find((i) => i.id === f.item); if (item) setLog({ item, editing: f }); }}
          />
        ))}
      </main>
      <TabBar active="ration" date={date} />

      {log && (
        <LogSheet
          item={log.item} group={groupOf(log.item.group)} food={day.food} editing={log.editing}
          initialMethod={lastMethod[log.item.id] as Method | undefined}
          onSave={save} onDelete={remove} onClose={() => setLog(null)}
        />
      )}
      {oil && <OilSheet onAdd={addOil} onClose={() => setOil(false)} />}
      {rules && <RulesSheet onClose={() => setRules(false)} />}
      {celebrate && (
        <div class="celebrate" role="status" onClick={() => setCelebrate(false)}>
          <PetalRain />
          <div class="sf-card celebrate__card sf-pop">
            <p class="sf-h2">{t('ration.allDone')}</p>
            <Button block onClick={() => setCelebrate(false)}>{t('common.done')}</Button>
          </div>
        </div>
      )}
    </>
  );
}

function GroupCard({ group, items, used, logs, open, onToggle, onPick, onEdit }: {
  group: PlanGroup; items: PlanItem[]; used: number; logs: FoodLog[]; open: boolean;
  onToggle: () => void; onPick: (i: PlanItem) => void; onEdit: (f: FoodLog) => void;
}) {
  const t = useT();
  const lang = useLang();
  const done = used >= DONE_AT;
  const over = used > 1.005;
  const nf = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 });
  const names = new Map(items.map((i) => [i.id, i]));
  const example = items[0];
  const status = over ? t('ration.over', { pct: pct(used - 1) }) : done ? t('ration.done')
    : used > 0 ? t('ration.left', { pct: 100 - pct(used) }) + (!open && example ? ` · ${t('ration.example', { item: itemName(example, lang).toLocaleLowerCase(), left: nf.format(roundAmount(remainingWeighed(example, 'raw', used), example.unit)), unit: t('unit.' + example.unit) })}` : '')
    : t('ration.kcalGroup', { n: group.kcal });
  return (
    <section class={'gcard' + (open ? ' is-open' : '') + (done ? ' is-done' : '')} style={domainVars(group.palette)}>
      <button type="button" class="gcard__head" aria-expanded={open} onClick={onToggle}>
        <GroupChip group={group} size={40} />
        <span class="sf-row__main">
          <span class="sf-row__title">{groupLabel(group, lang)}</span>
          <span class={'sf-row__sub' + (over ? ' is-over' : '')}>{status}</span>
        </span>
        <Ring value={used} size={48} stroke={6}>{done && !over ? <Icon name="check" size={18} /> : <span class="gcard__pct">{pct(used)}%</span>}</Ring>
      </button>

      {logs.length > 0 && (
        <div class="gcard__logs">
          {logs.map((f) => {
            const item = names.get(f.item);
            const u = t('unit.' + (item?.unit ?? 'g'));
            return (
              <button type="button" class="gcard__log sf-fadeup" onClick={() => onEdit(f)}>
                <Icon name={METHOD_ICON[f.method]} size={18} />
                <span class="sf-row__main">
                  <span class="gcard__logname">{item ? itemName(item, lang) : f.item}</span>
                  <span class="sf-row__sub">
                    {f.method === 'raw' ? `${nf.format(f.weighed)} ${u}` : t('ration.logCooked', { w: nf.format(f.weighed), raw: nf.format(f.raw), unit: u, method: t('method.' + f.method + '.short') })}
                    {' · '}{f.kcal} {t('unit.kcal')}
                  </span>
                </span>
                <span class="gcard__share">{pct(f.frac)}%</span>
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <div class="gcard__items">
          <p class="sf-meta" style="padding:0 4px">{t('ration.choose')}</p>
          {items.map((i) => {
            const left = roundAmount(remainingWeighed(i, 'raw', used), i.unit);
            const u = t('unit.' + i.unit);
            return (
              <button type="button" class={'gcard__item sf-press' + (left <= 0 ? ' is-empty' : '')} onClick={() => onPick(i)}>
                <span class="sf-row__main">
                  <span class="gcard__logname">{itemName(i, lang)}</span>
                  <span class="gcard__left">
                    <span class="sf-row__sub">{t('ration.itemLeft', { left: nf.format(left), max: nf.format(i.max), unit: u })}{i.note ? ` · ${i.note}` : ''}</span>
                    <Bar value={Math.max(0, 1 - used)} color="var(--c)" />
                  </span>
                </span>
                <Icon name="plus" size={20} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
