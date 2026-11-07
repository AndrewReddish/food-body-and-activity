import { db, getSettings, patchSettings, TiloDB } from './db';
import { markAllDirty, pushDirty, syncAll, syncProfiles, type SyncTarget } from './sync-remote';
import { RemoteError } from './remote';
import { currentUser, isRemoteConfigured, onAuthChange, supabaseStore } from './supabase';
import { dbNameFor, listProfiles, meta, profileIdFor } from './profiles';
import { nowIso } from '../lib/dates';

export type SyncStatus =
  | { state: 'off' }
  | { state: 'idle'; lastSyncAt?: string }
  | { state: 'syncing' }
  | { state: 'offline' }
  | { state: 'error'; message: string };

const PUSH_DELAY_MS = 3000;

let status: SyncStatus = { state: 'off' };
const listeners = new Set<(s: SyncStatus) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;

function emit(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l(s));
}

export const getSyncStatus = () => status;
export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function describe(e: unknown): string {
  if (e instanceof RemoteError) {
    if (e.status === 401 || e.status === 403) return `sign in again (${e.status})`;
    return e.status ? `${e.message} (${e.status})` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * The first time an account is used on this device, everything already logged here is uploaded,
 * for every app user (not only the active one). Remembered per account.
 */
async function uploadDeviceOnce(user: string): Promise<void> {
  if ((await meta.kv.get('uploadedFor'))?.value === user) return;
  const store = supabaseStore(user);
  for (const p of await listProfiles()) {
    const other = p.id !== profileIdFor(db.name);
    const d = other ? new TiloDB(dbNameFor(p.id)) : db;
    try {
      await markAllDirty(d);
      await pushDirty({ store, user, profile: p.id }, d);
    } finally {
      if (other) d.close();
    }
  }
  await meta.kv.put({ key: 'uploadedFor', value: user });
}

async function run(kind: 'pull' | 'push'): Promise<void> {
  const user = isRemoteConfigured() ? await currentUser() : null;
  if (!user) return emit({ state: 'off' });
  if (!navigator.onLine) return emit({ state: 'offline' });
  emit({ state: 'syncing' });
  try {
    const runDb = db; // pin: a profile switch mid-run must not redirect writes
    const target: SyncTarget = { store: supabaseStore(user.id), user: user.id, profile: profileIdFor(runDb.name) };
    if (kind === 'pull') {
      await uploadDeviceOnce(user.id);
      await syncAll(target, runDb);
      const merged = await syncProfiles(target.store, await listProfiles());
      await meta.profiles.bulkPut(merged);
      window.dispatchEvent(new CustomEvent('tilo:profiles'));
    } else await pushDirty(target, runDb);
    const lastSyncAt = nowIso();
    await patchSettings({ lastSyncAt });
    emit({ state: 'idle', lastSyncAt });
    window.dispatchEvent(new CustomEvent('tilo:synced'));
  } catch (e) {
    emit({ state: 'error', message: describe(e) });
  }
}

/** Serialise runs so a pull and a push never overlap. */
function enqueue(kind: 'pull' | 'push'): Promise<void> {
  const next = (running ?? Promise.resolve()).then(() => run(kind));
  running = next.finally(() => {
    if (running === next) running = undefined;
  });
  return next;
}

export const syncNow = () => enqueue('pull');

/** Push pending edits right away (before switching user). Never throws. */
export async function pushNow(): Promise<void> {
  if (!timer) return;
  clearTimeout(timer);
  timer = undefined;
  await enqueue('push');
}

/** Call after every local write: pushes ~3 s after the last edit. */
export function schedulePush(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void enqueue('push');
  }, PUSH_DELAY_MS);
}

let listening = false;

/** Call on app start and after every profile switch. */
export async function initSync(): Promise<void> {
  clearTimeout(timer);
  const s = await getSettings();
  emit(isRemoteConfigured() && (await currentUser()) ? { state: 'idle', lastSyncAt: s.lastSyncAt } : { state: 'off' });
  if (listening) return void syncNow();
  listening = true;
  // Signing in (code or magic link) starts a sync; signing out turns it off.
  let signedIn = !!(await currentUser());
  onAuthChange((u) => {
    if (!!u === signedIn) return;
    signedIn = !!u;
    if (u) void syncNow();
    else emit({ state: 'off' });
  });
  window.addEventListener('online', () => void enqueue('pull'));
  window.addEventListener('offline', () => emit({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void pushNow();
  });
  void syncNow();
}
