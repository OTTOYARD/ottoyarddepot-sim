#!/usr/bin/env node
// ============================================================================
// roboticsShots — the Robotics tab in the running cockpit, READ-ONLY by construction: every request to the Supabase
// project is aborted before it leaves the browser, so nothing can start, stop or write anything. Only tab, chip and
// list buttons inside the Robotics tab are pressed.
//
//   npm run dev                                   # or: PORT=8093 npx vite --host 127.0.0.1 --port 8093
//   node scripts/roboticsShots.mjs --url http://127.0.0.1:8093/ --out docs/pr-shots/robotics --dsf 2
// ============================================================================
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg('--url', 'http://127.0.0.1:8080/');
const OUT = arg('--out', './shots');
const DSF = Number(arg('--dsf', '1'));
const W = Number(arg('--w', '1600')), H = Number(arg('--h', '1000'));
const ONLY = arg('--only', null);
const CYCLE = process.argv.includes('--cycle');   // film each robot's cycle instead: play at 8x, shoot every few seconds
const exe = arg('--chromium', fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
let aborted = 0;
await page.route(/supabase\.co/, (r) => { aborted++; return r.abort(); });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(URL_, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^Robotics$/ }).first().click({ timeout: 120000 });
await page.waitForSelector('[data-testid="robotics-tab"]', { timeout: 120000 });

async function settle(label) {
  await page.waitForFunction(() => !document.body.innerText.includes('Load the model'), null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  if (!ONLY || ONLY.split(',').includes(label)) {
    const f = `${OUT}/${label}.png`;
    await page.screenshot({ path: f });
    console.log('shot', f);
  }
}
// Software rendering runs at about 1 frame a second, so every click waits until the tab shows its effect.
async function click(sel, pressed = true) {
  await page.locator(sel).first().click();
  if (pressed !== null) {
    await page.waitForFunction(([s, want]) => {
      const el = document.querySelector(s);
      return !!el && (el.getAttribute('aria-pressed') === 'true') === want;
    }, [sel, pressed], { timeout: 120000 });
  }
}

if (CYCLE) {
  for (const robot of ['charge_arm', 'clean_arm', 'wash_gantry']) {
    await click(`[data-testid="robot-${robot}"]`);
    await settle(`cycle-${robot}-0`);
    await click('[data-testid="speed-8"]');
    await click('[data-testid="cycle-play"]');
    for (let i = 1; i <= 5; i++) {
      await page.waitForTimeout(6000);
      const step = await page.locator('[data-testid="cycle-step"]').innerText();
      console.log(robot, i, step.split('\n')[0]);
      await page.screenshot({ path: `${OUT}/cycle-${robot}-${i}.png` });
    }
    await click('[data-testid="cycle-play"]', false);
  }
  await browser.close();
  process.exit(0);
}
await settle('01-charge-arm-stowed');
await click('[data-testid="pose-connected"]');
await settle('02-charge-arm-connected');
await click('[data-testid="subsystem"][data-sub="J2"]');
await settle('03-charge-arm-j2-isolated');
await click('[data-testid="bom-line"][data-part="SWG50-FS"]');
await settle('04-charge-arm-part-card');
await page.getByRole('button', { name: 'Close the part card' }).click();
await page.waitForFunction(() => !document.querySelector('[data-testid="part-card"]'), null, { timeout: 120000 });
await click('[data-testid="subsystem"][data-sub="J2"]', false);   // show all again
await click('[data-testid="pose-zero"]');
await page.locator('[data-testid="explode"] [role="slider"]').first().focus();
for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
await settle('05-charge-arm-exploded');
await click('[data-testid="robot-clean_arm"]');
await settle('06-clean-arm-home');
await click('[data-testid="pose-clean"]');
await settle('07-clean-arm-in-cabin');
await click('[data-testid="robot-wash_gantry"]');
await settle('08-wash-home');
await click('[data-testid="pose-brush"]');
await settle('09-wash-brush-pass');
await click('[data-testid="filter-fasteners"]');
await click('[data-testid="bom-line"]');
await settle('10-wash-fasteners-list');
console.log('aborted supabase requests:', aborted);
await browser.close();
