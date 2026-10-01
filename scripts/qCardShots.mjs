#!/usr/bin/env node
// ============================================================================
// qCardShots — look at the vehicle Q card (tap a car) in the running cockpit,
// desktop 2D and 3D at 1440x900 and the phone cockpit at 393x852, FULLY STUBBED.
//
// Nothing reaches the backend. The recorded run (twinRun.fresh0922.json) is
// served as the snapshot, its stalls as the layout; ottoq_depot_cards and the
// tapped car's ottoq_activity_feed_v2 are answered with a STUB SAMPLE in the
// contract-1.4 shape (otto-q-core 0460/0506/0507/0509/0512) for one car — the
// values are illustrative, not a run's. EVERY other request to Supabase (and to
// any other outside host) is aborted, and nothing presses Start/Pause/Stop.
//
//   PORT=8095 npx vite --host 127.0.0.1 --port 8095    # in another shell
//   node scripts/qCardShots.mjs --url http://127.0.0.1:8095/ --out docs/pr-shots/vehicle-q-card
//
// ⚠️ Software GL in a sandbox draws ~1 frame a second: this checks LAYOUT
// (where the card sits, what it says), not smoothness.
// ============================================================================
import { chromium } from "@playwright/test";
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
const URL_ = String(arg("url", "http://127.0.0.1:8095/"));
const OUT = resolve(String(arg("out", "docs/pr-shots/vehicle-q-card")));
const SECS = Number(arg("secs", 70));
const CHROMIUM = arg("chromium", undefined);
mkdirSync(OUT, { recursive: true });

const F = JSON.parse(readFileSync(join(ROOT, "src/engine/__fixtures__/twinRun.fresh0922.json"), "utf8"));
const RUN = "f1f1f1f1-0922-4000-8000-000000000002"; // synthetic: never a real run id
const DEPOT = "11111111-1111-1111-1111-111111111111";
const CAR = "0cb0532c-6fbb-4ec7-abfb-69e7681e6630"; // twin-sim-026, Waymo, on NASH-DCFC-STALL-01 in the recording
const iso = (ms) => new Date(ms).toISOString();

function worldAt(t0, ms) {
  const states = new Map();
  let last = F.frames[0];
  for (const f of F.frames) {
    if (f.wall_ms > ms) break;
    for (const c of f.changes) c.state === "__gone__" ? states.delete(c.id) : states.set(c.id, c);
    last = f;
  }
  const clock = Date.parse(last.t) + (ms - last.wall_ms) * (F.speedX ?? 1);
  const vehicles = F.roster.filter((r) => states.has(r.id)).map((r) => {
    const s = states.get(r.id);
    return { id: r.id, av_id: r.av_id, make: r.make, platform: r.platform, state: s.state, soc: r.soc, stall_id: s.stall_id };
  });
  return { clock, vehicles };
}

let t0 = null, ticks = 0;
const playback = () => (t0 === null ? -1 : (Date.now() - t0) / 1000);

function snapshot() {
  const ms = Date.now() - t0;
  const { clock, vehicles } = worldAt(t0, ms);
  const counts = {};
  for (const v of vehicles) counts[v.state] = (counts[v.state] ?? 0) + 1;
  return {
    run: { sim_run_id: RUN, scenario: "busy_day", status: "running", tick_count: ++ticks, time_scale: 60, seed: 1,
      sim_clock: iso(clock), speed_x: F.speedX ?? 1, playback_mode: "live", jump: null },
    legs: [], fleet: { counts, total: vehicles.length, vehicles }, stalls_status: [],
    energy: null, bess: null, weather: null, grid: null, counters: {}, recent_events: [], variability: {},
  };
}

