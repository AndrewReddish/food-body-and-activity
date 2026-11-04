import type { Dish, DishKind, DishPart, FoodLog, Method, Plan, PlanItem } from './types';
import { fromRaw, groupUse, makeLog, methodsFor } from './cooking';

/**
 * Dish ideas from what's left of today's ration.
 * What's left in each group is split evenly over the meals still to come; a dish fills its parts from
 * that per-meal budget, so logging a suggestion can never take a group over 100%.
 */

const P = (group: string, items: string[], method?: Method, weight?: number): DishPart =>
  ({ group, items, ...(method ? { method } : {}), ...(weight ? { weight } : {}) });
const D = (id: string, nameUk: string, nameEn: string, kind: DishKind, parts: DishPart[]): Dish => ({ id, nameUk, nameEn, kind, parts });

/** Built-in menu: only foods from the coach's plan. The first part of a dish is its base and must be available. */
export const BUILTIN_DISHES: Dish[] = [
  // breakfast
  D('omelet', 'Омлет з овочами', 'Vegetable omelette', 'breakfast',
    [P('b', ['eggs'], 'fried'), P('v', ['veg', 'mushrooms'], 'fried', 0.6), P('g', ['oil'], undefined, 0.5)]),
  D('syrnyky', 'Сирники запечені з ягодами', 'Baked syrnyky with berries', 'breakfast',
    [P('d', ['cottage']), P('a', ['flour', 'grain'], undefined, 0.4), P('e', ['fruit', 'sweet-fruit'], undefined, 0.6)]),
  D('oatmeal', 'Вівсянка на молоці з фруктами й горіхами', 'Oatmeal with milk, fruit and nuts', 'breakfast',
    [P('a', ['grain']), P('d', ['milk', 'kefir'], undefined, 0.5), P('e', ['sweet-fruit', 'fruit'], undefined, 0.7), P('ye', ['nuts', 'seeds'], undefined, 0.6)]),
  D('avocado-toast', 'Тости з авокадо і яйцем', 'Avocado toast with egg', 'breakfast',
    [P('a', ['bread', 'crispbread']), P('g', ['avocado']), P('b', ['eggs'], 'boiled'), P('v', ['veg'], undefined, 0.4)]),
  D('yogurt-bowl', 'Йогуртовий боул з вівсянкою та ягодами', 'Yogurt bowl with oats and berries', 'breakfast',
    [P('d', ['yogurt', 'kefir']), P('a', ['grain'], undefined, 0.5), P('e', ['fruit', 'sweet-fruit']), P('ye', ['seeds', 'nuts'], undefined, 0.6)]),

  // main
  D('bowl-chicken', 'Боул з куркою, рисом і овочами', 'Chicken rice bowl with vegetables', 'main',
    [P('b', ['fillet']), P('a', ['rice', 'grain'], 'boiled'), P('v', ['veg']), P('g', ['avocado', 'oil'], undefined, 0.7)]),
  D('bowl-fish', 'Боул з рибою, крупою та авокадо', 'Fish bowl with grains and avocado', 'main',
    [P('b', ['fish-lean', 'fish-fat'], 'baked'), P('a', ['grain', 'rice'], 'boiled'), P('v', ['veg']), P('g', ['avocado', 'oil'], undefined, 0.7)]),
  D('liver-buckwheat', 'Печінка з цибулею та гречкою', 'Liver with onion and buckwheat', 'main',
    [P('b', ['liver'], 'fried'), P('a', ['grain'], 'boiled'), P('v', ['veg'], 'fried', 0.5), P('g', ['oil'], undefined, 0.6)]),
  D('pasta-chicken', 'Паста з куркою і грибами', 'Pasta with chicken and mushrooms', 'main',
    [P('a', ['pasta'], 'boiled'), P('b', ['fillet'], 'fried'), P('v', ['mushrooms', 'veg'], 'fried'), P('g', ['oil'], undefined, 0.6), P('d', ['sourcream'], undefined, 0.4)]),
  D('potato-fish', 'Запечена картопля з рибою і салатом', 'Baked potato with fish and salad', 'main',
    [P('b', ['fish-lean', 'fish-fat'], 'baked'), P('a', ['potato'], 'baked'), P('v', ['veg']), P('g', ['oil', 'olives'], undefined, 0.6)]),
  D('lavash-roll', 'Лаваш-рол з куркою та овочами', 'Chicken and vegetable wrap', 'main',
    [P('a', ['lavash']), P('b', ['fillet'], 'baked'), P('v', ['veg']), P('g', ['mustard', 'ketchup', 'mayo'], undefined, 0.6)]),
  D('veal-stew', 'Телятина, тушкована з овочами та квасолею', 'Veal stew with vegetables and beans', 'main',
    [P('b', ['veal'], 'boiled'), P('a', ['legumes'], 'boiled'), P('v', ['veg'], 'boiled'), P('g', ['oil'], undefined, 0.5)]),
  D('rice-seafood', 'Рис з морепродуктами та овочами', 'Rice with seafood and vegetables', 'main',
    [P('b', ['seafood'], 'fried'), P('a', ['rice'], 'boiled'), P('v', ['veg'], 'fried'), P('g', ['oil'], undefined, 0.6)]),
  D('potato-mushrooms', 'Смажена картопля з грибами та сметаною', 'Fried potatoes with mushrooms and sour cream', 'main',
    [P('a', ['potato'], 'fried'), P('v', ['mushrooms'], 'fried'), P('g', ['oil'], undefined, 0.8), P('d', ['sourcream'], undefined, 0.4), P('b', ['eggs'], 'fried', 0.5)]),
  D('beans-bowl', 'Бобовий боул з яйцем і авокадо', 'Bean bowl with egg and avocado', 'main',
    [P('a', ['legumes'], 'boiled'), P('b', ['eggs'], 'boiled'), P('v', ['veg']), P('g', ['avocado', 'oil'], undefined, 0.7), P('d', ['sourcream', 'yogurt'], undefined, 0.3)]),
  D('sandwich', 'Сендвіч з куркою та сиром', 'Chicken and cheese sandwich', 'main',
    [P('a', ['bread', 'crispbread']), P('b', ['fillet'], 'baked'), P('d', ['cheese'], undefined, 0.5), P('v', ['veg'], undefined, 0.5), P('g', ['mustard', 'mayo'], undefined, 0.4)]),

  // salads
  D('seafood-salad', 'Салат з морепродуктами та авокадо', 'Seafood and avocado salad', 'salad',
    [P('b', ['seafood'], 'boiled'), P('v', ['veg']), P('g', ['avocado', 'olives']), P('a', ['crispbread', 'bread'], undefined, 0.5)]),
  D('greek-salad', 'Грецький салат з хлібцями', 'Greek salad with crispbread', 'salad',
    [P('v', ['veg']), P('d', ['cheese'], undefined, 0.6), P('g', ['olives', 'oil']), P('a', ['crispbread', 'bread'], undefined, 0.5)]),
  D('chicken-salad', 'Салат з куркою і яйцем', 'Chicken and egg salad', 'salad',
    [P('b', ['fillet', 'eggs'], 'baked'), P('v', ['veg']), P('g', ['mayo', 'oil'], undefined, 0.5), P('a', ['crispbread'], undefined, 0.4)]),

  // dessert & snacks
  D('cottage-berries', 'Десерт із сиру, ягід і горіхів', 'Cottage cheese with berries and nuts', 'dessert',
    [P('d', ['cottage', 'yogurt']), P('e', ['fruit', 'sweet-fruit']), P('ye', ['nuts', 'seeds'])]),
  D('yogurt-fruit', 'Йогурт з фруктами й насінням', 'Yogurt with fruit and seeds', 'dessert',
    [P('d', ['yogurt', 'kefir']), P('e', ['sweet-fruit', 'fruit']), P('ye', ['seeds', 'nuts'])]),
  D('kefir-smoothie', 'Смузі з кефіру та банана', 'Kefir and banana smoothie', 'dessert',
    [P('d', ['kefir', 'milk']), P('e', ['sweet-fruit', 'fruit']), P('zh', ['zh-banana', 'zh-fruit'], undefined, 0.5)]),
  D('fruit-salad', 'Фруктовий салат з йогуртом', 'Fruit salad with yogurt', 'dessert',
    [P('zh', ['zh-fruit', 'zh-banana']), P('e', ['fruit', 'sweet-fruit']), P('d', ['yogurt'], undefined, 0.5)]),
  D('fruit-nuts', 'Фрукти з горіхами', 'Fruit with nuts', 'snack',
    [P('e', ['fruit', 'sweet-fruit']), P('ye', ['nuts', 'seeds'])]),
  D('cheese-plate', 'Сирна тарілка з оливками', 'Cheese plate with olives', 'snack',
    [P('d', ['cheese']), P('g', ['olives']), P('a', ['crispbread'], undefined, 0.5)]),
  D('treat', 'Щось смачненьке', 'A little treat', 'snack',
    [P('zh', ['anything', 'zh-fruit', 'zh-banana'])]),
];

