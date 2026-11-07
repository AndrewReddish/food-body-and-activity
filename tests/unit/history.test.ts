import { describe, expect, it } from 'vitest';
import { dayStat, periodStats } from '../../src/model/history';
import { day, log, plan } from './fixtures';

const T = '2026-11-02T21:00:00Z';

describe('food history', () => {
  it('uses the goals saved with the day, else the current ones', () => {
    const d1 = day('2026-11-01', T, { food: [log('fillet', 475)], targets: { kcal: 1690, protein: 125, steps: 7000 } });
    const d2 = day('2026-11-02', T, { food: [log('fillet', 475)] });
    expect(dayStat(d1, plan).target.kcal).toBe(1690);
    expect(dayStat(d2, plan).target.kcal).toBe(2210);
    expect(dayStat(d1, plan).kcal).toBe(520); // the whole meat group
  });

  it('averages over logged days and counts days on target', () => {
    const full = plan.items.filter((i) => ['veal', 'cottage', 'grain', 'veg', 'oil', 'fruit', 'nuts', 'anything'].includes(i.id));
    const all = day('2026-11-01', T, { food: full.map((i) => log(i.id, i.max)) });
    const light = day('2026-11-02', T, { food: [log('veg', 300)] });
    const s = periodStats([dayStat(all, plan), dayStat(light, plan)])!;
    expect(s.days).toBe(2);
    expect(s.avgGroups).toBe(4); // 8 and 0 (300 g of 600 g vegetables is half a group)
    expect(s.allGroupsDays).toBe(1);
    expect(s.kcalOkDays).toBe(2); // 2195 and 60, both ≤ 2210 × 1.05
    expect(s.proteinOkDays).toBe(1); // the full day reaches 90% of 165 g
  });

  it('nothing logged → no stats', () => {
    expect(periodStats([])).toBeUndefined();
  });
});
