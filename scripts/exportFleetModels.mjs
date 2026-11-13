// Write public/fleet/<key>.glb and public/fleet/manifest.json from src/lib/fleetModels.
// The models are built in the browser by the same code the app uses (fleet-check.html?export=1), so the files
// and the live build cannot drift. Dev server must be running: PORT=8094 npx vite --host 127.0.0.1 --port 8094
//   node scripts/exportFleetModels.mjs --url http://127.0.0.1:8094
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = opt('--url', 'http://127.0.0.1:8094');
const out = opt('--out', 'public/fleet');
const detail = opt('--detail', '170');
mkdirSync(out, { recursive: true });
const CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`${url}/fleet-check.html`);
await page.waitForFunction(() => window.__fleetReady || window.__fleetError, null, { timeout: 180000 });
const keys = await page.evaluate(async () => (await import('/src/lib/fleetModels/index.ts')).FLEET_SPECS.map((s) => s.key));
const vehicles = [];
for (const key of keys) {
  await page.goto(`${url}/fleet-check.html?model=${key}&export=1&detail=${detail}`);
  await page.waitForFunction(() => window.__fleetReady || window.__fleetError, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__fleetError);
  if (err) throw new Error(`${key}: ${err}`);
  const { b64, meta, stats } = await page.evaluate(async (k) => {
    const m = await import('/src/lib/fleetModels/index.ts');
    const car = m.buildVehicle(m.fleetSpec(k));
    const sensors = [];
    car.traverse((o) => { if (o.userData.sensor) sensors.push({ ...o.userData.sensor, position: o.position.toArray().map((v) => +v.toFixed(4)) }); });
    const doors = m.doorNodes(car).map((o) => o.userData.door);
    const port = car.getObjectByName('charge_port');
    return {
      b64: window.__fleetGlb, stats: window.__fleetStats,
      meta: { ...car.userData.vehicle, doors, sensors, chargePortPosition: port ? port.position.toArray().map((v) => +v.toFixed(4)) : null },
    };
  }, key);
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(`${out}/${key}.glb`, buf);
  const count = (t) => meta.sensors.filter((s) => s.type === t).length;
  vehicles.push({
    ...meta, file: `${key}.glb`, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16),
    triangles: Math.round(stats.tris),
    sensorCounts: { lidar: count('lidar'), camera: count('camera'), radar: count('radar'), thermal: count('thermal') },
  });
  console.log(key, (buf.length / 1e6).toFixed(2), 'MB', Math.round(stats.tris), 'tris');
}
writeFileSync(`${out}/manifest.json`, JSON.stringify({
  generator: 'scripts/exportFleetModels.mjs from src/lib/fleetModels',
  units: 'metres', frame: '+X nose, +Y up, +Z right; origin on the ground under the middle of the body',
  nodes: 'body, door_<id>, wheel_<FL|FR|RL|RR>, sensor_<id>, interior, mirror_<L|R>, charge_port; animation "doors_open"',
  vehicles,
}, null, 1));
await browser.close();
