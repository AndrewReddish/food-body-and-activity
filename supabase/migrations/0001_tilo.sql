-- Tonus data store. Run once in the Supabase SQL editor (or `supabase db push`).
--
-- One Supabase account per phone owner; the app's users ("profiles") are rows inside that account.
-- Records keep the app's own Zod-validated JSON in `data`; `updated_at` is the app's edit time (newer wins),
-- `synced_at` is stamped by the server and drives incremental pulls.

create table if not exists public.profiles (
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null check (id ~ '^[a-z0-9-]{1,40}$'),
  name text not null,
  color text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (owner, id)
);

create table if not exists public.plans (
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  profile_id text not null,
  data jsonb not null,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (owner, profile_id)
);

create table if not exists public.days (
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  profile_id text not null,
  date date not null,
  data jsonb not null,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (owner, profile_id, date)
);

create table if not exists public.measures (
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  profile_id text not null,
  date date not null,
  data jsonb not null,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (owner, profile_id, date)
);

create index if not exists plans_synced on public.plans (owner, profile_id, synced_at);
create index if not exists days_synced on public.days (owner, profile_id, synced_at);
create index if not exists measures_synced on public.measures (owner, profile_id, synced_at);

-- Newer edit wins on the server too: an upsert carrying an older updated_at leaves the row alone.
-- Every accepted write gets a fresh synced_at for incremental pulls.
create or replace function public.tilo_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'plans', 'days', 'measures'] loop
    execute format('drop trigger if exists tilo_stamp on public.%I', t);
    execute format('create trigger tilo_stamp before insert or update on public.%I for each row execute function public.tilo_stamp()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()))', t);
  end loop;
end $$;

-- Progress photos: private bucket, objects at <user id>/<profile id>/<photo id>.jpg.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "tilo photos: own folder read" on storage.objects;
create policy "tilo photos: own folder read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "tilo photos: own folder insert" on storage.objects;
create policy "tilo photos: own folder insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
