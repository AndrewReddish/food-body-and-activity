import { useEffect, useState } from 'preact/hooks';
import type { DateKey } from '../model/types';
import { summarize } from '../model/cooking';
import { useLang, useT, locale } from '../i18n/t';
import { addDays, capFirst, fromDateKey, todayKey } from '../lib/dates';
import { useDay } from '../lib/useDay';
import { usePlan } from '../lib/usePlan';
import { measureStats, useMeasures } from '../lib/useMeasures';
import { useOnline } from '../lib/useOnline';
import { go } from '../lib/router';
import { sound } from '../lib/sound';
import { db } from '../storage/db';
import { Button, Icon, IconButton, TabBar, domainVars } from '../components/ui';
import { Bar, DayStrip, Ring, pct } from '../components/food';
import { StepsSheet } from './Steps';
import { firstIdeaName } from '../components/dishes';
import { Avatar, ProfileSheet } from '../components/profiles';
import { useProfiles } from '../lib/profile';

function greetingKey(h: number) {
  if (h >= 5 && h < 12) return 'today.greeting.morning';
  if (h >= 12 && h < 17) return 'today.greeting.day';
  if (h >= 17 && h < 23) return 'today.greeting';
  return 'today.greeting.night';
}

/** Days since the last measurement after which Заміри gets a dot. */
export const MEASURE_EVERY = 7;

