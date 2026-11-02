#!/usr/bin/env node
// ============================================================================
// idleDepotShots — what the twin draws with NO run, against the live layout, READ-ONLY.
//
// The idle twin (the cockpit before Start, and view.html, the live view the other
// cockpits frame) draws the depot the twin's layout describes (useTwinSceneBridge reads
// it with no run). This loads both pages with the run list answered empty
// (scripts/lib/fixturePlayback.mjs, `noRun`): the layout and every other GET pass
// through to the backend through curl, and every write is refused in the browser.
// Nothing touches the database.
//
// It counts, per canopy (A, B, C by stall number: DCFC-01..10, 11..20, 21..30), the
// OTTO-CHARGE ARMs and OTTO-CLEAN ARMs the cockpit's 2D plan draws, and the cleaning
// arms its 3D view and the live view draw, and shoots:
//   plan-2d.jpg            the cockpit's 2D plan
//   aerial-3d.jpg          the cockpit's 3D view over all three canopies
//   canopy-{A,B,C}.jpg     under each canopy, framed as the "Robots" preset frames canopy A
//   view-aerial.jpg        the live view (view.html) over all three canopies
// and writes summary.json. Exit 1 when a page throws.
//
//   npm run dev     # or: PORT=8093 npx vite --host 127.0.0.1 --port 8093
//   node scripts/idleDepotShots.mjs --url http://127.0.0.1:8093/ --out docs/pr-shots/idle-thirty
//
//   --url U (http://127.0.0.1:8080/)   --out DIR (./idle-depot-shots)   --chromium P
//
// ⚠️ Software GL in a sandbox draws about a frame a second: good for what is drawn and
// where, not for smoothness.
// ============================================================================
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
const URL_ = String(arg("url", "http://127.0.0.1:8080/")).replace(/\/?$/, "/");
const OUT = resolve(arg("out", "idle-depot-shots"));
const CHROMIUM = arg("chromium", existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
mkdirSync(OUT, { recursive: true });

// any wall-paced capture serves the routes; with noRun none of its frames is played
const F = loadFixture(ROOT, "fresh0922");
const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

/** plan -> world: x = 150 - x, z = 110 - y. From south of the canopies, high, at their middle. */
const AERIAL = [[0, 64, -86], [0, 0, -14]];
/** under each canopy from its west lane: the "Robots" preset (cameraPresets.ts) for A, moved 47u per canopy */
const UNDER = { A: [[70, 5.5, 2], [52, 2.5, -6]], B: [[23, 5.5, 2], [5, 2.5, -6]], C: [[-24, 5.5, 2], [-42, 2.5, -6]] };
const canopyOf = (id) => {
  const n = Number(/(\d+)$/.exec(id ?? "")?.[1] ?? 0);
  return n <= 10 ? "A" : n <= 20 ? "B" : "C";
};
const perCanopy = (ids) => ids.reduce((m, id) => ((m[canopyOf(id)] = (m[canopyOf(id)] ?? 0) + 1), m), {});

async function open(path, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  const routes = await installFixtureRoutes(page, F, { relay: true, noRun: true });
  const layoutReads = [];
  page.on("request", (r) => { if (/\/depot\/[^/]+\/layout$/.test(r.url())) layoutReads.push(r.url()); });
  await page.goto(URL_ + path, { waitUntil: "domcontentloaded" });
  return { ctx, page, errors, routes, layoutReads };
}
const frame = async (page, [p, t], file) => {
  await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [p, t]);
  await page.waitForTimeout(7000);
  await page.screenshot({ path: join(OUT, file), type: "jpeg", quality: 84 });
};
const cleanArms3d = (page) => page.evaluate(() => [...(window.__cleanArms ?? new Map()).keys()]);

const summary = { url: URL_, shots: [] };

// ── the cockpit: the 2D plan it opens on, then the 3D view ──
{
  const { ctx, page, errors, routes, layoutReads } = await open("", { width: 1440, height: 900 });
  await page.waitForTimeout(9000);
  const plan = await page.evaluate(() => ({
    chargeArms: [...document.querySelectorAll("[data-charge-arm]")].map((e) => e.getAttribute("data-charge-arm")),
    cleanArms: [...document.querySelectorAll("[data-clean-arm]")].map((e) => e.getAttribute("data-clean-arm")),
  }));
  await page.screenshot({ path: join(OUT, "plan-2d.jpg"), type: "jpeg", quality: 84 });
  summary.shots.push("plan-2d");
  await page.getByRole("button", { name: /^3d$/i }).first().click();
  await page.waitForFunction(() => !!window.__depotCam, null, { timeout: 180000 });
  await page.waitForTimeout(6000);
  await frame(page, AERIAL, "aerial-3d.jpg");
  summary.shots.push("aerial-3d");
  for (const [k, cam] of Object.entries(UNDER)) {
    await frame(page, cam, `canopy-${k}.jpg`);
    summary.shots.push(`canopy-${k}`);
  }
  summary.cockpit = {
    layoutReads: layoutReads.length,
    plan2d: { chargeArms: perCanopy(plan.chargeArms), cleanArms: perCanopy(plan.cleanArms) },
    cleanArms3d: perCanopy(await cleanArms3d(page)),
    // what the read-only guard refused: every request that is not a GET or an ottoq_twin_* read RPC
    refused: [...routes.refusedRequests],
    pageErrors: errors,
  };
  await ctx.close();
}

// ── the live view the other cockpits frame ──
{
  const { ctx, page, errors, routes, layoutReads } = await open("view.html", { width: 1280, height: 800 });
  await page.waitForFunction(() => !!window.__depotCam, null, { timeout: 180000 });
  await page.waitForTimeout(8000);
  await frame(page, AERIAL, "view-aerial.jpg");
  summary.shots.push("view-aerial");
  summary.view = {
    layoutReads: layoutReads.length,
    cleanArms3d: perCanopy(await cleanArms3d(page)),
    // what the read-only guard refused: every request that is not a GET or an ottoq_twin_* read RPC
    refused: [...routes.refusedRequests],
    pageErrors: errors,
  };
  await ctx.close();
}

await browser.close();
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
process.exit(summary.cockpit.pageErrors.length || summary.view.pageErrors.length ? 1 : 0);
