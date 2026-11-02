import Dexie, { type Table } from 'dexie';
import type { DateKey, DayLog, Measure, MonthKey, Plan } from '../model/types';
import { DayLogSchema, MeasureSchema, PlanSchema } from '../model/schema';
import { defaultPlan } from '../model/defaults';
import { monthOf } from '../lib/dates';

interface KV {
  key: string;
  value: unknown;
}

interface Dirty {
  /** `days/2026-11.json`, `measures/2026.json`, `plan.json`, `photos/<id>.jpg` */
  path: string;
}

export interface Photo {
  id: string;
  date: DateKey;
  blob: Blob;
}

export class TiloDB extends Dexie {
  days!: Table<DayLog, DateKey>;
  measures!: Table<Measure, DateKey>;
  photos!: Table<Photo, string>;
  kv!: Table<KV, string>;
  dirty!: Table<Dirty, string>;

  constructor(name = 'tilo') {
    super(name);
    this.version(1).stores({
      days: 'date',
      measures: 'date',
      photos: 'id, date',
      kv: 'key',
      dirty: 'path',
    });
  }
}

/** The active profile's database; swapped by switchDb() when the user changes. Hooks pin it at mount. */
export let db = new TiloDB();

export function switchDb(name: string): TiloDB {
  if (db.name !== name) {
    db.close();
    db = new TiloDB(name);
  }
  return db;
}

export const daysPath = (month: MonthKey) => `days/${month}.json`;
export const measuresPath = (year: string) => `measures/${year}.json`;
export const photoPath = (id: string) => `photos/${id}.jpg`;
export const PLAN_PATH = 'plan.json';

function valid<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, rows: unknown[]): T[] {
  return rows.flatMap((r) => {
    const p = schema.safeParse(r);
    return p.success ? [p.data as T] : [];
  });
}

export async function getDay(date: DateKey, d = db): Promise<DayLog | undefined> {
  const p = DayLogSchema.safeParse(await d.days.get(date));
  return p.success ? p.data : undefined;
}

export async function putDay(day: DayLog, d = db): Promise<void> {
  const v = DayLogSchema.parse(day);
  await d.transaction('rw', d.days, d.dirty, async () => {
    await d.days.put(v);
    await d.dirty.put({ path: daysPath(monthOf(v.date)) });
  });
}

export async function daysBetween(from: DateKey, to: DateKey, d = db): Promise<DayLog[]> {
  return valid(DayLogSchema, await d.days.where('date').between(from, to, true, true).toArray());
}

export async function allDays(d = db): Promise<DayLog[]> {
  return valid(DayLogSchema, await d.days.orderBy('date').toArray());
}

export async function allMeasures(d = db): Promise<Measure[]> {
  return valid(MeasureSchema, await d.measures.orderBy('date').toArray());
}

export async function putMeasure(m: Measure, d = db): Promise<void> {
  const v = MeasureSchema.parse(m);
  await d.transaction('rw', d.measures, d.dirty, async () => {
    await d.measures.put(v);
    await d.dirty.put({ path: measuresPath(v.date.slice(0, 4)) });
  });
}

export async function putPhoto(p: Photo, d = db): Promise<void> {
  await d.transaction('rw', d.photos, d.dirty, async () => {
    await d.photos.put(p);
    await d.dirty.put({ path: photoPath(p.id) });
  });
}

export async function getPlan(d = db): Promise<Plan> {
  const row = await d.kv.get('plan');
  const p = PlanSchema.safeParse(row?.value);
  return p.success ? p.data : defaultPlan();
}

export async function putPlan(plan: Plan, opts: { markDirty?: boolean } = {}, d = db): Promise<void> {
  const v = PlanSchema.parse(plan);
  await d.transaction('rw', d.kv, d.dirty, async () => {
    await d.kv.put({ key: 'plan', value: v });
    if (opts.markDirty !== false) await d.dirty.put({ path: PLAN_PATH });
  });
}

/** Device-local settings: never synced, never exported. */
export interface LocalSettings {
  lang: 'uk' | 'en';
  theme: 'system' | 'light' | 'dark';
  repo?: string; // "owner/name" of the PRIVATE data repo (shared with «Сфери»)
  token?: string; // fine-grained PAT, only ever sent to api.github.com
  prefix?: string; // folder in the data repo: 'food/' for the first user, 'users/<id>/food/' for others
  installHintSeen?: boolean;
  lastSyncAt?: string;
  sound?: boolean;
  /** «Сфери»'s connection/language/theme were offered once (first launch only). */
  moodChecked?: boolean;
  /** Last weighing method per item, so "cooked" sticks for meat. */
  lastMethod?: Record<string, string>;
}

const DEFAULT_SETTINGS: LocalSettings = { lang: 'uk', theme: 'system' };

export async function getSettings(d = db): Promise<LocalSettings> {
  const row = await d.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...(row?.value as Partial<LocalSettings> | undefined) };
}

export async function patchSettings(patch: Partial<LocalSettings>, d = db): Promise<LocalSettings> {
  const next = { ...(await getSettings(d)), ...patch };
  await d.kv.put({ key: 'settings', value: next });
  return next;
}
