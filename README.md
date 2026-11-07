# Тіло · Body

A phone-first web app for following a group-based meal plan (groups **а–ж**), daily steps and weekly body
measurements. It is the companion to [«Сфери»](https://github.com/AndrewReddish/daily-mood-and-habbits) and shares
its design, users and private data repository. Ukrainian by default, English in Settings.

- **Plan & status:** [PLAN.md](PLAN.md) · **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)

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
[**demo/tilo-demo.mp4**](demo/tilo-demo.mp4) is a 1-minute feature tour (1080×1920) on synthetic data:
4 weeks of meals, steps, cups and 8 weekly measurements with progress photos, for two users.
To re-record after UI changes, run `npm run dev`, then `npm run demo` (needs Playwright with Chromium, and
ffmpeg). The data comes from `scripts/demo/seed.ts`, lives only in the recording browser and is never synced.

## Develop
```sh
npm install
npm run dev        # http://localhost:5173/food-body-and-activity/
npm test           # Vitest unit tests
npm run build      # typecheck + production build into dist/
```

## Deploy & sync
Same setup as «Сфери» (see its DEPLOY.md): enable GitHub Pages → "GitHub Actions" for this repo. If «Сфери» is
already connected on the phone, this app reuses that connection on first launch. Its data goes into the
`food/` folder of the same private data repo.

App link once deployed: https://andrewreddish.github.io/food-body-and-activity/
