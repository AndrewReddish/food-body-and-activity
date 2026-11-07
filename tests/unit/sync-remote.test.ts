import { beforeEach, describe, expect, it } from 'vitest';
import { TiloDB, getPlan, getSettings, putDay, putMeasure, putPhoto, putPlan } from '../../src/storage/db';
import { markAllDirty, pullChanges, pushDirty, syncAll, syncProfiles, type SyncTarget } from '../../src/storage/sync-remote';
import type { RecordKind, RemoteProfile, RemoteRow, RemoteStore } from '../../src/storage/remote';
import { DEFAULT_PROFILE } from '../../src/storage/profiles';
import { defaultPlan } from '../../src/model/defaults';
import { day, log, measure } from './fixtures';

/**
 * In-memory stand-in for Supabase, with the same rules as supabase/migrations/0001_tilo.sql:
 * rows are per account + profile, an upsert with an older updated_at is ignored, and every accepted
 * write gets a fresh, increasing synced_at.
 */
function fakeStore() {
  let clock = Date.parse('2026-11-07T10:00:00Z');
  const tick = () => new Date(clock += 1000).toISOString();
  type Row = { data: unknown; updatedAt: string; syncedAt: string };
  const tables = new Map<string, Map<string, Row>>();
  const photos = new Map<string, Blob>();
  const profiles = new Map<string, RemoteProfile>();
  const table = (user: string, kind: string, profile: string) => {
    const k = `${user}/${kind}/${profile}`;
    if (!tables.has(k)) tables.set(k, new Map());
    return tables.get(k)!;
  };
  const upsert = (t: Map<string, Row>, key: string, data: unknown, updatedAt: string) => {
    const cur = t.get(key);
    if (cur && Date.parse(updatedAt) < Date.parse(cur.updatedAt)) return; // newer stays
    t.set(key, { data: structuredClone(data), updatedAt, syncedAt: tick() });
  };
  const rows = (t: Map<string, Row>, since?: string): RemoteRow[] =>
    [...t.values()].filter((r) => !since || r.syncedAt >= since).map((r) => ({ data: structuredClone(r.data), syncedAt: r.syncedAt }));

  const forUser = (user: string): RemoteStore => ({
    async putRecords(kind: RecordKind, profile, list) { for (const r of list) upsert(table(user, kind, profile), r.date, r.data, r.updatedAt); },
    async putPlan(profile, plan) { upsert(table(user, 'plans', profile), 'plan', plan, plan.updatedAt); },
    async changesSince(profile, since) {
      return { days: rows(table(user, 'days', profile), since), measures: rows(table(user, 'measures', profile), since), plan: rows(table(user, 'plans', profile), since)[0] };
    },
    async putPhoto(profile, id, blob) { const k = `${user}/${profile}/${id}`; if (!photos.has(k)) photos.set(k, blob); },
    async getPhoto(profile, id) { return photos.get(`${user}/${profile}/${id}`); },
    async listProfiles() { return [...profiles.values()].map((p) => ({ ...p })); },
    async putProfiles(list) { for (const p of list) profiles.set(p.id, { ...p }); },
  });
  return { forUser, table, photos, profiles, setClock: (iso: string) => { clock = Date.parse(iso); } };
}

let i = 0;
const freshDb = () => new TiloDB(`test-${++i}`);

