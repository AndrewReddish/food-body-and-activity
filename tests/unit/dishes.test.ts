import { describe, expect, it } from 'vitest';
import { BUILTIN_DISHES, buildDish, dishList, mealsLeftDefault, perMeal, suggest } from '../../src/model/dishes';
import { groupUse, remainingWeighed, roundAmount } from '../../src/model/cooking';
import { DishSchema, PlanSchema } from '../../src/model/schema';
import { item, log, plan } from './fixtures';

describe('remaining amounts within a group', () => {
  it('drinking half the milk halves what is left of every other dairy food', () => {
    const used = groupUse([log('milk', 317.5)]).d;
    expect(used).toBeCloseTo(0.5, 6);
    expect(roundAmount(remainingWeighed(item('kefir'), 'raw', used), 'g')).toBe(315);
    expect(roundAmount(remainingWeighed(item('cottage'), 'raw', used), 'g')).toBe(163);
    expect(roundAmount(remainingWeighed(item('cheese'), 'raw', used), 'g')).toBe(38);
  });
});

describe('dish ideas', () => {
  it('built-in dishes are valid and only use foods from the plan, in the right groups', () => {
    for (const d of BUILTIN_DISHES) {
      DishSchema.parse(d);
      for (const p of d.parts) for (const id of p.items) expect(item(id)?.group, `${d.id}: ${id}`).toBe(p.group);
    }
    expect(new Set(BUILTIN_DISHES.map((d) => d.id)).size).toBe(BUILTIN_DISHES.length);
  });

  it('plans with and without custom dishes parse', () => {
    expect(PlanSchema.safeParse(plan).success).toBe(true);
    const custom = { ...plan, dishes: [{ id: 'my-bowl', nameUk: 'Мій боул', nameEn: 'My bowl', kind: 'main', parts: [{ group: 'b', items: ['veal'] }] }], hiddenDishes: ['treat'] };
    expect(PlanSchema.parse(custom).dishes).toHaveLength(1);
    expect(dishList(PlanSchema.parse(custom)).some((d) => d.id === 'treat')).toBe(false);
  });

  it('splits what is left evenly over the meals to come', () => {
    const m = perMeal(plan, [log('veal', 152)], 2);
    expect(m.b).toBeCloseTo(0.25, 6);
    expect(m.a).toBeCloseTo(0.5, 6);
    expect(mealsLeftDefault(8)).toBe(4);
    expect(mealsLeftDefault(21)).toBe(1);
  });

  it('computes grams from the budget, in the cooked state when the dish is cooked', () => {
    const bowl = BUILTIN_DISHES.find((d) => d.id === 'bowl-chicken')!;
    const b = buildDish(bowl, plan, perMeal(plan, [], 2))!;
    const rice = b.parts.find((p) => p.item.id === 'rice')!;
    expect(rice.method).toBe('boiled');
    expect(rice.log.raw).toBeLessThanOrEqual(40);
    expect(rice.log.weighed).toBe(Math.floor(40 * 2.7));
    expect(b.parts.find((p) => p.item.id === 'fillet')!.log.raw).toBe(235);
  });

  it('falls back to the next food when the first is too small (eggs → fillet)', () => {
    const salad = BUILTIN_DISHES.find((d) => d.id === 'chicken-salad')!;
    const b = buildDish({ ...salad, parts: [{ group: 'b', items: ['eggs', 'fillet'] }] }, plan, { b: 0.1 })!;
    expect(b.parts[0].item.id).toBe('fillet');
  });

  it('skips exhausted groups and never suggests a dish whose base is used up', () => {
    const food = [log('fillet', 475), log('veal', 0.1)];
    for (const idea of suggest(plan, food, 1, 13)) {
      for (const d of [idea.main, idea.side]) if (d) expect(d.parts.every((p) => p.part.group !== 'b')).toBe(true);
    }
  });

  it('logging any suggestion never takes a group over 100%', () => {
    const states = [[], [log('milk', 317.5)], [log('veal', 200, 'fried'), log('rice', 216, 'boiled')], [log('oil', 19), log('fruit', 450)]];
    for (const food of states) for (const meals of [1, 2, 3, 4]) for (const seed of [0, 1, 2]) {
      const ideas = suggest(plan, food, meals, 13, seed);
      expect(ideas.length).toBeGreaterThan(0);
      for (const idea of ideas) {
        const logs = [...idea.main.parts, ...(idea.side?.parts ?? [])].map((p) => p.log);
        const use = groupUse([...food, ...logs]);
        for (const g of plan.groups) expect(use[g.id] ?? 0).toBeLessThanOrEqual(Math.max(1, groupUse(food)[g.id] ?? 0) + 1e-3);
      }
    }
  });

  it('one meal left uses up (almost) everything that remains', () => {
    const [idea] = suggest(plan, [log('veal', 152)], 1, 20);
    const b = idea.main.parts.find((p) => p.part.group === 'b');
    expect(b && b.log.frac).toBeGreaterThan(0.45);
  });

  it('offers a dessert alongside a main when dairy/fruit is left', () => {
    const ideas = suggest(plan, [], 3, 13);
    expect(ideas.some((i) => i.side && ['dessert', 'snack'].includes(i.side.dish.kind))).toBe(true);
    expect(new Set(suggest(plan, [], 3, 13, 1).map((i) => i.main.dish.id))).not.toEqual(new Set(ideas.map((i) => i.main.dish.id)));
  });
});
