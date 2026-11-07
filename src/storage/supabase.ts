import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { RemoteError, type RecordKind, type RemoteChanges, type RemoteProfile, type RemoteGoals, type RemoteRow, type RemoteStore } from './remote';
import { BodySchema } from '../model/schema';
import type { Body } from '../model/targets';
import { normBody } from './goals';

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

/** Body columns come with migration 0003; until it is run, only kcal / protein / steps are synced. */
const missingColumn = (error: { code?: string; message: string }) =>
  error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message);

const BODY_COLS = 'sex, birth_year, height_cm, weight_kg, activity, goal, auto, kcal_adjust, protein_per_kg';
interface BodyRow {
  sex?: string | null; birth_year?: number | null; height_cm?: number | null; weight_kg?: number | null; activity?: string | null;
  goal?: string | null; auto?: boolean | null; kcal_adjust?: number | null; protein_per_kg?: number | null;
}

/** A goals row's body columns → plan.body (validated: a typo in the dashboard is ignored, not synced). */
function bodyFromRow(r: BodyRow): Body | undefined {
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));
  const raw: Record<string, unknown> = {
    sex: r.sex, birthYear: num(r.birth_year), height: num(r.height_cm), weight: num(r.weight_kg),
    activity: r.activity, goal: r.goal, auto: r.auto, kcalAdjust: num(r.kcal_adjust), proteinPerKg: num(r.protein_per_kg),
  };
  // Field by field: one bad cell (say, an age typed into birth_year) doesn't drop the rest.
  const shape = BodySchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown } }>;
  return normBody(Object.fromEntries(Object.entries(raw).map(([k, v]) => {
    const p = v === null || v === undefined ? undefined : shape[k].safeParse(v);
    return [k, p?.success ? p.data : undefined];
  })));
}

function bodyToRow(b: Body | undefined): BodyRow {
  return {
    sex: b?.sex ?? null, birth_year: b?.birthYear ?? null, height_cm: b?.height ?? null, weight_kg: b?.weight ?? null,
    activity: b?.activity ?? null, goal: b?.goal ?? null, auto: b?.auto ?? false, kcal_adjust: b?.kcalAdjust ?? 0, protein_per_kg: b?.proteinPerKg ?? null,
  };
}

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
      let { data, error, status } = await client.from('goals').select(`kcal, protein, steps, updated_at, ${BODY_COLS}`).eq('profile_id', profile).maybeSingle();
      let hasBody = true;
      if (error && missingColumn(error)) {
        hasBody = false;
        ({ data, error, status } = await client.from('goals').select('kcal, protein, steps, updated_at').eq('profile_id', profile).maybeSingle());
      }
      if (error && missingTable(error, status)) return undefined;
      fail(error, status);
      const r = data as ({ kcal: number | null; protein: number | null; steps: number | null; updated_at: string } & BodyRow) | null;
      if (!r) return undefined;
      const goals: RemoteGoals = { kcal: r.kcal ?? 0, protein: r.protein ?? 0, steps: r.steps ?? 0, updatedAt: r.updated_at };
      if (hasBody) goals.body = bodyFromRow(r) ?? null;
      return goals;
    },
    async putGoals(profile, g) {
      const row = { owner: uid, profile_id: profile, kcal: g.kcal, protein: g.protein, steps: g.steps, updated_at: g.updatedAt };
      let { error, status } = await client.from('goals').upsert({ ...row, ...bodyToRow(g.body ?? undefined) }, { onConflict: 'owner,profile_id' });
      if (error && missingColumn(error)) ({ error, status } = await client.from('goals').upsert(row, { onConflict: 'owner,profile_id' }));
      if (error && missingTable(error, status)) return;
      fail(error, status);
    },
    async getFormula() {
      const { data, error, status } = await client.from('formula').select('*').eq('id', 'default').maybeSingle();
      if (error && missingTable(error, status)) return undefined;
      fail(error, status);
      if (!data) return undefined;
      // snake_case columns → camelCase keys; cleanFormula() drops anything unknown.
      return Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => [k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()), v]));
    },
    async putProfiles(profiles) {
      const rows = profiles.map((p) => ({ owner: uid, id: p.id, name: p.name, color: p.color, created_at: p.createdAt, updated_at: p.updatedAt }));
      const { error, status } = await client.from('profiles').upsert(rows, { onConflict: 'owner,id' });
      fail(error, status);
    },
  };
}
