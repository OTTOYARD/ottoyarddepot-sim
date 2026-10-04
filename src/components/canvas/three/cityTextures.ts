import * as THREE from 'three';
import type { Facade } from './cityPlan';

/**
 * The city's facades, drawn once on canvases: zero network assets, like textures.ts.
 *
 * Each facade is a TILE of bays by floors (cityPlan.FACADE_SPEC) drawn twice: the
 * colour map, near-neutral so a per-building tint (a vertex colour) can turn one brick
 * texture into red, brown and tan buildings, and an emissive map holding only the
 * windows that are lit after dark. The two share one random draw, so a lit pane is
 * always a window. Canvas row 0 is the TOP of a floor: textures flip on upload, so
 * the bottom of the canvas is the ground.
 */

function canvas(w: number, h: number, scale = 1): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const g = c.getContext('2d')!;
  if (scale !== 1) g.scale(scale, scale);
  return [c, g];
}

/** The night-light maps are drawn at half resolution: they only glow, and bloom softens them anyway. */
const NIGHT = 0.5;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tex(c: HTMLCanvasElement, color: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const WARM = ['#ffd9a3', '#ffe7c2', '#ffcf8a', '#fff1d8'];
const COOL = ['#dbe8ff', '#eef4ff', '#cfe0ff'];

/** A lit pane's colour: mostly warm, some cool office light, at varying strength. */
function glow(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, w: number, h: number, coolShare = 0.3) {
  const pal = r() < coolShare ? COOL : WARM;
  g.globalAlpha = 0.55 + r() * 0.45;
  g.fillStyle = pal[Math.floor(r() * pal.length)];
  // some blinds half drawn
  if (r() < 0.25) g.fillRect(x, y + h * 0.45, w, h * 0.55);
  else g.fillRect(x, y, w, h);
  g.globalAlpha = 1;
}

function noise(g: CanvasRenderingContext2D, r: () => number, w: number, h: number, n: number, dark: number, light: number) {
  for (let i = 0; i < n; i++) {
    const d = r() < 0.5;
    g.fillStyle = d ? `rgba(0,0,0,${r() * dark})` : `rgba(255,255,255,${r() * light})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/** Dark glass with a soft sky reflection: lighter at the top of each pane. */
function glass(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, w: number, h: number, top: string, bottom: string) {
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  const k = r();
  if (k < 0.3) { g.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.08})`; g.fillRect(x, y, w, h); }
  else if (k > 0.8) { g.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.1})`; g.fillRect(x, y, w, h); }
}

interface Pair { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture }

function drawGlass(): Pair {
  const S = 512, C = 64, r = mulberry(11);
  const [mc, m] = canvas(S, S), [ec, e] = canvas(S, S, NIGHT);
  m.fillStyle = '#c4ccd4'; m.fillRect(0, 0, S, S);           // mullions
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const x = i * C, y = j * C;
      glass(m, r, x + 2, y + 2, C - 4, C - 14, '#b7c6d4', '#566b7e');
      m.fillStyle = '#7b8895'; m.fillRect(x + 2, y + C - 11, C - 4, 9);   // spandrel at the floor line
      if (r() < 0.34) glow(e, r, x + 2, y + 2, C - 4, C - 14, 0.45);
    }
  }
  return { map: tex(mc, true), emissive: tex(ec, true) };
}

function drawOffice(): Pair {
  const S = 512, C = 64, r = mulberry(23);
  const [mc, m] = canvas(S, S), [ec, e] = canvas(S, S, NIGHT);
  m.fillStyle = '#ddd8cd'; m.fillRect(0, 0, S, S);
  noise(m, r, S, S, 5000, 0.06, 0.08);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  for (let j = 0; j < 8; j++) {
    const y = j * C;
    glass(m, r, 0, y + 7, S, 34, '#7d91a3', '#3d4d5c');
    m.fillStyle = '#a2998d'; m.fillRect(0, y + 41, S, 2);   // shadow under the ribbon
    for (let i = 0; i < 8; i++) {
      const lit = r() < 0.4;
      for (let k = 0; k < 4; k++) {
        const x = i * C + k * 16;
        m.fillStyle = '#a7b1ba'; m.fillRect(x, y + 7, 2, 34);   // mullion
        if (lit && r() < 0.85) glow(e, r, x + 2, y + 7, 14, 34, 0.55);
      }
    }
  }
  return { map: tex(mc, true), emissive: tex(ec, true) };
}

function drawBrick(): Pair {
  const S = 512, C = 64, r = mulberry(37);
  const [mc, m] = canvas(S, S), [ec, e] = canvas(S, S, NIGHT);
  m.fillStyle = '#dccab8'; m.fillRect(0, 0, S, S);
  // coursing: per-brick tone, then mortar
  for (let y = 0; y < S; y += 5) {
    const off = (y / 5) % 2 ? 5 : 0;
    for (let x = -off; x < S; x += 11) {
      m.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.08})`;
      m.fillRect(x, y, 11, 5);
      m.fillStyle = 'rgba(246,240,230,0.5)'; m.fillRect(x, y, 1, 5);
    }
    m.fillStyle = 'rgba(246,240,230,0.55)'; m.fillRect(0, y, S, 1);
  }
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const x = i * C, y = j * C;
      m.fillStyle = '#bda792'; m.fillRect(x + 16, y + 9, 32, 4);    // lintel
      m.fillStyle = '#f0eae0'; m.fillRect(x + 18, y + 13, 28, 38);  // frame
      glass(m, r, x + 20, y + 15, 24, 34, '#4f5f6c', '#27323c');
      m.fillStyle = '#f0eae0';
      m.fillRect(x + 31, y + 15, 2, 34);                             // muntins
      m.fillRect(x + 20, y + 29, 24, 2);
      m.fillStyle = '#ebe3d6'; m.fillRect(x + 15, y + 51, 34, 4);    // sill
      if (r() < 0.42) glow(e, r, x + 20, y + 15, 24, 34, 0.15);
    }
  }
  return { map: tex(mc, true), emissive: tex(ec, true) };
}

