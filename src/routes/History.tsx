import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLang, useT, locale, type Lang } from '../i18n/t';
import { addDays, capFirst, fromDateKey, todayKey } from '../lib/dates';
import { usePlan } from '../lib/usePlan';
import { go } from '../lib/router';
import { db, daysBetween } from '../storage/db';
import type { DayLog } from '../model/types';
import { allGroups, dayStat, kcalOk, periodStats, proteinOk, type DayStat } from '../model/history';
import { Icon, IconButton, Segmented, TabBar } from '../components/ui';
import { Bar } from '../components/food';

type Period = '7' | '30' | '90';

/** Food history: calories, protein and groups per day against that day's goals, with period averages. */
export function History() {
  const t = useT();
  const lang = useLang();
  const { plan } = usePlan();
  const today = todayKey();
  const [period, setPeriod] = useState<Period>('7');
  const [days, setDays] = useState<DayLog[] | null>(null);

  useEffect(() => {
    const load = () => void daysBetween(addDays(today, -89), today, db).then(setDays);
    load();
    window.addEventListener('tilo:synced', load);
    return () => window.removeEventListener('tilo:synced', load);
  }, [today]);

  const n = +period;
  const from = addDays(today, -(n - 1));
  const stats = useMemo(
    () => (days ?? []).filter((d) => d.date >= from && d.food.length > 0).map((d) => dayStat(d, plan)).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [days, from, plan],
  );
  // Today is still going: it's in the chart and the list, not in the averages.
  const sum = periodStats(stats.filter((d) => d.date !== today));
  const todayOnly = !sum && stats.length > 0;
  const nf = new Intl.NumberFormat(locale(lang));

  return (
    <>
      <main class="screen">
        <header class="screen__head">
          <div class="screen__row" style="align-items:center;margin-bottom:-8px">
            <IconButton icon="chevron-left" label={t('history.back')} onClick={() => go('ration')} style="margin:-10px 0 -10px -10px" />
          </div>
          <h1 class="sf-title">{t('history.title')}</h1>
        </header>

        <Segmented<Period> label={t('history.period')} value={period} onChange={setPeriod}
          options={[{ value: '7', label: t('history.p7') }, { value: '30', label: t('history.p30') }, { value: '90', label: t('history.p90') }]} />

        {days && !sum && !todayOnly && (
          <div class="sf-card hist-empty">
            <Icon name="ration" size={28} />
            <p class="sf-meta">{t('history.empty')}</p>
          </div>
        )}

        {sum && (<>
          <div class="ration-sum sf-card">
            <div><b>{nf.format(sum.avgKcal)}</b><span>{t('history.avgKcal', { n: nf.format(sum.avgKcalTarget) })}</span></div>
            <div><b>{sum.avgProtein}</b><span>{t('history.avgProtein', { n: sum.avgProteinTarget })}</span></div>
            <div><b>{nf.format(sum.avgGroups)}</b><span>{t('history.avgGroups', { n: sum.groupsTotal })}</span></div>
          </div>

          <div class="sf-list">
            <HitRow icon="flame" label={t('history.kcalOk')} hits={sum.kcalOkDays} of={sum.days} />
            <HitRow icon="protein" label={t('history.proteinOk')} hits={sum.proteinOkDays} of={sum.days} />
            <HitRow icon="check" label={t('history.allGroups')} hits={sum.allGroupsDays} of={sum.days} />
          </div>
          <p class="sf-meta" style="padding:0 4px;margin-top:-6px">{t('history.note', { n: sum.days })}</p>
        </>)}

        {stats.length > 0 && (<>
          {n <= 30 && <KcalChart stats={stats} from={from} days={n} lang={lang} />}
          <h2 class="sf-section">{t('history.days')}</h2>
          <div class="sf-list">
            {stats.map((d) => <DayRow d={d} lang={lang} today={today} />)}
          </div>
        </>)}
      </main>
      <TabBar active="ration" />
    </>
  );
}

function HitRow({ icon, label, hits, of }: { icon: string; label: string; hits: number; of: number }) {
  const t = useT();
  return (
    <div class="sf-row">
      <Icon name={icon} size={22} />
      <span class="sf-row__main">
        <span class="sf-row__title">{label}</span>
        <Bar value={of ? hits / of : 0} />
      </span>
      <b class="hist-hits">{t('history.hits', { n: hits, of })}</b>
    </div>
  );
}

/** Calories per day against that day's goal (dashed tick on each bar). */
function KcalChart({ stats, from, days, lang }: { stats: DayStat[]; from: string; days: number; lang: Lang }) {
  const t = useT();
  const byDate = new Map(stats.map((d) => [d.date, d]));
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const top = Math.max(1, ...stats.map((d) => Math.max(d.kcal, d.target.kcal))) * 1.12;
  const wd = new Intl.DateTimeFormat(locale(lang), days <= 7 ? { weekday: 'short' } : { day: 'numeric' });
  return (
    <div class="sf-card hist-chart">
      <h2 class="sf-label">{t('history.chart')}</h2>
      <div class="bars hist-bars" role="img" aria-label={t('history.chart')} style={`grid-template-columns:repeat(${days}, minmax(0, 1fr));gap:${days <= 7 ? 8 : 2}px`}>
        {dates.map((date, i) => {
          const d = byDate.get(date);
          const over = d && !kcalOk(d);
          const label = days <= 7 || i % 5 === 0 || i === days - 1;
          return (
            <button type="button" class={'bars__col' + (over ? ' is-over' : d ? ' is-goal' : '')} onClick={() => go('ration/' + date)}
              aria-label={d ? `${date}: ${d.kcal} / ${d.target.kcal}` : date}>
              {d && <span class="hist-bars__target" style={`bottom:${(d.target.kcal / top) * 100}%`} />}
              <span class="bars__bar" style={`height:${d ? (d.kcal / top) * 100 : 0}%`} />
              {label && <span class="bars__lbl">{wd.format(fromDateKey(date)).replace('.', '')}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayRow({ d, lang, today }: { d: DayStat; lang: Lang; today: string }) {
  const t = useT();
  const nf = new Intl.NumberFormat(locale(lang));
  const title = d.date === today ? t('history.today')
    : capFirst(new Intl.DateTimeFormat(locale(lang), { weekday: 'short', day: 'numeric', month: 'short' }).format(fromDateKey(d.date)));
  return (
    <button type="button" class="sf-row hist-day" onClick={() => go(d.date === today ? 'ration' : 'ration/' + d.date)}>
      <span class="sf-row__main">
        <span class="sf-row__title">{title}</span>
        <span class="hist-day__nums">
          <span class={kcalOk(d) ? '' : 'is-over'}><Icon name="flame" size={14} />{nf.format(d.kcal)} / {nf.format(d.target.kcal)}</span>
          <span class={proteinOk(d) ? '' : 'is-low'}><Icon name="protein" size={14} />{Math.round(d.protein)} / {d.target.protein} {t('unit.g')}</span>
          <span class={allGroups(d) ? 'is-done' : ''}><Icon name="ration" size={14} />{d.groupsDone}/{d.groupsTotal}</span>
        </span>
      </span>
      <Icon name="chevron-right" size={20} class="sf-row__chev" />
    </button>
  );
}