describe('remote sync', () => {
  let remote: ReturnType<typeof fakeStore>;
  let target: SyncTarget;
  beforeEach(() => {
    remote = fakeStore();
    target = { store: remote.forUser('u1'), user: 'u1', profile: 'me' };
  });

  it('pushes dirty days and measurements, then clears the dirty list', async () => {
    const db = freshDb();
    await putDay(day('2026-10-31', '2026-10-31T21:00:00+02:00', { steps: 9000 }), db);
    await putDay(day('2026-11-02', '2026-11-02T21:00:00+02:00', { food: [log('fillet', 150, 'fried')] }), db);
    await putMeasure(measure('2026-11-02', '2026-11-02T08:00:00+02:00', { weight: 103.4 }), db);
    await pushDirty(target, db);
    expect([...remote.table('u1', 'days', 'me').keys()].sort()).toEqual(['2026-10-31', '2026-11-02']);
    expect((remote.table('u1', 'days', 'me').get('2026-11-02')!.data as { food: { method: string }[] }).food[0].method).toBe('fried');
    expect(remote.table('u1', 'measures', 'me').size).toBe(1);
    expect(await db.dirty.count()).toBe(0);
  });

  it('never pushes the untouched built-in plan, but does push an edited one', async () => {
    const db = freshDb();
    await markAllDirty(db);
    await syncAll(target, db);
    expect(remote.table('u1', 'plans', 'me').size).toBe(0);
    await putPlan({ ...defaultPlan(), kcalTarget: 2000, updatedAt: '2026-11-02T10:00:00+02:00' }, {}, db);
    await pushDirty(target, db);
    expect((remote.table('u1', 'plans', 'me').get('plan')!.data as { kcalTarget: number }).kcalTarget).toBe(2000);
  });

  it('a fresh install restores days, measurements, the plan and photos', async () => {
    const phone = freshDb();
    await putDay(day('2026-11-02', '2026-11-02T21:00:00+02:00', { steps: 7777 }), phone);
    await putMeasure(measure('2026-11-02', '2026-11-02T08:00:00+02:00', { weight: 103.4, photos: ['2026-11-02-abc'] }), phone);
    await putPhoto({ id: '2026-11-02-abc', date: '2026-11-02', blob: new Blob([new Uint8Array([255, 216, 255, 1, 2, 3])], { type: 'image/jpeg' }) }, phone);
    await putPlan({ ...defaultPlan(), stepsGoal: 9000, updatedAt: '2026-11-02T10:00:00+02:00' }, {}, phone);
    await pushDirty(target, phone);

    const reinstalled = freshDb();
    await syncAll(target, reinstalled);
    expect((await reinstalled.days.get('2026-11-02'))?.steps).toBe(7777);
    expect((await reinstalled.measures.get('2026-11-02'))?.weight).toBe(103.4);
    expect((await getPlan(reinstalled)).stepsGoal).toBe(9000);
    const photo = await reinstalled.photos.get('2026-11-02-abc');
    expect([...new Uint8Array(await photo!.blob.arrayBuffer())]).toEqual([255, 216, 255, 1, 2, 3]);
    expect(await reinstalled.dirty.count()).toBe(0); // pulled rows are not pushed back
  });

  it('keeps the newer edit of each day, on both sides', async () => {
    const other = remote.forUser('u1');
    await other.putRecords('days', 'me', [
      { date: '2026-11-01', updatedAt: '2026-11-01T22:00:00+02:00', data: day('2026-11-01', '2026-11-01T22:00:00+02:00', { steps: 1 }) },
      { date: '2026-11-02', updatedAt: '2026-11-02T08:00:00+02:00', data: day('2026-11-02', '2026-11-02T08:00:00+02:00', { steps: 1 }) },
    ]);
    const db = freshDb();
    await putDay(day('2026-11-01', '2026-11-01T20:00:00+02:00', { steps: 5 }), db); // older than remote
    await putDay(day('2026-11-02', '2026-11-02T21:00:00+02:00', { steps: 5 }), db); // newer than remote
    await syncAll(target, db);
    expect((await db.days.get('2026-11-01'))?.steps).toBe(1);
    expect((remote.table('u1', 'days', 'me').get('2026-11-02')!.data as { steps: number }).steps).toBe(5);
    expect((remote.table('u1', 'days', 'me').get('2026-11-01')!.data as { steps: number }).steps).toBe(1);
  });

  it('pulls only what changed since the last pull', async () => {
    const db = freshDb();
    await target.store.putRecords('days', 'me', [{ date: '2026-11-01', updatedAt: '2026-11-01T22:00:00Z', data: day('2026-11-01', '2026-11-01T22:00:00Z', { steps: 1 }) }]);
    await pullChanges(target, db);
    const cursor = (await getSettings(db)).pullCursor!;
    expect(cursor.user).toBe('u1');

    remote.setClock('2026-11-08T10:00:00Z'); // well past the cursor margin
    await target.store.putRecords('days', 'me', [{ date: '2026-11-03', updatedAt: '2026-11-03T22:00:00Z', data: day('2026-11-03', '2026-11-03T22:00:00Z', { steps: 3 }) }]);
    let asked: string | undefined;
    const spy: SyncTarget = { ...target, store: { ...target.store, changesSince: (p, since) => { asked = since; return target.store.changesSince(p, since); } } };
    await pullChanges(spy, db);
    expect(asked && Date.parse(asked)).toBeLessThan(Date.parse(cursor.at));
    expect((await db.days.get('2026-11-03'))?.steps).toBe(3);
    expect(Date.parse((await getSettings(db)).pullCursor!.at)).toBeGreaterThan(Date.parse(cursor.at));
  });

  it('keeps app users and accounts apart', async () => {
    const db = freshDb();
    await putDay(day('2026-11-02', '2026-11-02T21:00:00+02:00', { steps: 4242 }), db);
    await pushDirty({ ...target, profile: 'maks-1' }, db);
    expect(remote.table('u1', 'days', 'me').size).toBe(0);
    expect(remote.table('u1', 'days', 'maks-1').size).toBe(1);

    const stranger = freshDb();
    await syncAll({ store: remote.forUser('u2'), user: 'u2', profile: 'maks-1' }, stranger);
    expect(await stranger.days.count()).toBe(0);
  });

  it('a different account on the same device starts a full pull', async () => {
    const db = freshDb();
    await target.store.putRecords('days', 'me', [{ date: '2026-11-01', updatedAt: '2026-11-01T22:00:00Z', data: day('2026-11-01', '2026-11-01T22:00:00Z') }]);
    await pullChanges(target, db);
    let asked: string | undefined = 'unset';
    const u2 = remote.forUser('u2');
    await pullChanges({ store: { ...u2, changesSince: (p, s) => { asked = s; return u2.changesSince(p, s); } }, user: 'u2', profile: 'me' }, db);
    expect(asked).toBeUndefined();
  });

  it('first sign-in uploads everything already on the device', async () => {
    const db = freshDb();
    await putDay(day('2026-09-15', '2026-09-15T21:00:00Z', { steps: 1000 }), db);
    await putDay(day('2026-11-02', '2026-11-02T21:00:00Z', { steps: 2000 }), db);
    await putMeasure(measure('2025-12-30', '2025-12-30T08:00:00Z', { weight: 99 }), db);
    await db.dirty.clear(); // as if pushed long ago to another place
    await markAllDirty(db);
    await pushDirty(target, db);
    expect(remote.table('u1', 'days', 'me').size).toBe(2);
    expect(remote.table('u1', 'measures', 'me').size).toBe(1);
  });

  it('merges the list of app users both ways', async () => {
    await remote.forUser('u1').putProfiles([{ id: 'maks-1', name: 'Макс', color: 'nature', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }]);
    const local = [{ ...DEFAULT_PROFILE, name: 'Олена', updatedAt: '2026-11-05T00:00:00Z' }];
    const merged = await syncProfiles(target.store, local);
    expect(merged.map((p) => p.id).sort()).toEqual(['maks-1', 'me']);
    expect(remote.profiles.get('me')!.name).toBe('Олена');
  });

  it('a fresh install takes the first user’s name from the account', async () => {
    await remote.forUser('u1').putProfiles([{ id: 'me', name: 'Олена', color: 'home', createdAt: '1970-01-01T00:00:00Z', updatedAt: '1970-01-01T00:00:00Z' }]);
    const merged = await syncProfiles(target.store, [DEFAULT_PROFILE]);
    expect(DEFAULT_PROFILE.name).toBe('');
    expect(merged.find((p) => p.id === 'me')!.name).toBe('Олена');
  });
});

describe('supabase settings', () => {
  it('accepts the project URL with or without the API path', async () => {
    const { projectUrl, linkToken } = await import('../../src/storage/supabase');
    expect(projectUrl('https://abc.supabase.co/rest/v1/')).toBe('https://abc.supabase.co');
    expect(projectUrl('https://abc.supabase.co')).toBe('https://abc.supabase.co');
    expect(projectUrl('')).toBeUndefined();
    expect(linkToken('https://abc.supabase.co/auth/v1/verify?token=abc123&type=magiclink&redirect_to=x')).toEqual({ token_hash: 'abc123', type: 'magiclink' });
    expect(linkToken('123456')).toBeUndefined();
  });
});
