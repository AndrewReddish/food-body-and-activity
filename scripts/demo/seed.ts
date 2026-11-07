/**
 * Synthetic demo data for the feature video (scripts/demo/record.mjs).
 * Runs inside the app page through the Vite dev server, using the app's own storage code,
 * so everything goes through the same Zod schemas. Never shipped in the build.
 */
import { db, getPlan, patchSettings, putDay, putMeasure, putPhoto } from '../../src/storage/db';
import { putProfile, setActiveId, DEFAULT_PROFILE } from '../../src/storage/profiles';
import { makeLog } from '../../src/model/cooking';
import { addDays, todayKey } from '../../src/lib/dates';
import type { DayLog, FoodLog, Measure, Method } from '../../src/model/types';

const EPOCH = '2026-01-01T08:00:00.000Z';
let rnd = 42;
const rand = () => ((rnd = (rnd * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

/** A soft synthetic "progress photo": gradient + silhouette, slimmer as weeks go by. */
async function photo(week: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 800;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 800);
  bg.addColorStop(0, '#efe6dc'); bg.addColorStop(1, '#d8c8b8');
  g.fillStyle = bg; g.fillRect(0, 0, 600, 800);
  g.fillStyle = '#8f7a68';
  const w = 1 - week * 0.035;
  g.beginPath(); g.arc(300, 150, 62, 0, Math.PI * 2); g.fill();
  g.beginPath();
  g.moveTo(300 - 150 * w, 250); g.quadraticCurveTo(300 - 175 * w, 470, 300 - 120 * w, 560);
  g.lineTo(300 - 95 * w, 790); g.lineTo(300 + 95 * w, 790); g.lineTo(300 + 120 * w, 560);
  g.quadraticCurveTo(300 + 175 * w, 470, 300 + 150 * w, 250); g.closePath(); g.fill();
  return new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.85));
}

export async function seed(): Promise<void> {
  const plan = await getPlan();
  const item = (id: string) => plan.items.find((i) => i.id === id)!;
  const group = (id: string) => plan.groups.find((g) => g.id === id)!;
  let n = 0;
  const log = (date: string, id: string, method: Method, weighed: number, hour: number): FoodLog =>
    makeLog(item(id), group(item(id).group), method, weighed, `demo-${n++}`, `${date}T${String(hour).padStart(2, '0')}:15:00.000Z`);

  /** A full, plausible day: each group close to (sometimes just over) 100%. */
  const fullDay = (d: string): FoodLog[] => {
    const f = rand();
    return [
      log(d, 'eggs', 'boiled', pick([2, 3]), 7),
      log(d, pick(['bread', 'crispbread']), 'raw', 55, 7),
      log(d, 'cottage', 'raw', Math.round(325 * (0.9 + rand() * 0.15)), 10),
      log(d, pick(['rice', 'grain', 'pasta']), 'boiled', Math.round(110 + rand() * 40), 13),
      log(d, pick(['fillet', 'fish-lean']), pick(['baked', 'boiled']), Math.round(200 + rand() * 60), 13),
      log(d, 'veg', 'raw', Math.round(350 + rand() * 200), 13),
      log(d, 'oil', 'raw', Math.round(10 + rand() * 8), 13),
      log(d, pick(['fruit', 'sweet-fruit']), 'raw', Math.round(220 + rand() * 120), 16),
      log(d, 'nuts', 'raw', Math.round(15 + rand() * 7), 16),
      log(d, 'kefir', 'raw', Math.round(250 + rand() * 150), 20),
      log(d, f > 0.5 ? 'anything' : 'zh-fruit', 'raw', f > 0.5 ? Math.round(60 + rand() * 45) : 500, 19),
      log(d, 'veal', 'baked', Math.round(70 + rand() * 40), 19),
    ];
  };

  const today = todayKey();
  for (let i = 27; i >= 1; i--) {
    const d = addDays(today, -i);
    const day: DayLog = {
      schemaVersion: 1, date: d, food: fullDay(d),
      steps: Math.round((5200 + rand() * 5600) / 10) * 10,
      cups: Math.floor(1 + rand() * 3), soda: rand() > 0.6 ? 330 : undefined,
      createdAt: `${d}T07:00:00.000Z`, updatedAt: `${d}T21:00:00.000Z`,
    };
    await putDay(day);
  }
  // Today: breakfast and a snack so far — groups are part-way, so dish ideas have something to work with.
  await putDay({
    schemaVersion: 1, date: today,
    food: [log(today, 'eggs', 'boiled', 2, 7), log(today, 'bread', 'raw', 40, 7), log(today, 'cottage', 'raw', 180, 10), log(today, 'fruit', 'raw', 150, 10)],
    steps: 4320, cups: 2, createdAt: `${today}T07:00:00.000Z`, updatedAt: `${today}T11:00:00.000Z`,
  });

  // Weekly measurements, 8 weeks, a steady ~0.6 kg/week trend with noise; photos every 2 weeks.
  for (let w = 7; w >= 0; w--) {
    const d = addDays(today, -w * 7 - 1);
    const k = 7 - w;
    const m: Measure = {
      schemaVersion: 1, date: d,
      weight: Math.round((88.4 - k * 0.62 + (rand() - 0.5) * 0.5) * 10) / 10,
      waist: Math.round((96 - k * 0.8) * 2) / 2, hips: Math.round((104 - k * 0.5) * 2) / 2,
      chest: Math.round((102 - k * 0.3) * 2) / 2, arm: 33.5, thigh: Math.round((60 - k * 0.3) * 2) / 2,
      createdAt: `${d}T08:00:00.000Z`, updatedAt: `${d}T08:00:00.000Z`,
    };
    if (k % 3 === 0) {
      const id = `demo-${d}`;
      await putPhoto({ id, date: d, blob: await photo(k) });
      m.photos = [id];
    }
    await putMeasure(m);
  }

  await patchSettings({ lang: 'uk', theme: 'light', sound: false, installHintSeen: true });
  await db.dirty.clear(); // nothing to push: no repo is connected
  await putProfile({ ...DEFAULT_PROFILE, name: 'Олена', updatedAt: EPOCH });
  await putProfile({ id: 'maks', name: 'Макс', color: 'nature', createdAt: EPOCH, updatedAt: EPOCH });
  await setActiveId('me');
}