export const isSide = (k: DishKind) => k === 'dessert' || k === 'snack';

/** Meals still to come today, guessed from the time of day. */
export function mealsLeftDefault(hour: number): number {
  if (hour < 11) return 4;
  if (hour < 15) return 3;
  if (hour < 19) return 2;
  return 1;
}

/** What each group can give to one of the remaining meals (share of the group, 0..1). */
export function perMeal(plan: Plan, food: FoodLog[], mealsLeft: number): Record<string, number> {
  const use = groupUse(food);
  const n = Math.max(1, mealsLeft);
  return Object.fromEntries(plan.groups.map((g) => [g.id, Math.max(0, 1 - (use[g.id] ?? 0)) / n]));
}

export interface BuiltPart {
  part: DishPart;
  item: PlanItem;
  method: Method;
  /** A ready-to-save log row (preview id). */
  log: FoodLog;
}

export interface BuiltDish {
  dish: Dish;
  parts: BuiltPart[];
  kcal: number;
  protein: number;
  /** Share of all groups' per-meal budgets this dish uses. */
  used: number;
}

/** Whole grams for small foods, 5 g steps for the rest, whole pieces; always rounded down (never over budget). */
function floorAmount(raw: number, item: PlanItem): number {
  if (item.unit === 'pcs') return Math.floor(raw + 1e-9);
  const step = item.max <= 40 ? 1 : 5;
  return Math.floor(raw / step + 1e-9) * step;
}

