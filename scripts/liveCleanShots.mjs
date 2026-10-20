#!/usr/bin/env node
// ============================================================================
// liveCleanShots — film a REAL OTTO-CLEAN ARM cycle from a LIVE run.
//
// cleanArmShots.mjs plays a recorded run and writes the arm's step into its frames;
// this one adds nothing. It opens the live view (view.html) pinned to a run the twin
// is playing now, waits until the engine itself starts a fast charger's cleaning arm
// (otto-q-core 0758, dial stall_cabin_robot on at the depot), frames that stall and
// shoots each phase the page reaches, from three cameras. What it shows is what the
// twin did. Read-only: the view only reads the run.
//
//   npx vite --host 127.0.0.1 --port 8091               # in another shell (dev build:
//                                                       # the camera hooks are stripped
//                                                       # from production builds)
//   node scripts/liveCleanShots.mjs --run <sim_run_id> --out docs/pr-shots/clean-arm-live
//
//   --url U (http://127.0.0.1:8091/)   --run ID (required)   --out DIR (./clean-arm-live)
//   --wait S (600)  seconds to wait for an arm to leave home   --chromium P
//
// First filmed 2026-10-20 on run c6ec017d (busy_day, twin depot): DCFC-08's car with its
// door open at sim 8:55 AM CT and the arm cleaning side A at 8:58.
//
// ⚠️ Software GL in a sandbox draws about a frame a second, so a phase shorter than a
// few real seconds can be missed; the phases the page reached are in summary.json.
// ============================================================================
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg("--url", "http://127.0.0.1:8091/");
const RUN = arg("--run", null);
const OUT = arg("--out", "./clean-arm-live");
const WAIT_S = Number(arg("--wait", "600"));
const exe = arg("--chromium", existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
if (!RUN) { console.error("--run <sim_run_id> is required"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  // the live backend through the sandbox's proxy; the dev server directly
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined,
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(`${URL_}view.html?run=${RUN}&cam=se&spin=0`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => !!window.__depotCam && !!window.__cleanArms && !!window.__twinDriver, null, { timeout: 180000 });

/** Every arm's phase, as the page sees it. */
const arms = () => page.evaluate(() =>
  [...(window.__cleanArms ?? new Map()).entries()].map(([stall, s]) => ({ stall, phase: s.phase })));

// wait for the engine to start an arm
let target = null;
const t0 = Date.now();
while (!target && Date.now() - t0 < WAIT_S * 1000) {
  await page.waitForTimeout(1000);
  target = (await arms()).find((a) => a.phase && a.phase !== "home")?.stall ?? null;
}
if (!target) {
  console.log(JSON.stringify({ error: `no cleaning arm left home in ${WAIT_S}s`, errors }));
  await browser.close();
  process.exit(1);
}

// cameras on that stall (cleanArmShots.mjs's: plan -> world is x = 150 - x, z = 110 - y)
const cams = await page.evaluate((rid) => {
  const d = window.__twinDriver;
  const pos = d.stallPos.get(rid);
  let heading = null;
  for (const [, e] of d.entries) if (e.stallId === rid) heading = e.stallHeading;
  if (!pos || heading === null) return null;
  const fx = -Math.cos(heading), fz = -Math.sin(heading);
  const rx = Math.sin(heading), rz = -Math.cos(heading);
  const cx = 150 - pos.x, cz = 110 - pos.y;
  const at = (n, r, y) => [cx + fx * n + rx * r, y, cz + fz * n + rz * r];
  return {
    high: { p: at(8.5, -6.0, 9.6), t: at(0.0, 0.0, 2.6) },
    left: { p: at(1.2, -9.5, 4.6), t: at(0.4, 0, 2.3) },
    right: { p: at(5.0, 9.5, 4.8), t: at(0.0, 0.5, 2.0) },
  };
}, target);

const shots = [];
const seen = new Set();
const t1 = Date.now();
while (cams && Date.now() - t1 < 240000) {
  const phase = (await arms()).find((a) => a.stall === target)?.phase ?? "gone";
  if (!seen.has(phase)) {
    seen.add(phase);
    for (const cam of ["high", "left", "right"]) {
      await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [cams[cam].p, cams[cam].t]);
      await page.waitForTimeout(2500);
      const f = `${OUT}/${String(shots.length).padStart(2, "0")}_${phase}_${cam}.png`;
      await page.screenshot({ path: f });
      shots.push({ phase, cam, file: f });
    }
  }
  if (phase === "home" && seen.size > 1) break;
  await page.waitForTimeout(700);
}

const summary = { run: RUN, stall: target, phases: [...seen], shots, errors };
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ stall: target, phases: summary.phases, shots: shots.length, errors: errors.length }));
await browser.close();