export function Today({ date: dateParam }: { date?: DateKey }) {
  const t = useT();
  const lang = useLang();
  const today = todayKey();
  const date = dateParam && dateParam <= today ? dateParam : today;
  const { day, update } = useDay(date);
  const { plan, groups } = usePlan();
  const { list: measures } = useMeasures();
  const online = useOnline();
  const [strip, setStrip] = useState<{ date: DateKey; value?: number }[]>([]);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const { active: profile } = useProfiles();

  const sum = summarize(day, plan);
  const stats = measureStats(measures);
  const measureDue = !stats.lastDate || stats.lastDate < addDays(today, -MEASURE_EVERY);

  useEffect(() => {
    const keys = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    void db.days.bulkGet(keys).then((rows) =>
      setStrip(keys.map((k, i) => ({ date: k, value: (k === date ? sum.groupsDone : summarize(rows[i], plan).groupsDone) / sum.groupsTotal }))),
    );
  }, [today, date, sum.groupsDone, plan]);

  const dt = fromDateKey(date);
  const dateLine = capFirst(new Intl.DateTimeFormat(locale(lang), { weekday: 'long', day: 'numeric', month: 'long' }).format(dt));
  const isToday = date === today;
  const steps = day.steps ?? 0;
  const goal = plan.stepsGoal || 7000;
  const left = groups.filter((g) => (sum.use[g.id] ?? 0) < 0.95);
  const hour = new Date().getHours();
  const nf = new Intl.NumberFormat(locale(lang));
  const idea = day.food.length ? firstIdeaName(plan, day.food, isToday ? hour : 20, lang) : undefined;

  return (
    <>
      <main class="screen">
        <header class="screen__head">
          <div class="screen__row" style="align-items:center;margin-bottom:-8px">
            <div class="screen__sub">{dateLine}</div>
            <button type="button" class="sf-avatarbtn sf-press" style="margin:-10px -6px -10px 0"
              aria-label={`${t('profiles.switch')}. ${t('profiles.current', { name: profile.name })}`} onClick={() => setProfilesOpen(true)}>
              <Avatar profile={profile} size={36} />
            </button>
          </div>
          <h1 class="sf-title">{isToday ? t(greetingKey(hour)) : t('today.past', { date: new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'long' }).format(dt) })}</h1>
        </header>

        {!online && <div class="sf-banner" role="status"><Icon name="offline" /><span>{t('offline')}</span></div>}

        <DayStrip days={strip} today={today} selected={date} onSelect={(d) => go(d === today ? 'today' : 'day/' + d)} />
        {!isToday && <Button variant="ghost" icon="chevron-left" onClick={() => go('today')}>{t('today.backToToday')}</Button>}

        {/* Ration */}
        <a class="sf-card home-card sf-press" href={'#/ration' + (isToday ? '' : '/' + date)}>
          <div class="home-card__main">
            <div class="home-card__top"><Icon name="ration" size={22} /><span class="home-card__big">{sum.groupsDone}<small>/{sum.groupsTotal}</small></span></div>
            <span class="sf-meta">
              {sum.groupsDone === sum.groupsTotal ? t('home.ration.done') : sum.groupsDone || day.food.length ? t('home.ration.left', { n: left.length }) : t('home.ration.empty')}
            </span>
            <div class="home-groups" aria-hidden="true">
              {groups.map((g) => (
                <span class={'home-groups__g' + ((sum.use[g.id] ?? 0) >= 0.95 ? ' is-done' : '') + (sum.over.includes(g.id) ? ' is-over' : '')} style={domainVars(g.palette)}>
                  <span style={`height:${Math.min(100, pct(sum.use[g.id] ?? 0))}%`} />
                  <i>{g.letter}</i>
                </span>
              ))}
            </div>
          </div>
          <Ring value={sum.kcal / plan.kcalTarget} size={96} stroke={9} label={t('home.kcal.aria', { kcal: sum.kcal, target: plan.kcalTarget })}>
            <b>{nf.format(sum.kcal)}</b><span>{t('home.kcal.of', { n: nf.format(plan.kcalTarget) })}</span>
          </Ring>
        </a>
        <div class="home-protein">
          <span class="sf-meta"><Icon name="protein" size={16} /> {t('home.protein', { n: Math.round(sum.protein), target: plan.macros?.protein ?? 0 })}</span>
          <Bar value={plan.macros?.protein ? sum.protein / plan.macros.protein : 0} color="var(--d-relationships)" />
        </div>
        {sum.over.length > 0 && (
          <div class="sf-banner is-warn" role="status"><Icon name="info" />
            <span>{t('home.over', { letters: sum.over.map((id) => groups.find((g) => g.id === id)?.letter).join(', ') })}</span>
          </div>
        )}

        {idea && (
          <a class="sf-card more-card sf-press" href={'#/ration' + (isToday ? '' : '/' + date)} style="text-decoration:none">
            <span class="sf-dchip" style="background:var(--accent-soft);color:var(--accent-ink)"><Icon name="ration" size={22} /></span>
            <span style="flex:1;display:grid;gap:2px;min-width:0">
              <span class="sf-label">{t('ideas.home')}</span>
              <span class="sf-meta">{idea}</span>
            </span>
            <Icon name="chevron-right" size={20} class="sf-row__chev" />
          </a>
        )}

        {/* Steps */}
        <div class="sf-card home-card">
          <div class="home-card__main">
            <div class="home-card__top"><Icon name="steps" size={22} /><span class="home-card__big">{nf.format(steps)}</span></div>
            <span class="sf-meta">{t('home.steps.goal', { n: nf.format(goal) })}</span>
            <div class="home-actions">
              <button type="button" class="sf-chip sf-press" onClick={() => { sound('bloom', Math.min(5, Math.ceil(((steps + 1000) / goal) * 5))); update({ steps: steps + 1000 }); }}>+1 000</button>
              <button type="button" class="sf-chip sf-press" onClick={() => setStepsOpen(true)}><Icon name="pen" size={18} />{t('home.steps.enter')}</button>
            </div>
          </div>
          <Ring value={steps / goal} size={96} stroke={9} label={`${pct(steps / goal)}%`}><b>{pct(steps / goal)}%</b></Ring>
        </div>

        {/* Weight */}
        <a class="sf-card home-card sf-press" href="#/measures">
          <div class="home-card__main">
            <div class="home-card__top"><Icon name="scale" size={22} />
              {stats.last ? <span class="home-card__big">{nf.format(stats.last.weight!)}<small> {t('unit.kg')}</small></span> : <span class="sf-label">{t('home.weight.empty')}</span>}
            </div>
            {stats.delta !== undefined && stats.delta !== 0 && (
              <span class={'home-delta ' + (stats.delta < 0 ? 'is-down' : 'is-up')}>
                {stats.delta < 0 ? '↓' : '↑'} {nf.format(Math.abs(stats.delta))} {t('unit.kg')} <span class="sf-meta">{t('home.weight.since')}</span>
              </span>
            )}
            {measureDue && <span class="sf-meta home-due"><span class="sf-tab__dot" style="position:static" />{t('home.measure.due')}</span>}
          </div>
          <Icon name="chevron-right" size={20} class="sf-row__chev" />
        </a>

        {/* Drinks from the rules */}
        <div class="sf-card drinks">
          <Counter icon="cup" label={t('drinks.cups')} hint={isToday && hour >= 14 ? t('drinks.cups.late') : t('drinks.cups.hint')}
            value={day.cups ?? 0} max={4} step={1} format={(n) => `${n} / 4`}
            onChange={(cups) => update({ cups })} />
          <Counter icon="bottle" label={t('drinks.soda')} hint={t('drinks.soda.hint')}
            value={day.soda ?? 0} max={330} step={110} format={(n) => `${n} ${t('unit.ml')}`}
            onChange={(soda) => update({ soda })} />
        </div>
      </main>
      <TabBar active="today" date={date} dot={{ measures: measureDue }} />

      {profilesOpen && <ProfileSheet onClose={() => setProfilesOpen(false)} />}
      {stepsOpen && <StepsSheet value={day.steps} goal={goal} onSave={(s) => update({ steps: s })} onClose={() => setStepsOpen(false)} />}
    </>
  );
}

function Counter({ icon, label, hint, value, max, step, format, onChange }: {
  icon: string; label: string; hint: string; value: number; max: number; step: number; format: (n: number) => string; onChange: (n: number) => void;
}) {
  const t = useT();
  const over = value > max;
  return (
    <div class="counter">
      <Icon name={icon} size={22} />
      <span class="sf-row__main">
        <span class="sf-row__title">{label}</span>
        <span class={'sf-row__sub' + (over ? ' is-over' : '')}>{over ? t('drinks.over') : hint}</span>
      </span>
      <IconButton icon="minus" label={t('log.less')} tone="sunk" size={20} disabled={value <= 0} onClick={() => { sound('chipOff'); onChange(Math.max(0, value - step)); }} />
      <span class={'counter__v sf-bump' + (over ? ' is-over' : '')} key={value}>{format(value)}</span>
      <IconButton icon="plus" label={t('log.more')} tone="sunk" size={20} onClick={() => { sound(value + step > max ? 'clear' : 'chipOn'); onChange(value + step); }} />
    </div>
  );
}
