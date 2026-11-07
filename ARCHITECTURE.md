# Architecture

An offline-first PWA on GitHub Pages. IndexedDB on the phone is what the UI reads and writes; a **Supabase**
project (Postgres with row-level security, Auth, Storage) is the remote copy, synced in the background.

## Stack
- **Vite + Preact + TypeScript**, hash routing: `#/today` (`#/day/<date>`), `#/ration[/<date>]`, `#/steps[/<date>]`,
  `#/measures`, `#/settings`. The chosen day carries across tabs.
- **Dexie (IndexedDB)** with **Zod** on every read and write (`src/model/schema.ts`, `src/storage/db.ts`).
- Design tokens, motion, sounds, sheets and users are copied from «Сфери» (`src/styles/tokens.css`,
  `motion.css`, `src/lib/sound.ts`, `src/components/ui.tsx`, `profiles.tsx`). Food-specific styles: `food.css`.
  Group colours reuse the 10 domain palettes.

## Model
- `Plan` (`plan.json`): kcal target, protein target, steps goal, 8 `groups` (letter, ~kcal, palette) and `items`
  (100% amount in raw g or pieces, food type `cook`, protein at 100%). Seed = the coach's text, in `defaults.ts`.
- `DayLog` (`days/YYYY-MM.json`): `food[]`, `steps`, `cups`, `soda`. Each food row stores what the scale showed
  (`weighed`, `method`) **and** the result (`raw`, `frac` of the group, `kcal`, `protein`), so editing the plan
  later doesn't rewrite history.
- `Measure` (`measures/YYYY.json`): weight + 5 tape fields + photo ids. Photos: JPEG ≤1280 px,
  `photos/<id>.jpg`, Blobs in IndexedDB.

## Raw ↔ cooked (`src/model/cooking.ts`)
`raw = weighed / yield(foodType, method)`. Yields are typical cooking-loss factors (meat 0.65–0.70, poultry
0.72–0.75, fish 0.80–0.85, rice 2.7, grains 2.5, pasta 2.3, legumes 2.4, potato 0.65–0.98, vegetables
0.75–0.9, mushrooms 0.55–0.6). Only the methods a food type has are offered. Switching method keeps the raw
amount and converts the number on screen. kcal = group kcal × share; protein = item protein × share.
Group share = Σ raw/max over its foods; "done" at ≥ 95%. The slider stops at what's left; typing more is flagged.

## Dish ideas (`src/model/dishes.ts`)
What's left of each group is split evenly over the meals still to come (1–4, default by time of day).
A dish is a list of parts (group + preferred foods + optional cooking method + share). `buildDish` fills each
part from the per-meal budget, rounding down (5 g steps, 1 g for small foods, whole pieces), falling back to the
next food when one would be too small, and returns ready-to-save log rows. `suggest` ranks main dishes by how
much of the budget they use (breakfasts first in the morning), adds a dessert/snack from what the main leaves,
and rotates alternatives by `seed`. Logging a suggestion can't take any group over 100% (unit-tested).
Built-in menu: `BUILTIN_DISHES`; the user's own dishes and hidden built-ins live in `plan.json`
(`dishes`, `hiddenDishes`, optional fields).

## Sync
- Remote: Supabase, set at build time with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
  (`src/storage/supabase.ts`). Schema, RLS and the photo bucket: `supabase/migrations/0001_tilo.sql`.
- Sign-in: email + password (Supabase Auth, "Confirm email" off, so no emails are sent). Email links were dropped:
  iOS opens them in the browser, never in a home-screen app, so the one-time token is used up there.
  One account per phone owner; the app's users are rows in it. Forgotten passwords are reset by the owner (docs/ADMIN.md).
- Tables `profiles`, `plans`, `days`, `measures`, keyed by `(owner, profile_id, date)`. `data` holds the record
  as the app stores it and is validated with Zod on the way back in.
- Every local write marks a path dirty (`days/YYYY-MM.json`, `measures/YYYY.json`, `plan.json`,
  `photos/<id>.jpg`). Push sends the records behind those paths ~3 s after the last edit.
- Newer `updatedAt` wins, on both sides: the server trigger ignores an upsert older than the stored row, and the
  pull keeps the newer record locally. Records are never deleted, so there are no tombstones.
- Pulls are incremental: the server stamps `synced_at` on every accepted write; each device keeps a cursor per
  account (re-reading a 2-minute margin before it).
- The built-in plan is never pushed until it's edited (stamped at the epoch).
- Photos are uploaded once (immutable) to `photos/<uid>/<profile>/<id>.jpg` and downloaded when a measurement
  references one this device lacks.
- The first sign-in of an account on a device marks everything local as dirty and uploads it, for every user.
- The merge logic (`src/storage/sync-remote.ts`) talks to a small `RemoteStore` interface (`remote.ts`);
  unit tests run it against an in-memory store with the same rules as the SQL migration.

## Layout
```
src/
  routes/      Today, Ration, Steps, Measures, Settings
  components/  ui.tsx, food.tsx (Ring, GroupChip, DayStrip, LogSheet, OilSheet, RulesSheet), profiles.tsx
  model/       schema.ts, types.ts, defaults.ts (coach plan), cooking.ts (yields, budget, summaries)
  storage/     db.ts, merge.ts, remote.ts, supabase.ts, sync-remote.ts, sync.ts, export.ts, profiles.ts, session.ts
  lib/         dates, router, useDay, usePlan, useMeasures, sound, profile
tests/unit/    cooking, schema, sync-remote (in-memory store incl. photos), export, dates
```
