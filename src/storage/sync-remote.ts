import { DayLogSchema, MeasureSchema, PlanSchema } from '../model/schema';
import type { DayLog, Measure } from '../model/types';
import { db as defaultDb, getPlan, getSettings, patchSettings, putPlan, PLAN_PATH, daysPath, measuresPath, photoPath, type TiloDB } from './db';
import { pickNewer } from './merge';
import { mergeProfiles, ProfileSchema, type Profile } from './profiles';
import type { RecordKind, RemoteGoals, RemoteStore } from './remote';

/**
 * Two-way sync of one app user's data with the remote store.
 *
 * Local writes mark a path dirty (`days/2026-11.json`, `measures/2026.json`, `plan.json`, `photos/<id>.jpg`).
 * Push sends the records behind those paths; the server keeps whichever version has the newer `updatedAt`.
 * Pull then fetches everything written since the last pull and keeps the newer side per record.
 * Records are never deleted in this app, so there are no tombstones.
 */
export interface SyncTarget {
  store: RemoteStore;
  /** Signed-in account; the pull cursor belongs to it. */
  user: string;
  /** App user (profile id). */
  profile: string;
}

/** Re-read a little before the cursor: writes committed out of order near it are not missed. */
const CURSOR_MARGIN_MS = 2 * 60 * 1000;
/** Stamp of the untouched built-in plan (defaults.ts): never pushed. */
const EPOCH = '1970-01-01T00:00:00.000Z';

async function pushRecords<T extends { date: string; updatedAt: string }>(t: SyncTarget, kind: RecordKind, rows: T[]) {
  if (rows.length) await t.store.putRecords(kind, t.profile, rows.map((r) => ({ date: r.date, updatedAt: r.updatedAt, data: r })));
}

async function pushPath(t: SyncTarget, db: TiloDB, path: string): Promise<void> {
  if (path === PLAN_PATH) {
    const plan = await getPlan(db);
    if (plan.updatedAt !== EPOCH) await t.store.putPlan(t.profile, plan);
  } else if (path.startsWith('photos/')) {
    const photo = await db.photos.get(path.slice('photos/'.length, -'.jpg'.length));
    if (photo) await t.store.putPhoto(t.profile, photo.id, photo.blob); // gone = deleted before it was pushed
  } else if (path.startsWith('days/')) {
    const month = path.slice('days/'.length, -'.json'.length);
    await pushRecords<DayLog>(t, 'days', await db.days.where('date').between(`${month}-01`, `${month}-31`, true, true).toArray());
  } else if (path.startsWith('measures/')) {
    const year = path.slice('measures/'.length, -'.json'.length);
    await pushRecords<Measure>(t, 'measures', await db.measures.where('date').between(`${year}-01-01`, `${year}-12-31`, true, true).toArray());
  }
}

/** Push what changed locally (called a few seconds after the last edit). */
export async function pushDirty(t: SyncTarget, db = defaultDb): Promise<void> {
  let plan = false;
  for (const { path } of await db.dirty.toArray()) {
    await pushPath(t, db, path);
    await db.dirty.delete(path);
    plan ||= path === PLAN_PATH;
  }
  if (plan) await reconcileGoals(t, db);
}

const after = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/**
 * Daily goals (kcal, protein, steps) also live as plain columns in the `goals` table, where the owner can
 * edit them. Newer change wins: the goals row vs the plan's `goalsUpdatedAt`. Runs after the plan merge,
 * so a pulled plan carrying older goal values can't override the table.
 */
export async function reconcileGoals(t: SyncTarget, db = defaultDb): Promise<void> {
  const plan = await getPlan(db);
  const local: RemoteGoals = {
    kcal: plan.kcalTarget, protein: Math.round(plan.macros?.protein ?? 0), steps: plan.stepsGoal,
    updatedAt: plan.goalsUpdatedAt ?? EPOCH,
  };
  const remote = await t.store.getGoals(t.profile);
  if (!remote || after(local.updatedAt, remote.updatedAt)) {
    await t.store.putGoals(t.profile, local);
    return;
  }
  const same = remote.kcal === local.kcal && remote.protein === local.protein && remote.steps === local.steps;
  if (after(remote.updatedAt, local.updatedAt) || !same) {
    await putPlan({
      ...plan,
      kcalTarget: remote.kcal,
      stepsGoal: remote.steps,
      macros: { protein: remote.protein, fat: plan.macros?.fat ?? 0, carbs: plan.macros?.carbs ?? 0 },
      goalsUpdatedAt: remote.updatedAt,
    }, { markDirty: false }, db);
  }
}