function drawStucco(): Pair {
  const S = 512, C = 64, r = mulberry(41);
  const [mc, m] = canvas(S, S), [ec, e] = canvas(S, S, NIGHT);
  m.fillStyle = '#efe9df'; m.fillRect(0, 0, S, S);
  noise(m, r, S, S, 6000, 0.05, 0.06);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const x = i * C, y = j * C;
      const balcony = i % 4 === 1 || i % 4 === 2;
      m.fillStyle = '#ffffff'; m.fillRect(x + 12, y + 10, 40, 40);
      glass(m, r, x + 14, y + 12, 36, 36, '#5a6976', '#2f3c47');
      m.fillStyle = '#ffffff'; m.fillRect(x + 31, y + 12, 2, 36);
      if (balcony) {
        m.fillStyle = 'rgba(70,72,74,0.45)'; m.fillRect(x + 6, y + 40, 52, 10);  // railing
        m.fillStyle = '#c8c0b2'; m.fillRect(x + 4, y + 50, 56, 5);               // slab
      }
      if (r() < 0.5) glow(e, r, x + 14, y + 12, 36, 36, 0.1);
    }
  }
  return { map: tex(mc, true), emissive: tex(ec, true) };
}

function drawStorefront(): Pair {
  const W = 512, H = 128, B = 128, r = mulberry(53);
  const [mc, m] = canvas(W, H), [ec, e] = canvas(W, H, NIGHT);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const signs = ['#2e4a3d', '#1f3550', '#5a2a2a', '#2b2b2f', '#3c5a66', '#6b4f2a', '#4a3a5c'];
  const awnings = ['#b5473a', '#2f6b5a', '#2a4f7a', '#8a6a2a'];
  for (let i = 0; i < 4; i++) {
    const x = i * B;
    m.fillStyle = '#d9d3c7'; m.fillRect(x, 0, B, H);                 // piers and band
    m.fillStyle = signs[Math.floor(r() * signs.length)];
    m.fillRect(x + 6, 4, B - 12, 20);                                 // sign band
    m.fillStyle = '#ece5d2'; m.fillRect(x + 34, 12, 60, 5);           // its lettering
    if (r() < 0.6) { e.fillStyle = r() < 0.5 ? '#fff4dc' : '#dff3ff'; e.fillRect(x + 34, 12, 60, 5); }
    if (r() < 0.55) {
      const a = awnings[Math.floor(r() * awnings.length)];
      for (let s = 0; s < B - 12; s += 10) {
        m.fillStyle = (s / 10) % 2 ? '#f2efe8' : a;
        m.fillRect(x + 6 + s, 26, 10, 9);
      }
    }
    glass(m, r, x + 8, 38, B - 16, 78, '#56677a', '#1f2932');
    m.fillStyle = '#4a4f55';
    m.fillRect(x + 8 + (B - 16) / 3, 38, 2, 78);
    m.fillRect(x + 8 + (2 * (B - 16)) / 3, 38, 2, 78);
    const door = r() < 0.5;
    if (door) { m.fillStyle = '#20262c'; m.fillRect(x + B - 34, 52, 20, 64); }
    m.fillStyle = '#5a554e'; m.fillRect(x, 116, B, 12);                 // base kick
    if (r() < 0.78) {
      const g = e.createLinearGradient(0, 38, 0, 116);
      g.addColorStop(0, 'rgba(255,214,160,0.55)');
      g.addColorStop(1, 'rgba(255,233,200,0.95)');
      e.fillStyle = g;
      e.fillRect(x + 8, 38, B - 16 - (door ? 26 : 0), 78);
    }
  }
  return { map: tex(mc, true), emissive: tex(ec, true) };
}

