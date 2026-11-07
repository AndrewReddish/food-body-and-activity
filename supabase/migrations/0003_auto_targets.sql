-- Tonus: automatic daily targets from body data and a weight goal. Run once in the SQL editor, after 0002_goals.sql.
--
-- 1. goals gets body columns. Fill them in for a person and set auto = true: the app then computes kcal,
--    protein and steps itself (src/model/targets.ts) and writes them back into this row.
-- 2. formula holds the coefficients (one row). Change a number there and every app on automatic targets
--    recalculates on its next sync.
-- 3. admin.targets_preview shows, right here, what the formula gives each person.

alter table public.goals
  add column if not exists sex text check (sex in ('f', 'm')),
  add column if not exists birth_year int check (birth_year between 1900 and 2100),
  add column if not exists height_cm numeric check (height_cm between 80 and 250),
  add column if not exists weight_kg numeric check (weight_kg between 20 and 400),
  add column if not exists activity text check (activity in ('sedentary', 'light', 'moderate', 'active')),
  add column if not exists goal text check (goal in ('lose', 'maintain', 'gain')),
  add column if not exists auto boolean not null default false,
  add column if not exists kcal_adjust int not null default 0 check (kcal_adjust between -2000 and 2000),
  add column if not exists protein_per_kg numeric check (protein_per_kg between 0.5 and 4);

comment on column public.goals.sex is 'f = жінка, m = чоловік';
comment on column public.goals.weight_kg is 'Стартова вага; після першого заміру береться вага з замірів';
comment on column public.goals.activity is 'sedentary 1.2 · light 1.375 · moderate 1.55 · active 1.725';
comment on column public.goals.goal is 'lose = схуднення · maintain = утримання · gain = набір';
comment on column public.goals.auto is 'true: kcal / protein / steps рахує застосунок; false: як вписано вручну';
comment on column public.goals.kcal_adjust is 'Поправка до формули для цієї людини, ккал (напр. -100)';
comment on column public.goals.protein_per_kg is 'Білок г/кг для цієї людини замість формули (порожньо = з формули)';

create table if not exists public.formula (
  id text primary key default 'default' check (id = 'default'),
  deficit_pct numeric not null default 20,      -- схуднення: мінус % від витрат
  surplus_pct numeric not null default 10,      -- набір: плюс % до витрат
  protein_lose numeric not null default 1.8,    -- білок, г на кг
  protein_maintain numeric not null default 1.4,
  protein_gain numeric not null default 1.8,
  protein_bmi_cap numeric not null default 25,  -- при ІМТ вище — білок на кг ваги при цьому ІМТ
  fat_pct numeric not null default 25,          -- жири, % калорій; вуглеводи — решта
  steps_lose int not null default 7000,
  steps_maintain int not null default 7000,
  steps_gain int not null default 6000,
  min_kcal_female int not null default 1200,
  min_kcal_male int not null default 1500,
  floor_bmr boolean not null default true,      -- схуднення не нижче обміну в спокої
  act_sedentary numeric not null default 1.2,
  act_light numeric not null default 1.375,
  act_moderate numeric not null default 1.55,
  act_active numeric not null default 1.725,
  note text,
  updated_at timestamptz not null default now()
);
insert into public.formula (id) values ('default') on conflict do nothing;

alter table public.formula enable row level security;
drop policy if exists read_all on public.formula;
create policy read_all on public.formula for select to authenticated using (true);
-- No write policy: only the owner changes it, in the dashboard.

-- Overview with the new columns (replaces the one from 0002).
drop view if exists admin.goals_overview;
create view admin.goals_overview as
select u.email, p.name as user_name, g.profile_id, g.auto, g.goal, g.kcal, g.protein, g.steps,
       g.sex, g.birth_year, g.height_cm, g.weight_kg, g.activity, g.kcal_adjust, g.protein_per_kg, g.updated_at, g.owner
from public.goals g
join auth.users u on u.id = g.owner
left join public.profiles p on p.owner = g.owner and p.id = g.profile_id
order by u.email, p.name;
revoke all on admin.goals_overview from public, anon, authenticated;

-- What the formula gives each person now — the same arithmetic as src/model/targets.ts.
-- weight_used: the latest measured weight, else weight_kg. Empty when body data is missing.
drop view if exists admin.targets_preview;
create view admin.targets_preview as
with f as (select * from public.formula where id = 'default'),
b as (
  select g.owner, g.profile_id, g.auto, coalesce(g.goal, 'lose') as goal, g.sex, g.height_cm, g.kcal_adjust, g.protein_per_kg,
         g.kcal as kcal_now, g.protein as protein_now, g.steps as steps_now,
         extract(year from now())::int - g.birth_year as age,
         coalesce((select (m.data->>'weight')::numeric from public.measures m
                   where m.owner = g.owner and m.profile_id = g.profile_id and m.data ? 'weight'
                   order by m.date desc limit 1), g.weight_kg) as w,
         case coalesce(g.activity, 'light') when 'sedentary' then f.act_sedentary when 'light' then f.act_light
              when 'moderate' then f.act_moderate else f.act_active end as act
  from public.goals g cross join f
),
e as (
  select b.*, 10 * w + 6.25 * height_cm - 5 * age + case when sex = 'm' then 5 else -161 end as bmr from b
),
k as (
  select e.*, bmr * act as tdee,
         round((case e.goal
           when 'lose' then greatest(bmr * act * (1 - f.deficit_pct / 100), case when sex = 'm' then f.min_kcal_male else f.min_kcal_female end,
                                     case when f.floor_bmr then bmr else 0 end)
           when 'gain' then bmr * act * (1 + f.surplus_pct / 100)
           else bmr * act end + kcal_adjust) / 10) * 10 as kcal_formula,
         round(least(w, f.protein_bmi_cap * (height_cm / 100) ^ 2)
               * coalesce(protein_per_kg, case e.goal when 'lose' then f.protein_lose when 'gain' then f.protein_gain else f.protein_maintain end) / 5) * 5 as protein_formula,
         case e.goal when 'lose' then f.steps_lose when 'gain' then f.steps_gain else f.steps_maintain end as steps_formula
  from e cross join f
)
select u.email, p.name as user_name, k.profile_id, k.auto, k.goal, k.age, round(k.w, 1) as weight_used,
       round(k.w / (k.height_cm / 100) ^ 2, 1) as bmi, round(k.bmr) as bmr, round(k.tdee) as tdee,
       case when k.bmr is not null then k.kcal_formula end as kcal_formula,
       case when k.bmr is not null then k.protein_formula end as protein_formula,
       case when k.bmr is not null then k.steps_formula end as steps_formula, k.kcal_now, k.protein_now, k.steps_now
from k
join auth.users u on u.id = k.owner
left join public.profiles p on p.owner = k.owner and p.id = k.profile_id
order by u.email, p.name;
revoke all on admin.targets_preview from public, anon, authenticated;
