#!/usr/bin/env node
// sceneryShots — the yard's grass and sky from four cameras, with no run (READ-ONLY; see idleDepotShots).
//   node scripts/sceneryShots.mjs --url http://127.0.0.1:8093/ --out DIR [--relay] [--hour 18.5] [--weather Rain]
// --hour and --weather set the renderer's own clock and weather through the dev server's store module (vite dev only).
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
const URL_ = String(arg("url", "http://127.0.0.1:8080/")).replace(/\/?$/, "/");
const OUT = resolve(arg("out", "scenery-shots"));
const CHROMIUM = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
mkdirSync(OUT, { recursive: true });

const F = loadFixture(ROOT, "fresh0922");
const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const CAMS = {
  aerial: [[0, 150, -210], [0, 0, 0]],          // the whole block, grass verge and city
  horizon: [[-200, 14, -150], [40, 30, 60]],    // low, looking up at the sky over the depot
  verge: [[-170, 9, -40], [-150, 0, 30]],       // close on the grass outside the west fence
  lawnTop: [[-158, 30, 60], [-158, 0, 61]],     // straight down on the verge
};
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
await installFixtureRoutes(page, F, { relay: arg("relay", false) === true, noRun: true });
await page.goto(URL_ + "view.html", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__depotCam === "function", null, { timeout: 120000 });
await page.waitForTimeout(15000);
if (arg("hour", null) !== null || arg("weather", null) !== null) {
  await page.evaluate(async ([hour, weather]) => {
    const { useSimulationStore } = await import("/src/store/simulationStore.ts");
    const s = useSimulationStore.getState();
    if (hour !== null) s.setSimTime(Number(hour) * 3600);
    if (weather !== null) useSimulationStore.setState({ config: { ...s.config, weather } });
  }, [arg("hour", null), arg("weather", null)]);
}
for (const [name, [p, t]] of Object.entries(CAMS)) {
  await page.evaluate(([p, t]) => window.__depotCam?.(p, t), [p, t]);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 86 });
}
await browser.close();
if (errors.length) { console.error(errors); process.exit(1); }
console.log("ok", OUT);