function drawIndustrial(): Pair {
  const W = 512, H = 256, B = 128, r = mulberry(67);
  const [mc, m] = canvas(W, H), [ec, e] = canvas(W, H, NIGHT);
  for (let x = 0; x < W; x += 6) {
    m.fillStyle = (x / 6) % 2 ? '#c8cdd1' : '#dadee1';
    m.fillRect(x, 0, 6, H);
  }
  noise(m, r, W, H, 4000, 0.05, 0.05);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  m.fillStyle = '#9aa3aa'; m.fillRect(0, 0, W, 14);                  // fascia
  for (let x = 6; x < W; x += 32) {                                  // clerestory
    m.fillStyle = '#eef0f2'; m.fillRect(x, 26, 22, 18);
    glass(m, r, x + 2, 28, 18, 14, '#6d7d8c', '#3f4c58');
    if (r() < 0.35) { e.globalAlpha = 0.5; e.fillStyle = '#cfe0ff'; e.fillRect(x + 2, 28, 18, 14); e.globalAlpha = 1; }
  }
  for (let i = 0; i < 4; i++) {
    const x = i * B;
    m.fillStyle = '#b3b9be'; m.fillRect(x, 14, 3, 222);                // pilaster line
    if (r() < 0.62) {
      // a dock door: seal, roll-up slats, bumpers
      m.fillStyle = '#2d2e30'; m.fillRect(x + 19, 137, 90, 99);
      m.fillStyle = '#aeb5bb'; m.fillRect(x + 23, 141, 82, 95);
      m.fillStyle = '#8f979e';
      for (let y = 145; y < 236; y += 7) m.fillRect(x + 23, y, 82, 1);
      m.fillStyle = '#1d1d1f'; m.fillRect(x + 26, 228, 10, 8); m.fillRect(x + 92, 228, 10, 8);
      e.fillStyle = '#ffe2b0'; e.fillRect(x + 60, 126, 8, 4);          // dock light
    } else {
      m.fillStyle = '#6b757e'; m.fillRect(x + 54, 190, 20, 46);        // man door
      m.fillStyle = '#8b939a'; m.fillRect(x + 48, 184, 32, 4);         // its canopy
      e.fillStyle = '#ffe2b0'; e.fillRect(x + 60, 178, 8, 4);
    }
  }
  m.fillStyle = '#a29e97'; m.fillRect(0, 236, W, 20);                // concrete base
  return { map: tex(mc, true), emissive: tex(ec, true) };
}

const DRAW: Record<Facade, () => Pair> = {
  glass: drawGlass, office: drawOffice, brick: drawBrick,
  stucco: drawStucco, storefront: drawStorefront, industrial: drawIndustrial,
};

const cache = new Map<Facade, Pair>();

/** The facade's colour and night-light maps (cached: drawn once per page). */
export function facadeTextures(f: Facade): Pair {
  let p = cache.get(f);
  if (!p) { p = DRAW[f](); cache.set(f, p); }
  return p;
}

let roof: THREE.CanvasTexture | null = null;
/** Pale roofing membrane with seams, for world-unit UVs. */
export function roofTexture(): THREE.CanvasTexture {
  if (roof) return roof;
  const S = 256, r = mulberry(79);
  const [c, g] = canvas(S, S);
  g.fillStyle = '#d2d5d7'; g.fillRect(0, 0, S, S);
  noise(g, r, S, S, 9000, 0.09, 0.08);
  g.fillStyle = 'rgba(120,124,128,0.35)';
  for (let k = 0; k < S; k += 64) { g.fillRect(k, 0, 1, S); g.fillRect(0, k, S, 1); }
  roof = tex(c, true);
  return roof;
}
