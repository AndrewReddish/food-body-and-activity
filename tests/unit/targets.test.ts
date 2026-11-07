import { describe, expect, it } from 'vitest';
import { applyTargets, cleanFormula, computeTargets, DEFAULT_FORMULA, type Body } from '../../src/model/targets';
import { defaultPlan } from '../../src/model/defaults';

const Y = 2026;
const woman: Body = { sex: 'f', birthYear: Y - 56, height: 165, weight: 95, activity: 'light', goal: 'lose' };
const calc = (b: Body, w?: number, f = DEFAULT_FORMULA) => {
  const r = computeTargets(b, w, f, Y);
  if (!r.ok) throw new Error('missing ' + r.missing.join());
  return r.targets;
};

describe('computeTargets', () => {
  it('woman, 56, 165 cm, 95 kg, losing: Mifflin-St Jeor, −20%, protein at BMI 25', () => {
    const t = calc(woman);
    expect(t.bmr).toBe(1540); // 950 + 1031.25 − 280 − 161
    expect(t.tdee).toBe(2118); // × 1.375
    expect(t.kcal).toBe(1690); // × 0.8, to 10
    expect(t.protein).toBe(125); // 68.1 kg (BMI 25 at 165 cm) × 1.8, to 5
    expect(t.fat).toBe(47); // 25% of kcal
    expect(t.steps).toBe(7000);
    expect(t.protein * 4 + t.fat * 9 + t.carbs * 4).toBeCloseTo(t.kcal, -1);
  });

  it('measured weight wins over the starting one', () => {
    expect(calc(woman, 90).weight).toBe(90);
    expect(calc(woman, 90).kcal).toBeLessThan(calc(woman).kcal);
  });

  it('maintain = expenditure, gain = +10%', () => {
    const tdee = calc(woman).tdee;
    expect(calc({ ...woman, goal: 'maintain' }).kcal).toBe(Math.round(tdee / 10) * 10);
    expect(calc({ ...woman, goal: 'gain' }).kcal).toBe(Math.round((tdee * 1.1) / 10) * 10);
  });

  it('losing never goes below resting energy or the minimum', () => {
    const small: Body = { sex: 'f', birthYear: Y - 70, height: 150, weight: 50, activity: 'sedentary', goal: 'lose' };
    const t = calc(small);
    expect(t.kcal).toBeGreaterThanOrEqual(Math.max(1200, t.bmr) - 5);
  });

  it('applies the per-person adjustment and protein override', () => {
    expect(calc({ ...woman, kcalAdjust: -100 }).kcal).toBe(1590);
    expect(calc({ ...woman, proteinPerKg: 1.5 }).protein).toBe(100);
  });

  it('follows the formula', () => {
    expect(calc(woman, undefined, { ...DEFAULT_FORMULA, deficitPct: 15 }).kcal).toBe(1800);
  });

  it('lists what is missing', () => {
    const r = computeTargets({ sex: 'f', goal: 'lose' }, undefined, DEFAULT_FORMULA, Y);
    expect(r.ok ? [] : r.missing).toEqual(['birthYear', 'height', 'weight']);
  });
});

describe('applyTargets', () => {
  it('changes nothing unless the person is on automatic targets', () => {
    const p = { ...defaultPlan(), body: woman };
    expect(applyTargets(p, undefined, DEFAULT_FORMULA, 'now', Y)).toBe(p);
  });

  it('sets kcal, protein, steps and macros, and stamps the goals', () => {
    const p = applyTargets({ ...defaultPlan(), body: { ...woman, auto: true } }, undefined, DEFAULT_FORMULA, '2026-11-07T12:00:00Z', Y);
    expect([p.kcalTarget, p.macros?.protein, p.stepsGoal, p.goalsUpdatedAt]).toEqual([1690, 125, 7000, '2026-11-07T12:00:00Z']);
    expect(applyTargets(p, undefined, DEFAULT_FORMULA, 'later', Y)).toBe(p);
  });
});

describe('cleanFormula', () => {
  it('reads numeric strings from Postgres and ignores junk', () => {
    const f = cleanFormula({ deficitPct: '15', fatPct: 'abc', floorBmr: false, proteinLose: -1 });
    expect([f.deficitPct, f.fatPct, f.floorBmr, f.proteinLose]).toEqual([15, 25, false, 1.8]);
  });
});
