/**
 * Records the «Тіло» feature demo with synthetic data.
 *
 *   npm run dev                       # in another terminal (http://localhost:5173/food-body-and-activity/)
 *   node scripts/demo/record.mjs      # → demo/tilo-demo.mp4 (1080×1920)
 *
 * Needs Playwright (with Chromium) and ffmpeg. Data comes from scripts/demo/seed.ts and lives only in the
 * recording browser's throwaway profile.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.DEMO_URL ?? 'http://localhost:5173/food-body-and-activity/';
const OUT = join(process.cwd(), 'demo');
const W = 390, H = 844;

/** Caption, tap ripple and title cards, drawn over the app in its own fonts and colours. */
const OVERLAY = () => {
  const css = `
    .demo-cap{position:fixed;left:16px;right:16px;bottom:100px;z-index:99999;pointer-events:none;
      background:rgba(43,33,27,.92);color:#fbf6ef;border-radius:20px;padding:14px 18px;
      font:600 17px/1.3 var(--font-ui,system-ui);box-shadow:0 10px 30px rgba(0,0,0,.18);
      opacity:0;transform:translateY(12px);transition:opacity .35s,transform .35s}
    .demo-cap.on{opacity:1;transform:none}
    .demo-cap.top{bottom:auto;top:16px;transform:translateY(-12px)}
    .demo-cap.top.on{transform:none}
    .demo-cap small{display:block;font-weight:500;font-size:14px;opacity:.78;margin-top:4px}
    .demo-tap{position:fixed;z-index:99999;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
      background:rgba(160,72,40,.28);border:2px solid rgba(160,72,40,.7);pointer-events:none;
      animation:demo-tap .55s ease-out forwards}
    @keyframes demo-tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}
    .demo-card{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:14px;text-align:center;padding:32px;background:#f4eee6;color:#2b211b;
      opacity:0;transition:opacity .5s;pointer-events:none}
    .demo-card.on{opacity:1}
    .demo-card h1{font:500 56px/1 var(--font-entry,Georgia);margin:0}
    .demo-card p{font:500 18px/1.45 var(--font-ui,system-ui);margin:0;color:#6d5d51}
    .demo-card .dots{display:flex;gap:6px;margin-top:8px}
    .demo-card .dots i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font:600 14px var(--font-entry,Georgia);font-style:normal}`;
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.append(s);
  });
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'tilo-demo-'));
  const browser = await chromium.launch();

  const ctxOpts = { viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'uk-UA', timezoneId: 'Europe/Kyiv', hasTouch: true, isMobile: true };

  // Synthetic data goes in through the app's own storage code before the screencast starts.
  // Frames come from the DevTools screencast at full device resolution (Playwright's recordVideo
  // doesn't scale with deviceScaleFactor), each held until the next one arrives.
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(async (base) => (await import(base + 'scripts/demo/seed.ts')).seed(), new URL(BASE).pathname);
  await page.goto(BASE + '#/today');
  await page.reload();
  await page.waitForSelector('.screen');
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(tmp, `f${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));

  const wait = (ms) => page.waitForTimeout(ms);
  const caption = (title, sub = '', top = false) => page.evaluate(([title, sub, top]) => {
    let el = document.querySelector('.demo-cap');
    if (!el) { el = document.createElement('div'); el.className = 'demo-cap'; document.body.append(el); }
    el.classList.remove('on');
    if (!title) return;
    el.classList.toggle('top', top);
    el.innerHTML = title + (sub ? `<small>${sub}</small>` : '');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  }, [title, sub, top]);
  const card = async (html, ms) => {
    await page.evaluate((html) => {
      const el = document.createElement('div');
      el.className = 'demo-card';
      el.innerHTML = html;
      document.body.append(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    }, html);
    await wait(ms);
    await page.evaluate(() => {
      const el = document.querySelector('.demo-card');
      el?.classList.remove('on');
      setTimeout(() => el?.remove(), 600);
    });
    await wait(600);
  };
  const tap = async (loc, pause = 700) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (b) {
      await page.evaluate(([x, y]) => {
        const d = document.createElement('div');
        d.className = 'demo-tap';
        d.style.left = x + 'px'; d.style.top = y + 'px';
        document.body.append(d);
        setTimeout(() => d.remove(), 700);
      }, [b.x + b.width / 2, b.y + b.height / 2]);
      await wait(180);
    }
    await loc.click();
    await wait(pause);
  };
  /** Smooth scroll of the page (or a sheet), in small steps so it reads well on video. */
  const scroll = async (dy, ms = 1200, sel = null) => {
    const steps = Math.max(1, Math.round(ms / 16));
    for (let i = 0; i < steps; i++) {
      await page.evaluate(([d, sel]) => {
        const t = sel ? document.querySelector(sel) : null;
        (t ?? window).scrollBy(0, d);
      }, [dy / steps, sel]);
      await wait(16);
    }
  };
  const scrollTop = () => page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
  const tab = (name) => tap(page.locator('nav.sf-tabs').getByRole('link', { name }), 900);
  const type = async (loc, text) => {
    await loc.click();
    await loc.fill('');
    await loc.pressSequentially(text, { delay: 120 });
  };

  await page.goto(BASE + '#/today');
  await page.waitForSelector('.screen');
  const dot = (l, c) => `<i style="background:var(--d-${c}-soft,#eee);color:var(--d-${c}-ink,#333)">${l}</i>`;

  // Intro
  await card(`<h1>Тіло</h1><p>Раціон тренера, кроки й заміри —<br>в одному застосунку на телефоні</p>
    <div class="dots">${[['а', 'leisure'], ['б', 'relationships'], ['в', 'nature'], ['г', 'money'], ['д', 'sleep'], ['е', 'mood'], ['є', 'work'], ['ж', 'home']].map(([l, c]) => dot(l, c)).join('')}</div>`, 2800);

  // Home
  await caption('Головна', 'Калорії, 8 груп, білок, кроки і вага — день з одного погляду');
  await wait(2600);
  await caption('Тиждень угорі', 'Кільце кожного дня показує, наскільки виконано план');
  await tap(page.locator('.sf-day').nth(4), 1400).catch(() => wait(1000));
  await page.goto(BASE + '#/today'); await wait(700);
  await caption('Кава, чай і газована без цукру', 'Лічильники з правил тренера');
  await scroll(320, 1100);
  await tap(page.getByRole('button', { name: 'Більше' }).first(), 900).catch(() => wait(600));
  await wait(900);
  await scrollTop(); await wait(500);

  // Ration
  await tab('Раціон');
  await caption('Раціон', 'План тренера: продукти в групі — взаємозамінні й ділять одну норму');
  await wait(2400);
  await caption('Записати продукт', 'Наприклад, куряче філе з групи «б»');
  const fillet = page.locator('.gcard__item', { hasText: 'Куряче або індиче філе' });
  if (!(await fillet.isVisible())) await tap(page.locator('.gcard__head', { hasText: 'М’ясо, риба, яйця' }), 600);
  await tap(fillet, 900);
  await caption('Зважуйте готове', 'Застосунок сам перерахує в сиру вагу, яку рахує план', true);
  await tap(page.getByRole('radio', { name: 'Смажене' }), 800);
  await type(page.locator('#amount'), '160');
  await wait(1500);
  await tap(page.getByRole('button', { name: 'Записати' }).last(), 900);
  await caption('Смажили?', 'Застосунок запропонує додати олію в групу «г»', true);
  await wait(1200);
  await tap(page.locator('.sf-chip', { hasText: /^10 г$/ }).first(), 1200).catch(() => wait(800));

  await scrollTop(); await wait(600);
  await caption('Що приготувати з залишку', 'Залишок ділиться на прийоми їжі — і з нього складаються страви');
  await page.getByRole('heading', { name: 'Що приготувати з залишку' }).first().scrollIntoViewIfNeeded().catch(() => {});
  await wait(1600);
  await tap(page.getByRole('radio', { name: '2' }).first(), 1200).catch(() => wait(600));
  await caption('Одним дотиком', 'Можна підправити грами — і записати всю страву', true);
  await tap(page.getByRole('button', { name: 'Записати', exact: true }).first(), 1500);
  await tap(page.getByRole('button', { name: /Записати страву/ }), 1300);
  await caption('Прогрес по групах', 'Понад норму — чесно червоним, без заборон');
  await scroll(900, 2600);
  await wait(800);
  await scrollTop(); await wait(400);

  // Steps
  await tab('Кроки');
  await caption('Кроки', 'Ціль 7 000 на день, тиждень на графіку');
  await wait(1200);
  await tap(page.getByRole('button', { name: '+1000' }), 700);
  await tap(page.getByRole('button', { name: '+1000' }), 700);
  await tap(page.getByRole('button', { name: '+1000' }), 1500);
  await caption('Кроки', 'Дотик до стовпчика — відкриває той день');
  await scroll(300, 900);
  await wait(1400);

  // Measures
  await tab('Заміри');
  await caption('Заміри раз на тиждень', 'Вага, талія, стегна, груди, рука, нога — і тренд ваги');
  await wait(2600);
  await scroll(520, 1600);
  await caption('Фото прогресу', 'Порівняння «до» і «після» поруч', true);
  await tap(page.getByRole('button', { name: 'Порівняти' }), 2600);
  await page.keyboard.press('Escape'); await wait(400);
  await page.getByRole('button', { name: /Закрити/ }).last().click().catch(() => {});
  await wait(600);
  await scrollTop(); await wait(400);

  // Settings
  await tab('Опції');
  await caption('Кілька людей на одному телефоні', 'Ті самі користувачі, що й у «Сферах», — дані окремо');
  await wait(2400);
  await caption('Ваші дані — у вашому приватному GitHub', 'Синхронізація, експорт у CSV і JSON, план тренера можна редагувати');
  await scroll(700, 2600);
  await wait(1200);
  await caption('');

  // Outro
  await card(`<h1>Тіло</h1><p>Офлайн, без реклами й акаунтів.<br>Працює в парі зі «Сферами».</p>
    <p style="font-size:15px">andrewreddish.github.io/food-body-and-activity</p>`, 3200);

  await cdp.send('Page.stopScreencast');
  const end = Date.now() / 1000;
  await ctx.close();
  await browser.close();

  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? end) - f.t).toFixed(3)}`);
  list.push(`file '${frames.at(-1).file}'`);
  writeFileSync(join(tmp, 'frames.txt'), list.join('\n'));
  // 1080×1920 (Reels/Shorts/Stories): the phone screen centred on the app's background colour.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'frames.txt'),
    '-vf', 'scale=-2:1920:flags=lanczos,pad=1080:1920:(ow-iw)/2:0:color=0xF4EEE6,fps=30',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(OUT, 'tilo-demo.mp4')]);
  rmSync(tmp, { recursive: true, force: true });
  console.log('Saved', join(OUT, 'tilo-demo.mp4'));
}

main().catch((e) => { console.error(e); process.exit(1); });
