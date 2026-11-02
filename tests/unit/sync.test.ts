import { beforeEach, describe, expect, it } from 'vitest';
import { TiloDB, getPlan, putDay, putMeasure, putPhoto, putPlan } from '../../src/storage/db';
import { pullAll, pushDirty } from '../../src/storage/sync-github';
import { defaultPlan } from '../../src/model/defaults';
import { day, log, measure } from './fixtures';

/** In-memory stand-in for the GitHub Contents API (JSON and raw media types). */
function fakeGitHub() {
  const files = new Map<string, { content: string; sha: string }>();
  let n = 0;
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    expect(u.startsWith('https://api.github.com/')).toBe(true);
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    const path = u.split('/contents/')[1];
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      const cur = files.get(path);
      if (cur && cur.sha !== body.sha) return new Response('{}', { status: cur && !body.sha ? 422 : 409 });
      const sha = `sha${++n}`;
      files.set(path, { content: body.content, sha });
      return new Response(JSON.stringify({ content: { sha } }), { status: 200 });
    }
    const dirFiles = [...files.keys()].filter((k) => k.startsWith(path + '/'));
    if (dirFiles.length) {
      return new Response(JSON.stringify(dirFiles.map((p) => ({ name: p.split('/').pop(), path: p, type: 'file', sha: files.get(p)!.sha }))), { status: 200 });
    }
    const f = files.get(path);
    if (!f) return new Response('{}', { status: 404 });
    if (headers.Accept.includes('raw')) return new Response(Buffer.from(f.content, 'base64'), { status: 200 });
    return new Response(JSON.stringify({ content: f.content, sha: f.sha }), { status: 200 });
  };
  return {
    fetchImpl: fetchImpl as typeof fetch,
    read: (p: string) => JSON.parse(unb64(files.get(p)!.content)),
    write: (p: string, data: unknown) => files.set(p, { content: b64(JSON.stringify(data)), sha: `sha${++n}` }),
    paths: () => [...files.keys()].sort(),
  };
}

const target = { repo: 'me/spheres-data', token: 'tok', prefix: 'food/' };
let i = 0;
const freshDb = () => new TiloDB(`test-${++i}`);

describe('GitHub sync', () => {
  let gh: ReturnType<typeof fakeGitHub>;
  beforeEach(() => {
    gh = fakeGitHub();
  });

  it('writes only inside food/, one file per month / year', async () => {
    const db = freshDb();
    await putDay(day('2026-11-02', '2026-11-02T21:00:00+02:00', { food: [log('veal', 200, 'fried')], steps: 9000 }), db);
    await putDay(day('2026-10-31', '2026-10-31T21:00:00+02:00', { steps: 4000 }), db);
    await putMeasure(measure('2026-11-02', '2026-11-02T08:00:00+02:00', { weight: 103.4 }), db);
    await pushDirty(target, db, gh.fetchImpl);
    expect(gh.paths()).toEqual(['food/days/2026-10.json', 'food/days/2026-11.json', 'food/measures/2026.json']);
    expect(gh.read('food/days/2026-11.json')['2026-11-02'].food[0].method).toBe('fried');
    expect(await db.dirty.count()).toBe(0);
  });

  it('never pushes the untouched built-in plan, but does push an edited one', async () => {
    const db = freshDb();
    await pullAll(target, db, gh.fetchImpl);
    expect(gh.paths()).toEqual([]);
    await putPlan({ ...defaultPlan(), kcalTarget: 2000, updatedAt: '2026-11-02T10:00:00+02:00' }, {}, db);
    await pushDirty(target, db, gh.fetchImpl);
    expect(gh.read('food/plan.json').kcalTarget).toBe(2000);
  });

  it('a fresh install restores days, measurements, the plan and photos', async () => {
    const phone = freshDb();
    await putDay(day('2026-11-02', '2026-11-02T21:00:00+02:00', { steps: 7777 }), phone);
    await putMeasure(measure('2026-11-02', '2026-11-02T08:00:00+02:00', { weight: 103.4, photos: ['2026-11-02-abc'] }), phone);
    await putPhoto({ id: '2026-11-02-abc', date: '2026-11-02', blob: new Blob([new Uint8Array([255, 216, 255, 1, 2, 3])], { type: 'image/jpeg' }) }, phone);
    await putPlan({ ...defaultPlan(), stepsGoal: 9000, updatedAt: '2026-11-02T10:00:00+02:00' }, {}, phone);
    await pushDirty(target, phone, gh.fetchImpl);
    expect(gh.paths()).toContain('food/photos/2026-11-02-abc.jpg');

    const reinstalled = freshDb();
    await pullAll(target, reinstalled, gh.fetchImpl);
    expect((await reinstalled.days.get('2026-11-02'))?.steps).toBe(7777);
    expect((await reinstalled.measures.get('2026-11-02'))?.weight).toBe(103.4);
    expect((await getPlan(reinstalled)).stepsGoal).toBe(9000);
    const photo = await reinstalled.photos.get('2026-11-02-abc');
    expect([...new Uint8Array(await photo!.blob.arrayBuffer())]).toEqual([255, 216, 255, 1, 2, 3]);
  });

  it('merges per day: newer wins on both sides', async () => {
    gh.write('food/days/2026-11.json', {
      '2026-11-01': day('2026-11-01', '2026-11-01T22:00:00+02:00', { steps: 1 }),
      '2026-11-02': day('2026-11-02', '2026-11-02T08:00:00+02:00', { steps: 1 }),
    });
    const db = freshDb();
    await putDay(day('2026-11-01', '2026-11-01T20:00:00+02:00', { steps: 5 }), db); // older than remote
    await putDay(day('2026-11-02', '2026-11-02T21:00:00+02:00', { steps: 5 }), db); // newer than remote
    await pullAll(target, db, gh.fetchImpl);
    expect((await db.days.get('2026-11-01'))?.steps).toBe(1);
    expect(gh.read('food/days/2026-11.json')['2026-11-02'].steps).toBe(5);
  });
});
