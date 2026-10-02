#!/usr/bin/env node
// ============================================================================
// tabShots — screenshots of the OTTO-Q and Agent tabs (or, on main, the three tabs they replace) in the running
// cockpit, fed a RECORDED run. READ-ONLY by construction.
//
// A headless Chromium opens the dev server at /?run=<fixture run> and answers ONLY the read RPCs these tabs call, from
// src/components/tabs/__fixtures__/ottoqRun.1ccad49b.json (a read-only capture). EVERY other request to the Supabase
// project is aborted before it leaves the browser, so nothing can start, stop, pause or write anything. No button is
// pressed except tab buttons, layer rows and, with --replay, the OTTO-Q tab's own "Replay the newest records" and
// "Stop the replay" (selected by those exact labels inside the replay row; they read and write nothing).
//
// The depot cards answer the fixture's first captured frame, then its second (two real states 92 s apart), and the
// decision feed and the offer ledger answer an older page first and then the full page: real records arriving in the
// order the engine wrote them, so the funnel's motion can be seen. Nothing is generated.
//
//   npm run dev                                          # in another shell (PORT=8080)
//   node scripts/tabShots.mjs --out ./shots              # after (this branch)
//   node scripts/tabShots.mjs --out ./shots --before     # before (main: Intelligence, Orchestration, Events)
//
//   --url U         dev server (http://127.0.0.1:8080/)
//   --events FILE   ottoq_run_event_feed payload for the Events tab (--before only)
//   --chromium P    browser executable (default /opt/pw-browsers/chromium if present)
// ============================================================================
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const URL_ = arg("--url", "http://127.0.0.1:8080/");
const OUT = arg("--out", "./shots");
const BEFORE = has("--before");
const EVENTS = arg("--events", null);
const WIDTHS = arg("--widths", "420,360,320").split(",").map(Number).filter(Boolean);
const ONLY = arg("--only", null);
const NO_PHONE = has("--no-phone");
const exe = arg("--chromium", fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
fs.mkdirSync(OUT, { recursive: true });

const FX = JSON.parse(fs.readFileSync(path.resolve("src/components/tabs/__fixtures__/ottoqRun.1ccad49b.json"), "utf8"));
const RUN = FX.sim_run_id;
const events = EVENTS ? JSON.parse(fs.readFileSync(EVENTS, "utf8")) : [];

function installRoutes(page) {
  const log = { answered: {}, aborted: 0, abortedWrites: 0 };
  let cardsCalls = 0, feedCalls = 0, dispCalls = 0;
  // The newest 40 decisions and 30 offers arrive on the second read.
  const feedOld = FX.feed.slice(40);
  const dispOld = FX.dispositions.slice(30);
  page.route(/gxdrcyphqjzjsuhxuqtg\.supabase\.co/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const rpc = url.pathname.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/)?.[1];
    const table = url.pathname.match(/\/rest\/v1\/([a-z0-9_]+)$/)?.[1];
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    const answer = (name, body) => { log.answered[name] = (log.answered[name] ?? 0) + 1; return json(body); };
    if (rpc === "ottoq_depot_cards") {
      cardsCalls++;
      return answer(rpc, { sim_run_id: RUN, sim_clock: cardsCalls > 1 ? FX.sim_clock_b : null, contract_version: "1.4",
        vehicles: cardsCalls > 1 ? FX.cards_b : FX.cards_a });
    }
    if (rpc === "ottoq_activity_feed_v2") {
      const body = JSON.parse(req.postData() || "{}");
      if (body.p_vehicle_id) return answer(rpc, FX.feed.filter((r) => r.vehicle_id === body.p_vehicle_id));
      feedCalls++;
      return answer(rpc, feedCalls > 1 ? FX.feed : feedOld);
    }
    if (rpc === "ottoq_intelligence_stack") return answer(rpc, FX.stack);
    if (rpc === "ottoq_challenger_board") return answer(rpc, FX.challenger);
    if (rpc === "ottoq_learning_board") return answer(rpc, FX.learning);
    if (rpc === "ottoq_run_event_feed" && BEFORE) return answer(rpc, events);
    if (rpc === "ottoq_decision_options") return answer(rpc, { choices: [] });
    if (req.method() === "GET" && table === "ottoq_proposal_disposition_ledger") {
      dispCalls++;
      const gt = Number((url.searchParams.get("disposition_id") ?? "gt.0").replace("gt.", ""));
      const src = dispCalls > 1 ? FX.dispositions : dispOld;
      return answer(table, src.filter((d) => d.disposition_id > gt));
    }
    if (req.method() === "GET" && (table === "ottoq_decisions" || table === "ottoq_external_proposals")) return answer(table, []);
    log.aborted++;
    if (req.method() !== "GET" && !rpc?.startsWith("ottoq_")) log.abortedWrites++;
    return route.abort();
  });
  return log;
}

