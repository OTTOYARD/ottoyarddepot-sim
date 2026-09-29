#!/usr/bin/env node
// ============================================================================
// perfHarness — measure the 3D twin's rendering, repeatably, per profile and tier.
//
// Plays a RECORDED run (the fresh0922 dispatch wave: 116 cars, the busiest
// capture there is) through the real cockpit, read-only (scripts/lib/
// fixturePlayback.mjs), switches to 3D, and for each camera preset reads the
// in-app probe (window.__perf, src/components/canvas/three/perf/PerfProbe.tsx):
// fps, p50/p95/p99 frame time, draw calls and triangles for the WHOLE frame
// (shadow + main + post passes), CPU ms inside renderer.render, and an estimate
// of GPU memory. Prints a markdown table and writes JSON (+ screenshots) to --out.
//
//   npm run dev                                           # in another shell
//   node scripts/perfHarness.mjs --label before --quality baseline
//   node scripts/perfHarness.mjs --label after  --quality high,medium,low --shots
//
//   --url U            cockpit dev server (http://127.0.0.1:8080/)
//   --profiles p,p     desktop (1440x900 @1x) and/or mobile (932x430 @3x, touch,
//                      iPhone UA, CPU throttled --throttle x) (desktop,mobile)
//   --quality q,q      tiers to force via ?quality= (high, medium, low, auto), or
//                      "baseline" to pass none (a build without tiers) (auto)
//   --presets a,b      camera presets (Bird Eye,Operator,Hero,Canopy)
//   --secs N           seconds sampled per preset (12)   --settle N (3)
//   --start N          fixture playback seconds before the first sample (40)
//   --throttle X       CPU slowdown on the mobile profile (4)
//   --shots            screenshot each preset
//   --dsf F            override the profile's device scale factor (software GL is
//                      fill-bound: 0.5 makes it ~4x cheaper; counts are unchanged)
//   --label L          --out DIR (./perf)   --relay-curl   --chromium P
//
// ⚠️ In a sandbox the browser renders WebGL in SOFTWARE (SwiftShader): draw
// calls, triangles and memory are exact, but fps and frame times measure a CPU
// rasteriser, so compare them only against another run on the same machine.
// Real frame rates come from a real device with ?perf=1 (the on-screen overlay).
// ============================================================================
import { chromium, devices } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
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
const list = (v) => String(v).split(",").map((s) => s.trim()).filter(Boolean);
const URL_ = arg("url", "http://127.0.0.1:8080/");
const PROFILES = list(arg("profiles", "desktop,mobile"));
const QUALITIES = list(arg("quality", "auto"));
const PRESETS = list(arg("presets", "Bird Eye,Operator,Hero,Canopy"));
const SECS = Number(arg("secs", 12));
const SETTLE = Number(arg("settle", 3));
const START = Number(arg("start", 40));
const THROTTLE = Number(arg("throttle", 4));
const SHOTS = arg("shots", false) === true;
const LABEL = String(arg("label", "run"));
const OUT = resolve(arg("out", "perf"));
const RELAY = arg("relay-curl", false) === true;
const CHROMIUM = arg("chromium", undefined);
const FIXTURE = String(arg("fixture", "fresh0922"));
const DSF = arg("dsf", undefined);
mkdirSync(OUT, { recursive: true });

const F = loadFixture(ROOT, FIXTURE);
const iphone = devices["iPhone 14 Pro Max landscape"] ?? devices["iPhone 13 Pro Max landscape"];
const PROFILE = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  // 932 px wide: an iPhone Pro Max in landscape. (A narrower phone was turned
  // away outright by ResponsiveGuard's 900 px floor before this lane.)
  mobile: {
    ...(iphone ?? {}),
    viewport: { width: 932, height: 430 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  },
};

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

const results = [];
for (const profile of PROFILES) {
  for (const quality of QUALITIES) {
    const ctx = await browser.newContext({ ...PROFILE[profile], ...(DSF ? { deviceScaleFactor: Number(DSF) } : {}) });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    if (profile === "mobile" && THROTTLE > 1) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    }
    const routes = await installFixtureRoutes(page, F, { relay: RELAY });
    const u = new URL(URL_);
    u.searchParams.set("perf", "1");
    if (quality !== "baseline") u.searchParams.set("quality", quality);
    await page.goto(u.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    // the view switch lives in the side panel / top bar on desktop; a phone
    // layout may open straight into 3D
    await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => /^3d$/i.test(x.textContent?.trim() ?? ""))?.click());
    await page.waitForFunction(() => !!window.__perf, null, { timeout: 120000 });
    while (routes.playbackSeconds() < START) await page.waitForTimeout(500);

    const inv = await page.evaluate(() => window.__perf.inventory());
    for (const preset of PRESETS) {
      // a DOM click, not a Playwright one: at software-GL frame rates the page
      // is too busy for actionability checks to settle
      const hit = await page.evaluate((name) => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim().toLowerCase() === name.toLowerCase());
        b?.click();
        return !!b;
      }, preset);
      if (!hit) console.error(`preset ${preset}: no button`);
      await page.waitForTimeout(SETTLE * 1000);
      await page.evaluate(() => window.__perf.reset());
      await page.waitForTimeout(SECS * 1000);
      const s = await page.evaluate(() => window.__perf.summary());
      const cars = await page.evaluate(() => window.__twinDriver?.entries?.size ?? null);
      const row = { label: LABEL, profile, quality, preset, playbackS: +routes.playbackSeconds().toFixed(0), cars, ...s };
      results.push(row);
      console.error(`${profile}/${quality}/${preset}: ${s.fps} fps p95 ${s.p95Ms} ms, ${s.calls} calls, ${(s.triangles / 1e6).toFixed(2)}M tris, js ${s.cpuFrameMs} ms, render ${s.cpuRenderMs} ms, ${s.memory.totalMB} MB, ${cars} cars`);
      if (SHOTS) await page.screenshot({ path: join(OUT, `${LABEL}_${profile}_${quality}_${preset.replace(/\s+/g, "")}.png`) });
    }
    results.push({ label: LABEL, profile, quality, inventory: inv, pageErrors: [...new Set(errors)].slice(0, 5), refusedWrites: routes.refused });
    await ctx.close();
  }
}
await browser.close();

writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(results, null, 1));
const rows = results.filter((r) => r.preset);
console.log(`\n### ${LABEL}\n`);
console.log("| profile | tier | preset | fps* | p95 ms* | draw calls | triangles | JS frame ms | render() ms | GPU mem est. MB | programs | dpr | canvas |");
console.log("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const r of rows) {
  console.log(`| ${r.profile} | ${r.quality === "baseline" ? "(none)" : r.tier + (r.quality === "auto" ? " (auto)" : "")} | ${r.preset} | ${r.fps} | ${r.p95Ms} | ${r.calls} | ${(r.triangles / 1e6).toFixed(2)}M | ${r.cpuFrameMs ?? "-"} | ${r.cpuRenderMs} | ${r.memory.totalMB} | ${r.memory.programs} | ${r.dpr} | ${r.canvas.join("x")} |`);
}
console.log("\n\\* software GL (SwiftShader) in a sandbox: compare only against runs on the same machine.");
