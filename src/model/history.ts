import type { DateKey, DayLog, Plan } from './types';
import { summarize } from './cooking';

/** One day for the food history: what was eaten against the goals that applied that day. */
export interface DayStat {
  date: DateKey;
  kcal: number;
  protein: number;
  groupsDone: number;
  groupsTotal: number;
  steps?: number;
  target: { kcal: number; protein: number; steps: number };
}

export function dayStat(day: DayLog, plan: Plan): DayStat {
  const s = summarize(day, plan);
  const target = day.targets ?? { kcal: plan.kcalTarget, protein: Math.round(plan.macros?.protein ?? 0), steps: plan.stepsGoal };
  return { date: day.date, kcal: s.kcal, protein: s.protein, groupsDone: s.groupsDone, groupsTotal: s.groupsTotal, steps: day.steps, target };
}

/** Within the calorie goal: up to 5% over counts (scale noise, rounding of portions). */
export const KCAL_OK = 1.05;
/** Protein goal met at 90%. */
export const PROTEIN_OK = 0.9;

export const kcalOk = (d: DayStat) => d.target.kcal > 0 && d.kcal <= d.target.kcal * KCAL_OK;
export const proteinOk = (d: DayStat) => d.target.protein > 0 && d.protein >= d.target.protein * PROTEIN_OK;
export const allGroups = (d: DayStat) => d.groupsTotal > 0 && d.groupsDone === d.groupsTotal;

export interface PeriodStats {
  /** Days with any food logged — the averages are over these only (an empty day isn't a 0-kcal day). */
  days: number;
  avgKcal: number;
  avgKcalTarget: number;
  avgProtein: number;
  avgProteinTarget: number;
  avgGroups: number;
  groupsTotal: number;
  kcalOkDays: number;
  proteinOkDays: number;
  allGroupsDays: number;
}

export function periodStats(stats: DayStat[]): PeriodStats | undefined {
  const logged = stats.filter((d) => d.kcal > 0);
  const n = logged.length;
  if (!n) return undefined;
  const avg = (f: (d: DayStat) => number) => logged.reduce((s, d) => s + f(d), 0) / n;
  return {
    days: n,
    avgKcal: Math.round(avg((d) => d.kcal)),
    avgKcalTarget: Math.round(avg((d) => d.target.kcal)),
    avgProtein: Math.round(avg((d) => d.protein)),
    avgProteinTarget: Math.round(avg((d) => d.target.protein)),
    avgGroups: Math.round(avg((d) => d.groupsDone) * 10) / 10,
    groupsTotal: logged[0].groupsTotal,
    kcalOkDays: logged.filter(kcalOk).length,
    proteinOkDays: logged.filter(proteinOk).length,
    allGroupsDays: logged.filter(allGroups).length,
  };
}
