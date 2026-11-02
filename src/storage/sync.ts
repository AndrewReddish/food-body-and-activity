import { db, getSettings, patchSettings } from './db';
import { pullAll, pushDirty, syncProfilesFile, SyncError } from './sync-github';
import { listProfiles, meta } from './profiles';
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
  if (e instanceof SyncError) {
    if (e.status === 401) return 'token rejected (401)';
    if (e.status === 403) return 'no access (403)';
    if (e.status === 404) return 'repository not found (404)';
    return `${e.message} (${e.status ?? 'network'})`;
  }
  return e instanceof Error ? e.message : String(e);
}

async function run(kind: 'pull' | 'push'): Promise<void> {
  const s = await getSettings();
  if (!s.repo || !s.token) return emit({ state: 'off' });
  if (!navigator.onLine) return emit({ state: 'offline' });
  emit({ state: 'syncing' });
  try {
    // Guard: this app may only ever write inside a food/ folder of the shared data repo.
    const prefix = s.prefix?.endsWith('food/') ? s.prefix : 'food/';
    const target = { repo: s.repo, token: s.token, prefix };
    const runDb = db; // pin: a profile switch mid-run must not redirect writes
    if (kind === 'pull') {
      await pullAll(target, runDb);
      // The first user's profile also keeps the shared list of users in the repo root.
      if (target.prefix === 'food/') {
        const merged = await syncProfilesFile(target, await listProfiles());
        await meta.profiles.bulkPut(merged);
        window.dispatchEvent(new CustomEvent('tilo:profiles'));
      }
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
  emit(s.repo && s.token ? { state: 'idle', lastSyncAt: s.lastSyncAt } : { state: 'off' });
  if (listening) return void syncNow();
  listening = true;
  window.addEventListener('online', () => void enqueue('pull'));
  window.addEventListener('offline', () => emit({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void pushNow();
  });
  void syncNow();
}
