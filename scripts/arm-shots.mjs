#!/usr/bin/env node
/**
 * Capture the OTTO-CHARGE ARM at each phase of a mate cycle, plus the HUD that
 * reports scale, reach and the measured arm↔cabinet clearance.
 *
 * The clearance number is the point of this script. The arm used to pass through
 * the DCFC cabinet, and the fix (rotate the cabinet so its wide face runs fore/aft,
 * then back it off by CABINET_BACKSET_PU) is geometric — a regression would be
 * silent in the test suite but obvious here. The HUD prints the live measurement
 * rather than a stored constant, so a screenshot is evidence rather than a claim.
 *
 * Usage:
 *   npx vite --host 127.0.0.1 --port 5173 &
 *   node scripts/arm-shots.mjs [outputDir]
 *
 * Chromium is preinstalled in this environment; PLAYWRIGHT_BROWSERS_PATH points at
 * it, so do NOT run `playwright install`. swiftshader flags are required because
 * the container has no GPU — without them the WebGL context never comes up and
 * every shot is a blank canvas.
 */
import { chromium } from 'playwright';

const EXE = process.env.CHROMIUM_PATH
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.argv[2] ?? '.';
const BASE = process.env.ARM_CHECK_URL ?? 'http://127.0.0.1:5173/arm-check.html';

// The mate sequence in order. `stow` is the parked pose; `latch` is the connector
// seated in the inlet, which is the pose where cabinet clearance is tightest.
const POSES = ['stow', 'approach', 'align', 'insert', 'latch'];

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
});

for (const pose of POSES) {
  await page.goto(`${BASE}?pose=${pose}&view=side`, { waitUntil: 'networkidle' });
  // three.js needs a beat after networkidle to build the scene and settle the IK
  // solve; screenshotting immediately catches a half-drawn frame.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/arm-${pose}.png` });
}

await page.goto(`${BASE}?pose=latch&view=iso`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/arm-latch-iso.png` });

const hud = await page.evaluate(() => document.body.innerText.slice(0, 1200));
console.log('=== HUD ===\n' + hud);

await browser.close();
