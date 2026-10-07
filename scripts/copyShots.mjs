#!/usr/bin/env node
// ============================================================================
// copyShots — look at the OTTO-Q copy (layer cards, Background tab) and the
// "Learned this run" strip in the running cockpit, without starting a run.
//
// Plays a recorded run read-only (scripts/lib/fixturePlayback.mjs: nothing reaches
// the database, every write is refused in the browser). The Background tab's facts
// are run-independent reads (ledger, rules, canon), so they pass through read-only
// and show real numbers. The strip's read, public.ottoq_run_learning, is answered
// from a file: by default the real capture of run fd6ed035
// (src/components/tabs/__fixtures__/runLearning.fd6ed035.json, an ENDED run), and
// with --live-example a payload BUILT to the same contract to show the live form.
// The live example is not a measurement and says so in every caption it is used in.
//
//   npm run dev                                          # in another shell
//   node scripts/copyShots.mjs --url http://127.0.0.1:8093/ --out docs/pr-shots/copy-and-learning
//
//   --url U   (http://127.0.0.1:8080/)   --out DIR (./copy-shots)   --live-example
//   --chromium P (default /opt/pw-browsers/chromium if present)    --relay-curl
// ============================================================================
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
const OUT = resolve(arg("out", "copy-shots"));
const RELAY = arg("relay-curl", false) === true;
const CHROMIUM = arg("chromium", existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
mkdirSync(OUT, { recursive: true });

const F = loadFixture(ROOT, "fresh0922");
const CAPTURE = JSON.parse(readFileSync(join(ROOT, "src/components/tabs/__fixtures__/runLearning.fd6ed035.json"), "utf8"));
/** The live form, built to 0613's contract from the shape of run fd6ed035's busy hours. NOT a measurement. */
const LIVE_EXAMPLE = {
  ok: true, live: true, window_ticks: 20,
  run: { tick: 214, status: "running" },
  chargers: { dcfc: { free: 1, total: 10, faulted: 2 }, l2: { free: 0, total: 30, faulted: 1 } },
  chargers_free: 1,
  queue: { waiting: 41, waiting_for_a_charger: 34 },
  batch: { max_assets: 1, priority: [] },
  offers: { planners_recent: { offered: 3, used: 1, moved: 1, refused: 2, refused_by_reason: { stall_occupied: 1, stall_reserved: 1 } } },
  refusals: [
    { tick: 209, source: "forward_lex", vehicle: "Waymo-006", vehicle_id: "a1", stall: "CANOPY-01 E-08", stall_id: "s1", reason: "stall_occupied",
      went_to: { vehicle: "Tesla-AV-064", tick: 208, same_car: false } },
    { tick: 203, source: "forward_lex", vehicle: "Waymo-001", vehicle_id: "a2", stall: "CANOPY-01 W-05", stall_id: "s2", reason: "stall_reserved",
      went_to: { vehicle: "Tesla-AV-052", tick: 202, same_car: false } },
  ],
  dispatched: [{ tick: 212, vehicle: "Waymo-AV-012", vehicle_id: "v1", stall: "CANOPY-01 E-04", moved_from_offer: true }],
  lesson: { code: "more_cars_than_chargers" },
};
const LEARNING = arg("live-example", false) === true ? LIVE_EXAMPLE : CAPTURE;

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const summary = { shots: [], checks: {}, refused: [], pageErrors: [] };
const panel = (page) => page.locator("div.h-full.bg-canvas-raised").first();
const shootPanel = async (page, name) => {
  const box = await panel(page).boundingBox();
  const path = join(OUT, `${name}.jpg`);
  await page.screenshot({ path, type: "jpeg", quality: 88, clip: box ?? undefined });
  summary.shots.push(path);
};
const shootEl = async (page, locator, name, pad = 6) => {
  const b = await locator.boundingBox();
  const path = join(OUT, `${name}.jpg`);
  await page.screenshot({
    path, type: "jpeg", quality: 90,
    clip: b ? { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad } : undefined,
  });
  summary.shots.push(path);
};
const openTab = (page, label) => page.evaluate((t) => {
  const b = [...document.querySelectorAll("button")].find((e) => e.textContent?.trim().toUpperCase() === t);
  b?.click();
  return !!b;
}, label);
const scrollTo = (page, id) => page.evaluate((x) => { document.getElementById(x)?.scrollIntoView({ block: "start" }); }, id);

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => summary.pageErrors.push(String(e).slice(0, 200)));
const routes = await installFixtureRoutes(page, F, { relay: RELAY });
// registered last, so it answers before the fixture's own RPC route
await page.route(/\/rest\/v1\/rpc\/ottoq_run_learning/, (route) => route.fulfill({
  status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(LEARNING),
}));
await page.goto(URL_, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="run-transport"]', { timeout: 60000 });
await page.waitForTimeout(8000);

// ── Background: the agentic system, the safety harness, the technical edge ─────
await openTab(page, "BACKGROUND");
await page.waitForTimeout(4000);
for (const [id, name] of [["bg-agentic", "12-background-agentic"], ["bg-safety", "13-background-safety"], ["bg-edge", "14-background-edge"]]) {
  await scrollTo(page, id);
  await page.waitForTimeout(900);
  await shootPanel(page, name);
}
summary.checks.backgroundProductNames = await page.evaluate(() =>
  (document.body.innerText.match(/Nemotron|cuOpt|CP-SAT|OR-Tools|Omniverse|Isaac Sim/g) ?? []));

// ── the layer cards, opened from the Background tab's agentic list ────────────
await scrollTo(page, "bg-agentic");
await page.waitForTimeout(600);
for (const [layer, name] of [["Agent", "15-card-agent"], ["Planners", "16-card-planners"], ["Decide", "17-card-decide"], ["Safety", "18-card-safety"]]) {
  await page.getByRole("button", { name: `About the ${layer} layer` }).first().click();
  const card = page.getByRole("article", { name: `About the ${layer} layer` });
  await card.waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  await shootEl(page, card, name, 10);
  summary.checks[`card_${layer}`] = (await card.innerText()).replace(/\s+/g, " ").slice(0, 400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

// ── the OTTO-Q tab: "Learned this run" ────────────────────────────────────────
await openTab(page, "OTTO-Q");
const strip = page.getByRole("region", { name: "Learned this run" });
await strip.waitFor({ timeout: 60000 });
await page.waitForTimeout(3000);
const details = strip.locator("details");
if (await details.count()) await details.first().evaluate((d) => { d.open = true; });
// to the top of the panel's scroll area, so the open list is on screen and not under the fold
await strip.evaluate((el) => el.scrollIntoView({ block: "start" }));
await page.waitForTimeout(800);
await shootEl(page, strip, LEARNING === LIVE_EXAMPLE ? "19-learned-this-run-live-example" : "19-learned-this-run-fd6ed035", 8);
summary.checks.strip = (await strip.innerText()).replace(/\s+/g, " ").slice(0, 600);

summary.refused = [...routes.refusedRequests];
await browser.close();
console.log(JSON.stringify(summary, null, 2));