const minAmount = (item: PlanItem) => (item.unit === 'pcs' ? 1 : Math.max(3, Math.round(item.max * 0.06)));

/**
 * Fill a dish from `budget` (per-group shares, mutated: what the dish takes is subtracted).
 * Returns undefined when the dish's base part can't be filled.
 */
export function buildDish(dish: Dish, plan: Plan, budget: Record<string, number>, at = ''): BuiltDish | undefined {
  const items = new Map(plan.items.filter((i) => i.active).map((i) => [i.id, i]));
  const groups = new Map(plan.groups.map((g) => [g.id, g]));
  const parts: BuiltPart[] = [];
  const taken: Record<string, number> = {};
  for (const [k, part] of dish.parts.entries()) {
    const group = groups.get(part.group);
    const avail = (budget[part.group] ?? 0) - (taken[part.group] ?? 0);
    let built: BuiltPart | undefined;
    for (const id of part.items) {
      const item = items.get(id);
      if (!group || !item || item.group !== part.group) continue;
      const raw = floorAmount(avail * (part.weight ?? 1) * item.max, item);
      if (raw < minAmount(item)) continue;
      const method = part.method && methodsFor(item.cook).includes(part.method) ? part.method : 'raw';
      // Weighed amount in the cooked state, rounded down so the raw equivalent stays within budget.
      const weighed = method === 'raw' ? raw : Math.floor(fromRaw(raw, item.cook, method));
      built = { part, item, method, log: makeLog(item, group, method, weighed, `${dish.id}-${k}`, at) };
      break;
    }
    if (!built) {
      if (k === 0) return undefined;
      continue;
    }
    taken[part.group] = (taken[part.group] ?? 0) + built.log.frac;
    parts.push(built);
  }
  for (const [g, f] of Object.entries(taken)) budget[g] = Math.max(0, (budget[g] ?? 0) - f);
  return {
    dish, parts,
    kcal: parts.reduce((s, p) => s + p.log.kcal, 0),
    protein: Math.round(parts.reduce((s, p) => s + p.log.protein, 0) * 10) / 10,
    used: parts.reduce((s, p) => s + p.log.frac, 0),
  };
}

