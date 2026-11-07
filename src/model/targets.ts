import type { Plan } from './types';

/**
 * Daily targets from body data and a weight goal.
 *
 * - Resting energy (BMR): Mifflin–St Jeor (1990), the equation the Academy of Nutrition and Dietetics
 *   found most accurate for healthy and obese adults:
 *   10·kg + 6.25·cm − 5·age + 5 (men) / −161 (women).
 * - Daily expenditure (TDEE): BMR × physical-activity factor (1.2 / 1.375 / 1.55 / 1.725).
 * - Goal: lose = TDEE − deficit % (default 20%, i.e. ~0.5–0.8 kg a week), never below BMR or the minimum
 *   for the sex (1200 / 1500 kcal); maintain = TDEE; gain = TDEE + surplus % (default 10%).
 * - Protein: g per kg (default 1.8 when losing or gaining, 1.4 maintaining: ISSN / PROT-AGE ranges, higher
 *   for older adults). Above BMI 25 it is per kg of the weight at BMI 25, so obesity doesn't inflate it.
 * - Fat: % of calories (default 25%); carbs: the rest.
 *
 * Every number is a coefficient in `Formula`, which the owner can change in the `formula` table.
 */
export const GOALS = ['lose', 'maintain', 'gain'] as const;
export type WeightGoal = (typeof GOALS)[number];
export const ACTIVITIES = ['sedentary', 'light', 'moderate', 'active'] as const;
export type Activity = (typeof ACTIVITIES)[number];

export interface Formula {
  deficitPct: number;
  surplusPct: number;
  proteinLose: number;
  proteinMaintain: number;
  proteinGain: number;
  /** Protein is per kg of the weight at this BMI when the person's BMI is higher. */
  proteinBmiCap: number;
  fatPct: number;
  stepsLose: number;
  stepsMaintain: number;
  stepsGain: number;
  minKcalFemale: number;
  minKcalMale: number;
  /** Losing never goes below the resting energy (BMR). */
  floorBmr: boolean;
  actSedentary: number;
  actLight: number;
  actModerate: number;
  actActive: number;
}

export const DEFAULT_FORMULA: Formula = {
  deficitPct: 20,
  surplusPct: 10,
  proteinLose: 1.8,
  proteinMaintain: 1.4,
  proteinGain: 1.8,
  proteinBmiCap: 25,
  fatPct: 25,
  stepsLose: 7000,
  stepsMaintain: 7000,
  stepsGain: 6000,
  minKcalFemale: 1200,
  minKcalMale: 1500,
  floorBmr: true,
  actSedentary: 1.2,
  actLight: 1.375,
  actModerate: 1.55,
  actActive: 1.725,
};

/** Fill gaps and drop nonsense from a formula row (the owner edits it by hand). */
export function cleanFormula(raw: Partial<Record<keyof Formula, unknown>> | undefined): Formula {
  const out = { ...DEFAULT_FORMULA };
  for (const k of Object.keys(DEFAULT_FORMULA) as (keyof Formula)[]) {
    const v = raw?.[k];
    if (k === 'floorBmr') { if (typeof v === 'boolean') out.floorBmr = v; continue; }
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) (out as Record<string, number | boolean>)[k] = n;
  }
  return out;
}

export type Body = NonNullable<Plan['body']>;

export interface Targets {
  age: number;
  weight: number;
  bmi: number;
  bmr: number;
  tdee: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  steps: number;
}

export type Missing = 'sex' | 'birthYear' | 'height' | 'weight';

const round = (v: number, to: number) => Math.round(v / to) * to;

/** Targets for a body, or the fields still missing. `weight` is the latest measured one, if any. */
export function computeTargets(body: Body, weight: number | undefined, f: Formula, year = new Date().getFullYear()):
  { ok: true; targets: Targets } | { ok: false; missing: Missing[] } {
  const w = weight ?? body.weight;
  const missing: Missing[] = [];
  if (!body.sex) missing.push('sex');
  if (!body.birthYear) missing.push('birthYear');
  if (!body.height) missing.push('height');
  if (!w) missing.push('weight');
  if (missing.length || !body.sex || !body.birthYear || !body.height || !w) return { ok: false, missing };

  const goal = body.goal ?? 'lose';
  const age = year - body.birthYear;
  const m = body.height / 100;
  const bmi = w / (m * m);
  const bmr = 10 * w + 6.25 * body.height - 5 * age + (body.sex === 'm' ? 5 : -161);
  const act = { sedentary: f.actSedentary, light: f.actLight, moderate: f.actModerate, active: f.actActive }[body.activity ?? 'light'];
  const tdee = bmr * act;

  let kcal = goal === 'lose' ? tdee * (1 - f.deficitPct / 100) : goal === 'gain' ? tdee * (1 + f.surplusPct / 100) : tdee;
  if (goal === 'lose') kcal = Math.max(kcal, body.sex === 'm' ? f.minKcalMale : f.minKcalFemale, f.floorBmr ? bmr : 0);
  kcal = round(kcal + (body.kcalAdjust ?? 0), 10);

  const refWeight = Math.min(w, f.proteinBmiCap * m * m);
  const perKg = body.proteinPerKg ?? (goal === 'lose' ? f.proteinLose : goal === 'gain' ? f.proteinGain : f.proteinMaintain);
  const protein = round(refWeight * perKg, 5);
  const fat = Math.round((kcal * f.fatPct) / 100 / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const steps = goal === 'lose' ? f.stepsLose : goal === 'gain' ? f.stepsGain : f.stepsMaintain;

  return { ok: true, targets: { age, weight: w, bmi: Math.round(bmi * 10) / 10, bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, fat, carbs, steps } };
}

/**
 * The plan with its goals set from the body, when the person is on automatic targets.
 * Returns the same object when nothing changes, so callers can skip a save.
 */
export function applyTargets(plan: Plan, weight: number | undefined, f: Formula, now: string, year?: number): Plan {
  if (!plan.body?.auto) return plan;
  const r = computeTargets(plan.body, weight, f, year);
  if (!r.ok) return plan;
  const t = r.targets;
  const m = plan.macros;
  if (plan.kcalTarget === t.kcal && plan.stepsGoal === t.steps && m?.protein === t.protein && m.fat === t.fat && m.carbs === t.carbs) return plan;
  return { ...plan, kcalTarget: t.kcal, stepsGoal: t.steps, macros: { protein: t.protein, fat: t.fat, carbs: t.carbs }, goalsUpdatedAt: now };
}
