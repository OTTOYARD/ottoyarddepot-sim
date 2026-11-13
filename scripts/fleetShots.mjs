// Shoot the fleet vehicle models through fleet-check.html (dev server must be running:
// PORT=8094 npx vite --host 127.0.0.1 --port 8094).
//   node scripts/fleetShots.mjs --url http://127.0.0.1:8094 --out docs/pr-shots/fleet \
//        --shot waymo_ojai:iso:0 --shot waymo_ojai:side:1
// Each --shot is model:view:doors[:zoom[:glb[:yard]]]. `yard` = 1 shoots the yard's light model (lib/fleetModels/yardLod).
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = opt('--url', 'http://127.0.0.1:8094');
const out = opt('--out', 'docs/pr-shots/fleet');
const shots = args.flatMap((a, i) => (a === '--shot' ? [args[i + 1]] : []));
const w = Number(opt('--w', '1400')), h = Number(opt('--h', '900')), dsf = Number(opt('--dsf', '1'));
mkdirSync(out, { recursive: true });
const CHROMIUM = opt('--chromium', existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
for (const s of shots) {
  const [model, view = 'iso', doors = '0', zoom = '1', glb = '', yard = ''] = s.split(':');
  const qs = new URLSearchParams({ model, view, doors, zoom, ...(glb ? { glb } : {}), ...(yard ? { yard, status: '1' } : {}) });
  await page.goto(`${url}/fleet-check.html?${qs}`);
  await page.waitForFunction(() => window.__fleetReady || window.__fleetError, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__fleetError);
  if (err) { console.error(s, err); continue; }
  const file = `${out}/${s.replace(/[:]/g, '_')}.png`;
  await page.screenshot({ path: file });
  console.log('shot', file, JSON.stringify(await page.evaluate(() => window.__fleetStats)));
}
await browser.close();
