#!/usr/bin/env node
// ============================================================================
// faultShots — look at a FAULTED CHARGER and the top bar's run transport in the
// running cockpit, without starting a run and without the live backend's faults.
//
// Plays a recorded run read-only (scripts/lib/fixturePlayback.mjs: nothing reaches
// the database, every write is refused in the browser) and adds three Faulted
// chargers to every served frame, in the snapshot's own shape (otto-q-core 0612):
// the live rows of 2026-10-07 (DCFC-02 communication dropout, DCFC-09 hardware),
// re-timed to the recording's sim clock, and an L2 with a code the cockpit does not
// know and no repair end. Then it shoots:
//
//   desktop, no run   the cockpit opening on Background, the top bar's Start, and
//                     its confirm (opened, then cancelled — never confirmed)
//   desktop, faults   the "chargers down" chip (bottom bar, beside LIVE) and its
//                     list, the faulted DCFC in 3D among its charging neighbours
//                     and at its face, the Canopy preset; then the 2D plan's FAULT
//                     marks and a faulted stall's tooltip, at 2x
//   phone, faults     the chip on the status strip, portrait and landscape, and
//                     the list a tap opens
//   phone, no run     the run bar's Start (the same transport as the top bar)
// It also prints checks: the tab the cockpit opened on, that no start request was
// made, that the top bar's telemetry strip is not clipped, which renderer stall each
// fault was drawn on and that no car holds one, the tooltip and the chip list text.
//
//   npm run dev                                         # in another shell
//   node scripts/faultShots.mjs --url http://127.0.0.1:5174/ --out docs/pr-shots/faults-and-start
//
//   --url U   (http://127.0.0.1:8080/)   --out DIR (./fault-shots)
//   --chromium P (default /opt/pw-browsers/chromium if present)   --relay-curl
//
// ⚠️ Software GL in a sandbox draws ~1 frame a second: good for placement and
// colour, not smoothness.
// ============================================================================
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
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
const OUT = resolve(arg("out", "fault-shots"));
const RELAY = arg("relay-curl", false) === true;
const CHROMIUM = arg("chromium", existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
mkdirSync(OUT, { recursive: true });

const F = loadFixture(ROOT, "fresh0922");
const MIN = 60_000;
/** The three faults, timed from the frame's own sim clock. */
const FAULTS = [
  { id: "609910b1-c888-4624-8077-76c2fc83615f", fault_code: "fault.communication_dropout", backInMin: 47 },
  { id: "3a7310ac-5dfe-45fc-af3a-82d169345f30", fault_code: "fault.station_hardware", backInMin: 98 },
  { id: "d01cc4ff-a0dd-4db0-a6ec-f8e5b95d7be7", fault_code: "fault.new_code_the_cockpit_does_not_know", backInMin: null },
];
const withFaults = (snap) => {
  const now = Date.parse(snap.run.sim_clock);
  const rows = FAULTS.map((f) => ({
    id: f.id, status: "faulted", vehicle_id: null, reserved_by: null, reserved_until: null, tethered: false,
    tether_until: null, tether_direction: null, tether_phase: null,
    charger_state: "Faulted", fault_code: f.fault_code,
    fault_until: f.backInMin === null ? null : new Date(now + f.backInMin * MIN).toISOString(),
  }));
  return { ...snap, stalls_status: [...(snap.stalls_status ?? []), ...rows] };
};

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const summary = { shots: [], checks: {}, refused: [], pageErrors: [] };
const shoot = async (page, name, opts = {}) => {
  const path = join(OUT, `${name}.jpg`);
  await page.screenshot({ path, type: "jpeg", quality: 85, ...opts });
  summary.shots.push(path);
};
const track = (page, routes) => {
  page.on("pageerror", (e) => summary.pageErrors.push(String(e).slice(0, 200)));
  return () => summary.refused.push(...routes.refusedRequests);
};
/** DOM-level click: at software-GL frame rates Playwright's actionability waits can time out. */
const clickByText = (page, sel, text) => page.evaluate(([s, t]) => {
  const el = [...document.querySelectorAll(s)].find((e) => e.textContent?.trim() === t);
  el?.click();
  return !!el;
}, [sel, text]);
/** Does the top bar's telemetry strip fit its box (the transport takes room beside the clock)? */
const topBarFit = (page) => page.evaluate(() => {
  const bar = document.querySelector("div.h-14");
  const strip = bar?.querySelector("div.rounded-md.py-1");
  const box = strip?.parentElement;
  const r = strip?.getBoundingClientRect(), b = box?.getBoundingClientRect();
  return r && b ? { strip: Math.round(r.width), box: Math.round(b.width), clipped: r.left < b.left - 0.5 || r.right > b.right + 0.5 } : null;
});

// ── desktop, NO RUN: opens on Background; Start opens its confirm ─────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const routes = await installFixtureRoutes(page, F, { relay: RELAY, noRun: true });
  const done = track(page, routes);
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="run-transport"]', { timeout: 60000 });
  await page.waitForTimeout(6000);
  summary.checks.activeTabOnOpen = await page.evaluate(() =>
    [...document.querySelectorAll("div.w-\\[420px\\] button")].find((b) => b.querySelector("span.absolute"))?.textContent?.trim() ?? null);
  summary.checks.topBarNoRun = await topBarFit(page);
  await shoot(page, "01-desktop-opens-on-background-with-start");
  await page.getByRole("button", { name: /^Start$/ }).first().click();
  await page.waitForSelector('[data-testid="start-run-dialog"]', { timeout: 15000 });
  await page.waitForTimeout(800);
  await shoot(page, "02-desktop-start-confirm");
  await page.getByRole("button", { name: /^Cancel$/ }).click();
  await page.waitForTimeout(800);
  summary.checks.startDialogClosed = (await page.locator('[data-testid="start-run-dialog"]').count()) === 0;
  summary.checks.startWritesAttempted = [...routes.refusedRequests].filter((r) => r.includes("/scenarios/start")).length;
  done();
  await ctx.close();
}