/** Keep the newer side of each pulled record; writes locally without marking anything dirty. */
async function mergeRows<T extends { date: string; updatedAt: string }>(
  rows: unknown[], parse: (v: unknown) => T | undefined, table: TiloDB['days'] | TiloDB['measures'],
): Promise<void> {
  for (const raw of rows) {
    const remote = parse(raw);
    if (!remote) continue;
    const local = (await table.get(remote.date)) as T | undefined;
    if (pickNewer(local, remote) === remote && local?.updatedAt !== remote.updatedAt) await table.put(remote as never);
  }
}

/** Download photos that measurements reference but this device doesn't have. */
async function pullPhotos(t: SyncTarget, db: TiloDB): Promise<void> {
  for (const m of await db.measures.toArray()) {
    for (const id of m.photos ?? []) {
      if (await db.photos.get(id)) continue;
      const blob = await t.store.getPhoto(t.profile, id);
      if (blob) await db.photos.put({ id, date: m.date, blob });
    }
  }
}

/** Pull everything written since the last pull by this account (all of it the first time). */
export async function pullChanges(t: SyncTarget, db = defaultDb): Promise<void> {
  const s = await getSettings(db);
  const prev = s.pullCursor?.user === t.user ? s.pullCursor.at : undefined;
  const since = prev ? new Date(Date.parse(prev) - CURSOR_MARGIN_MS).toISOString() : undefined;
  const ch = await t.store.changesSince(t.profile, since);

  const day = (v: unknown) => { const p = DayLogSchema.safeParse(v); return p.success ? p.data : undefined; };
  const measure = (v: unknown) => { const p = MeasureSchema.safeParse(v); return p.success ? p.data : undefined; };
  await mergeRows(ch.days.map((r) => r.data), day, db.days);
  await mergeRows(ch.measures.map((r) => r.data), measure, db.measures);
  if (ch.plan) {
    const remote = PlanSchema.safeParse(ch.plan.data);
    const local = await getPlan(db);
    if (remote.success && pickNewer(local, remote.data) === remote.data && local.updatedAt !== remote.data.updatedAt) {
      await putPlan(remote.data, { markDirty: false }, db);
    }
  }
  await pullPhotos(t, db);

  const stamps = [...ch.days, ...ch.measures, ...(ch.plan ? [ch.plan] : [])].map((r) => r.syncedAt);
  const at = stamps.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a), prev ?? EPOCH);
  if (at !== EPOCH) await patchSettings({ pullCursor: { user: t.user, at } }, db);
}

/** Full sync on app open, coming online, or "sync now": local edits first, then remote changes. */
export async function syncAll(t: SyncTarget, db = defaultDb): Promise<void> {
  await pushDirty(t, db);
  await pullChanges(t, db);
  await reconcileGoals(t, db);
}

/** Mark everything on this device for upload — the first time an account is connected here. */
export async function markAllDirty(db = defaultDb): Promise<void> {
  const paths = new Set<string>();
  for (const d of await db.days.toArray()) paths.add(daysPath(d.date.slice(0, 7)));
  for (const m of await db.measures.toArray()) paths.add(measuresPath(m.date.slice(0, 4)));
  for (const p of await db.photos.toArray()) paths.add(photoPath(p.id));
  if ((await getPlan(db)).updatedAt !== EPOCH) paths.add(PLAN_PATH);
  await db.dirty.bulkPut([...paths].map((path) => ({ path })));
  const s = await getSettings(db);
  if (s.pullCursor) await patchSettings({ pullCursor: undefined }, db);
}

const sameTime = (a: string, b: string) => Date.parse(a) === Date.parse(b);

/** The account's list of app users: merge both ways, newer `updatedAt` wins. Returns the merged list. */
export async function syncProfiles(store: RemoteStore, local: Profile[]): Promise<Profile[]> {
  const remote = (await store.listProfiles()).flatMap((r) => {
    const p = ProfileSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
  const merged = mergeProfiles(local, remote);
  const changed = merged.filter((p) => {
    const r = remote.find((x) => x.id === p.id);
    return !r || !sameTime(r.updatedAt, p.updatedAt) || r.name !== p.name || r.color !== p.color;
  });
  if (changed.length) await store.putProfiles(changed);
  return merged;
}
