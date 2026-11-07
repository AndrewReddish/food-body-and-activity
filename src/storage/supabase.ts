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
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'tilo-auth' } })
  : null;

export const isRemoteConfigured = () => supabase !== null;

function fail(error: { message: string; status?: number; code?: string } | null, status?: number): void {
  if (error) throw new RemoteError(error.message, error.status ?? status);
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

/** Sends an email with a 6-digit code and a magic link; creates the account on first use. */
export async function sendCode(email: string): Promise<void> {
  const { error } = await supabase!.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname },
  });
  fail(error);
}

export async function verifyCode(email: string, token: string): Promise<User> {
  const { data, error } = await supabase!.auth.verifyOtp({ email, token, type: 'email' });
  fail(error);
  if (!data.user) throw new RemoteError('no user');
  return data.user;
}

/**
 * Sign in with the link from the email pasted into the app (when the email template has no code yet).
 * The link's `token` is a one-time token hash that can be verified directly.
 *
 * Mail apps often hand out their own wrapper instead of the real link (Gmail on iPhone copies
 * `https://www.google.com/url?q=<encoded link>`), so the token is looked for anywhere in the pasted text,
 * after undoing URL encoding. A bare token hash on its own is accepted too.
 */
type LinkType = 'magiclink' | 'signup' | 'invite' | 'email';
const LINK_TYPES: LinkType[] = ['magiclink', 'signup', 'invite', 'email'];

export function linkToken(text: string): { token_hash: string; type?: LinkType } | undefined {
  let s = text.trim();
  for (let i = 0; i < 4; i++) {
    try {
      const d = decodeURIComponent(s.replace(/\+/g, ' '));
      if (d === s) break;
      s = d;
    } catch {
      break;
    }
  }
  const token = s.match(/[?&#]token(?:_hash)?=([A-Za-z0-9_-]{20,})/)?.[1];
  if (token) {
    const type = s.match(/[?&#]type=([a-z_]+)/)?.[1] as LinkType | undefined;
    return { token_hash: token, type: type && LINK_TYPES.includes(type) ? type : undefined };
  }
  if (/^[a-f0-9]{40,}$/i.test(s)) return { token_hash: s };
  return undefined;
}

export async function verifyLink(text: string): Promise<User> {
  const t = linkToken(text);
  if (!t) throw new RemoteError('not a sign-in link');
  // Type from the link; without one, try the kinds of email this app can receive.
  let last: { message: string; status?: number } | null = null;
  for (const type of t.type ? [t.type] : (['magiclink', 'invite', 'signup'] as LinkType[])) {
    const { data, error } = await supabase!.auth.verifyOtp({ token_hash: t.token_hash, type });
    if (!error && data.user) return data.user;
    last = error;
  }
  fail(last ?? { message: 'no user' });
  throw new RemoteError('no user');
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

const PAGE = 1000;

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
    async putProfiles(profiles) {
      const rows = profiles.map((p) => ({ owner: uid, id: p.id, name: p.name, color: p.color, created_at: p.createdAt, updated_at: p.updatedAt }));
      const { error, status } = await client.from('profiles').upsert(rows, { onConflict: 'owner,id' });
      fail(error, status);
    },
  };
}
