#!/usr/bin/env node
/**
 * Capture the OTTO-CHARGE ARMS in the REAL APP against a LIVE run.
 *
 * This exists because scripts/arm-shots.mjs does NOT prove the arms move. That
 * one drives arm-check.html, a standalone page that poses the arm directly, so
 * it proves geometry and IK and nothing about whether the running depot ever
 * asks the arm to move. An arm can be perfect there and stowed for an entire
 * run here -- which is exactly the failure the founder saw and both my previous
 * checks were structurally incapable of catching.
 *
 * So this loads index.html, the actual DepotScene3D, against whatever run the
 * app connects to, and shoots the same DCFC stall repeatedly over wall time.
 * If the arm is animating, consecutive frames differ. If it is stowed, they are
 * identical -- and identical frames are the evidence, not my opinion.
 *
 * Usage:
 *   npx vite --host 127.0.0.1 --port 5173 &
 *   node scripts/arm-live-shots.mjs <outDir> [frames] [intervalMs]
 *
 * Chromium is preinstalled; PLAYWRIGHT_BROWSERS_PATH points at it, so do NOT
 * run `playwright install`. The swiftshader flags are required because the
 * container has no GPU -- without them the WebGL context never comes up and
 * every shot is a blank canvas.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const EXE = process.env.CHROMIUM_PATH
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.argv[2] ?? './arm-live';
const FRAMES = Number(process.argv[3] ?? 8);
const INTERVAL = Number(process.argv[4] ?? 4000);
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173/';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  args: [
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--no-sandbox', '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

// Surface page-side failures instead of silently shooting a blank canvas.
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90_000 });

// Wait for a real WebGL canvas with non-zero size before believing anything.
await page.waitForSelector('canvas', { timeout: 60_000 });
await page.waitForTimeout(8000);          // let the scene settle and the feed poll

const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return { ok: false };
  return { ok: true, w: c.width, h: c.height, ctx: !!c.getContext('webgl2') || !!c.getContext('webgl') };
});
writeFileSync(`${OUT}/00-canvas.json`, JSON.stringify(canvasInfo, null, 2));

// Pull whatever the app knows about arm state, straight off the driver, so the
// frames can be read against the two inputs ChargingArm actually gates on.
const probe = async () => page.evaluate(() => {
  const d = globalThis.twinMotionDriver ?? globalThis.__twinMotionDriver;
  const out = { hasDriver: !!d };
  try {
    if (d) {
      out.tetherPhase = d.twinTetherPhase ? Object.fromEntries(d.twinTetherPhase) : null;
      out.tetherDir = d.twinTetherDir ? Object.fromEntries(d.twinTetherDir) : null;
      out.dwellCount = d.dwells?.size ?? null;
      out.legCount = d.legs?.size ?? null;
    }
  } catch (e) { out.probeError = String(e); }
  return out;
});

const shots = [];
for (let i = 0; i < FRAMES; i++) {
  const file = `${OUT}/frame-${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: file });
  shots.push({ i, file, at: Date.now(), probe: await probe() });
  if (i < FRAMES - 1) await page.waitForTimeout(INTERVAL);
}

writeFileSync(`${OUT}/probe.json`, JSON.stringify(shots, null, 2));
writeFileSync(`${OUT}/console.log`, logs.join('\n'));
console.log(JSON.stringify({ canvasInfo, frames: shots.length, out: OUT, logLines: logs.length }, null, 2));

await browser.close();