/** STUB SAMPLE: one car's contract-1.4 card, timed off the served sim clock; every other car as the recording has it. */
function depotCards() {
  const { clock, vehicles } = worldAt(t0, Date.now() - t0);
  const m = (min) => iso(clock + min * 60_000);
  const code = new Map(F.stalls.map((s) => [s.id, { code: s.code, kind: s.type }]));
  return {
    endpoint: "ottoq.depot_cards", contract_version: "1.4", depot_id: DEPOT, sim_run_id: RUN, sim_clock: iso(clock),
    vehicles: vehicles.map((v) => {
      const st = v.stall_id ? code.get(v.stall_id) : null;
      const base = { vehicle_id: v.id, display_name: v.av_id, state: v.state, soc: v.soc, target_soc: 100,
        stall: st ? { id: v.stall_id, code: st.code, kind: st.kind } : null, reservations: [], card: null };
      if (v.id !== CAR) return base;
      return {
        ...base,
        reservations: [
          { booking_id: "s1", purpose: "wash", state: "held", stall_code: "NASH-WASH-02", stall_kind: "wash", starts_at: m(22), ends_at: m(34), need_atom: "exterior_wash", booked_by: "otto_q" },
          { booking_id: "s2", purpose: "inspect", state: "held", stall_code: "NASH-SVC-03", stall_kind: "service_bay", starts_at: m(37), ends_at: m(43), need_atom: "readiness_check", booked_by: "otto_q" },
          { booking_id: "s3", purpose: "staging", state: "held", stall_code: "NASH-STG-12", stall_kind: "staging", starts_at: m(45), ends_at: m(90), booked_by: "otto_q" },
        ],
        card: {
          urgency: "standard", dispatch_due_at: m(90),
          needs: [
            { svc: "interior_inspection", status: "done", done_at: m(-31), must_do: true, performed_by: "charger_sensors" },
            { svc: "charge", status: "in_progress", must_do: true },
            { svc: "exterior_wash", status: "pending", must_do: true },
            { svc: "readiness_check", status: "pending", must_do: true },
          ],
          steps: [
            { seq: 1, leg_type: "taxi", status: "done", actual_end: m(-40) },
            { seq: 2, leg_type: "inspect", atom: "interior_inspection", status: "done", actual_start: m(-38), actual_end: m(-31) },
            { seq: 3, leg_type: "charge_dcfc", status: "current", planned_start: m(-38), planned_end: m(14), actual_start: m(-38),
              progress_pct: 68, expected_end: m(17), eta_source: "charge_physics", over_plan_min: null },
            { seq: 4, leg_type: "taxi", status: "upcoming", planned_start: m(18), planned_end: m(21) },
            { seq: 5, leg_type: "wash", atom: "exterior_wash", status: "upcoming", planned_start: m(22), planned_end: m(34) },
            { seq: 6, leg_type: "inspect", atom: "readiness_check", status: "upcoming", planned_start: m(37), planned_end: m(43) },
            { seq: 7, leg_type: "stage", status: "upcoming", planned_start: m(45), planned_end: m(90) },
          ],
        },
      };
    }),
  };
}

/** STUB SAMPLE: the car's own decisions — a send to its charger, then a re-booking of its wash onto bay 02. */
function carFeed() {
  const { clock } = worldAt(t0, Date.now() - t0);
  const m = (min) => iso(clock + min * 60_000);
  const r = (o) => ({ vehicle_id: CAR, display_name: "twin-sim-026", engine: "deterministic", reason: null, outcome: "enacted", ...o });
  return [
    r({ occurred_at: m(-40), action: "stall_assignment", target: "NASH-DCFC-STALL-01", rationale: { verb: "assign_stall", stall_type: "dcfc" }, decision_seq: 1 }),
    r({ occurred_at: m(-6), action: "reservation_reopt", target: "NASH-WASH-02", rationale: { verb: "rebook", source: "reservation_reopt" }, decision_seq: 2 }),
  ];
}

const json = (route, body) => route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const served = new Map();
const aborted = new Map();
const count = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

