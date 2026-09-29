#!/usr/bin/env node
// node scripts/pwaIcons.mjs   (CHROMIUM=/path/to/chromium if Playwright has no browser of its own)
// Rasterise the OTTOYARD hex mark into the PWA icon set (run once; PNGs are committed).
import { chromium } from "@playwright/test";
const b = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
const page = await b.newPage();
const mark = (inset) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0A0B0E"/>
  <g transform="translate(${inset} ${inset}) scale(${(100 - 2 * inset) / 100})" fill="#C00000">
    <path d="M50 5 L93 27.5 L93 72.5 L50 95 L7 72.5 L7 27.5 Z"/>
    <path d="M50 20 L78 35 L78 65 L50 80 L22 65 L22 35 Z" fill="none" stroke="white" stroke-width="3"/>
  </g></svg>`;
// "any" icons fill most of the square; maskable ones keep the mark inside the
// 80% safe zone a launcher may crop to a circle
for (const [name, size, inset] of [["icon-192.png", 192, 8], ["icon-512.png", 512, 8], ["icon-maskable-512.png", 512, 18], ["apple-touch-icon.png", 180, 12]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${mark(inset).replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: false });
}
await b.close();
