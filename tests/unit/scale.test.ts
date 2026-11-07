import { describe, expect, it } from 'vitest';
import { defaultPlan } from '../../src/model/defaults';
import { roundMax, scaleFactor, scalePlan } from '../../src/model/scale';
import type { Plan } from '../../src/model/types';

const withGoal = (kcalTarget: number, patch: Partial<Plan> = {}): Plan => ({ ...defaultPlan(), kcalTarget, ...patch });
const item = (p: Plan, id: string) => p.items.find((i) => i.id === id)!;
const group = (p: Plan, id: string) => p.groups.find((g) => g.id === id)!;

describe('scalePlan', () => {
  it('leaves the coach plan untouched at its own calories', () => {
    const p = withGoal(2210);
    expect(scaleFactor(p)).toBe(1);
    expect(scalePlan(p)).toBe(p);
  });

  it('treats a stored plan without planKcal as written for 2210', () => {
    const { planKcal: _, ...old } = withGoal(2210);
    expect(scalePlan(old as Plan)).toEqual(old);
  });

  it('scales groups to the goal, keeping vegetables and nuts', () => {
    const p = scalePlan(withGoal(1650));
    const total = p.groups.reduce((s, g) => s + g.kcal, 0);
    expect(Math.abs(total - (2195 * 1650) / 2210)).toBeLessThan(5);
    expect(group(p, 'v').kcal).toBe(120);
    expect(item(p, 'veg').max).toBe(600);
    expect(item(p, 'nuts').max).toBe(20);
    expect(item(p, 'fillet').max).toBe(340);
    expect(item(p, 'eggs').max).toBe(5);
    expect(item(p, 'oil').max).toBe(14);
  });

  it('scales protein with the amount', () => {
    const base = defaultPlan();
    const p = scalePlan(withGoal(1650));
    const f = item(p, 'fillet');
    expect(f.protein).toBeCloseTo((item(base, 'fillet').protein * f.max) / item(base, 'fillet').max, 1);
  });

  it('honours a group switched to fixed or to scaled', () => {
    const base = withGoal(1650);
    const p = scalePlan({ ...base, groups: base.groups.map((g) => (g.id === 'b' ? { ...g, fixed: true } : g.id === 'v' ? { ...g, fixed: false } : g)) });
    expect(item(p, 'fillet').max).toBe(475);
    expect(item(p, 'veg').max).toBeLessThan(600);
  });
});

describe('roundMax', () => {
  it('rounds the way people weigh', () => {
    expect(roundMax(339.6, 'g')).toBe(340);
    expect(roundMax(14.3, 'g')).toBe(14);
    expect(roundMax(5.2, 'pcs')).toBe(5);
    expect(roundMax(5.3, 'pcs')).toBe(5.5);
  });
});
