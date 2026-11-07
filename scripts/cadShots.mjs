// Shoot the robot CAD through cad-check.html (dev server must be running: npm run dev, or
// PORT=8093 npx vite --host 127.0.0.1 --port 8093).
//   node scripts/cadShots.mjs --url http://127.0.0.1:8093 --out docs/pr-shots/robotics \
//        --shot charge_arm:stowed:0:iso --shot charge_arm:zero:0.6:side
// Each --shot is robot:pose:explode:view[:sub[:zoom]].
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = opt('--url', 'http://127.0.0.1:8080');
const out = opt('--out', 'docs/pr-shots/robotics');
const shots = args.flatMap((a, i) => (a === '--shot' ? [args[i + 1]] : []));
const w = Number(opt('--w', '1400')), h = Number(opt('--h', '1000'));
mkdirSync(out, { recursive: true });
const CHROMIUM = opt('--chromium', existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
for (const s of shots) {
  const [robot, pose = 'stowed', explode = '0', view = 'iso', sub = '', zoom = '1'] = s.split(':');
  const qs = new URLSearchParams({ robot, pose, explode, view, zoom, ...(sub ? { sub } : {}) });
  await page.goto(`${url}/cad-check.html?${qs}`);
  await page.waitForFunction(() => window.__cadReady || window.__cadError, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__cadError);
  if (err) { console.error(s, err); continue; }
  const file = `${out}/${s.replace(/[:]/g, '_')}.png`;
  await page.screenshot({ path: file });
  console.log('shot', file);
}
await browser.close();
