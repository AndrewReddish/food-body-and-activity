# Тіло · Body

A phone-first web app for following a group-based meal plan (groups **а–ж**), daily steps and weekly body
measurements. It works offline and syncs to your account in Supabase. Ukrainian by default, English in Settings.

- **Plan & status:** [PLAN.md](PLAN.md) · **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) · **For the owner (accounts, sign-in, lost access):** [docs/ADMIN.md](docs/ADMIN.md)

## What it does
- **Раціон**: the coach's 8 groups. Foods inside a group are alternatives that share one 100% budget. Log a food
  raw, boiled, baked or fried: cooked weight is converted back to raw weight using a yield for that food type,
  because the plan counts raw weight. Frying offers to log the oil (group г). Going over the plan is allowed and
  shown in red.
- **Кроки**: manual entry against a goal (7 000 by default), with a 7-day chart.
- **Заміри**: weight, waist, hips, chest, arm, thigh and progress photos, with a weight trend and a side-by-side
  photo comparison.
- **Головна**: kcal ring, the 8 groups at a glance, protein, steps, latest weight, and coffee/tea and zero-soda
  counters from the plan's rules.

## Demo
[**demo/tilo-showcase.mp4**](demo/tilo-showcase.mp4) is an 80-second feature tour (1920×1080) on synthetic
data: 4 weeks of meals, steps and cups, and 8 weekly measurements with progress photos, for two users.
Chapter text sits on the left and the live app in a phone frame on the right (`scripts/demo/stage.html`).
To re-record after UI changes, run `npm run dev`, then `npm run demo` (needs Playwright with Chromium, and
ffmpeg). The data comes from `scripts/demo/seed.ts`. It lives only in the recording browser and is never synced.

## Develop
```sh
npm install
npm run dev        # http://localhost:5173/food-body-and-activity/
npm test           # Vitest unit tests
npm run build      # typecheck + production build into dist/
```

## Deploy & sync
The app is an offline-first PWA on GitHub Pages. Everything is stored on the phone (IndexedDB) and, once you
sign in, synced to a Supabase project. Without Supabase settings the app works local-only.

One-time Supabase setup:
1. **Database.** In the Supabase SQL editor, run [`supabase/migrations/0001_tilo.sql`](supabase/migrations/0001_tilo.sql)
   (or `supabase db push`). It creates the `profiles`, `plans`, `days` and `measures` tables with row-level
   security (each account sees only its own rows) and a private `photos` storage bucket.
2. **Sign-in.** Authentication → Sign In / Providers: keep **Email** on. Authentication → Emails → "Magic Link"
   template: add the code, e.g. `<p>Код: <b>{{ .Token }}</b></p>`, next to the link. The app asks for this
   code, because on iPhone a link from Mail opens Safari, not the installed app.
3. **Redirect URLs.** Authentication → URL Configuration: Site URL
   `https://andrewreddish.github.io/food-body-and-activity/`; also allow
   `http://localhost:5173/food-body-and-activity/` for development.
4. **Build settings.** In this GitHub repo → Settings → Secrets and variables → Actions → **Variables**, add
   `SUPABASE_URL` (Project Settings → API → Project URL) and `SUPABASE_PUBLISHABLE_KEY` (the publishable /
   anon key). Never use the `service_role` key in the app. For local development, copy `.env.example` to
   `.env.local` with the same two values.
5. **Pages.** Settings → Pages → Source: **GitHub Actions**.

On the phone, the first screen is sign-up / sign-in: enter your email, then the code from the email (the same
step creates the account the first time). Then the app asks for your name, or, on a new phone with an existing
account, brings your users from it. The first sign-in on a device uploads everything already logged there.

App link once deployed: https://andrewreddish.github.io/food-body-and-activity/
