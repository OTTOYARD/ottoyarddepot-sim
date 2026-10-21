#!/usr/bin/env node
// ============================================================================
// cleanArmShots — watch the OTTO-CLEAN ARM in the RUNNING COCKPIT, end to end.
//
// Plays a recorded run read-only (scripts/lib/fixturePlayback.mjs: nothing reaches
// the database, every write is refused in the browser) and adds to every served
// frame, in the snapshot's own shape (otto-q-core 0758), what the twin publishes
// when its dial is on: for each car charging on a fast charger, the interior tidy
// in progress by that stall's arm (robot_stall_id, started_at, ends_at), and the
// dwell leg that is the charge arm's service window. Then it shoots one stall
// through the cycle from three cameras, naming each frame by the arm's phase, and
// prints what every arm did.
//
// The recording is re-timed to `--speed` sim seconds per real second (0.25 by
// default, so a 1.5 s move lasts 6 real seconds and every phase gets its frame), and
// the step is given `--cycle` sim minutes from when the car was first seen charging,
// counted after the car has had time to drive in. The twin's own timing is asserted
// in TwinMotionDriver.cleanarm.test.ts; this is for looking at the choreography.
//
//   npm run dev                                          # in another shell
//   node scripts/cleanArmShots.mjs --url http://127.0.0.1:5174/ --out docs/pr-shots/clean-arm
//
//   --url U (http://127.0.0.1:8080/)   --out DIR (./clean-arm-shots)   --secs N (900)
//   --speed S (0.25)   --cycle M (2.5)   --dsf F (1)   --chromium P   --relay-curl
//   --build dcfc20   serve the layout with canopy B re-striped as the 20-post build-out
//   --build dcfc30   serve it with canopies B and C re-striped: the 30-post build, no L2
//                    (otto-q-core 0759): ten of canopy B's standard stalls become fast
//                    chargers at canopy A's rows, keeping their twin ids so the recorded
//                    cars on them charge fast; the cockpit switches build from the census.
//   --card           when the framed arm starts cleaning, tap its car and shoot the car's Q card
//                    (its "Interior clean" row) at each phase until the arm is home, then stop
//   --overview       also shoot the canopies from the air once an arm is out, and the 2D plan at the end
//   --overview-only  shoot only those two, once an arm is out, and stop
//   --stall RE       frame the first arm to leave home on a renderer stall matching RE
//                    (e.g. "DCFC-1[1-9]|DCFC-20" for canopy B in the 20-post build)
//
// ⚠️ Software GL in a sandbox draws about a frame a second, and the motion driver
// steps with it, so the playback runs slower than the sim clock: good for placement,
// clearance and the order of the cycle, not for its timing.
// ============================================================================
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
const OUT = resolve(arg("out", "clean-arm-shots"));
const SECS = Number(arg("secs", 900));
const SPEED = Number(arg("speed", 0.25));
const CYCLE_MIN = Number(arg("cycle", 2.5));
const BUILD = String(arg("build", "as_built"));
const OVERVIEW_ONLY = arg("overview-only", false) === true;
const OVERVIEW = OVERVIEW_ONLY || arg("overview", false) === true;
const CARD = arg("card", false) === true;
const STALL = arg("stall", null) ? new RegExp(`^(${arg("stall", "")})$`) : null;
const DSF = Number(arg("dsf", 1));
const RELAY = arg("relay-curl", false) === true;
const CHROMIUM = arg("chromium", existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
mkdirSync(OUT, { recursive: true });

const F = loadFixture(ROOT, "fresh0922");
// re-time the recording: sim time runs SPEED x the wall clock between and across frames
{
  const t0 = Date.parse(F.frames[0].t);
  for (const f of F.frames) f.t = new Date(t0 + f.wall_ms * SPEED).toISOString();
  F.speedX = SPEED;
}
/** sim seconds a car is given to drive in before its step's clock starts */
const DRIVE_IN_S = 90 * SPEED;

/** first sim instant each car was seen charging on a fast charger, by car */
const firstSeen = new Map();
/** dcfc20 / dcfc30: twin stall ids that the re-striped layout turns into fast chargers */
const toFast = new Set();
const withCabinCleans = (snap) => {
  const now = Date.parse(snap.run.sim_clock);
  const legs = [...(snap.legs ?? [])];
  const vehicles = snap.fleet.vehicles.map((v0) => {
    const v = toFast.has(v0.stall_id) && v0.state === "charging_l2" ? { ...v0, state: "charging_dcfc" } : v0;
    if (v.state !== "charging_dcfc" || !v.stall_id) { firstSeen.delete(v.id); return v; }
    if (!firstSeen.has(v.id)) firstSeen.set(v.id, now + DRIVE_IN_S * 1000);
    const start = firstSeen.get(v.id);
    const ends = start + CYCLE_MIN * 60_000;
    legs.push({
      leg_id: `cab-${v.id}`, vehicle_id: v.id, seq: 1, leg_type: "charge_dcfc", intent: null, kind: "charge_curve",
      from_stall: null, to_stall: v.stall_id, from_x: null, from_y: null, to_x: null, to_y: null,
      start_sim: new Date(start).toISOString(), end_sim: new Date(start + 40 * 60_000).toISOString(),
      duration_s: 2400, status: "active", geometry: "measured",
    });
    return {
      ...v,
      visit: {
        visit_id: `visit-${v.id}`, visit_status: "in_progress", archetype: null, urgency: null,
        arrived_at: new Date(start).toISOString(), target_soc: 100, soc_at_arrival: v.soc, est_charge_min: 30,
        atoms: [
          { svc: "charge", status: "in_progress", must_do: true, est_min: 30, started_at: new Date(start).toISOString(), ends_at: null, done_at: null, robot_stall_id: null },
          now < ends
            ? { svc: "interior_tidy", status: "in_progress", must_do: true, est_min: 5, started_at: new Date(start).toISOString(), ends_at: new Date(ends).toISOString(), done_at: null, robot_stall_id: v.stall_id }
            : { svc: "interior_tidy", status: "done", must_do: true, est_min: 5, started_at: new Date(start).toISOString(), ends_at: new Date(ends).toISOString(), done_at: new Date(ends).toISOString(), robot_stall_id: v.stall_id },
        ],
      },
    };
  });
  return { ...snap, legs, fleet: { ...snap.fleet, vehicles } };
};

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DSF });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
// React reports an error a boundary caught (the 3D view's SceneErrorBoundary) to the console, not as a page error
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 600)); });
const routes = await installFixtureRoutes(page, F, { relay: RELAY, mutateSnapshot: withCabinCleans });