async function install(page) {
  const local = new URL(URL_).host;
  await page.route("**/*", async (route) => {
    const r = route.request();
    const u = new URL(r.url());
    if (u.host === local) return route.continue();
    const m = r.method();
    const key = `${m} ${u.pathname}`;
    if (!/supabase\.co$/.test(u.hostname)) { count(aborted, `${m} ${u.host}`); return route.abort(); }
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } });
    if (m === "GET" && /\/otto-twin-control\/sim_runs$/.test(u.pathname)) {
      count(served, key);
      return json(route, { ok: true, data: { runs: [{ sim_run_id: RUN, scenario: "busy_day", status: "running", speed_x: F.speedX, tick_count: ticks, seed: 1 }] } });
    }
    if (m === "GET" && u.pathname.endsWith(`/sim_runs/${RUN}/snapshot`)) {
      if (t0 === null) t0 = Date.now();
      count(served, key);
      return json(route, { ok: true, data: snapshot() });
    }
    if (m === "GET" && /\/otto-twin-control\/depot\/[^/]+\/layout$/.test(u.pathname)) {
      count(served, key);
      return json(route, { ok: true, data: { depot: null, structures: [], stalls: F.stalls.map((s) => ({ zone: null, canopy: null, covered: null, heading: 0, connector_kw: null, ...s })) } });
    }
    const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname)?.[1];
    const body = r.postData() ?? "";
    if (m === "POST" && rpc === "ottoq_twin_run_context" && body.includes(RUN)) { count(served, key); return json(route, { depot_id: DEPOT, sim_run_id: RUN }); }
    if (m === "POST" && rpc === "ottoq_depot_cards" && t0 !== null) { count(served, key); return json(route, depotCards()); }
    if (m === "POST" && rpc === "ottoq_activity_feed_v2" && body.includes(CAR) && t0 !== null) { count(served, key); return json(route, carFeed()); }
    count(aborted, key);
    return route.abort();
  });
}

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const summary = [];
const clickText = (page, t) => page.evaluate((x) => {
  const b = [...document.querySelectorAll("button")].find((e) => e.textContent?.trim().toLowerCase() === x.toLowerCase());
  b?.click(); return !!b;
}, t);
const cardInfo = (page) => page.evaluate(() => {
  const c = document.querySelector('[data-testid="vehicle-qcard"]');
  if (!c) return null;
  const host = c.parentElement.getBoundingClientRect();
  return { vehicle: c.getAttribute("data-vehicle"), rect: [host.left, host.top, host.width, host.height].map(Math.round),
    steps: [...c.querySelectorAll('[data-testid="qcard-step"]')].map((e) => e.getAttribute("data-state")),
    leave: c.querySelector('[data-testid="qcard-leave"]')?.textContent, now: c.querySelector('[data-testid="qcard-now"]')?.textContent };
});
/** A real tap on the 3D canvas where the car is drawn: pointerdown + pointerup, as CameraRig listens for them. */
const tapCar = (page, id, touch) => page.evaluate(([vid, isTouch]) => {
  const p = window.__carScreenPoint?.(vid);
  const el = document.querySelector("canvas");
  if (!p || !el) return null;
  const ev = (type) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 11, pointerType: isTouch ? "touch" : "mouse", isPrimary: true, button: 0 }));
  ev("pointerdown"); ev("pointerup");
  return p;
}, [id, touch]);
const shot = async (page, name) => {
  const path = join(OUT, `${name}.jpg`);
  await page.screenshot({ path, quality: 82 });
  summary.push({ shot: path, card: await cardInfo(page) });
};

// ── desktop 1440x900: 2D, then 3D ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await install(page);
  const u = new URL(URL_); u.searchParams.set("quality", "low");
  await page.goto(u.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await clickText(page, "2D");
  while (playback() < SECS) await page.waitForTimeout(500);
  await page.waitForTimeout(3000);
  // a click on the car's dot in the 2D map
  const clicked = await page.evaluate((vid) => {
    const g = document.querySelector(`[data-vid="${vid}"]`);
    g?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return !!g;
  }, CAR);
  summary.push({ step: "2D click on the car's dot", clicked });
  await page.waitForTimeout(12000); // cards (10 s poll) and the car's feed answer
  await shot(page, "desktop-2d-qcard");
  // the trail toggle is read-only too: it only asks reads, which are stubbed or aborted
  // 3D: close the card, then tap the car where it is drawn
  await clickText(page, "3D");
  await page.waitForTimeout(15000);
  await page.evaluate(() => document.querySelector('[aria-label="Close Q card"]')?.click());
  // an oblique framing: from straight above, the solar canopy hides the fast chargers' cars
  await clickText(page, String(arg("preset", "Hero")));
  await page.waitForTimeout(4000);
  const tapped = await tapCar(page, CAR, false);
  summary.push({ step: "3D tap on the car", tapped });
  await page.waitForTimeout(14000); // follow glide at ~1 fps + card fill
  await shot(page, "desktop-3d-qcard");
  // a tap on open ground closes it (and stops following)
  await page.evaluate(() => {
    const el = document.querySelector("canvas"); const r = el.getBoundingClientRect();
    const ev = (t) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: r.left + 30, clientY: r.bottom - 30, pointerId: 12, pointerType: "mouse", isPrimary: true, button: 0 }));
    ev("pointerdown"); ev("pointerup");
  });
  await page.waitForTimeout(2500);
  summary.push({ step: "3D tap on open ground", cardAfter: await cardInfo(page) });
  summary.push({ desktopErrors: [...new Set(errors)].slice(0, 5) });
  await ctx.close();
}

// ── phone 393x852 portrait: a bottom sheet ──
{
  t0 = null; ticks = 0;
  const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await install(page);
  const u = new URL(URL_); u.searchParams.set("quality", "low");
  await page.goto(u.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector("canvas"), null, { timeout: 120000 });
  while (playback() < SECS) await page.waitForTimeout(500);
  await page.waitForTimeout(4000);
  const tapped = await tapCar(page, CAR, true);
  summary.push({ step: "phone tap on the car", tapped });
  await page.waitForTimeout(14000);
  await shot(page, "phone-portrait-qcard");
  summary.push({ phoneErrors: [...new Set(errors)].slice(0, 5) });
  await ctx.close();
}

await browser.close();
summary.push({ served: Object.fromEntries(served), aborted: Object.fromEntries(aborted) });
console.log(JSON.stringify(summary, null, 1));
