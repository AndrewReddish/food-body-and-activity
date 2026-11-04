# Тіло · Body — plan

Rebuild of the old Telegram mini app («Наука та здоровий глузд») in the style of «Сфери».

## Decisions (Nov 2026)
| Topic | Decision |
|---|---|
| Scope v1 | Ration + Steps + Measurements. Workouts later. |
| Groups | Foods in a group are alternatives sharing one 100% budget. |
| Plan | The coach's full ration text (~2210 kcal; Б 165 / Ж 62 / В 205), editable in Settings, JSON import/export. |
| Raw / cooked | Weight conversion by food-type yield; fried → prompt to log the oil. |
| Steps | Manual entry (a web app can't read Apple Health). |
| Measurements | Weight, waist, hips, chest, arm, thigh, progress photos. |
| Storage | Same private data repo as «Сфери», under `food/`. Same users. |

## Status
- [x] Data contract, cooking algorithm, coach plan seed — unit-tested
- [x] Home, Ration (log sheet, oil prompt, rules), Steps, Measures (chart, photos, compare), Settings (plan editor)
- [x] Sync to `food/` + photos; reuse of «Сфери»'s connection and users
- [x] UA/EN, light/dark, motion and sounds
- [x] v1.1: remaining amount of every food always visible (shrinks proportionally within the group); dish ideas sized to what's left, logged in one tap; built-in menu + own dishes
- [ ] Real-device check on the iPhone; enable Pages for this repo
- [ ] Workouts tab (old app: "0/3 тренувань цього тижня")

## Open questions for Andrew
1. App name (working title «Тіло · Body»).
2. Group calories in the text add up to 2195, not 2210 — kept as written.
3. Protein per food is estimated from a raw-food table (the text gives only daily macros); edit in Settings if the coach has exact numbers.
4. Yields are typical values; tune per food type in Settings → Групи та продукти if your scale disagrees.
