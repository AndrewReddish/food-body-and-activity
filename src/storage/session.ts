import { getSettings, patchSettings, switchDb } from './db';
import { initSync, pushNow } from './sync';
import { DEFAULT_PROFILE_ID, dbNameFor, getActiveId, setActiveId } from './profiles';

/** A new user starts with the first user's language and theme. Sync needs nothing: the account is per device. */
async function inheritLook(id: string): Promise<void> {
  if (id === DEFAULT_PROFILE_ID) return;
  const own = await switchDb(dbNameFor(id)).kv.get('settings');
  if (own) return;
  const main = await getSettings(switchDb(dbNameFor(DEFAULT_PROFILE_ID)));
  switchDb(dbNameFor(id));
  await patchSettings({ lang: main.lang, theme: main.theme });
}

/** Open the active profile's database on app start. */
export async function openActiveProfile(): Promise<string> {
  const id = await getActiveId();
  switchDb(dbNameFor(id));
  await inheritLook(id);
  return id;
}

/** Finish pending pushes for the current user, then open another one. */
export async function switchProfile(id: string): Promise<void> {
  await pushNow();
  switchDb(dbNameFor(id));
  await setActiveId(id);
  await inheritLook(id);
  await initSync();
}
