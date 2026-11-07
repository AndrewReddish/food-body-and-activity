-- Tonus: daily goals (kcal, protein, steps) as plain columns, so the owner can see and edit them
-- in Supabase → Table Editor → goals. Run once in the SQL editor, after 0001_tilo.sql.
--
-- Both the owner (here) and the person (Опції in the app) may change them; the newer change wins.
-- An edit in the dashboard that doesn't touch updated_at is stamped "now", so it counts as the newest.

create table if not exists public.goals (
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  profile_id text not null,
  kcal int check (kcal between 0 and 10000),
  protein int check (protein between 0 and 1000),
  steps int check (steps between 0 and 100000),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  primary key (owner, profile_id)
);

create or replace function public.tilo_goals_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at is not distinct from old.updated_at then
      new.updated_at := now();            -- edited in the dashboard: this is the newest change
    elsif new.updated_at < old.updated_at then
      return null;                        -- an older change from the app: keep the newer one
    end if;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists tilo_goals_stamp on public.goals;
create trigger tilo_goals_stamp before insert or update on public.goals
  for each row execute function public.tilo_goals_stamp();

alter table public.goals enable row level security;
drop policy if exists own_rows on public.goals;
create policy own_rows on public.goals for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

-- Rows for everyone right away: from saved plans, else the built-in defaults stamped at the epoch
-- (so any real value from the app wins).
insert into public.goals (owner, profile_id, kcal, protein, steps, updated_at)
select owner, profile_id,
       (data->>'kcalTarget')::int, round((data->'macros'->>'protein')::numeric)::int, (data->>'stepsGoal')::int,
       -- the plan's own goals stamp, else the epoch: the same values as the app has, so they don't count as a newer edit
       coalesce((data->>'goalsUpdatedAt')::timestamptz, '1970-01-01T00:00:00Z')
from public.plans
on conflict do nothing;

insert into public.goals (owner, profile_id, kcal, protein, steps, updated_at)
select owner, id, 2210, 165, 7000, '1970-01-01T00:00:00Z'
from public.profiles
on conflict do nothing;

-- Read-only overview for the owner: who is who. In its own schema, which the API doesn't expose.
create schema if not exists admin;
revoke all on schema admin from public, anon, authenticated;

create or replace view admin.goals_overview as
select u.email, p.name as user_name, g.profile_id, g.kcal, g.protein, g.steps, g.updated_at, g.owner
from public.goals g
join auth.users u on u.id = g.owner
left join public.profiles p on p.owner = g.owner and p.id = g.profile_id
order by u.email, p.name;

revoke all on admin.goals_overview from public, anon, authenticated;
