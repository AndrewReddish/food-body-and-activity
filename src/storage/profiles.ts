import Dexie, { type Table } from 'dexie';
import { z } from 'zod';

/**
 * Users ("profiles") on this device. Each profile has its own IndexedDB database,
 * so logs never mix. Same profile ids and `profiles.json` as «Сфери», so one person is one user in both apps.
 */
export const ProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(40),
  color: z.string().min(1).max(40), // palette id from tokens.css
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Profile = z.infer<typeof ProfileSchema>;
export const ProfilesFileSchema = z.object({ profiles: z.array(ProfileSchema) });

/** The first profile keeps the original database and the data-repo root. */
export const DEFAULT_PROFILE_ID = 'me';
export const DEFAULT_PROFILE: Profile = {
  id: DEFAULT_PROFILE_ID,
  name: 'Андрій',
  color: 'home',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export const dbNameFor = (id: string) => (id === DEFAULT_PROFILE_ID ? 'tilo' : `tilo-${id}`);
/**
 * Folder in the data repo shared with «Сфери»: the mood app owns the root (and users/<id>/),
 * this app writes only under food/ inside the same user's folder.
 */
export const syncPrefixFor = (id: string) => (id === DEFAULT_PROFILE_ID ? 'food/' : `users/${id}/food/`);

interface KV {
  key: string;
  value: unknown;
}

class MetaDB extends Dexie {
  profiles!: Table<Profile, string>;
  kv!: Table<KV, string>;
  constructor(name = 'tilo-meta') {
    super(name);
    this.version(1).stores({ profiles: 'id', kv: 'key' });
  }
}

export const meta = new MetaDB();

export async function listProfiles(m = meta): Promise<Profile[]> {
  const rows = (await m.profiles.toArray()).flatMap((r) => {
    const p = ProfileSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
  if (!rows.some((p) => p.id === DEFAULT_PROFILE_ID)) {
    await m.profiles.put(DEFAULT_PROFILE);
    rows.unshift(DEFAULT_PROFILE);
  }
  return rows.sort((a, b) => (a.id === DEFAULT_PROFILE_ID ? -1 : b.id === DEFAULT_PROFILE_ID ? 1 : a.createdAt.localeCompare(b.createdAt)));
}

export async function putProfile(p: Profile, m = meta): Promise<void> {
  await m.profiles.put(ProfileSchema.parse(p));
}

export async function getActiveId(m = meta): Promise<string> {
  const row = await m.kv.get('active');
  return typeof row?.value === 'string' && (await m.profiles.get(row.value)) ? row.value : DEFAULT_PROFILE_ID;
}

export async function setActiveId(id: string, m = meta): Promise<void> {
  await m.kv.bulkPut([{ key: 'active', value: id }, { key: 'chosen', value: true }]);
}

/** Whether the first-launch "who's logging?" choice has been made. */
export async function hasChosen(m = meta): Promise<boolean> {
  return (await m.kv.get('chosen'))?.value === true;
}

export function newProfileId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);
  return `${slug || 'user'}-${Date.now().toString(36).slice(-5)}`;
}

/** Merge local and remote profile lists by id; newer updatedAt wins. */
export function mergeProfiles(local: Profile[], remote: Profile[]): Profile[] {
  const byId = new Map(local.map((p) => [p.id, p]));
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || Date.parse(r.updatedAt) > Date.parse(l.updatedAt)) byId.set(r.id, r);
  }
  return [...byId.values()];
}

/**
 * «Сфери» runs on the same origin (andrewreddish.github.io), so its users can be read straight
 * from its IndexedDB on first launch. Read-only; never writes to the mood app's databases.
 */
export async function importMoodProfiles(m = meta): Promise<void> {
  try {
    if (!(await Dexie.exists('spheres-meta'))) return;
    const mood = new Dexie('spheres-meta');
    await mood.open();
    const rows = mood.tables.some((t) => t.name === 'profiles') ? await mood.table('profiles').toArray() : [];
    mood.close();
    const local = await listProfiles(m);
    const merged = mergeProfiles(local, rows.flatMap((r) => {
      const p = ProfileSchema.safeParse(r);
      return p.success ? [p.data] : [];
    }));
    await m.profiles.bulkPut(merged);
  } catch {
    // The mood app isn't installed here, or its database is busy — nothing to import.
  }
}