// ── desktop, a run with three chargers down ───────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const routes = await installFixtureRoutes(page, F, { relay: RELAY, mutateSnapshot: withFaults });
  const done = track(page, routes);
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="chargers-down"]', { timeout: 60000 });
  while (routes.playbackSeconds() < 20) await page.waitForTimeout(500);
  // the top bar must not clip its telemetry strip with the transport beside the clock
  summary.checks.topBarWithRun = await topBarFit(page);
  // where the driver drew the three, and that no car holds one
  summary.checks.faultedStalls = await page.evaluate((ids) => {
    const d = window.__twinDriver;
    return ids.map((id) => {
      const rid = d?.rendererStallFor(id);
      let heldBy = null;
      for (const [vid, e] of d?.entries ?? []) if (e.stallId === rid) heldBy = vid;
      return { twin: id.slice(0, 8), renderer: rid ?? null, heldBy };
    });
  }, FAULTS.map((f) => f.id));
  await shoot(page, "03-desktop-chargers-down-chip");
  await page.locator('[data-testid="chargers-down"]').click();
  await page.waitForSelector('[data-testid="chargers-down-list"]', { timeout: 10000 });
  await page.waitForTimeout(600);
  await shoot(page, "04-desktop-chargers-down-list", { clip: { x: 0, y: 900 - 420, width: 1440, height: 420 } });
  summary.checks.chipList = await page.evaluate(() => document.querySelector('[data-testid="chargers-down-list"]')?.innerText ?? null);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 3D: the faulted DCFC close up from the lane, then its face, then the canopy preset
  await page.getByRole("button", { name: /^3d$/i }).first().click();
  await page.waitForFunction(() => !!window.__depotCam, null, { timeout: 120000 });
  const cam = await page.evaluate((id) => {
    const d = window.__twinDriver;
    const rid = d?.rendererStallFor(id);
    const pos = rid ? d.stallPos.get(rid) : null;
    if (!pos) return null;
    // world = toWorld(plan): x = 150 - plan x, z = 110 - plan y. DCFC-02 is in the WEST
    // column (bearing 60), so its cabinet stands ~7.35u off the car's south-east flank,
    // at world offset about (-3.7, -6.4) from the stall's centre.
    const cx = 150 - pos.x, cz = 110 - pos.y;
    const at = (dx, y, dz) => [cx + dx, y, cz + dz];
    return {
      context: { p: at(-1, 7, 8), t: at(-3.2, 2.0, -4.5) },  // the closed pad, the faulted cabinet, its neighbours charging
      face: { p: at(5.1, 3.5, -5.2), t: at(-3.5, 2.4, -6.1) }, // the cabinet's car-facing face: red screen, beacon
    };
  }, FAULTS[0].id);
  await page.waitForTimeout(8000);
  if (cam) {
    await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [cam.context.p, cam.context.t]);
    await page.waitForTimeout(9000);
    await shoot(page, "05-3d-faulted-dcfc-among-chargers", { clip: { x: 0, y: 56, width: 1020, height: 790 } });
    await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [cam.face.p, cam.face.t]);
    await page.waitForTimeout(9000);
    await shoot(page, "06-3d-faulted-dcfc-face", { clip: { x: 0, y: 56, width: 1020, height: 790 } });
  }
  if (await clickByText(page, "button", "Canopy")) {
    await page.waitForTimeout(9000);
    await shoot(page, "07-3d-canopy-preset");
  }
  done();
  await ctx.close();
}

