#!/usr/bin/env node
// ============================================================================
// liveWashShots — film a REAL wash-bay program from a LIVE run.
//
// Opens the live view (view.html) pinned to a run the twin is playing now, waits until a
// wash bay's rollover machine leaves home (the twin seated a car there, otto-q-core 0746 /
// 0762, and the motion driver started the program), and shoots each phase the page
// reaches from three cameras: inside the hall, through the south door, and from above.
// What it shows is what the twin did. Read-only: the view only reads the run.
//
//   npx vite --host 127.0.0.1 --port 8091               # in another shell (dev build:
//                                                       # the camera hooks are stripped
//                                                       # from production builds)
//   node scripts/liveWashShots.mjs --run <sim_run_id> --out docs/pr-shots/wash-live
//
//   --url U (http://127.0.0.1:8091/)   --run ID (required)   --out DIR (./wash-live)
//   --wait S (900)  seconds to wait for a machine to leave home   --chromium P
//   --bay WASH-0N   film this bay only
//
// ⚠️ Software GL in a sandbox draws about a frame a second, so a phase shorter than a few
// real seconds can be missed; the phases the page reached are in summary.json.
// ============================================================================
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg("--url", "http://127.0.0.1:8091/");
const RUN = arg("--run", null);
const OUT = arg("--out", "./wash-live");
const WAIT_S = Number(arg("--wait", "900"));
const ONLY = arg("--bay", null);
const exe = arg("--chromium", existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
if (!RUN) { console.error("--run <sim_run_id> is required"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined,
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(`${URL_}view.html?run=${RUN}&cam=se&spin=0`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => !!window.__depotCam && !!window.__washGantries && !!window.__twinDriver, null, { timeout: 180000 });

/** Every bay's machine, as the page sees it. */
const bays = () => page.evaluate(() =>
  [...(window.__washGantries ?? new Map()).entries()].map(([bay, s]) => ({ bay, ...s })));

// wait for the engine's seat to start a machine
let target = null;
const t0 = Date.now();
while (!target && Date.now() - t0 < WAIT_S * 1000) {
  await page.waitForTimeout(1000);
  target = (await bays()).find((b) => (!ONLY || b.bay === ONLY) && b.phase && b.phase !== "home")?.bay ?? null;
}
if (!target) {
  console.log(JSON.stringify({ error: `no wash machine left home in ${WAIT_S}s`, bays: await bays(), errors }));
  await browser.close();
  process.exit(1);
}

// cameras on that bay: plan -> world is x = 150 - x, z = 110 - y; the car stands at plan y 41
const cams = await page.evaluate((bay) => {
  const pos = window.__twinDriver.stallPos.get(bay);
  if (!pos) return null;
  const wx = 150 - pos.x, wz = 110 - pos.y;
  return {
    // inside the hall, high in the bay's south-east corner, looking at the car
    inside: { p: [wx - 6.2, 8.2, wz - 11.5], t: [wx, 2.2, wz + 1.5] },
    // through the south door from the forecourt
    door: { p: [wx + 1.5, 4.2, wz - 27], t: [wx, 3.0, wz] },
    // from above the hall
    above: { p: [wx - 14, 46, wz - 38], t: [wx, 0, wz] },
  };
}, target);

const shots = [];
const seen = new Set();
const t1 = Date.now();
while (cams && Date.now() - t1 < 900000) {
  const s = (await bays()).find((b) => b.bay === target);
  const phase = s?.phase ?? "gone";
  if (!seen.has(phase)) {
    seen.add(phase);
    for (const cam of ["inside", "door", "above"]) {
      await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [cams[cam].p, cams[cam].t]);
      await page.waitForTimeout(2500);
      const f = `${OUT}/${String(shots.length).padStart(2, "0")}_${phase}_${cam}.png`;
      await page.screenshot({ path: f });
      shots.push({ phase, cam, file: f, at: s });
    }
  }
  if (phase === "home" && seen.size > 1) break;
  await page.waitForTimeout(700);
}

const summary = { run: RUN, bay: target, phases: [...seen], shots, errors };
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ bay: target, phases: summary.phases, shots: shots.length, errors: errors.length }));
await browser.close();
