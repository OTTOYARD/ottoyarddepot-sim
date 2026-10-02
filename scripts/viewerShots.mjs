#!/usr/bin/env node
// ============================================================================
// viewerShots — the live view (view.html) from each of its cameras: empty, then with a RECORDED run playing.
// READ-ONLY by construction, like cockpitPlayback.mjs.
//
//   empty   the run list answers with no run, so the view follows nothing and draws the empty depot: what a cockpit
//           shows before a simulation starts. Every other request is refused or passes through as a GET.
//   live    scripts/lib/fixturePlayback.mjs serves a captured run (synthetic run id, never a real one) on the wall
//           clock, so the cars move as they did; the depot layout is a read-only GET to the backend.
//   framed  a page that frames the view as a cockpit does, and records what the view posts to it.
//
//   npm run dev                                       # in another shell (PORT=8080)
//   node scripts/viewerShots.mjs --out ./shots --relay-curl
//
//   --url U          dev server (http://127.0.0.1:8080/)
//   --fixture NAME   src/engine/__fixtures__/twinRun.NAME.json (fresh0922)
//   --secs N         playback seconds before the live shots (40)
//   --relay-curl     fetch the backend's GETs through curl (a sandbox whose browser distrusts the proxy CA)
//   --chromium P     browser executable (default /opt/pw-browsers/chromium if present)
// ============================================================================
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUN, installFixtureRoutes, loadFixture } from "./lib/fixturePlayback.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const URL_ = arg("--url", "http://127.0.0.1:8080/");
const OUT = arg("--out", "./shots");
const SECS = Number(arg("--secs", "40"));
const FIXTURE = arg("--fixture", "fresh0922");
const RELAY = has("--relay-curl");
const ONLY = arg("--only", null); // empty | live | framed
const exe = arg("--chromium", fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
fs.mkdirSync(OUT, { recursive: true });

const CAMS = ["se", "sw", "ne", "nw", "pole", "top"];
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const summary = { shots: [], errors: [], states: {}, refused: 0 };
const view = (q = "") => `${URL_.replace(/\/$/, "")}/view.html${q}`;

async function shootCams(page, prefix) {
  for (const c of CAMS) {
    await page.getByRole("button", { name: c === "pole" ? "Pole" : c === "top" ? "Top" : c.toUpperCase(), exact: true }).click();
    await page.waitForTimeout(2200);
    const nm = `${prefix}-${c}.png`;
    await page.screenshot({ path: path.join(OUT, nm) });
    summary.shots.push(nm);
  }
}

// ── empty: no run anywhere ───────────────────────────────────────────────────
if (!ONLY || ONLY === "empty") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => summary.errors.push(`empty: ${e.message}`));
  await page.route(/supabase\.co/, (route) => {
    const r = route.request();
    if (/\/otto-twin-control\/sim_runs$/.test(new URL(r.url()).pathname) && r.method() === "GET") {
      return route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true, data: { runs: [] } }) });
    }
    summary.refused++;
    return route.abort(); // nothing else is needed to draw an empty depot
  });
  await page.goto(view("?spin=0"), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  summary.states.empty = await page.getByRole("status").first().textContent();
  await shootCams(page, "empty");
  await ctx.close();
}

// ── live: a recorded run, followed (no ?run=) ────────────────────────────────
if (!ONLY || ONLY === "live") {
  const F = loadFixture(ROOT, FIXTURE);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => summary.errors.push(`live: ${e.message}`));
  const h = await installFixtureRoutes(page, F, { relay: RELAY });
  await page.goto(view("?spin=0"), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(SECS * 1000);
  summary.states.live = await page.getByRole("status").first().textContent();
  await shootCams(page, "live");
  // spin: two shots a few seconds apart from the same corner
  await page.getByRole("button", { name: "SE", exact: true }).click();
  await page.getByRole("button", { name: /Spin/ }).click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, "live-se-spun.png") });
  summary.shots.push("live-se-spun.png");
  summary.refused += h.refused;
  await ctx.close();
}

// ── framed: a cockpit-shaped host on a trusted origin, pinned to the recorded run ──
if (!ONLY || ONLY === "framed") {
  const F = loadFixture(ROOT, FIXTURE);
  const ctx = await browser.newContext({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => summary.errors.push(`framed: ${e.message}`));
  const h = await installFixtureRoutes(page, F, { relay: RELAY });
  const host = `${URL_.replace(/\/$/, "")}/__host.html`; // same origin as the dev server: a trusted parent
  const src = view(`?run=${RUN}&embed=1&cam=pole`);
  await page.route(host, (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><body style="margin:0;background:#111">
    <div style="padding:8px;color:#ccc;font:12px sans-serif">Host page (a cockpit's overview)</div>
    <iframe id="v" src="${src}" style="width:860px;height:480px;border:0" allow="fullscreen"></iframe>
    <script>window.__msgs=[];addEventListener('message',e=>{if(e.data&&e.data.source==='otto-twin-view')window.__msgs.push(e.data)});</script>
  </body></html>` }));
  await page.goto(host, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(SECS * 1000);
  await page.screenshot({ path: path.join(OUT, "framed.png") });
  summary.shots.push("framed.png");
  // the host hides the view, then asks for another camera: the view must take both from a trusted parent
  await page.evaluate(() => {
    const w = document.getElementById("v").contentWindow;
    w.postMessage({ source: "otto-cockpit", type: "camera", cam: "top" }, "*");
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "framed-top.png") });
  summary.shots.push("framed-top.png");
  summary.states.framedMessages = await page.evaluate(() => window.__msgs.map((m) => m.type === "state" ? `state:${m.state.kind}` : m.type));
  summary.refused += h.refused;
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(summary, null, 1));
