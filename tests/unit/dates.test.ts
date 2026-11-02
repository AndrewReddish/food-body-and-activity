import { describe, expect, it } from 'vitest';
import { addDays, isoWeek, monthGrid, nowIso, toDateKey, weekdayIndex } from '../../src/lib/dates';

describe('dates', () => {
  it('uses local calendar dates', () => {
    expect(toDateKey(new Date(2026, 9, 24, 23, 59))).toBe('2026-10-24');
  });
  it('adds days across months', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('weeks start on Monday', () => {
    expect(weekdayIndex('2026-10-19')).toBe(0); // Monday
    expect(weekdayIndex('2026-10-25')).toBe(6); // Sunday
  });
  it('computes ISO weeks', () => {
    expect(isoWeek('2026-10-24')).toBe('2026-W43');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
  });
  it('month grid is Monday-first and whole weeks', () => {
    const g = monthGrid('2026-10');
    expect(g.length % 7).toBe(0);
    expect(g.slice(0, 4)).toEqual([null, null, null, '2026-10-01']); // Oct 1 2026 is a Thursday
  });
  it('nowIso carries a local offset', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});
