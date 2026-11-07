import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = 'http://localhost:5173/food-body-and-activity/';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto(BASE);
await p.evaluate(async () => { const m = await import('/food-body-and-activity/scripts/demo/seed.ts'); await m.seed(); });
const out = process.argv[2];
for (const r of ['today', 'ration', 'steps', 'measures', 'settings']) {
  await p.goto(BASE + '#/' + r); await p.reload(); await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${r}.png`, fullPage: true });
}
await b.close();
