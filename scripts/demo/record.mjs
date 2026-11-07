/**
 * Records the Tonus feature showcase with synthetic data: 1920×1080, chapter text on the left,
 * the live app in a phone frame on the right (scripts/demo/stage.html).
 *
 *   npm run dev                       # in another terminal (http://localhost:5173/food-body-and-activity/)
 *   npm run demo                      # → demo/tonus-showcase.mp4, with sound
 *   npm run demo -- --no-music        # interface sounds and transitions only
 *   npm run demo -- --silent          # no audio track
 *
 * The app must run local-only for the recording: if .env.local has Supabase settings, start the dev server
 * with them blanked (VITE_SUPABASE_URL= npm run dev), or the app opens on the sign-in screen.
 *
 * Sound: the app's own interface sounds are logged while recording (a hook in src/lib/sound.ts) and rendered
 * afterwards together with chapter transitions and a quiet generated melody (scripts/demo/audio.js).
 *
 * Needs Playwright (with Chromium) and ffmpeg. Data comes from scripts/demo/seed.ts and lives only in the
 * recording browser's throwaway profile.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDemoAudio } from './audio.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.DEMO_URL ?? 'http://localhost:5173/food-body-and-activity/';
const STAGE = BASE + 'scripts/demo/stage.html';
const OUT = join(process.cwd(), 'demo');
const FILE = join(OUT, 'tonus-showcase.mp4');
const FOOT = 'Демо-дані · 4 тижні записів';
const SILENT = process.argv.includes('--silent');
const MUSIC = !process.argv.includes('--no-music');
/**
 * Screencast frames show a change ~0.2 s after it happens (capture latency), measured from the tap ripple
 * drawn before each click. Sounds are delayed by the same amount so they land on the picture.
 */
