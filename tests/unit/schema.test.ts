import { describe, expect, it } from 'vitest';
import { DayLogSchema, MeasureSchema, PlanSchema } from '../../src/model/schema';
import { defaultPlan } from '../../src/model/defaults';
import { day, log, measure } from './fixtures';

describe('contract', () => {
  it('the coach plan is valid, with 8 groups and unique ids', () => {
    const p = PlanSchema.parse(defaultPlan());
    expect(p.groups.map((g) => g.letter).join('')).toBe('абвгдеєж');
    expect(new Set(p.items.map((i) => i.id)).size).toBe(p.items.length);
    for (const i of p.items) expect(p.groups.some((g) => g.id === i.group)).toBe(true);
    expect(p.groups.reduce((s, g) => s + g.kcal, 0)).toBe(2195);
  });

  it('a day with food, steps and drinks round-trips', () => {
    const d = day('2026-11-02', '2026-11-02T21:00:00+02:00', { food: [log('veal', 200, 'fried')], steps: 8123, cups: 3, soda: 330 });
    expect(DayLogSchema.parse(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('rejects nonsense', () => {
    expect(DayLogSchema.safeParse(day('2026-13-02x', 'x')).success).toBe(false);
    expect(MeasureSchema.safeParse(measure('2026-11-02', 'x', { weight: -1 })).success).toBe(false);
    expect(MeasureSchema.safeParse(measure('2026-11-02', 'x', { photos: ['../../etc'] })).success).toBe(false);
  });
});
