#!/usr/bin/env node
// ============================================================================
// liveChargeShots — film REAL OTTO-CHARGE ARM mates from a LIVE run, each vehicle's own inlet.
//
// Opens the live view (view.html) pinned to a run the twin is playing now, reads every fast charger's arm from the
// page (window.__arms: its phase, which of the mate's five stops it is at, where its base stands on the rail and
// the cross-slide, which connector is forward, the vehicle's port profile from the twin's snapshot), and shoots
// the arms that are at a mate, one of each port profile, from two cameras. Read-only: the view only reads the run.
//
//   npx vite --host 127.0.0.1 --port 8093               # in another shell (a dev build: the hooks are dev only)
//   node scripts/liveChargeShots.mjs --run <sim_run_id> --out docs/pr-shots/charge-arm-live
//
//   --url U (http://127.0.0.1:8093/)   --run ID (required)   --out DIR   --wait S (240)   --chromium P
//
// ⚠️ Software GL in a sandbox draws about a frame a second, and the arm's servo travel is counted in drawn frames
// of at most 0.1 s each, so an arm takes far longer to reach its mate here than on a real GPU.
// ============================================================================
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg("--url", "http://127.0.0.1:8093/");
const RUN = arg("--run", null);
const OUT = arg("--out", "./charge-arm-live");
const WAIT_S = Number(arg("--wait", "240"));
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
await page.waitForFunction(() => !!window.__depotCam && !!window.__arms && !!window.__twinDriver, null, { timeout: 180000 });

const arms = () => page.evaluate(() => [...(window.__arms ?? new Map()).entries()].map(([stall, s]) => ({
  stall, phase: s.phase, stop: s.stop, slideM: +s.slideM.toFixed(3), crossM: +s.crossM.toFixed(3), head: s.head, mateOk: s.mateOk, profile: s.profile,
})));

// wait until arms are at their mates (stop 4, a connector forward)
let seen = [];
const t0 = Date.now();
while (Date.now() - t0 < WAIT_S * 1000) {
  await page.waitForTimeout(3000);
  seen = await arms();
  const mated = seen.filter((a) => a.stop === 4 && a.head);
  if (new Set(mated.map((a) => a.profile)).size >= 2 || (mated.length && Date.now() - t0 > WAIT_S * 500)) break;
}
const mated = seen.filter((a) => a.stop === 4 && a.head);
const picks = [...new Map(mated.map((a) => [a.profile, a])).values()].slice(0, 4);

console.log(JSON.stringify({ arms: seen.filter((a) => a.phase !== "stowed") }));
const shots = [];
for (const a of picks) {
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
      left: { p: at(-3.0, -11.0, 5.2), t: at(-1.0, 0, 1.6) },
      right: { p: at(-3.0, 11.0, 5.2), t: at(-1.0, 0, 1.6) },
      tail: { p: at(-13.0, 0.0, 6.0), t: at(-3.0, 0, 1.4) },
    };
  }, a.stall);
  if (!cams) continue;
  for (const cam of ["left", "right", "tail"]) {
    await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [cams[cam].p, cams[cam].t]);
    await page.waitForTimeout(2500);
    const f = `${OUT}/${a.profile ?? "unknown"}_${a.stall}_${cam}.png`;
    await page.screenshot({ path: f, timeout: 180000 });
    shots.push({ ...a, cam, file: f });
  }
}
const summary = { run: RUN, arms: seen, shots, errors };
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ shots: shots.length, errors }));
await browser.close();