const AV_DELAY = Number(process.env.DEMO_AV_DELAY ?? 0.2);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'tonus-demo-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'uk-UA', timezoneId: 'Europe/Kyiv' });
  // Every interface sound the app plays, with the time it played (the app frame calls this via sound.ts).
  const events = [];
  await ctx.exposeBinding('__soundTap', (_source, name, n) => { events.push({ t: Date.now() / 1000, name, n }); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));

  // Synthetic data goes in through the app's own storage code (same origin as the stage's iframe).
  await page.goto(BASE);
  await page.evaluate(async (base) => (await import(base + 'scripts/demo/seed.ts')).seed(), new URL(BASE).pathname);
  await page.goto(STAGE + '?app=' + encodeURIComponent(BASE + '#/today'));
  const frame = await (await page.waitForSelector('#app')).contentFrame();
  await frame.waitForSelector('.screen');
  if (await frame.locator('#password').count()) {
    throw new Error('The app opened on the sign-in screen: Supabase is configured. Start the dev server local-only: VITE_SUPABASE_URL= npm run dev');
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  // Frames come from the DevTools screencast, each held until the next one arrives.
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(tmp, `f${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

  const app = page.frameLocator('#app');
  const wait = (ms) => page.waitForTimeout(ms);
  let covers = 0;
  const chapter = (c) => {
    events.push({ t: Date.now() / 1000, name: c.cover ? (covers++ === 0 ? 'intro' : 'outro') : 'chapter' });
    return page.evaluate((c) => window.showCopy(c), { foot: FOOT, ...c });
  };
  /** A soft ripple where the "finger" lands (drawn on the stage, over the phone), then the real click. */
  const tap = async (loc, pause = 700) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (b) {
      await page.evaluate(([x, y]) => {
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;z-index:9;left:${x - 26}px;top:${y - 26}px;width:52px;height:52px;border-radius:50%;
          background:rgba(150,110,90,.28);pointer-events:none;transition:transform .55s ease-out,opacity .55s ease-out`;
        document.body.append(d);
        requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = 'scale(1.5)'; d.style.opacity = '0'; }));
        setTimeout(() => d.remove(), 700);
      }, [b.x + b.width / 2, b.y + b.height / 2]);
      await wait(200);
    }
    await loc.click();
    await wait(pause);
  };
  /** Smooth scroll inside the app, in small steps so it reads well on video. */
  const scroll = async (dy, ms = 1200) => {
    const steps = Math.max(1, Math.round(ms / 16));
    for (let i = 0; i < steps; i++) {
      await frame.evaluate((d) => scrollBy(0, d), dy / steps);
      await wait(16);
    }
  };
  const scrollTop = async () => { await frame.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' })); await wait(500); };
  const tab = (name) => tap(app.locator('nav.sf-tabs').getByRole('link', { name }), 900);
  const type = async (loc, text) => {
    await loc.click();
    await loc.fill('');
    await loc.pressSequentially(text, { delay: 130 });
  };

  // Cover
  await chapter({ cover: true, title: 'Раціон, кроки й заміри', uk: 'План харчування по групах — без підрахунку калорій уручну. Кілька дотиків на день.', en: 'A group-based meal plan, daily steps and weekly measurements — a few taps a day.', foot: '' });
  await wait(4200);

  // 01 Home
  await chapter({ pill: '01 · Головна', title: 'Увесь день на одному екрані', uk: 'Калорії, вісім груп, білок, кроки й вага. Кільця тижня показують, як ішов план.', en: 'Calories, eight food groups, protein, steps and weight at a glance.' });
  await wait(2600);
  await tap(app.locator('.sf-day').nth(4), 1600);
  await tap(app.locator('.sf-day').nth(6), 1000);
  await scroll(330, 1200);
  await tap(app.getByRole('button', { name: 'Більше' }).first(), 1500);
  await scrollTop();

  // 02 Ration
  await tab('Раціон');
  await chapter({ pill: '02 · Раціон', title: 'Вісім груп — одна норма на кожну', uk: 'Продукти в групі взаємозамінні: що з’їв — віднімається від спільних 100%.', en: 'Foods in a group are alternatives that share one 100% budget.' });
  await wait(1800);
  await scroll(760, 2200);
  await wait(900);
  const fillet = app.locator('.gcard__item', { hasText: 'Куряче або індиче філе' });
  if (!(await fillet.isVisible())) await tap(app.locator('.gcard__head', { hasText: 'М’ясо, риба, яйця' }), 600);

  // 03 Cooked → raw
  await chapter({ pill: '03 · Готове → сире', title: 'Зважили готове — план порахує сире', uk: 'Варене, запечене чи смажене перераховується в сиру вагу. Після смаженого — нагадування про олію.', en: 'Weigh it cooked; the app converts it to the raw weight the plan counts.' });
  await tap(fillet, 1200);
  await tap(app.getByRole('radio', { name: 'Смажене' }), 900);
  await type(app.locator('#amount'), '160');
  await wait(800);
  await frame.evaluate(() => document.querySelector('.sf-sheet__body, .sf-sheet')?.scrollBy({ top: 300, behavior: 'smooth' }));
  await wait(2000);
  await tap(app.getByRole('button', { name: 'Записати', exact: true }).last(), 1300);
  await tap(app.locator('.sf-chip', { hasText: /^10 г$/ }).first(), 1500);
  await scrollTop();

  // 04 Dish ideas
  await chapter({ pill: '04 · Що приготувати', title: 'Страви із залишку норми', uk: 'Залишок ділиться на прийоми їжі, що лишились, — і з нього складаються страви з грамовками.', en: 'What’s left is split over the remaining meals and turned into dishes.' });
  await app.getByRole('heading', { name: 'Що приготувати з залишку' }).first().scrollIntoViewIfNeeded();
  await wait(1600);
  await tap(app.getByRole('radio', { name: '2' }).first(), 1500);
  await tap(app.getByRole('button', { name: 'Записати', exact: true }).first(), 2200);
  await tap(app.getByRole('button', { name: /Записати страву/ }), 1500);
  await scrollTop();
  await wait(800);

  // 05 Steps
  await tab('Кроки');
  await chapter({ pill: '05 · Кроки', title: 'Ціль на день і тиждень на графіку', uk: 'Вносьте число з телефона чи годинника. 7 000 кроків — ціль за замовчуванням.', en: 'Enter today’s steps; the week is one bar chart against your goal.' });
  await wait(1400);
  await tap(app.getByRole('button', { name: '+1000' }), 650);
  await tap(app.getByRole('button', { name: '+1000' }), 650);
  await tap(app.getByRole('button', { name: '+1000' }), 1600);
  await scroll(320, 1000);
  await wait(1800);
  await scrollTop();

  // 06 Measures
  await tab('Заміри');
  await chapter({ pill: '06 · Заміри', title: 'Раз на тиждень — вага, обхвати, фото', uk: 'Тренд ваги, зміни з першого заміру і фото «до» та «після» поруч.', en: 'Weekly weight, tape measurements and progress photos side by side.' });
  await wait(2600);
  await scroll(560, 1600);
  await wait(600);
  await tap(app.getByRole('button', { name: 'Порівняти' }), 3200);
  await tap(app.getByRole('button', { name: 'Закрити' }).last(), 800);
  await scrollTop();

  // 07 Settings
  await tab('Опції');
  await chapter({ pill: '07 · Опції', title: 'Ваш план, ваші дані', uk: 'План тренера можна змінити. Кілька людей на одному телефоні, синхронізація з вашим акаунтом, експорт у CSV і JSON.', en: 'Edit the plan, add people, sync to your account, export anytime.' });
  await wait(2600);
  await scroll(620, 2200);
  await wait(800);
  await tap(app.getByRole('radio', { name: 'Темна' }).or(app.getByRole('button', { name: 'Темна' })).first(), 1400);
  await scrollTop();
  await tab('Головна');

  // Outro (dark theme)
  await chapter({ cover: true, title: 'Tonus', uk: 'Офлайн-PWA на iPhone · синхронізація з акаунтом · кілька користувачів.', en: 'Offline PWA for iPhone · account sync · several users on one device.', foot: '' });
  await wait(4500);

  await cdp.send('Page.stopScreencast');
  const end = Date.now() / 1000;

  // Audio track: offsets on the same clock as the screencast frames.
  const t0 = frames[0].t;
  const wav = join(tmp, 'audio.wav');
  if (!SILENT) {
    const timeline = events.map((e) => ({ at: +(e.t - t0 + AV_DELAY).toFixed(3), name: e.name, n: e.n }));
    writeFileSync(join(tmpdir(), 'tonus-showcase.sounds.json'), JSON.stringify(timeline, null, 1)); // for checking the timing
    const b64 = await page.evaluate(renderDemoAudio, { base: new URL(BASE).pathname, duration: end - t0, events: timeline, music: MUSIC });
    writeFileSync(wav, Buffer.from(b64, 'base64'));
    console.log(`Audio: ${timeline.filter((e) => e.at >= 0).length} sound events${MUSIC ? ' + melody' : ''}`);
  }
  await ctx.close();
  await browser.close();

  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? end) - f.t).toFixed(3)}`);
  list.push(`file '${frames.at(-1).file}'`);
  writeFileSync(join(tmp, 'frames.txt'), list.join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'frames.txt'),
    ...(SILENT ? [] : ['-i', wav]),
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    ...(SILENT ? [] : ['-af', 'volume=4dB,alimiter=limit=0.84:level=false', '-c:a', 'aac', '-b:a', '192k', '-shortest']),
    '-movflags', '+faststart', FILE]);
  rmSync(tmp, { recursive: true, force: true });
  console.log('Saved', FILE);
}

main().catch((e) => { console.error(e); process.exit(1); });
