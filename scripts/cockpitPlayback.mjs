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
//                   Canopy, Operator, Service, Hero)
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
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const F = JSON.parse(readFileSync(join(ROOT, "src/engine/__fixtures__", `twinRun.${FIXTURE}.json`), "utf8"));
if (!F.frames.every((f) => typeof f.wall_ms === "number")) {
  console.error(`twinRun.${FIXTURE}.json carries no wall clock (wall_ms) — only wall-paced captures can be played`);
  process.exit(2);
}
const RUN = "f1f1f1f1-0922-4000-8000-000000000001"; // synthetic: never a real run id
const DEPOT = "11111111-1111-1111-1111-111111111111"; // the twin depot, the only test site
let t0 = null, ticks = 0;

/** The fixture's world at `ms` of playback, in the snapshot endpoint's shape. */
function snapshotAt(ms) {
  const states = new Map();
  let last = F.frames[0];
  for (const f of F.frames) {
    if (f.wall_ms > ms) break;
    for (const c of f.changes) c.state === "__gone__" ? states.delete(c.id) : states.set(c.id, c);
    last = f;
  }
  const vehicles = F.roster.filter((r) => states.has(r.id)).map((r) => {
    const s = states.get(r.id);
    return { id: r.id, av_id: r.av_id, make: r.make, platform: r.platform, state: s.state, soc: r.soc, stall_id: s.stall_id };
  });
  const counts = {};
  for (const v of vehicles) counts[v.state] = (counts[v.state] ?? 0) + 1;
  return {
    run: {
      sim_run_id: RUN, scenario: "busy_day", status: "running", tick_count: ++ticks, time_scale: 60, seed: 1,
      sim_clock: new Date(Date.parse(last.t) + (ms - last.wall_ms) * (F.speedX ?? 1)).toISOString(),
      speed_x: F.speedX ?? 1, playback_mode: "live", jump: null,
    },
    legs: [], fleet: { counts, total: vehicles.length, vehicles }, stalls_status: [],
    energy: null, bess: null, weather: null, grid: null, counters: {}, recent_events: [], variability: {},
  };
}

/** GET through curl (it trusts the system CA bundle the sandbox proxy is signed by). */
function viaCurl(method, url, headers, body) {
  const args = ["-sS", "-m", "30", "-X", method, "-D", "-", "-o", "-"];
  for (const [k, v] of Object.entries(headers)) {
    if (!/^(host|content-length|connection|accept-encoding)$/i.test(k)) args.push("-H", `${k}: ${v}`);
  }
  if (body) args.push("--data-binary", "@-");
  args.push(url);
  return new Promise((res, rej) => {
    const p = execFile("curl", args, { encoding: "buffer", maxBuffer: 64e6 }, (err, out) => {
      if (err) return rej(err);
      // -D - prints every header block (a proxy's CONNECT reply, a 100-continue,
      // then the response): keep consuming while the remainder starts with HTTP/
      let rest = out, status = 0, hdrs = {};
      while (rest.subarray(0, 5).toString("latin1") === "HTTP/") {
        const i = rest.indexOf("\r\n\r\n");
        if (i < 0) break;
        const lines = rest.subarray(0, i).toString("latin1").split("\r\n");
        status = Number(lines[0].split(" ")[1]);
        hdrs = {};
        for (const l of lines.slice(1)) { const j = l.indexOf(":"); if (j > 0) hdrs[l.slice(0, j).trim().toLowerCase()] = l.slice(j + 1).trim(); }
        rest = rest.subarray(i + 4);
      }
      for (const h of ["content-encoding", "transfer-encoding", "content-length", "set-cookie"]) delete hdrs[h];
      hdrs["access-control-allow-origin"] = "*";
      res({ status, headers: hdrs, body: rest });
    });
    if (body) p.stdin.write(body);
    p.stdin.end();
  });
}

const reply = (route, body) => route.fulfill({
  status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body),
});
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
let refused = 0;
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.route(/supabase\.co/, async (route) => {
  const r = route.request();
  const u = new URL(r.url());
  const m = r.method();
  if (m === "OPTIONS") {
    return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" } });
  }
  // the fixture's run
  if (/\/otto-twin-control\/sim_runs$/.test(u.pathname) && m === "GET") {
    return reply(route, { ok: true, data: { runs: [{ sim_run_id: RUN, scenario: "busy_day", status: "running", speed_x: F.speedX, tick_count: ticks, seed: 1 }] } });
  }
  if (u.pathname.includes(`/sim_runs/${RUN}/snapshot`)) {
    if (t0 === null) t0 = Date.now();
    return reply(route, { ok: true, data: snapshotAt(Date.now() - t0) });
  }
  if (u.pathname.includes(`/sim_runs/${RUN}`)) return reply(route, { ok: false, error: "fixture playback" });
  const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname)?.[1];
  if (rpc && (r.postData() ?? "").includes(RUN)) {
    return reply(route, rpc === "ottoq_twin_run_context" ? { depot_id: DEPOT, sim_run_id: RUN } : { error: "fixture playback" });
  }
  // READ-ONLY for everything else
  if (m !== "GET" && !(m === "POST" && rpc?.startsWith("ottoq_twin_"))) {
    refused++;
    return reply(route, { ok: false, error: "refused by cockpitPlayback (read-only)" });
  }
  if (!RELAY) return route.continue();
  try { await route.fulfill(await viaCurl(m, r.url(), r.headers(), r.postDataBuffer())); }
  catch { await route.abort(); }
});

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
  const pt = t0 === null ? -1 : (Date.now() - t0) / 1000;
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
    const b = page.getByRole("button", { name: new RegExp(`^${CAMS[cam]}$`, "i") });
    if (await b.count()) await b.first().click();
    cam++;
  }
  if (shot < SHOTS.length && pt >= SHOTS[shot]) {
    const label = CAMS[shot] ? `_${CAMS[shot].replace(/\s+/g, "")}` : "";
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
  refusedWrites: refused, pageErrors: [...new Set(errors)].slice(0, 5), video: videoPath, out: OUT,
}, null, 1));