// ── --build dcfc20 | dcfc30: the layout with canopy B (and C) re-striped (registered after
//    the fixture routes, so Playwright asks it first) ──
/** per re-striped canopy: its two columns' plan x, its canopy code, and its first fast-charger number */
const RESTRIPE = {
  dcfc20: [{ west: 143, east: 157, canopy: "CANOPY-02", first: 11 }],
  dcfc30: [{ west: 143, east: 157, canopy: "CANOPY-02", first: 11 }, { west: 190, east: 204, canopy: "CANOPY-03", first: 21 }],
}[BUILD];
if (RESTRIPE) {
  const UNIT_FT = 0.4785 / 0.3048;
  const ft = (planX, planY) => ({ x: +((planX - 6) * UNIT_FT).toFixed(4), y: +((206 - planY) * UNIT_FT).toFixed(4) });
  // the live layout, read once through curl (it trusts the sandbox proxy's CA bundle), then re-striped per request
  const LAYOUT_URL = "https://gxdrcyphqjzjsuhxuqtg.supabase.co/functions/v1/otto-twin-control/depot/11111111-1111-1111-1111-111111111111/layout";
  const live = JSON.parse(execFileSync("curl", ["-sS", "-m", "30", LAYOUT_URL], { encoding: "utf8" }));
  await page.route(/otto-twin-control\/depot\/[^/]+\/layout/, async (route) => {
    const body = structuredClone(live);
    const stalls = body?.data?.stalls ?? [];
    const near = (a, b) => Math.abs(a - b) < 1;
    const template = stalls.find((s) => s.type === "dcfc");
    let keep = stalls;
    const fresh = [];
    for (const c of RESTRIPE) {
      const westX = ft(c.west, 0).x, eastX = ft(c.east, 0).x;
      const columns = [westX, eastX].map((x) => stalls.filter((s) => s.type === "l2" && near(s.x, x)).sort((a, b) => b.y - a.y));
      keep = keep.filter((s) => !(s.type === "l2" && (near(s.x, westX) || near(s.x, eastX))));
      columns.forEach((col, k) => {
        for (let i = 0; i < 5 && i < col.length; i++) {
          const p = ft(k === 0 ? c.west : c.east, 88 + 14 * i);
          toFast.add(col[i].id);
          fresh.push({ ...template, id: col[i].id, code: `NASH-DCFC-STALL-${c.first + 5 * k + i}`, type: "dcfc",
            canopy: c.canopy, x: p.x, y: p.y, heading: k === 0 ? 60 : 300 });
        }
      });
    }
    body.data.stalls = [...keep, ...fresh];
    await route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
}

await page.goto(URL_, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.getByRole("button", { name: /^3d$/i }).first().click();
await page.waitForFunction(() => !!window.__depotCam && !!window.__cleanArms, null, { timeout: 180000 });

/** The arms' phases and the doors, as the page sees them. */
const state = () => page.evaluate(() => {
  const arms = [...(window.__cleanArms ?? new Map()).entries()].map(([stall, s]) => ({ stall, ...s }));
  const d = window.__twinDriver;
  const holds = d ? { charge: d.armHolds, clean: d.cleanHolds } : null;
  return { arms, holds };
});

// wait for the first arm to leave home, then frame that stall
let target = null;
const t0 = Date.now();
while (!target && Date.now() - t0 < SECS * 1000) {
  await page.waitForTimeout(1000);
  const s = await state();
  target = s.arms.find((a) => a.phase !== "home" && (!STALL || STALL.test(a.stall)))?.stall ?? null;
}
if (!target) { console.log(JSON.stringify({ error: "no cleaning arm left home", pageErrors: errors })); process.exit(1); }

const cams = await page.evaluate((rid) => {
  const d = window.__twinDriver;
  const pos = d.stallPos.get(rid);
  let heading = null;
  for (const [, e] of d.entries) if (e.stallId === rid) heading = e.stallHeading;
  if (!pos || heading === null) return null;
  // plan -> world: x = 150 - x, z = 110 - y. The car's nose and right flank in world terms.
  const fx = -Math.cos(heading), fz = -Math.sin(heading);    // nose
  const rx = Math.sin(heading), rz = -Math.cos(heading);     // right flank (plan right = (-fwd.y, fwd.x))
  const cx = 150 - pos.x, cz = 110 - pos.y;
  const at = (n, r, y) => [cx + fx * n + rx * r, y, cz + fz * n + rz * r];
  return {
    left: { p: at(1.2, -9.5, 4.6), t: at(0.4, 0, 2.3) },       // the car's left flank, cleaned first on a west column
    right: { p: at(5.0, 9.5, 4.8), t: at(0.0, 0.5, 2.0) },     // its right (port) flank from the front quarter, past the cabinet: both robots
    high: { p: at(8.5, -6.0, 9.6), t: at(0.0, 0.0, 2.6) },     // three-quarter from the nose, high under the canopy
    canopy: { p: at(-16, -16, 10.2), t: at(10, 4, 1.5) },      // the row of stalls
    card: { p: at(19, -14.5, 8.6), t: at(0.5, 3.5, 0.8) },    // --card: under the roof, the car small enough for its card
  };
}, target);

/** which camera shows a phase: the flank being worked, else from above */
const camFor = (phase, sideA) => {
  if (/_a$/.test(phase)) return sideA;
  if (/_b$/.test(phase)) return sideA === "left" ? "right" : "left";
  return "high";
};
const sideACam = await page.evaluate((rid) => {
  // side A is the far flank from the charge port: the car's left on a canopy's west column (toward +1)
  const d = window.__twinDriver;
  const pos = d.stallPos.get(rid);
  const spines = [103, 150, 197]; // sitePlan.CANOPIES[].cx
  const cx = pos ? spines.reduce((b, c) => (Math.abs(c - pos.x) < Math.abs(b - pos.x) ? c : b), spines[0]) : 103;
  return pos && pos.x < cx ? "left" : "right";
}, target);

const summary = { target, shots: [], phases: {}, checks: [], cards: [], pageErrors: errors, consoleErrors };

// ── --overview: every canopy from the air while the arms work (plan -> world: x = 150 - x, z = 110 - y) ──
const aerial = async (label) => {
  // from south of the canopies (plan y 196), high, looking at their middle (plan 150, 124)
  await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [[0, 64, -86], [0, 0, -14]]);
  await page.waitForTimeout(2500);
  const s = await state();
  summary.aerial = { label, armsOut: s.arms.filter((a) => a.phase !== "home").map((a) => `${a.stall}:${a.phase}`) };
  await page.screenshot({ path: join(OUT, `overview-3d-${label}.jpg`), type: "jpeg", quality: 84 });
  summary.shots.push(`overview-3d-${label}`);
};
const plan2d = async () => {
  await page.getByRole("button", { name: /^2d$/i }).first().click();
  await page.waitForTimeout(3000);
  // the plan's robot layer draws one charge arm and one cleaning arm per fast charger (Robots2D.tsx)
  summary.plan2d = await page.evaluate(() => {
    const ids = (attr) => [...document.querySelectorAll(`[${attr}]`)].map((e) => e.getAttribute(attr));
    const phases = (attr) => [...document.querySelectorAll(`[${attr}]`)].map((e) => e.getAttribute("data-phase"));
    return {
      chargeArms: ids("data-charge-arm"), cleanArms: ids("data-clean-arm").length,
      chargeArmPhases: phases("data-charge-arm"), cleanArmPhases: phases("data-clean-arm"),
    };
  });
  await page.screenshot({ path: join(OUT, "overview-2d.jpg"), type: "jpeg", quality: 86 });
  summary.shots.push("overview-2d");
};
if (OVERVIEW) await aerial("start");
if (OVERVIEW_ONLY) {
  await plan2d();
  summary.refusedWrites = routes.refused;
  await ctx.close();
  await browser.close();
  writeFileSync(join(OUT, "summary-overview.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, shots: summary.shots.length }, null, 1));
  process.exit(0);
}

// ── --card: tap the car being cleaned and shoot its Q card, phase by phase ──
if (CARD) {
  let tapped = false, last = null;
  const t1 = Date.now();
  while (Date.now() - t1 < SECS * 1000) {
    const s = await state();
    const me = s.arms.find((a) => a.stall === target);
    if (me && !tapped && me.vehicleId) {
      // frame the car from far enough out that the anchored card fits beside it
      const c = cams.card;
      await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [c.p, c.t]);
      await page.waitForTimeout(1500);
      // the camera glides to the preset: prefer the car's point once it is on the canvas; after 5 s take the last one
      // (the canvas tap below does not need it on screen to pick the car)
      let hit = null;
      for (let k = 0; k < 20; k++) {
        hit = await page.evaluate((vid) => {
          const p = window.__carScreenPoint?.(vid);
          if (!p) return null;
          const r = document.querySelector("canvas")?.getBoundingClientRect();
          const on = !!r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
          const el = on ? document.elementFromPoint(p.x, p.y) : null;
          return { ...p, on, top: el?.tagName === "CANVAS" ? "canvas" : `${el?.tagName ?? "none"}.${String(el?.className ?? "").slice(0, 60)}` };
        }, me.vehicleId);
        if (hit?.on) break;
        await page.waitForTimeout(250);
      }
      // a real click when the canvas is what a finger would land on; else the canvas tap the repo's qCardShots uses,
      // and the summary names what covered the car
      if (hit) {
        summary.tap = hit;
        if (hit.top === "canvas") await page.mouse.click(hit.x, hit.y);
        else await page.evaluate(({ x, y }) => {
          const el = document.querySelector("canvas");
          const ev = (type) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0 }));
          ev("pointerdown"); ev("pointerup");
        }, hit);
        tapped = true;
        // the tap also follows the car (the cockpit's own behaviour); stop following and frame it again, so the car,
        // its arm and its card share the frame. Stopping the follow leaves the card open.
        await page.waitForTimeout(800);
        summary.followStopped = await page.evaluate(() => {
          const b = document.querySelector('button[aria-label="Stop follow mode"]');
          b?.click();
          return !!b;
        });
        await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [c.p, c.t]);
        await page.waitForTimeout(800);
      }
    }
    // the 3D view's own fallback, or the card's: told apart by their words
    const failed = tapped && await page.evaluate(() => [...document.querySelectorAll('[role="alert"]')]
      .map((e) => e.textContent ?? "").find((t) => /3D view is not available|card for this car is not available/.test(t)) ?? null);
    if (failed) {
      summary.sceneFailed = /3D view/.test(failed);
      summary.cardFailed = /card for this car/.test(failed);
      await page.screenshot({ path: join(OUT, "failed.jpg"), type: "jpeg", quality: 80 });
      break;
    }
    if (me && tapped && me.phase !== last) {
      await page.waitForTimeout(1200); // the card reads the arm twice a second
      const card = await page.evaluate(() => {
        const q = (sel) => document.querySelector(sel);
        const r = q('[data-testid="qcard-cabin"]')?.closest(".z-40")?.getBoundingClientRect();
        return {
          state: q('[data-testid="qcard-cabin-state"]')?.textContent ?? null,
          words: q('[data-testid="qcard-cabin-words"]')?.textContent ?? null,
          row: q('[data-testid="qcard-cabin"]')?.getAttribute("data-state") ?? null,
          card: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
        };
      });
      summary.cards.push({ phase: me.phase, ...card });
      const name = `card-${String(summary.cards.length).padStart(2, "0")}-${me.phase}`;
      await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 86 });
      summary.shots.push(name);
      last = me.phase;
      if (me.phase === "home" && summary.cards.length > 2) break;
    }
    await page.waitForTimeout(300);
  }
  summary.refusedWrites = routes.refused;
  await ctx.close();
  await browser.close();
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, shots: summary.shots.length }, null, 1));
  process.exit(0);
}
let n = 0, lastPhase = null;
const shoot = async (cam, label) => {
  const c = cams[cam];
  await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [c.p, c.t]);
  await page.waitForTimeout(300);
  const name = `${String(n).padStart(3, "0")}-${label}-${cam}`;
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 84, clip: { x: 0, y: 56, width: 1020, height: 790 } });
  summary.shots.push(name);
  n++;
};
const startShots = Date.now();
while (Date.now() - startShots < SECS * 1000) {
  const s = await state();
  for (const a of s.arms) {
    const seen = summary.phases[a.stall] ?? (summary.phases[a.stall] = []);
    if (seen[seen.length - 1] !== a.phase) seen.push(a.phase);
  }
  const me = s.arms.find((a) => a.stall === target);
  if (me && cams && me.phase !== lastPhase) {
    summary.checks.push({ phase: me.phase, j1: me.j1, pivot: me.pivot, knuckle: me.knuckle, holds: s.holds });
    await shoot(camFor(me.phase, sideACam), me.phase);
    if (me.phase === "clean_a" || me.phase === "clean_b") await shoot("high", `${me.phase}`);
    if (me.phase === "clean_a") await shoot("canopy", "row");
    lastPhase = me.phase;
  }
  if (me && me.phase === "home" && (summary.phases[target] ?? []).includes("doors_close")) break;
  await page.waitForTimeout(250);
}
if (OVERVIEW) { await aerial("end"); await plan2d(); }
summary.refusedWrites = routes.refused;
await ctx.close();
await browser.close();
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ ...summary, shots: summary.shots.length }, null, 1));
