import type { z } from 'zod';
import type { DayLog, Measure } from '../model/types';
import { DaysFileSchema, MeasuresFileSchema, PlanSchema } from '../model/schema';
import { PLAN_PATH, TiloDB, db as defaultDb, getPlan, putPlan } from './db';
import { differs, mergeMaps, mergePlan } from './merge';
import { ProfilesFileSchema, mergeProfiles, type Profile } from './profiles';

/**
 * Sync with the PRIVATE data repo shared with «Сфери», through the GitHub Contents API.
 * This app only touches `<user folder>/food/`: plan.json, days/YYYY-MM.json,
 * measures/YYYY.json, photos/<id>.jpg — plus the shared profiles.json at the root.
 * The token is only ever sent to api.github.com and never logged.
 */
const API = 'https://api.github.com';

export interface SyncTarget {
  repo: string; // owner/name
  token: string;
  /** Folder inside the repo, e.g. 'food/' or 'users/olena-x1/food/'. */
  prefix?: string;
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

interface RemoteFile<T> {
  data: T;
  sha: string;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const b64encode = (text: string) => bytesToB64(new TextEncoder().encode(text));

function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export class GitHubClient {
  constructor(
    private target: SyncTarget,
    private fetchImpl: Fetch = (...a) => fetch(...a),
  ) {}

  private get prefix(): string {
    return this.target.prefix ?? '';
  }

  private async req(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
    return this.fetchImpl(`${API}/repos/${this.target.repo}/contents/${this.prefix}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.target.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }

  /** File paths in `dir`, relative to our folder. */
  async list(dir: string, ext = '.json'): Promise<{ path: string; sha: string }[]> {
    const res = await this.req(dir);
    if (res.status === 404) return [];
    if (!res.ok) throw new SyncError(`list ${dir}`, res.status);
    const items = (await res.json()) as { name: string; type: string; path: string; sha: string }[];
    return items
      .filter((i) => i.type === 'file' && i.name.endsWith(ext))
      .map((i) => ({ path: i.path.startsWith(this.prefix) ? i.path.slice(this.prefix.length) : i.path, sha: i.sha }));
  }

  async get<S extends z.ZodTypeAny>(path: string, schema: S): Promise<RemoteFile<z.infer<S>> | undefined> {
    const res = await this.req(path);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new SyncError(`get ${path}`, res.status);
    const body = (await res.json()) as { content: string; sha: string };
    const data = schema.parse(JSON.parse(b64decode(body.content)));
    return { data, sha: body.sha };
  }

  async put(path: string, data: unknown, sha: string | undefined, message: string): Promise<string> {
    return this.putRaw(path, b64encode(JSON.stringify(data, null, 2) + '\n'), sha, message);
  }

  async putRaw(path: string, contentB64: string, sha: string | undefined, message: string): Promise<string> {
    const res = await this.req(path, { method: 'PUT', body: JSON.stringify({ message, content: contentB64, sha }) });
    if (!res.ok) throw new SyncError(`put ${path}`, res.status);
    const body = (await res.json()) as { content: { sha: string } };
    return body.content.sha;
  }

  /** Binary file (photos). The raw media type also works for files over 1 MB. */
  async getBlob(path: string, type = 'image/jpeg'): Promise<Blob | undefined> {
    const res = await this.req(path, {}, 'application/vnd.github.raw+json');
    if (res.status === 404) return undefined;
    if (!res.ok) throw new SyncError(`get ${path}`, res.status);
    return new Blob([await res.arrayBuffer()], { type });
  }

  /** Checks the token can read the repo. */
  async ping(): Promise<void> {
    const res = await this.fetchImpl(`${API}/repos/${this.target.repo}`, {
      headers: { Authorization: `Bearer ${this.target.token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new SyncError('ping', res.status);
  }
}

const sortKeys = <T>(m: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));

const retryable = (e: unknown) => e instanceof SyncError && (e.status === 409 || e.status === 422);

/** Pull one keyed file (days of a month / measures of a year), merge, write back whichever side is behind. */
async function syncKeyedFile<T extends { date: string; updatedAt: string }>(
  gh: GitHubClient,
  path: string,
  schema: z.ZodType<Record<string, T>>,
  readLocal: () => Promise<T[]>,
  writeLocal: (rows: T[]) => Promise<unknown>,
  attempt = 0,
): Promise<void> {
  const remote = await gh.get(path, schema);
  const local: Record<string, T> = Object.fromEntries((await readLocal()).map((e) => [e.date, e]));
  const merged = mergeMaps(local, remote?.data ?? {});
  const toLocal = Object.values(merged).filter((e) => local[e.date]?.updatedAt !== e.updatedAt);
  if (toLocal.length) await writeLocal(toLocal);
  if (!remote || differs(merged, remote.data)) {
    try {
      await gh.put(path, sortKeys(merged), remote?.sha, path.replace('.json', ''));
    } catch (e) {
      // Someone else wrote in between — re-pull and merge once more.
      if (retryable(e) && attempt < 2) return syncKeyedFile(gh, path, schema, readLocal, writeLocal, attempt + 1);
      throw e;
    }
  }
}

function syncPath(gh: GitHubClient, db: TiloDB, path: string): Promise<void> {
  if (path.startsWith('days/')) {
    const month = path.slice('days/'.length, -'.json'.length);
    return syncKeyedFile<DayLog>(gh, path, DaysFileSchema,
      () => db.days.where('date').between(`${month}-01`, `${month}-31`, true, true).toArray(),
      (rows) => db.days.bulkPut(rows));
  }
  const year = path.slice('measures/'.length, -'.json'.length);
  return syncKeyedFile<Measure>(gh, path, MeasuresFileSchema,
    () => db.measures.where('date').between(`${year}-01-01`, `${year}-12-31`, true, true).toArray(),
    (rows) => db.measures.bulkPut(rows));
}

async function syncPlan(gh: GitHubClient, db: TiloDB, pushIfNeeded: boolean): Promise<void> {
  const remote = await gh.get(PLAN_PATH, PlanSchema);
  const local = await getPlan(db);
  const merged = mergePlan(local, remote?.data);
  if (merged !== local) await putPlan(merged, { markDirty: false }, db);
  // Never push the untouched built-in plan over nothing: it would only add noise to the repo.
  if (pushIfNeeded && (!remote || merged.updatedAt !== remote.data.updatedAt)) {
    await gh.put(PLAN_PATH, merged, remote?.sha, 'plan');
  }
}

async function pushPhoto(gh: GitHubClient, db: TiloDB, path: string): Promise<void> {
  const id = path.slice('photos/'.length, -'.jpg'.length);
  const photo = await db.photos.get(id);
  if (!photo) return; // deleted locally before it was pushed
  const bytes = new Uint8Array(await photo.blob.arrayBuffer());
  try {
    await gh.putRaw(path, bytesToB64(bytes), undefined, `photo ${photo.date}`);
  } catch (e) {
    if (!retryable(e)) throw e; // 422 = already there: photos are immutable, so that's fine
  }
}

/** Download photos referenced by measurements that this device doesn't have yet. */
async function pullPhotos(gh: GitHubClient, db: TiloDB): Promise<void> {
  const wanted = new Map<string, string>();
  for (const m of await db.measures.toArray()) for (const id of m.photos ?? []) wanted.set(id, m.date);
  for (const [id, date] of wanted) {
    if (await db.photos.get(id)) continue;
    const blob = await gh.getBlob(`photos/${id}.jpg`);
    if (blob) await db.photos.put({ id, date, blob });
  }
}

/** Full pull on app open: every remote file plus anything dirty locally. */
export async function pullAll(target: SyncTarget, db = defaultDb, fetchImpl?: Fetch): Promise<void> {
  const gh = new GitHubClient(target, fetchImpl);
  const dirty = new Set((await db.dirty.toArray()).map((d) => d.path));
  await syncPlan(gh, db, dirty.has(PLAN_PATH));

  const remote = [...(await gh.list('days')), ...(await gh.list('measures'))].map((f) => f.path);
  const paths = new Set([...remote, ...dirty]);
  for (const p of [...paths].sort()) {
    if (p.startsWith('days/') || p.startsWith('measures/')) await syncPath(gh, db, p);
    else if (p.startsWith('photos/')) await pushPhoto(gh, db, p);
  }
  await pullPhotos(gh, db);
  await db.dirty.clear();
}

/** Push only what changed locally (called ~3 s after the last edit). */
export async function pushDirty(target: SyncTarget, db = defaultDb, fetchImpl?: Fetch): Promise<void> {
  const gh = new GitHubClient(target, fetchImpl);
  for (const { path } of await db.dirty.toArray()) {
    if (path === PLAN_PATH) await syncPlan(gh, db, true);
    else if (path.startsWith('photos/')) await pushPhoto(gh, db, path);
    else await syncPath(gh, db, path);
    await db.dirty.delete(path);
  }
}

/**
 * `profiles.json` at the data-repo root lists every user and is shared with «Сфери»,
 * so both apps know the same people. Returns the merged list.
 */
export async function syncProfilesFile(target: SyncTarget, local: Profile[], fetchImpl?: Fetch, attempt = 0): Promise<Profile[]> {
  const gh = new GitHubClient({ ...target, prefix: '' }, fetchImpl);
  const remote = await gh.get('profiles.json', ProfilesFileSchema);
  const merged = mergeProfiles(local, remote?.data.profiles ?? []);
  const key = (ps: Profile[]) => JSON.stringify([...ps].sort((a, b) => a.id.localeCompare(b.id)).map((p) => [p.id, p.updatedAt]));
  if (!remote || key(merged) !== key(remote.data.profiles)) {
    try {
      await gh.put('profiles.json', { profiles: [...merged].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }, remote?.sha, 'profiles');
    } catch (e) {
      if (retryable(e) && attempt < 2) return syncProfilesFile(target, merged, fetchImpl, attempt + 1);
      throw e;
    }
  }
  return merged;
}