export interface MealIdea {
  main: BuiltDish;
  side?: BuiltDish;
  kcal: number;
  protein: number;
}

/** Built-in dishes the user hasn't hidden, plus their own. */
export function dishList(plan: Plan): Dish[] {
  const hidden = new Set(plan.hiddenDishes ?? []);
  return [...BUILTIN_DISHES.filter((d) => !hidden.has(d.id)), ...(plan.dishes ?? [])];
}

/**
 * Up to `count` meal ideas for one of the remaining meals: a main dish that uses as much of the per-meal
 * budget as possible (breakfasts preferred in the morning), plus a dessert or snack from what it leaves.
 * `seed` rotates through the alternatives.
 */
export function suggest(plan: Plan, food: FoodLog[], mealsLeft: number, hour: number, seed = 0, count = 3): MealIdea[] {
  const base = perMeal(plan, food, mealsLeft);
  const total = Object.values(base).reduce((s, v) => s + v, 0);
  if (total < 0.05) return [];
  const all = dishList(plan);
  const morning = hour < 11;

  const rank = (kinds: (k: DishKind) => boolean, budget: Record<string, number>, bias: (d: Dish) => number) =>
    all.filter((d) => kinds(d.kind))
      .flatMap((d) => {
        const b = buildDish(d, plan, { ...budget });
        return b && b.parts.length ? [{ b, score: b.used + bias(d) }] : [];
      })
      .sort((x, y) => y.score - x.score || x.b.dish.id.localeCompare(y.b.dish.id));

  const mains = rank((k) => !isSide(k), base, (d) => (d.kind === 'breakfast' ? (morning ? 0.25 : -0.25) : morning ? -0.1 : 0));
  // Nothing substantial left (only fruit, dairy, nuts…): suggest the snacks themselves.
  const pool = mains.length ? mains : rank(isSide, base, () => 0);
  if (!pool.length) return [];

  const top = pool.slice(0, Math.max(count, 8));
  const picks = Array.from({ length: Math.min(count, top.length) }, (_, i) => top[(seed * count + i) % top.length]);
  const seen = new Set<string>();
  const out: MealIdea[] = [];
  for (const [i, p] of picks.entries()) {
    if (seen.has(p.b.dish.id)) continue;
    seen.add(p.b.dish.id);
    const budget = { ...base };
    const main = buildDish(p.b.dish, plan, budget)!;
    let side: BuiltDish | undefined;
    if (!isSide(main.dish.kind)) {
      const sides = rank(isSide, budget, () => 0).filter((s) => s.b.used >= 0.08);
      if (sides.length) side = buildDish(sides[(seed + i) % Math.min(sides.length, 3)].b.dish, plan, budget);
    }
    out.push({ main, side, kcal: main.kcal + (side?.kcal ?? 0), protein: Math.round((main.protein + (side?.protein ?? 0)) * 10) / 10 });
  }
  return out;
}
