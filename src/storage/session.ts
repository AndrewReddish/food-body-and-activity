import Dexie from 'dexie';
import { getSettings, patchSettings, switchDb, type LocalSettings } from './db';
import { initSync, pushNow } from './sync';
import { DEFAULT_PROFILE_ID, dbNameFor, getActiveId, setActiveId, syncPrefixFor } from './profiles';

/**
 * New users reuse the first user's data repo and token, in their own folder.
 * Runs on every open of a profile, so profiles restored from profiles.json get sync too.
 */
async function inheritSync(id: string): Promise<void> {
  if (id === DEFAULT_PROFILE_ID) {
    await inheritFromMood();
    return;
  }
  const own = await getSettings();
  if (own.repo && own.token) return;
  const main = await getSettings(switchDb(dbNameFor(DEFAULT_PROFILE_ID)));
  switchDb(dbNameFor(id));
  if (main.repo && main.token) {
    await patchSettings({ repo: main.repo, token: main.token, prefix: syncPrefixFor(id), lang: main.lang, theme: main.theme });
  }
}

/**
 * «Сфери» lives on the same origin; if it is already connected to the data repo, reuse its repo,
 * token, language and theme so there is nothing to set up twice. Read-only.
 */
export async function readMoodSettings(): Promise<Partial<LocalSettings> | undefined> {
  try {
    if (!(await Dexie.exists('spheres'))) return undefined;
    const mood = new Dexie('spheres');
    await mood.open();
    const row = mood.tables.some((t) => t.name === 'kv') ? await mood.table('kv').get('settings') : undefined;
    mood.close();
    return row?.value as Partial<LocalSettings> | undefined;
  } catch {
    return undefined;
  }
}

async function inheritFromMood(): Promise<void> {
  const own = await getSettings();
  if (own.moodChecked || (own.repo && own.token)) return;
  const mood = await readMoodSettings();
  const patch: Partial<LocalSettings> = { moodChecked: true, lang: mood?.lang ?? own.lang, theme: mood?.theme ?? own.theme };
  if (mood?.repo && mood.token) Object.assign(patch, { repo: mood.repo, token: mood.token, prefix: syncPrefixFor(DEFAULT_PROFILE_ID) });
  await patchSettings(patch);
}

/** Open the active profile's database on app start. */
export async function openActiveProfile(): Promise<string> {
  const id = await getActiveId();
  switchDb(dbNameFor(id));
  await inheritSync(id);
  return id;
}

/** Finish pending pushes for the current user, then open another one. */
export async function switchProfile(id: string): Promise<void> {
  await pushNow();
  switchDb(dbNameFor(id));
  await setActiveId(id);
  await inheritSync(id);
  await initSync();
}
