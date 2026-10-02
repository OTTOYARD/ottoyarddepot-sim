#!/usr/bin/env node
// ============================================================================
// backgroundShots — screenshots of the OTTO-Q tab's layer "i" cards and the Background tab, in the running cockpit,
// fed RECORDED reads. READ-ONLY by construction, like tabShots.mjs: a headless Chromium answers only the read requests
// these tabs make, from two read-only captures, and aborts every other request to the Supabase project before it
// leaves the browser.
//
//   src/components/tabs/__fixtures__/ottoqRun.1ccad49b.json      the OTTO-Q tab's run (cards, feed, offers, stack)
//   src/components/tabs/__fixtures__/background.2026-10-02.json  the Background tab's ten sources, read 21:11 UTC
//   src/components/tabs/__fixtures__/valueSummary.example.json   the Value summary
//
//   npm run dev                                       # in another shell (PORT=8080)
//   node scripts/backgroundShots.mjs --out ./shots
//
//   --url U         dev server (http://127.0.0.1:8080/)
//   --chromium P    browser executable (default /opt/pw-browsers/chromium if present)
// ============================================================================
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg("--url", "http://127.0.0.1:8080/");
const OUT = arg("--out", "./shots");
const exe = arg("--chromium", fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
fs.mkdirSync(OUT, { recursive: true });

const read = (f) => JSON.parse(fs.readFileSync(path.resolve(`src/components/tabs/__fixtures__/${f}`), "utf8"));
const FX = read("ottoqRun.1ccad49b.json");
const BG = read("background.2026-10-02.json");
const VALUE = read("valueSummary.example.json");
const RUN = FX.sim_run_id;

const TABLES = {
  ottoq_calibration_datasets: BG.datasets,
  ottoq_calibration_distributions: BG.distributions,
  ottoq_feed_plans: BG.feed_plans,
  ottoq_variability_catalog: BG.catalog,
  ottoq_intelligence_ledger: BG.ledger,
  ottoq_rules: BG.rules,
  ottoq_determinism_canon: BG.canon,
  ottoq_depot_tariffs: BG.tariffs,
  ottoq_vehicle_classes: BG.classes,
};

function installRoutes(page) {
  const log = { answered: {}, aborted: 0 };
  let cardsCalls = 0;
  page.route(/gxdrcyphqjzjsuhxuqtg\.supabase\.co/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const rpc = url.pathname.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/)?.[1];
    const table = url.pathname.match(/\/rest\/v1\/([a-z0-9_]+)$/)?.[1];
    const answer = (name, body) => {
      log.answered[name] = (log.answered[name] ?? 0) + 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    };
    if (rpc === "ottoq_depot_cards") {
      cardsCalls++;
      return answer(rpc, { sim_run_id: RUN, sim_clock: cardsCalls > 1 ? FX.sim_clock_b : null, contract_version: "1.4",
        vehicles: cardsCalls > 1 ? FX.cards_b : FX.cards_a });
    }
    if (rpc === "ottoq_activity_feed_v2") return answer(rpc, FX.feed);
    if (rpc === "ottoq_intelligence_stack") return answer(rpc, FX.stack);
    if (rpc === "ottoq_challenger_board") return answer(rpc, FX.challenger);
    if (rpc === "ottoq_learning_board") return answer(rpc, FX.learning);
    if (rpc === "ottoq_shield_probe_posture") return answer(rpc, BG.posture);
    if (rpc === "ottoq_value_summary") return answer(rpc, VALUE);
    if (req.method() === "GET" && table === "ottoq_proposal_disposition_ledger") return answer(table, FX.dispositions);
    if (req.method() === "GET" && table && TABLES[table]) return answer(table, TABLES[table]);
    log.aborted++;
    return route.abort();
  });
  return log;
}

const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const shots = [];
const errors = [];

async function desktop() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  const log = installRoutes(page);
  await page.goto(`${URL_}?run=${RUN}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const panel = page.locator("div.w-\\[420px\\]").first();

  // OTTO-Q: the stack, then each plate's "i" card
  await page.locator("div.w-\\[420px\\] button", { hasText: /^OTTO\-Q$/ }).first().click();
  await page.waitForTimeout(9000);
  await panel.screenshot({ path: path.join(OUT, "ottoq-stack-with-info.png") });
  shots.push("ottoq-stack-with-info.png");
  for (const layer of ["Agent", "Planners", "Decide", "Safety", "Depot"]) {
    const btn = page.getByRole("button", { name: `About the ${layer} layer` }).first();
    await btn.click({ force: true });
    await page.waitForTimeout(700);
    const nm = `ottoq-info-${layer.toLowerCase()}.png`;
    await page.screenshot({ path: path.join(OUT, nm), clip: { x: 1440 - 820, y: 0, width: 820, height: 900 } });
    shots.push(nm);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // Background: the top, then each section, then the full-width panel
  await page.getByRole("button", { name: /^Background$/ }).first().click(); // the top bar's entry
  await page.waitForTimeout(2500);
  await panel.screenshot({ path: path.join(OUT, "background-top.png") });
  shots.push("background-top.png");
  for (const id of ["bg-boundary", "bg-data", "bg-montecarlo", "bg-agentic", "bg-safety", "bg-value", "bg-agnostic", "bg-facts"]) {
    await page.evaluate((x) => document.getElementById(x)?.scrollIntoView({ block: "start" }), id);
    await page.waitForTimeout(400);
    const nm = `background-${id.slice(3)}.png`;
    await panel.screenshot({ path: path.join(OUT, nm) });
    shots.push(nm);
  }
  const overflow = await page.evaluate(() => {
    const el = document.querySelector("div.w-\\[420px\\]");
    return el ? [el.scrollWidth, el.clientWidth] : null;
  });
  await ctx.close();
  return { log, overflow };
}

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  installRoutes(page);
  await page.goto(`${URL_}?run=${RUN}&phone=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const tab = page.getByRole("button", { name: /^Background$/ }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, "background-phone.png") });
    shots.push("background-phone.png");
  }
  await ctx.close();
}

const d = await desktop();
await phone();
await browser.close();
console.log(JSON.stringify({ shots, answered: d.log.answered, aborted: d.log.aborted, panelOverflow: d.overflow, errors }, null, 1));
