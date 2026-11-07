import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { RemoteError, type RecordKind, type RemoteChanges, type RemoteProfile, type RemoteRow, type RemoteStore } from './remote';

/**
 * Supabase: email sign-in (6-digit code, or the magic link in a browser tab) and the remote store.
 * Tables, row-level security and the photo bucket are in supabase/migrations/0001_tilo.sql.
 *
 * The URL and publishable key are build-time settings (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY).
 * Without them the app runs local-only. The publishable key is meant for clients: RLS limits every row
 * and photo to the signed-in account.
 */
/** The project URL, also when it was pasted as the API URL (…/rest/v1/). */
export function projectUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim().replace(/\/+$/, '').replace(/\/(rest|auth|storage)\/v1$/, '');
  return v || undefined;
}

const url = projectUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'tilo-auth' } })
  : null;

export const isRemoteConfigured = () => supabase !== null;

function fail(error: { message: string; status?: number; code?: string } | null, status?: number): void {
  if (error) throw new RemoteError(error.message, error.status ?? status, error.code);
}

export async function currentUser(): Promise<User | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export function onAuthChange(fn: (user: User | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => fn(session?.user ?? null));
  return () => data.subscription.unsubscribe();
}

/*
 * Email + password. No emails are sent: the project keeps "Confirm email" off, so a new account is signed
 * in straight away. (Email links can't sign in a home-screen app on iPhone: iOS opens them in the browser,
 * which uses up the one-time token there.)
 */
export async function signIn(email: string, password: string): Promise<User> {
  const { data, error } = await supabase!.auth.signInWithPassword({ email, password });
  fail(error);
  return data.user!;
}

export async function signUp(email: string, password: string): Promise<User> {
  const { data, error } = await supabase!.auth.signUp({ email, password });
  fail(error);
  // With "Confirm email" on, Supabase returns no session and waits for an email link.
  if (!data.session || !data.user) throw new RemoteError('email confirmation is on', undefined, 'confirm_email_on');
  return data.user;
}

/** Sets or changes the password of the signed-in account. */
export async function setPassword(password: string): Promise<void> {
  const { error } = await supabase!.auth.updateUser({ password });
  fail(error);
}

export const MIN_PASSWORD = 8;

/** Which message to show for a sign-in error (i18n key under account.err.*), or undefined for the raw one. */
export function authErrorKey(e: unknown): string | undefined {
  const code = (e as { code?: string })?.code ?? '';
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'account.err.credentials';
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered')) return 'account.err.exists';
  if (code === 'same_password' || msg.includes('should be different')) return 'account.err.same';
  if (code === 'weak_password' || msg.includes('password should be')) return 'account.err.weak';
  if (code === 'signup_disabled' || msg.includes('signups not allowed')) return 'account.err.signupOff';
  if (code === 'email_address_invalid' || code === 'validation_failed' || msg.includes('invalid format')) return 'account.err.email';
  if (code === 'confirm_email_on' || code === 'email_not_confirmed') return 'account.err.confirmOn';
  if (code === 'over_request_rate_limit' || msg.includes('rate limit') || (e as { status?: number })?.status === 429) return 'account.err.rate';
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')) return 'account.err.network';
  return undefined;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

const PAGE = 1000;

/** The goals table comes with migration 0002; until it is run, goals simply aren't synced. */
const missingTable = (error: { code?: string; message: string }, status?: number) =>
  error.code === 'PGRST205' || error.code === '42P01' || status === 404 || /could not find the table|does not exist/i.test(error.message);

export function supabaseStore(uid: string, client = supabase!): RemoteStore {
  const photoPath = (profile: string, id: string) => `${uid}/${profile}/${id}.jpg`;

  async function since(table: string, profile: string, from?: string): Promise<RemoteRow[]> {
    const out: RemoteRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let q = client.from(table).select('data, synced_at').eq('profile_id', profile);
      if (from) q = q.gte('synced_at', from);
      const { data, error, status } = await q.order('synced_at').range(offset, offset + PAGE - 1);
      fail(error, status);
      const rows = (data ?? []) as { data: unknown; synced_at: string }[];
      out.push(...rows.map((r) => ({ data: r.data, syncedAt: r.synced_at })));
      if (rows.length < PAGE) return out;
    }
  }

  return {
    async putRecords(kind: RecordKind, profile, rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({ owner: uid, profile_id: profile, date: r.date, data: r.data, updated_at: r.updatedAt }));
        const { error, status } = await client.from(kind).upsert(chunk, { onConflict: 'owner,profile_id,date' });
        fail(error, status);
      }
    },
    async putPlan(profile, plan) {
      const { error, status } = await client.from('plans')
        .upsert({ owner: uid, profile_id: profile, data: plan, updated_at: plan.updatedAt }, { onConflict: 'owner,profile_id' });
      fail(error, status);
    },
    async changesSince(profile, from): Promise<RemoteChanges> {
      const [days, measures, plans] = await Promise.all([since('days', profile, from), since('measures', profile, from), since('plans', profile, from)]);
      return { days, measures, plan: plans[0] };
    },
    async putPhoto(profile, id, blob) {
      const { error } = await client.storage.from('photos').upload(photoPath(profile, id), blob, { contentType: 'image/jpeg', upsert: false });
      // Photos are immutable: "already exists" means an earlier push got there.
      if (error && !/exist|duplicate/i.test(error.message)) throw new RemoteError(error.message);
    },
    async getPhoto(profile, id) {
      const { data, error } = await client.storage.from('photos').download(photoPath(profile, id));
      if (error) {
        if (/not.?found|404|object/i.test(error.message)) return undefined;
        throw new RemoteError(error.message);
      }
      return data ?? undefined;
    },
    async listProfiles(): Promise<RemoteProfile[]> {
      const { data, error, status } = await client.from('profiles').select('id, name, color, created_at, updated_at');
      fail(error, status);
      return ((data ?? []) as { id: string; name: string; color: string; created_at: string; updated_at: string }[])
        .map((r) => ({ id: r.id, name: r.name, color: r.color, createdAt: r.created_at, updatedAt: r.updated_at }));
    },
    async getGoals(profile) {
      const { data, error, status } = await client.from('goals').select('kcal, protein, steps, updated_at').eq('profile_id', profile).maybeSingle();
      if (error && missingTable(error, status)) return undefined;
      fail(error, status);
      const r = data as { kcal: number | null; protein: number | null; steps: number | null; updated_at: string } | null;
      return r ? { kcal: r.kcal ?? 0, protein: r.protein ?? 0, steps: r.steps ?? 0, updatedAt: r.updated_at } : undefined;
    },
    async putGoals(profile, g) {
      const { error, status } = await client.from('goals')
        .upsert({ owner: uid, profile_id: profile, kcal: g.kcal, protein: g.protein, steps: g.steps, updated_at: g.updatedAt }, { onConflict: 'owner,profile_id' });
      if (error && missingTable(error, status)) return;
      fail(error, status);
    },
    async putProfiles(profiles) {
      const rows = profiles.map((p) => ({ owner: uid, id: p.id, name: p.name, color: p.color, created_at: p.createdAt, updated_at: p.updatedAt }));
      const { error, status } = await client.from('profiles').upsert(rows, { onConflict: 'owner,id' });
      fail(error, status);
    },
  };
}
