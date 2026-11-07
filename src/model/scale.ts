import type { Plan, PlanGroup, PlanItem } from './types';

/** The calories the coach's group amounts were written for, when a plan doesn't say. */
export const DEFAULT_PLAN_KCAL = 2210;

/** Groups that keep their amounts when the plan is scaled, unless the plan says otherwise: vegetables and nuts. */
const FIXED_BY_DEFAULT = new Set(['v', 'ye']);

export const planKcalOf = (plan: Plan) => plan.planKcal ?? DEFAULT_PLAN_KCAL;
export const isFixed = (g: PlanGroup) => g.fixed ?? FIXED_BY_DEFAULT.has(g.id);

/**
 * How much the scaled groups are multiplied by, so the day matches `kcalTarget` instead of `planKcal`.
 * Fixed groups keep their calories; the rest share what's left in proportion to their own calories.
 * 1 when the goal is the plan's own calories (the plan is used exactly as written).
 */
export function scaleFactor(plan: Plan): number {
  const base = planKcalOf(plan);
  if (!base || !plan.kcalTarget || plan.kcalTarget === base) return 1;
  const total = plan.groups.reduce((s, g) => s + g.kcal, 0);
  const fixed = plan.groups.filter(isFixed).reduce((s, g) => s + g.kcal, 0);
  const scalable = total - fixed;
  if (scalable <= 0) return 1;
  // The groups' own sum may differ from planKcal (the coach's text: 2195 vs 2210); keep that ratio.
  const wanted = (total * plan.kcalTarget) / base;
  return Math.max(0, (wanted - fixed) / scalable);
}

/** A scaled amount, rounded the way people weigh: halves for pieces, 1 g below 40 g, else 5 g. */
export function roundMax(v: number, unit: PlanItem['unit']): number {
  if (unit === 'pcs') return Math.max(0.5, Math.round(v * 2) / 2);
  if (v < 40) return Math.max(1, Math.round(v));
  return Math.round(v / 5) * 5;
}

/**
 * The plan as this person eats it: group calories, 100% amounts and protein at 100% scaled to their
 * calorie goal. The stored plan stays the coach's original; only what the screens use is scaled.
 * Logged days are unaffected: each log keeps its own share, kcal and protein.
 */
export function scalePlan(plan: Plan): Plan {
  const k = scaleFactor(plan);
  if (k === 1) return plan;
  const fixed = new Set(plan.groups.filter(isFixed).map((g) => g.id));
  const groups = plan.groups.map((g) => (fixed.has(g.id) ? g : { ...g, kcal: Math.round(g.kcal * k) }));
  const items = plan.items.map((i) => {
    if (fixed.has(i.group)) return i;
    const max = roundMax(i.max * k, i.unit);
    return { ...i, max, protein: Math.round((i.protein * max) / i.max * 10) / 10 };
  });
  return { ...plan, groups, items };
}
