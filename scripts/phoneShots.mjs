#!/usr/bin/env node
// ============================================================================
// phoneShots — look at the PHONE cockpit (src/components/phone) without a phone.
//
// Plays a recorded run read-only through the running cockpit (the same fixture
// routing as cockpitPlayback / perfHarness: nothing reaches the database, every
// write is refused in the browser) in an emulated iPhone, landscape and
// portrait, and screenshots each state: the live view, the panel sheet at half
// and full, a tab switch, the camera menu, and the Stop confirmation (opened,
// then dismissed — never confirmed). Pass --desktop to also shoot the desktop
// cockpit at 1440x900, to show it is unchanged.
//
//   npm run dev                                         # in another shell
//   node scripts/phoneShots.mjs --out /tmp/phone --desktop
//
//   --url U   (http://127.0.0.1:8080/)   --secs N  playback seconds first (25)
//   --out DIR (./phone-shots)            --quality low|medium|high (low: fast in software GL)
//   --only landscape|portrait            --chromium P   --relay-curl
//
// ⚠️ Software GL in a sandbox draws ~1 frame a second: this checks LAYOUT
// (what is where, at what size, in which orientation), not smoothness.
// ============================================================================
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
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
const OUT = resolve(arg("out", "phone-shots"));
const SECS = Number(arg("secs", 25));
const QUALITY = String(arg("quality", "low"));
const ONLY = arg("only", null);
const DESKTOP = arg("desktop", false) === true;
const RELAY = arg("relay-curl", false) === true;
const CHROMIUM = arg("chromium", undefined);
mkdirSync(OUT, { recursive: true });

const F = loadFixture(ROOT, "fresh0922");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const phone = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
const PROFILES = {
  landscape: phone(852, 393), // iPhone 15/16
  portrait: phone(393, 852),
};

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

/** DOM-level helpers: at software-GL frame rates Playwright's actionability waits time out. */
const clickLabel = (page, label) => page.evaluate((l) => {
  const el = [...document.querySelectorAll("[aria-label]")].find((e) => e.getAttribute("aria-label") === l);
  el?.click();
  return !!el;
}, label);
const clickText = (page, text) => page.evaluate((t) => {
  const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === t);
  el?.click();
  return !!el;
}, text);
/** Drag the sheet handle by dy px (negative = up), as pointer events. */
const dragHandle = (page, dy) => page.evaluate((d) => {
  const el = [...document.querySelectorAll("[aria-label]")].find((e) => /panels$/.test(e.getAttribute("aria-label") ?? ""));
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const ev = (type, yy) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: yy, pointerId: 7, pointerType: "touch", isPrimary: true }));
  ev("pointerdown", y);
  for (let i = 1; i <= 8; i++) ev("pointermove", y + (d * i) / 8);
  ev("pointerup", y + d);
  return true;
}, dy);

const summary = [];
const shots = async (name, profile) => {
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const routes = await installFixtureRoutes(page, F, { relay: RELAY });
  const u = new URL(URL_);
  u.searchParams.set("quality", QUALITY);
  await page.goto(u.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector("canvas"), null, { timeout: 120000 });
  while (routes.playbackSeconds() < SECS) await page.waitForTimeout(500);
  await page.waitForTimeout(2500);
  const shot = async (label) => {
    await page.waitForTimeout(1800);
    const path = join(OUT, `${name}-${label}.jpg`);
    await page.screenshot({ path, quality: 82 });
    summary.push(path);
  };
  await shot("01-live-view");
  if (name === "landscape") {
    await clickLabel(page, "Open panels");
    await shot("02-sheet-half-control");
    await clickText(page, "Intelligence");
    await shot("03-sheet-half-intelligence");
    await dragHandle(page, -260);
    await shot("04-sheet-full-intelligence");
    await dragHandle(page, 400);
    await shot("05-sheet-peek");
  } else {
    await clickText(page, "Intelligence");
    await shot("02-panels-intelligence");
    await clickLabel(page, "Make the live view larger");
    await shot("03-bigger-live-view");
    await clickLabel(page, "Make the live view smaller");
  }
  await clickLabel(page, "Camera and quality");
  await shot("06-camera-menu");
  await clickText(page, "Hero");
  await shot("07-hero-preset");
  if (await clickLabel(page, "Stop run")) {
    await shot("08-stop-confirm");
    await clickText(page, "Keep running");
  }
  const layout = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    canvas: (() => { const c = document.querySelector("canvas"); const r = c?.getBoundingClientRect(); return r ? [Math.round(r.width), Math.round(r.height)] : null; })(),
    desktopTopBar: !!document.querySelector("img[alt=OTTOYARD]"),
    horizontalScroll: document.documentElement.scrollWidth > innerWidth,
  }));
  summary.push({ name, layout, refused: [...routes.refusedRequests], pageErrors: [...new Set(errors)].slice(0, 5) });
  await ctx.close();
};

for (const [name, profile] of Object.entries(PROFILES)) {
  if (ONLY && ONLY !== name) continue;
  await shots(name, profile);
}
if (DESKTOP) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const routes = await installFixtureRoutes(page, F, { relay: RELAY });
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => /^3d$/i.test(x.textContent?.trim() ?? ""))?.click());
  while (routes.playbackSeconds() < SECS) await page.waitForTimeout(500);
  await page.waitForTimeout(4000);
  const path = join(OUT, "desktop-1440.jpg");
  await page.screenshot({ path, quality: 82 });
  summary.push(path, { name: "desktop", phoneCockpit: await page.evaluate(() => !!document.querySelector('[aria-label="Camera and quality"]')) });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(summary, null, 1));
