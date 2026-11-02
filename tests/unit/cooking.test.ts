import { describe, expect, it } from 'vitest';
import { DONE_AT, YIELDS, fromRaw, groupUse, methodsFor, remainingWeighed, summarize, toRaw, yieldOf } from '../../src/model/cooking';
import { COOK_TYPES } from '../../src/model/schema';
import { item, log, plan } from './fixtures';

describe('raw ↔ cooked', () => {
  it('raw is always 1:1 and always offered first', () => {
    for (const c of COOK_TYPES) {
      expect(yieldOf(c, 'raw')).toBe(1);
      expect(methodsFor(c)[0]).toBe('raw');
    }
  });

  it('meat loses water: 200 g fried veal ≈ 286 g raw', () => {
    expect(toRaw(200, 'meat', 'fried')).toBeCloseTo(285.7, 1);
    expect(fromRaw(304, 'meat', 'fried')).toBeCloseTo(212.8, 1);
  });

  it('grains soak water: 216 g boiled rice ≈ 80 g raw', () => {
    expect(toRaw(216, 'rice', 'boiled')).toBeCloseTo(80, 5);
    expect(toRaw(200, 'grain', 'boiled')).toBeCloseTo(80, 5);
  });

  it('foods without a conversion only offer raw', () => {
    expect(methodsFor('none')).toEqual(['raw']);
    expect(methodsFor('rice')).toEqual(['raw', 'boiled']);
    expect(methodsFor('potato')).toEqual(['raw', 'boiled', 'baked', 'fried']);
  });

  it('every yield is a plausible cooking factor', () => {
    for (const c of COOK_TYPES) for (const v of Object.values(YIELDS[c])) expect(v).toBeGreaterThan(0.4), expect(v).toBeLessThan(3.5);
  });

  it('round-trips', () => {
    for (const c of COOK_TYPES) for (const m of methodsFor(c)) expect(toRaw(fromRaw(123, c, m), c, m)).toBeCloseTo(123, 6);
  });
});

describe('logging against the plan', () => {
  it('counts cooked weight as its raw equivalent', () => {
    const l = log('veal', 200, 'fried');
    expect(l.raw).toBeCloseTo(285.7, 1);
    expect(l.frac).toBeCloseTo(285.7 / 304, 3);
    expect(l.kcal).toBe(Math.round(520 * (285.7142857 / 304)));
  });

  it('foods in a group share one budget', () => {
    const food = [log('veal', 152), log('eggs', 3.5)]; // 50% + 50%
    expect(groupUse(food).b).toBeCloseTo(1, 6);
    const s = summarize({ food }, plan);
    expect(s.groupsDone).toBe(1);
    expect(s.over).toEqual([]);
  });

  it('what is left of a group shrinks as it fills, in the chosen state', () => {
    const used = groupUse([log('veal', 200, 'fried')]).b; // ≈ 94%
    expect(remainingWeighed(item('eggs'), 'raw', used)).toBeCloseTo(7 * (1 - used), 6);
    expect(remainingWeighed(item('fillet'), 'boiled', used)).toBeCloseTo(475 * (1 - used) * 0.75, 6);
    expect(remainingWeighed(item('fillet'), 'raw', 1.2)).toBe(0);
  });

  it('flags groups over 100%', () => {
    const s = summarize({ food: [log('oil', 30)] }, plan);
    expect(s.over).toEqual(['g']);
    expect(s.use.g).toBeCloseTo(1.5, 6);
  });

  it('a full plan day hits the coach\'s ~2210 kcal', () => {
    const food = ['legumes', 'veal', 'veg', 'oil', 'cottage', 'fruit', 'nuts', 'anything'].map((id) => log(id, item(id).max));
    const s = summarize({ food }, plan);
    expect(s.groupsDone).toBe(8);
    expect(s.kcal).toBe(2195);
    expect(DONE_AT).toBeLessThan(1);
  });
});
