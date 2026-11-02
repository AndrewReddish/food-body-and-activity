import type { DateKey, MonthKey, WeekKey } from '../model/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date, not UTC: a late-evening entry belongs to today. */
export function toDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now = new Date()): DateKey {
  return toDateKey(now);
}

export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function monthOf(key: DateKey): MonthKey {
  return key.slice(0, 7);
}

export function addDays(key: DateKey, n: number): DateKey {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(key: DateKey): number {
  return (fromDateKey(key).getDay() + 6) % 7;
}

/** ISO-8601 week key, e.g. `2026-W43`. */
export function isoWeek(key: DateKey): WeekKey {
  const d = fromDateKey(key);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3); // Thursday of this week decides the year
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const week =
    1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${pad(week)}`;
}

/** Local time with offset, e.g. `2026-10-24T21:40:12+03:00` (matches the data contract). */
export function nowIso(now = new Date()): string {
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${toDateKey(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Compare two ISO timestamps that may carry different offsets. */
export function compareIso(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

/** All date keys of a month grid, Monday-first, padded with nulls. */
export function monthGrid(month: MonthKey): (DateKey | null)[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (DateKey | null)[] = Array(lead).fill(null);
  for (let i = 1; i <= days; i++) cells.push(`${month}-${pad(i)}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** "субота, 24 жовтня" → "Субота, 24 жовтня" (capitalize only the first letter). */
export const capFirst = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** "Жовтень 2026" — avoids the "р." suffix uk-UA adds to month + year. */
export function monthTitle(month: MonthKey, loc: string): string {
  const d = fromDateKey(month + '-01');
  const name = new Intl.DateTimeFormat(loc, { month: 'long' }).format(d);
  return `${capFirst(name)} ${d.getFullYear()}`;
}