let interact = null;
let replayLog = null;
let cost = null;
async function panelShots(browser, width) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  const log = installRoutes(page);
  await page.goto(`${URL_}?run=${RUN}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  // Size the side panel like a narrower screen would.
  await page.evaluate((w) => {
    const el = document.querySelector("div.w-\\[420px\\]");
    if (el) { el.style.width = `${w}px`; el.parentElement.style.width = `${w}px`; }
  }, width);
  const tabs = (BEFORE ? ["Intelligence", "Orchestration", "Events"] : ["OTTO-Q", "Agent"]).filter((t) => !ONLY || t === ONLY);
  const shots = [];
  const overflow = {};
  for (const t of tabs) {
    await page.locator("div.w-\\[420px\\] button", { hasText: new RegExp(`^${t.replace("-", "\\-")}$`) }).first().click();
    if (!BEFORE && t === "OTTO-Q" && has("--motion") && width === WIDTHS[0]) {
      // Motion: the stack while the second reads land (real records arriving in engine order), a frame every ~0.7 s.
      const stackEl = page.locator("div.w-\\[420px\\] canvas").first();
      await page.waitForTimeout(3600);
      for (let f = 0; f < 12; f++) {
        const nm = `motion-${String(f).padStart(2, "0")}.png`;
        const box = await stackEl.boundingBox();
        if (box) await page.screenshot({ path: path.join(OUT, nm), clip: { x: box.x, y: box.y, width: box.width * 0.66, height: box.height } });
        shots.push(nm);
        await page.waitForTimeout(700);
      }
    }
    await page.waitForTimeout(t === "OTTO-Q" ? 11000 : 3000); // OTTO-Q: long enough for the second cards and feed reads
    const panel = page.locator("div.w-\\[420px\\]").first();
    const name = `${BEFORE ? "before" : "after"}-${t.toLowerCase().replace(/[^a-z]/g, "")}-${width}.png`;
    await panel.screenshot({ path: path.join(OUT, name) });
    shots.push(name);
    overflow[t] = await page.evaluate(() => {
      const el = document.querySelector("div.w-\\[420px\\]");
      const bad = [];
      el?.querySelectorAll("*").forEach((n) => { if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== "hidden" && getComputedStyle(n).overflowX !== "auto" && getComputedStyle(n).overflowX !== "scroll" && n.clientWidth > 0) bad.push(n.tagName + "." + (n.className || "").toString().slice(0, 40)); });
      return { panel: el ? [el.scrollWidth, el.clientWidth] : null, bad: bad.slice(0, 5) };
    });
    if (!BEFORE && t === "OTTO-Q" && width === WIDTHS[0]) {
      // Cost, from the stack's dev-only probe: the last frame's draw calls and triangles (bloom passes included), and
      // how many frames a quiet stretch renders (the loop should stop once nothing moves).
      const probe = () => page.evaluate(() => { const rt = window.__ottoqStack; return rt ? { frames: rt.frames, last: rt.lastInfo } : null; });
      const a = await probe();
      await page.waitForTimeout(4000);
      const b = await probe();
      cost = a && b ? { drawCalls: b.last?.calls ?? null, triangles: b.last?.triangles ?? null, framesInQuiet4s: b.frames - a.frames } : null;
    }
    if (!BEFORE && t === "OTTO-Q" && has("--replay") && width === WIDTHS[0]) {
      // Replay: ask for it, shoot the transport row and the stack while it plays, then stop it and check it let go.
      const stackEl = page.locator("div.w-\\[420px\\] canvas").first();
      const startBtn = page.locator("[data-replay-bar] button[aria-label='Replay the newest records']");
      const idle = (await page.locator("[data-replay-bar]").first().textContent())?.replace(/\s+/g, " ").trim();
      await startBtn.click();
      const frames = [];
      const hiddenNow = () => page.evaluate(() => {
        const rt = window.__ottoqStack;
        if (!rt) return null;
        const t = performance.now() / 1000;
        return [...rt.reveal.values()].filter((at) => at > t).length;
      });
      // A software-rendered screenshot takes ~3 s: four frames span ~14 s of the ~20 s replay, then Stop is pressed
      // while records are still hidden, and must put every one of them back.
      for (let f = 0; f < 4; f++) {
        await page.waitForTimeout(f === 0 ? 1400 : 300);
        const box = await stackEl.boundingBox();
        const nm = `replay-${String(f).padStart(2, "0")}.png`;
        if (box) await page.screenshot({ path: path.join(OUT, nm), clip: { x: box.x, y: box.y - 36, width: box.width, height: box.height + 36 } });
        shots.push(nm);
        frames.push((await page.locator("[data-replay-bar][role=status]").first().textContent({ timeout: 1000 }).catch(() => null))?.replace(/\s+/g, " ").trim() ?? null);
      }
      const hiddenBeforeStop = await hiddenNow();
      const stopBtn = page.locator("[data-replay-bar][role=status] button[aria-label='Stop the replay']");
      const stopped = await stopBtn.click({ timeout: 3000 }).then(() => true, () => false);
      await page.waitForTimeout(1500);
      const after = await page.locator("[data-replay-bar][role=status]").count();
      const hidden = await hiddenNow();
      replayLog = { idle, frames, hiddenBeforeStop, stopped, statusAfterStop: after, hiddenAfterStop: hidden };
    }
    if (!BEFORE && t === "OTTO-Q") {
      // Open two layers and shoot each.
      const flat = await page.locator("ol[aria-label='OTTO-Q layers']").count();
      const plates = flat ? ["Proposers", "Service"] : ["Planners", "Depot", "Agent", "Decide", "Safety"];
      for (const layer of plates) {
        const btn = flat
          ? page.locator("ol[aria-label='OTTO-Q layers'] button", { hasText: layer }).first()
          : page.locator("button[aria-pressed]", { hasText: layer }).first();
        await btn.click({ force: true });
        await page.waitForTimeout(flat ? 600 : 4000);
        const nm = `after-ottoq-${layer.toLowerCase().replace(/[^a-z]/g, "")}-${width}.png`;
        await panel.screenshot({ path: path.join(OUT, nm) });
        shots.push(nm);
        await btn.click({ force: true });
        await page.waitForTimeout(flat ? 100 : 2500);
      }
      // A mid-motion frame: the second cards read has just moved cars; catch sparks in flight.
    }
    if (!BEFORE && t === "Agent") {
      await page.getByRole("tab", { name: "Learning" }).click();
      await page.waitForTimeout(800);
      const nm = `after-agent-learning-${width}.png`;
      await panel.screenshot({ path: path.join(OUT, nm) });
      shots.push(nm);
    }
  }
  if (!BEFORE && has("--interact") && width === WIDTHS[0]) {
    await page.locator("div.w-\\[420px\\] button", { hasText: /^OTTO\-Q$/ }).first().click();
    await page.waitForTimeout(2500);
    const c = page.locator("div.w-\\[420px\\] canvas").first();
    const box = await c.boundingBox();
    if (box) {
      // drag sideways: the stack turns (a vertical swipe would scroll the panel instead)
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
      await page.mouse.down();
      for (let k = 1; k <= 12; k++) await page.mouse.move(box.x + box.width * 0.3 - k * 12, box.y + box.height * 0.5);
      await page.mouse.up();
      await page.waitForTimeout(2500);
      await page.locator("div.w-\\[420px\\]").first().screenshot({ path: path.join(OUT, `after-ottoq-turned-${width}.png`) });
      shots.push(`after-ottoq-turned-${width}.png`);
      // turn back, then find a car puck under the pointer (its tooltip appears), shoot the hover, and tap it
      await page.mouse.move(box.x + box.width * 0.3 - 144, box.y + box.height * 0.5);
      await page.mouse.down();
      for (let k = 1; k <= 12; k++) await page.mouse.move(box.x + box.width * 0.3 - 144 + k * 12, box.y + box.height * 0.5);
      await page.mouse.up();
      await page.waitForTimeout(2500);
      const tip = page.locator("div.pointer-events-none.absolute.z-20");
      let hit = null;
      for (let fy = 0.6; fy < 0.9 && !hit; fy += 0.03) {
        for (let fx = 0.12; fx < 0.6 && !hit; fx += 0.035) {
          await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
          await page.waitForTimeout(220);
          if (await tip.count()) {
            const text = (await tip.first().textContent()) ?? "";
            if (!/offer|agent|\d{1,2}:\d{2}/i.test(text)) hit = { fx, fy, text };
          }
        }
      }
      if (hit) {
        await page.locator("div.w-\\[420px\\]").first().screenshot({ path: path.join(OUT, `after-ottoq-hover-${width}.png`) });
        shots.push(`after-ottoq-hover-${width}.png`);
        await page.mouse.down(); await page.mouse.up();
        await page.waitForTimeout(4500);
        await page.locator("div.w-\\[420px\\]").first().screenshot({ path: path.join(OUT, `after-ottoq-picked-${width}.png`) });
        shots.push(`after-ottoq-picked-${width}.png`);
      }
      interact = { hover: hit?.text ?? null, pickedCard: await page.locator("section[aria-label='Picked record']").count() };
    }
  }
  const full = `${BEFORE ? "before" : "after"}-cockpit-${width}.png`;
  await page.screenshot({ path: path.join(OUT, full) });
  await ctx.close();
  return { width, shots, errors: [...new Set(errors)], overflow, log, interact: width === WIDTHS[0] ? interact : undefined, replay: width === WIDTHS[0] ? replayLog : undefined, cost: width === WIDTHS[0] ? cost : undefined };
}

async function phoneShots(browser) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 393, height: 852 }, reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  const log = installRoutes(page);
  await page.goto(`${URL_}?run=${RUN}&phone=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const tabs = (BEFORE ? ["Intelligence", "Orchestration", "Events"] : ["OTTO-Q", "Agent"]).filter((t) => !ONLY || t === ONLY);
  const shots = [];
  const docWidth = {};
  for (const t of tabs) {
    // the phone's 3D view keeps a software-rendered main thread busy: do not wait on it after the tap
    await page.locator("button", { hasText: new RegExp(`^${t.replace("-", "\\-")}$`) }).first().click({ force: true, noWaitAfter: true, timeout: 60000 });
    await page.waitForTimeout(t === "OTTO-Q" ? 11000 : 3000);
    const nm = `${BEFORE ? "before" : "after"}-phone-${t.toLowerCase().replace(/[^a-z]/g, "")}.png`;
    await page.screenshot({ path: path.join(OUT, nm) });
    shots.push(nm);
    docWidth[t] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  }
  await ctx.close();
  return { phone: "393x852", shots, errors: [...new Set(errors)], docWidth, log };
}

const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
for (const w of WIDTHS) results.push(await panelShots(browser, w));
if (!NO_PHONE) results.push(await phoneShots(browser));
await browser.close();
console.log(JSON.stringify(results, null, 1));
