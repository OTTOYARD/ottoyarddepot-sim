#!/usr/bin/env node
// ============================================================================
// cockpitPlayback — play a RECORDED run through the REAL cockpit, in 2D or 3D.
//
// The founder, 2026-09-22: "Make sure to always validate against the twin 2D/3D
// for final confirmation." The flow replays (src/engine/__fixtures__/flowReplay.ts)
// MEASURE motion; this is how you LOOK at it: the running app (npm run dev) fed a
// captured run instead of the live one. The hardest case there is — a fresh
// start's dispatch wave — can then be watched on demand, twice, side by side
// against main, without starting a run (which purges the live one).
//
// How: a headless Chromium answers the cockpit's run list, snapshot and per-run
// RPCs for a SYNTHETIC run id from the fixture, on the wall clock (frame wall_ms,
// sim clock advanced at the fixture's speedX). Everything else — the depot layout,
// reference data — passes through to the backend READ-ONLY: every request that
// is not a GET or an ottoq_twin_* read RPC is refused before it leaves the
// browser. Nothing touches the database.
//
//   npm run dev                                   # in another shell
//   node scripts/cockpitPlayback.mjs --view 2d --secs 150 --video --out /tmp/pb
//   node scripts/cockpitPlayback.mjs --view 3d --cams Entrance,Hero,Operator --shots 35,55,75
//
//   --url U         cockpit dev server (http://127.0.0.1:8080/)
//   --fixture NAME  src/engine/__fixtures__/twinRun.NAME.json, wall-paced (fresh0922)
//   --view 2d|3d    --secs N (150)   --out DIR (./playback)
//   --shots s,s,…   playback seconds to screenshot (35,55,75,95,130)
//   --cams p,p,…    3D camera preset to select before each shot (Bird Eye, Entrance,
//                   Canopy, Operator, Service, Hero, Bays, Rear), or an ad-hoc world
//                   camera @x:y:z/tx:ty:tz (position / target) to try a view first
//   --video         record a .webm of the session into --out
//   --dsf F         device scale factor; 0.5 renders 3D ~4x cheaper in software GL
//   --relay-curl    fetch the backend through curl, for sandboxes whose browser
//                   does not trust the egress proxy's CA (TLS checks stay ON)
//   --chromium P    browser executable (else Playwright's own)
//
// Prints a JSON summary: the driver's view multiplier, share of taxi time stopped,
// stuck samples (no progress > 10 s), peak cars taxiing. Needs a DEV server —
// window.__twinDriver is stripped from production builds.
// ============================================================================
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installFixtureRoutes, loadFixture } from "./lib/fixturePlayback.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const URL_ = arg("url", "http://127.0.0.1:8080/");
const FIXTURE = arg("fixture", "fresh0922");
const VIEW = arg("view", "2d");
const SECS = Number(arg("secs", 150));
const OUT = resolve(arg("out", "playback"));
const SHOTS = String(arg("shots", "35,55,75,95,130")).split(",").map(Number).filter((n) => n > 0);
const CAMS = String(arg("cams", "")).split(",").map((s) => s.trim()).filter(Boolean);
const VIDEO = arg("video", false) === true;
const DSF = Number(arg("dsf", 1));
const RELAY = arg("relay-curl", false) === true;
const CHROMIUM = arg("chromium", undefined);
mkdirSync(OUT, { recursive: true });

const F = (() => {
  try { return loadFixture(ROOT, FIXTURE); }
  catch (e) { console.error(e.message); process.exit(2); }
})();

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 }, // ResponsiveGuard needs >= 1200 px
  deviceScaleFactor: DSF,
  ...(VIDEO ? { recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } } : {}),
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
const routes = await installFixtureRoutes(page, F, { relay: RELAY });

const T0 = Date.now();
await page.goto(URL_, { waitUntil: "domcontentloaded" });
if (VIEW === "3d") {
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: /^3d$/i }).first().click();
}
const samples = [];
let shot = 0, cam = 0;
while (Date.now() - T0 < SECS * 1000) {
  await page.waitForTimeout(2000);
  const pt = routes.playbackSeconds();
  const s = await page.evaluate(() => {
    const d = window.__twinDriver;
    if (!d) return null;
    let n = 0, taxi = 0, stopped = 0, stuck = 0;
    for (const [, e] of d.entries) {
      n++;
      if (!e.reverse && e.tracker) { taxi++; if (e.tracker.v < 0.3) stopped++; if (e.tracker.stationaryFor > 10) stuck++; }
    }
    return { n, taxi, stopped, stuck, viewMult: d.viewMult };
  });
  if (s && pt >= 0) samples.push({ pt, ...s });
  if (cam < CAMS.length && cam === shot && shot < SHOTS.length && pt >= SHOTS[shot] - 6) {
    if (CAMS[cam].startsWith("@")) {
      // @x:y:z/tx:ty:tz — an ad-hoc world camera (dev server only), to try a view before it becomes a preset
      const [p, t] = CAMS[cam].slice(1).split("/").map((v) => v.split(":").map(Number));
      await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [p, t]);
    } else {
      const b = page.getByRole("button", { name: new RegExp(`^${CAMS[cam]}$`, "i") });
      if (await b.count()) await b.first().click();
    }
    cam++;
  }
  if (shot < SHOTS.length && pt >= SHOTS[shot]) {
    const label = CAMS[shot] ? `_${CAMS[shot].replace(/\s+/g, "").replace(/[@:/]/g, "_")}` : "";
    await page.screenshot({ path: join(OUT, `${FIXTURE}_${VIEW}_${SHOTS[shot]}s${label}.png`) });
    shot++;
  }
}
const fps = await page.evaluate(() => new Promise((r) => {
  let n = 0; const t = performance.now();
  const f = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else r(n / 3); };
  requestAnimationFrame(f);
}));
const video = VIDEO ? page.video() : null;
await ctx.close();
const videoPath = video ? await video.path() : null;
await browser.close();

const taxi = samples.reduce((a, s) => a + s.taxi, 0);
console.log(JSON.stringify({
  fixture: FIXTURE, view: VIEW, url: URL_, viewMult: samples.at(-1)?.viewMult ?? null, fps: +fps.toFixed(1),
  samples: samples.length, stoppedShare: taxi ? +(samples.reduce((a, s) => a + s.stopped, 0) / taxi).toFixed(3) : null,
  stuckSamples: samples.reduce((a, s) => a + s.stuck, 0), peakTaxiing: Math.max(0, ...samples.map((s) => s.taxi)),
  refusedWrites: routes.refused, pageErrors: [...new Set(errors)].slice(0, 5), video: videoPath, out: OUT,
}, null, 1));
