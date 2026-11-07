import { useEffect, useState } from 'preact/hooks';
import type { DateKey } from '../model/types';
import { useLang, useT, locale } from '../i18n/t';
import { addDays, capFirst, fromDateKey, todayKey } from '../lib/dates';
import { useDay } from '../lib/useDay';
import { usePlan } from '../lib/usePlan';
import { go } from '../lib/router';
import { sound } from '../lib/sound';
import { daysBetween } from '../storage/db';
import { Burst, Button, Icon, IconButton, Sheet, TabBar } from '../components/ui';
import { DayStrip, Ring, pct } from '../components/food';

export function Steps({ date: dateParam }: { date?: DateKey }) {
  const t = useT();
  const lang = useLang();
  const today = todayKey();
  const date = dateParam && dateParam <= today ? dateParam : today;
  const { day, update } = useDay(date);
  const { plan } = usePlan();
  const goal = plan.stepsGoal || 7000;
  const [hist, setHist] = useState<Map<string, number>>(new Map());
  const [text, setText] = useState('');
  const [pulse, setPulse] = useState(0);
  const nf = new Intl.NumberFormat(locale(lang));
  const steps = day.steps ?? 0;

  useEffect(() => setText(day.steps !== undefined ? String(day.steps) : ''), [date, day.steps]);
  useEffect(() => {
    void daysBetween(addDays(today, -29), today).then((rows) => setHist(new Map(rows.flatMap((r) => (r.steps !== undefined ? [[r.date, r.steps]] : [])))));
  }, [today, steps]);

  const set = (n: number) => {
    const v = Math.max(0, Math.min(200000, Math.round(n)));
    if (steps < goal && v >= goal) { sound('saved'); setPulse((p) => p + 1); } else sound('tick', 4);
    update({ steps: v });
  };

  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const logged = [...hist.entries()].map(([d, s]) => (d === date ? steps : s));
  const avg = logged.length ? Math.round(logged.reduce((a, b) => a + b, 0) / logged.length) : 0;
  // Headroom above the tallest bar or the goal line, so the goal label sits inside the chart.
  const top = Math.max(goal, ...week.map((d) => (d === date ? steps : hist.get(d) ?? 0))) * 1.18;
  const wd = new Intl.DateTimeFormat(locale(lang), { weekday: 'short' });

  return (
    <>
      <main class="screen">
        <header class="screen__head">
          <div class="screen__sub">{capFirst(new Intl.DateTimeFormat(locale(lang), { weekday: 'long', day: 'numeric', month: 'long' }).format(fromDateKey(date)))}</div>
          <h1 class="sf-title">{t('tab.steps')}</h1>
        </header>
        <DayStrip days={week.map((d) => ({ date: d, value: (d === date ? steps : hist.get(d) ?? 0) / goal }))} today={today} selected={date}
          onSelect={(d) => go(d === today ? 'steps' : 'steps/' + d)} />

        <div class="sf-card steps-hero">
          <div style="position:relative">
            <Ring value={steps / goal} size={168} stroke={14} label={`${pct(steps / goal)}%`}>
              <b class="sf-bump" key={steps}>{nf.format(steps)}</b>
              <span>{t('steps.of', { n: nf.format(goal) })}</span>
            </Ring>
            {pulse > 0 && <span key={pulse} style="position:absolute;inset:0;display:grid;place-items:center;pointer-events:none"><Burst count={10} distance={90} /></span>}
          </div>
          <p class="sf-meta">{steps >= goal ? t('steps.done') : t('steps.left', { n: nf.format(goal - steps) })}</p>
          <div class="log-amount__row" style="width:100%">
            <IconButton icon="minus" label="-1000" tone="sunk" onClick={() => set(steps - 1000)} />
            <input class="sf-input sf-input--ui log-amount__input" inputMode="numeric" enterKeyHint="done" placeholder="0" aria-label={t('steps.input')} value={text}
              onInput={(e) => setText((e.currentTarget as HTMLInputElement).value.replace(/\D/g, ''))}
              onBlur={() => text !== '' && +text !== steps && set(+text)}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
            <IconButton icon="plus" label="+1000" tone="sunk" onClick={() => set(steps + 1000)} />
          </div>
          <p class="sf-meta" style="text-align:center">{t('steps.hint')}</p>
        </div>

        <div class="sf-card steps-week">
          <div class="screen__row"><h2 class="sf-label">{t('steps.week')}</h2><span class="sf-meta">{avg ? t('steps.avg', { n: nf.format(avg) }) : ''}</span></div>
          <div class="bars" role="img" aria-label={t('steps.week')}>
            <span class="bars__goal" style={`bottom:${(goal / top) * 100}%`}><i>{t('steps.goalLine', { n: nf.format(goal) })}</i></span>
            {week.map((d) => {
              const v = d === date ? steps : hist.get(d) ?? 0;
              return (
                <button type="button" class={'bars__col' + (d === date ? ' is-on' : '') + (v >= goal ? ' is-goal' : '')} onClick={() => go(d === today ? 'steps' : 'steps/' + d)}
                  aria-label={`${d}: ${nf.format(v)}`}>
                  <span class="bars__bar" style={`height:${(v / top) * 100}%`} />
                  <span class="bars__lbl">{wd.format(fromDateKey(d)).replace('.', '')}</span>
                </button>
              );
            })}
          </div>
        </div>
      </main>
      <TabBar active="steps" date={date} />
    </>
  );
}

/** Quick entry from Home. */
export function StepsSheet({ value, goal, onSave, onClose }: { value?: number; goal: number; onSave: (n: number) => void; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState(value !== undefined ? String(value) : '');
  return (
    <Sheet onClose={onClose} labelledBy="steps-title">
      {(close) => (<>
        <div class="sf-sheet__head">
          <span class="sf-dchip sf-dchip--lg" style="background:var(--accent-soft);color:var(--accent-ink)"><Icon name="steps" size={22} /></span>
          <h2 class="sf-h2" id="steps-title" style="flex:1">{t('steps.input')}</h2>
          <IconButton icon="close" label={t('common.close')} tone="sunk" size={22} onClick={close} />
        </div>
        <input class="sf-input sf-input--ui log-amount__input" inputMode="numeric" enterKeyHint="done" autoFocus placeholder="0" aria-label={t('steps.input')} value={text}
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value.replace(/\D/g, ''))} />
        <p class="sf-meta">{t('steps.hint')}</p>
        <Button block icon="check" disabled={text === ''} onClick={() => { const n = +text; sound(n >= goal ? 'saved' : 'chipOn'); onSave(n); close(); }}>{t('common.save')}</Button>
      </>)}
    </Sheet>
  );
}
