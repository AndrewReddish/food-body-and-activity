import type { CookType, DayLog, FoodLog, Method, Plan, PlanGroup, PlanItem } from './types';

/**
 * Raw ↔ cooked weight.
 * The plan counts RAW weight ("Їжа важиться сирою"). When food is weighed after cooking,
 * we divide by the yield (cooked weight ÷ raw weight) for that food type and method.
 *   meat loses water:   200 g fried veal  / 0.70 ≈ 286 g raw
 *   grains soak water:  200 g boiled rice / 2.7  ≈  74 g raw
 * Values are typical yields from cooking-loss tables (USDA retention / Ukrainian кулінарні
 * норми втрат), rounded; they are estimates, not lab numbers.
 */
export const YIELDS: Record<CookType, Partial<Record<Method, number>>> = {
  none: {},
  eggs: { boiled: 1, fried: 1 }, // counted in pieces; frying only matters for the oil
  meat: { boiled: 0.65, baked: 0.7, fried: 0.7 },
  poultry: { boiled: 0.75, baked: 0.72, fried: 0.75 },
  offal: { boiled: 0.8, baked: 0.75, fried: 0.78 },
  fish: { boiled: 0.85, baked: 0.8, fried: 0.8 },
  seafood: { boiled: 0.75, baked: 0.75, fried: 0.75 },
  rice: { boiled: 2.7 },
  grain: { boiled: 2.5 },
  pasta: { boiled: 2.3 },
  legumes: { boiled: 2.4 },
  potato: { boiled: 0.98, baked: 0.75, fried: 0.65 },
  vegetables: { boiled: 0.9, baked: 0.75, fried: 0.8 },
  mushrooms: { boiled: 0.6, baked: 0.55, fried: 0.55 },
};

/** Methods a food type can be weighed in; raw is always first. */
export function methodsFor(cook: CookType): Method[] {
  return ['raw', ...(Object.keys(YIELDS[cook]) as Method[])];
}

/** cooked weight ÷ raw weight (1 for raw or for foods that don't change). */
export function yieldOf(cook: CookType, method: Method): number {
  if (method === 'raw') return 1;
  return YIELDS[cook][method] ?? 1;
}

export const toRaw = (weighed: number, cook: CookType, method: Method) => weighed / yieldOf(cook, method);
export const fromRaw = (raw: number, cook: CookType, method: Method) => raw * yieldOf(cook, method);

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Share of the group used by this item at this raw amount. */
export const fracOf = (item: PlanItem, raw: number) => raw / item.max;

/** Build one log row. kcal is the group's kcal × share; protein scales from the item's protein at max. */
export function makeLog(
  item: PlanItem, group: PlanGroup, method: Method, weighed: number, id: string, at: string,
): FoodLog {
  const raw = toRaw(weighed, item.cook, method);
  const frac = fracOf(item, raw);
  return {
    id, item: item.id, group: group.id, method,
    weighed: round1(weighed),
    raw: round1(raw),
    frac: Math.round(frac * 10000) / 10000,
    kcal: Math.round(group.kcal * frac),
    protein: round1(item.protein * frac),
    at,
  };
}

/** Sum of shares per group, e.g. { b: 0.94 } — over 1 means the plan was exceeded. */
export function groupUse(food: FoodLog[], exceptId?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of food) if (f.id !== exceptId) out[f.group] = (out[f.group] ?? 0) + f.frac;
  return out;
}

/** A group counts as done at ≥ 95% — the last few grams are scale noise. */
export const DONE_AT = 0.95;

export interface DaySummary {
  kcal: number;
  protein: number;
  groupsDone: number;
  groupsTotal: number;
  over: string[]; // group ids above 100%
  use: Record<string, number>;
}

export function summarize(day: Pick<DayLog, 'food'> | undefined, plan: Plan): DaySummary {
  const food = day?.food ?? [];
  const use = groupUse(food);
  const groups = plan.groups;
  return {
    kcal: food.reduce((s, f) => s + f.kcal, 0),
    protein: round1(food.reduce((s, f) => s + f.protein, 0)),
    groupsDone: groups.filter((g) => (use[g.id] ?? 0) >= DONE_AT).length,
    groupsTotal: groups.length,
    over: groups.filter((g) => (use[g.id] ?? 0) > 1.005).map((g) => g.id),
    use,
  };
}

/**
 * Most the user may still log of `item` in this method without going over the group:
 * remaining share × max, converted to the weighed state.
 */
export function remainingWeighed(item: PlanItem, method: Method, usedFrac: number): number {
  const leftRaw = Math.max(0, 1 - usedFrac) * item.max;
  return fromRaw(leftRaw, item.cook, method);
}

/** Round a weight for display: whole grams, or halves for pieces. */
export function roundAmount(n: number, unit: PlanItem['unit']): number {
  return unit === 'pcs' ? Math.round(n * 2) / 2 : Math.round(n);
}