// ── desktop 2D close up, at 2x: the FAULT marks and a faulted stall's tooltip ─
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const routes = await installFixtureRoutes(page, F, { relay: RELAY, mutateSnapshot: withFaults });
  const done = track(page, routes);
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="stall-fault-mark"]', { timeout: 60000 });
  while (routes.playbackSeconds() < 20) await page.waitForTimeout(500);
  const target = await page.evaluate((id) => {
    const d = window.__twinDriver;
    const rid = d?.rendererStallFor(id);
    const pos = rid ? d.stallPos.get(rid) : null;
    const svg = document.querySelector('svg[viewBox="0 0 300 220"]');
    if (!pos || !svg) return null;
    const at = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(svg.getScreenCTM()); };
    const s = at(pos.x, pos.y), a = at(78, 66), b = at(232, 170);
    return { x: s.x, y: s.y, clip: { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y } };
  }, FAULTS[0].id);
  if (target) {
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(700);
    await shoot(page, "08-2d-fault-marks-and-tooltip", { clip: target.clip });
  }
  summary.checks.tooltip = await page.evaluate(() => document.querySelector('[data-testid="stall-tooltip"]')?.innerText ?? null);
  summary.checks.faultMarks2d = await page.evaluate(() => document.querySelectorAll('[data-testid="stall-fault-mark"]').length);
  done();
  await ctx.close();
}

// ── phone, a run with three chargers down ─────────────────────────────────────
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
for (const [name, w, h] of [["portrait", 393, 852], ["landscape", 852, 393]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  const routes = await installFixtureRoutes(page, F, { relay: RELAY, mutateSnapshot: withFaults });
  const done = track(page, routes);
  const u = new URL(URL_);
  u.searchParams.set("quality", "low");
  await page.goto(u.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="chargers-down"]', { timeout: 90000 });
  while (routes.playbackSeconds() < 15) await page.waitForTimeout(500);
  await page.waitForTimeout(2500);
  await shoot(page, `09-phone-${name}-chip`);
  await page.evaluate(() => document.querySelector('[data-testid="chargers-down"]')?.click());
  await page.waitForTimeout(1200);
  await shoot(page, `10-phone-${name}-chargers-down-list`);
  done();
  await ctx.close();
}

// ── phone, NO RUN: the shared transport's Start, on the phone run bar ─────────
{
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  const page = await ctx.newPage();
  const routes = await installFixtureRoutes(page, F, { relay: RELAY, noRun: true });
  const done = track(page, routes);
  const u = new URL(URL_);
  u.searchParams.set("quality", "low");
  await page.goto(u.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="run-transport"]', { timeout: 90000 });
  await page.waitForTimeout(6000);
  await shoot(page, "11-phone-portrait-no-run-start");
  summary.checks.phoneStartWritesAttempted = [...routes.refusedRequests].filter((r) => r.includes("/scenarios/start")).length;
  done();
  await ctx.close();
}

await browser.close();
summary.refused = [...new Set(summary.refused)];
summary.pageErrors = [...new Set(summary.pageErrors)].slice(0, 8);
console.log(JSON.stringify(summary, null, 1));
