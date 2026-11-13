import * as THREE from 'three';
import logoSignUrl from '@/assets/ottoyard-sign.jpg';

/**
 * Procedural CanvasTextures — zero network assets, generated once at module
 * load. These carry the photoreal read: asphalt grain, PV cell grids,
 * concrete tone, sky gradient. Cached singletons.
 */

const _tex = new Map<string, THREE.Texture>();

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  return c;
}

function cachedTex(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = _tex.get(key);
  if (!t) { t = make(); _tex.set(key, t); }
  return t;
}

/** Seeded PRNG so textures are stable frame-to-frame and run-to-run. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Worn asphalt: dark base, aggregate speckle, tonal patches, faint sealant seams. */
export function asphaltTexture(): THREE.Texture {
  return cachedTex('asphalt', () => {
    const rnd = mulberry(7);
    const c = canvas(512, 512, (g, w, h) => {
      g.fillStyle = '#26262c';
      g.fillRect(0, 0, w, h);
      // broad tonal patches (repaved sections / tire wear)
      for (let i = 0; i < 26; i++) {
        const x = rnd() * w, y = rnd() * h, r = 40 + rnd() * 130;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        const tone = rnd();
        grad.addColorStop(0, tone > 0.5 ? 'rgba(58,58,66,0.16)' : 'rgba(12,12,16,0.18)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // aggregate speckle
      for (let i = 0; i < 26000; i++) {
        const v = 30 + rnd() * 60;
        g.fillStyle = `rgba(${v},${v},${v + 4},${0.16 + rnd() * 0.22})`;
        g.fillRect(rnd() * w, rnd() * h, 1, 1);
      }
      // faint sealant cracks
      g.strokeStyle = 'rgba(10,10,12,0.35)';
      g.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        let x = rnd() * w, y = rnd() * h;
        g.moveTo(x, y);
        for (let s = 0; s < 6; s++) { x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 90; g.lineTo(x, y); }
        g.stroke();
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(7, 5);
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** PV module face: deep-blue cells, white grid gaps, thin busbars, frame border. */
export function pvCellTexture(): THREE.Texture {
  return cachedTex('pv', () => {
    const c = canvas(256, 256, (g, w, h) => {
      g.fillStyle = '#dfe5ea';            // cell-gap backing
      g.fillRect(0, 0, w, h);
      const N = 6, m = 6, cell = (w - m * 2 - (N - 1) * 3) / N;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const x = m + i * (cell + 3), y = m + j * (cell + 3);
          const grad = g.createLinearGradient(x, y, x + cell, y + cell);
          grad.addColorStop(0, '#16335e');
          grad.addColorStop(0.5, '#0d2347');
          grad.addColorStop(1, '#142e57');
          g.fillStyle = grad;
          g.fillRect(x, y, cell, cell);
          // busbars
          g.fillStyle = 'rgba(220,228,235,0.55)';
          for (let b = 1; b <= 2; b++) g.fillRect(x + (cell * b) / 3 - 0.5, y, 1, cell);
        }
      }
      // aluminum frame
      g.strokeStyle = '#9aa4ad';
      g.lineWidth = 4;
      g.strokeRect(2, 2, w - 4, h - 4);
    });
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Broom-finished concrete for aprons and pads. */
export function concreteTexture(): THREE.Texture {
  return cachedTex('concrete', () => {
    const rnd = mulberry(31);
    const c = canvas(256, 256, (g, w, h) => {
      g.fillStyle = '#a7a9ab';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const v = 140 + rnd() * 80;
        g.fillStyle = `rgba(${v},${v},${v},${0.10 + rnd() * 0.12})`;
        g.fillRect(rnd() * w, rnd() * h, 1, 1);
      }
      // control joints
      g.strokeStyle = 'rgba(90,92,94,0.5)';
      g.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        g.beginPath(); g.moveTo((w / 4) * i, 0); g.lineTo((w / 4) * i, h); g.stroke();
        g.beginPath(); g.moveTo(0, (h / 4) * i); g.lineTo(w, (h / 4) * i); g.stroke();
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Equirect sky: zenith blue → pale horizon, soft cloud banks, sun glow. */
export function skyTexture(): THREE.Texture {
  return cachedTex('sky', () => {
    const rnd = mulberry(99);
    const c = canvas(1024, 512, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#2f6fd0');
      grad.addColorStop(0.30, '#5e97e3');
      grad.addColorStop(0.52, '#a8c8ef');
      grad.addColorStop(0.62, '#dce9f7');   // horizon band
      grad.addColorStop(0.70, '#cfd9e4');
      grad.addColorStop(1.0, '#b9c3cd');    // below horizon (ground haze)
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      // sun glow (upper third)
      const sg = g.createRadialGradient(w * 0.7, h * 0.26, 0, w * 0.7, h * 0.26, 130);
      sg.addColorStop(0, 'rgba(255,250,235,0.95)');
      sg.addColorStop(0.25, 'rgba(255,246,220,0.45)');
      sg.addColorStop(1, 'rgba(255,246,220,0)');
      g.fillStyle = sg;
      g.fillRect(0, 0, w, h);
      // cumulus banks: clustered soft ellipses
      for (let k = 0; k < 9; k++) {
        const cx = rnd() * w, cy = h * (0.30 + rnd() * 0.22), scale = 0.7 + rnd() * 1.5;
        for (let p = 0; p < 12; p++) {
          const px = cx + (rnd() - 0.5) * 150 * scale;
          const py = cy + (rnd() - 0.5) * 34 * scale;
          const r = (16 + rnd() * 30) * scale;
          const cg = g.createRadialGradient(px, py, 0, px, py, r);
          cg.addColorStop(0, 'rgba(255,255,255,0.85)');
          cg.addColorStop(0.6, 'rgba(252,253,255,0.5)');
          cg.addColorStop(1, 'rgba(252,253,255,0)');
          g.fillStyle = cg;
          g.fillRect(px - r, py - r, r * 2, r * 2);
        }
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/**
 * Mown turf, seen from above: mottled greens, thousands of short blades in a dozen shades,
 * a little clover and a few dry flecks. It tiles (everything is drawn wrapped across the
 * edges), and the red channel doubles as the bump height, so blades catch the sun.
 * Laid by world position (materials.grass), so one tile is the same size on every lawn.
 */
export function grassTexture(): THREE.Texture {
  return cachedTex('grass', () => {
    const rnd = mulberry(1213);
    const c = canvas(1024, 1024, (g, w, h) => {
      g.fillStyle = '#41702f';
      g.fillRect(0, 0, w, h);
      /** draw at (x, y) and at its wrapped copies, so the tile has no seam */
      const wrapped = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
        for (const ox of [0, x < r ? w : x > w - r ? -w : null]) {
          for (const oy of [0, y < r ? h : y > h - r ? -h : null]) {
            if (ox !== null && oy !== null) draw(x + ox, y + oy);
          }
        }
      };
      // broad patches: lush, thin, sun-yellowed, shaded
      const PATCH = ['rgba(92,150,58,0.20)', 'rgba(40,84,34,0.24)', 'rgba(132,150,62,0.16)', 'rgba(58,112,44,0.22)', 'rgba(30,70,30,0.18)'];
      for (let i = 0; i < 90; i++) {
        const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 130, col = PATCH[Math.floor(rnd() * PATCH.length)];
        wrapped(x, y, r, (px, py) => {
          const grad = g.createRadialGradient(px, py, 0, px, py, r);
          grad.addColorStop(0, col);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grad;
          g.fillRect(px - r, py - r, r * 2, r * 2);
        });
      }
      // blades: short strokes leaning every way, dark ones first so the light ones lie on top
      const BLADE = ['#244d1f', '#2d5a24', '#356a2a', '#3f7a30', '#4c8a38', '#5a9a40', '#6aa848', '#7fb655', '#93bf62'];
      g.lineCap = 'round';
      for (let pass = 0; pass < BLADE.length; pass++) {
        g.strokeStyle = BLADE[pass];
        const n = pass < 4 ? 9000 : pass < 7 ? 6500 : 2600;
        g.globalAlpha = pass < 4 ? 0.55 : 0.5;
        g.lineWidth = pass < 4 ? 1.6 : 1.1;
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI * 2, len = 3 + rnd() * 7;
          const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
          wrapped(x, y, 10, (px, py) => { g.moveTo(px, py); g.lineTo(px + dx, py + dy); });
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      // clover and weeds: small dark-green clusters
      for (let i = 0; i < 70; i++) {
        const x = rnd() * w, y = rnd() * h;
        for (let k = 0; k < 9; k++) {
          const px = x + (rnd() - 0.5) * 22, py = y + (rnd() - 0.5) * 22, r = 1.5 + rnd() * 2.5;
          g.fillStyle = `rgba(${36 + rnd() * 20},${96 + rnd() * 30},${44 + rnd() * 16},0.55)`;
          wrapped(px, py, 4, (qx, qy) => { g.beginPath(); g.arc(qx, qy, r, 0, Math.PI * 2); g.fill(); });
        }
      }
      // dry flecks and the odd bare speck of soil
      for (let i = 0; i < 2600; i++) {
        const dry = rnd() > 0.25;
        g.fillStyle = dry ? `rgba(${170 + rnd() * 40},${168 + rnd() * 30},${90 + rnd() * 30},${0.25 + rnd() * 0.3})` : `rgba(70,56,36,${0.2 + rnd() * 0.25})`;
        g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd());
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Clipped hedge foliage: small overlapping leaves, light over dark, with shadowed gaps. Tiles. */
export function foliageTexture(): THREE.Texture {
  return cachedTex('foliage', () => {
    const rnd = mulberry(4441);
    const c = canvas(512, 512, (g, w, h) => {
      g.fillStyle = '#1f3d1a';
      g.fillRect(0, 0, w, h);
      const LEAF = ['#254a1e', '#2d5a24', '#37692b', '#427a32', '#4f8a3a', '#5f9a45'];
      for (let pass = 0; pass < LEAF.length; pass++) {
        g.fillStyle = LEAF[pass];
        g.globalAlpha = 0.8;
        for (let i = 0; i < (pass < 3 ? 2600 : 1500); i++) {
          const x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI, rx = 3 + rnd() * 4, ry = 1.5 + rnd() * 2;
          for (const ox of [0, x < 8 ? w : x > w - 8 ? -w : null]) {
            for (const oy of [0, y < 8 ? h : y > h - 8 ? -h : null]) {
              if (ox === null || oy === null) continue;
              g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, a, 0, Math.PI * 2); g.fill();
            }
          }
        }
      }
      g.globalAlpha = 1;
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

// ── SURFACES LAID BY WORLD POSITION (materials.worldMapped) ───────────────────
// Each tiles (everything is drawn wrapped across the edges) and is read at two scales by the
// material, so a 300 u lot shows aggregate up close and repaved patches from the air.

/** Draw at (x, y) and at its wrapped copies, so a tile has no seam. `r` is the mark's reach. */
function wrap(w: number, h: number, x: number, y: number, r: number, draw: (x: number, y: number) => void) {
  for (const ox of [0, x < r ? w : x > w - r ? -w : null]) {
    for (const oy of [0, y < r ? h : y > h - r ? -h : null]) {
      if (ox !== null && oy !== null) draw(x + ox, y + oy);
    }
  }
}

/** Yard asphalt: fine aggregate in a dark binder, lighter worn patches, darker resealed ones,
 *  hairline cracks and a few tar-sealed ones. */
export function asphaltFineTexture(): THREE.Texture {
  return cachedTex('asphaltFine', () => {
    const rnd = mulberry(77);
    const c = canvas(1024, 1024, (g, w, h) => {
      g.fillStyle = '#2b2b31';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const x = rnd() * w, y = rnd() * h, r = 50 + rnd() * 170;
        const col = rnd() > 0.5 ? 'rgba(74,74,82,0.17)' : 'rgba(10,10,14,0.22)';
        wrap(w, h, x, y, r, (px, py) => {
          const grad = g.createRadialGradient(px, py, 0, px, py, r);
          grad.addColorStop(0, col); grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grad; g.fillRect(px - r, py - r, r * 2, r * 2);
        });
      }
      // aggregate: mostly gray stones, a few pale and a few brown
      for (let i = 0; i < 90000; i++) {
        const k = rnd(), v = 34 + rnd() * 74;
        g.fillStyle = k > 0.96 ? `rgba(${v + 70},${v + 66},${v + 58},0.5)` : k > 0.92 ? `rgba(${v + 22},${v + 8},${v - 6},0.4)` : `rgba(${v},${v},${v + 5},${0.14 + rnd() * 0.26})`;
        const sz = k > 0.9 ? 2 : 1;
        g.fillRect(rnd() * w, rnd() * h, sz, sz);
      }
      // hairline cracks, and a few sealed with tar
      for (let i = 0; i < 26; i++) {
        const sealed = i < 7;
        g.strokeStyle = sealed ? 'rgba(6,6,8,0.75)' : 'rgba(8,8,10,0.42)';
        g.lineWidth = sealed ? 3.2 : 1;
        g.lineJoin = 'round';
        const pts: [number, number][] = [];
        let x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI * 2;
        for (let k = 0; k < 9; k++) { pts.push([x, y]); a += (rnd() - 0.5) * 1.3; const len = 18 + rnd() * 44; x += Math.cos(a) * len; y += Math.sin(a) * len; }
        for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
          g.beginPath();
          pts.forEach(([px, py], k) => (k ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy)));
          g.stroke();
        }
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Cast concrete: pores, trowel mottling, water stains, and a control joint round the tile
 *  (the material sets how many units a tile spans, so that is the slab size). */
export function concreteSlabTexture(): THREE.Texture {
  return cachedTex('concreteSlab', () => {
    const rnd = mulberry(313);
    const c = canvas(512, 512, (g, w, h) => {
      g.fillStyle = '#b3b4b3';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) {
        const x = rnd() * w, y = rnd() * h, r = 24 + rnd() * 110;
        const col = rnd() > 0.5 ? 'rgba(214,213,208,0.12)' : 'rgba(112,114,116,0.10)';
        wrap(w, h, x, y, r, (px, py) => {
          const grad = g.createRadialGradient(px, py, 0, px, py, r);
          grad.addColorStop(0, col); grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grad; g.fillRect(px - r, py - r, r * 2, r * 2);
        });
      }
      for (let i = 0; i < 30000; i++) {
        const v = 120 + rnd() * 110;
        g.fillStyle = `rgba(${v},${v},${v - 3},${0.10 + rnd() * 0.16})`;
        g.fillRect(rnd() * w, rnd() * h, 1, 1);
      }
      // pores and pinholes
      for (let i = 0; i < 700; i++) {
        g.fillStyle = `rgba(70,72,74,${0.25 + rnd() * 0.35})`;
        g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.6 + rnd() * 1.3, 0, Math.PI * 2); g.fill();
      }
      // the joint, half on each edge, with the darker damp line beside it
      for (const [x0, y0, x1, y1] of [[0, 0, w, 0], [0, h, w, h], [0, 0, 0, h], [w, 0, w, h]] as const) {
        g.strokeStyle = 'rgba(96,98,100,0.30)'; g.lineWidth = 9;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.strokeStyle = 'rgba(52,54,56,0.80)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Road paint that has been driven on: near-white (it multiplies the paint's own colour) with
 *  chips and scuffs worn through. */
export function paintWearTexture(): THREE.Texture {
  return cachedTex('paintWear', () => {
    const rnd = mulberry(909);
    const c = canvas(512, 512, (g, w, h) => {
      g.fillStyle = '#f4f4f4';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 46; i++) {
        const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 70;
        wrap(w, h, x, y, r, (px, py) => {
          const grad = g.createRadialGradient(px, py, 0, px, py, r);
          grad.addColorStop(0, 'rgba(120,120,124,0.30)'); grad.addColorStop(1, 'rgba(120,120,124,0)');
          g.fillStyle = grad; g.fillRect(px - r, py - r, r * 2, r * 2);
        });
      }
      for (let i = 0; i < 5200; i++) {
        g.fillStyle = `rgba(${60 + rnd() * 50},${60 + rnd() * 50},${66 + rnd() * 50},${0.25 + rnd() * 0.5})`;
        g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2);
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Bark: dark furrows running up the trunk between lighter ridges. */
export function barkTexture(): THREE.Texture {
  return cachedTex('bark', () => {
    const rnd = mulberry(5150);
    const c = canvas(256, 256, (g, w, h) => {
      g.fillStyle = '#6b5440';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 150; i++) {
        const x = rnd() * w, y0 = rnd() * h, len = 30 + rnd() * 120, dark = rnd() > 0.4;
        g.strokeStyle = dark ? `rgba(34,24,16,${0.4 + rnd() * 0.4})` : `rgba(150,128,104,${0.25 + rnd() * 0.3})`;
        g.lineWidth = dark ? 1.5 + rnd() * 3 : 1 + rnd() * 2;
        for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
          g.beginPath(); g.moveTo(x + ox, y0 + oy);
          g.bezierCurveTo(x + ox + (rnd() - 0.5) * 10, y0 + oy + len / 3, x + ox + (rnd() - 0.5) * 10, y0 + oy + (len * 2) / 3, x + ox + (rnd() - 0.5) * 6, y0 + oy + len);
          g.stroke();
        }
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Ribbed, painted steel (a battery enclosure, a switchgear cabinet): a pressed rib every
 *  eighth of the tile, each with its lit and shaded edge, and faint rain streaks down the paint. */
export function ribbedSteelTexture(): THREE.Texture {
  return cachedTex('ribbedSteel', () => {
    const rnd = mulberry(2468);
    const c = canvas(512, 512, (g, w, h) => {
      g.fillStyle = '#eceeef';
      g.fillRect(0, 0, w, h);
      const N = 8, rw = w / N;
      for (let i = 0; i < N; i++) {
        const x = i * rw;
        const grad = g.createLinearGradient(x, 0, x + rw, 0);
        grad.addColorStop(0.00, 'rgba(60,66,74,0.55)');
        grad.addColorStop(0.07, 'rgba(60,66,74,0.10)');
        grad.addColorStop(0.16, 'rgba(255,255,255,0.55)');
        grad.addColorStop(0.30, 'rgba(255,255,255,0)');
        grad.addColorStop(0.86, 'rgba(60,66,74,0)');
        grad.addColorStop(1.00, 'rgba(60,66,74,0.40)');
        g.fillStyle = grad; g.fillRect(x, 0, rw, h);
      }
      // rain streaks and dust
      for (let i = 0; i < 90; i++) {
        const x = rnd() * w, y = rnd() * h, len = 60 + rnd() * 260;
        const grad = g.createLinearGradient(0, y, 0, y + len);
        grad.addColorStop(0, `rgba(96,92,84,${0.05 + rnd() * 0.10})`); grad.addColorStop(1, 'rgba(96,92,84,0)');
        g.fillStyle = grad;
        for (const oy of [-h, 0]) g.fillRect(x, y + oy, 1 + rnd() * 3, len);
      }
      for (let i = 0; i < 5000; i++) {
        g.fillStyle = `rgba(110,112,116,${0.05 + rnd() * 0.10})`;
        g.fillRect(rnd() * w, rnd() * h, 1, 1);
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Chain-link mesh: galvanised wire woven in diamonds, clear between the wires. */
export function chainLinkTexture(): THREE.Texture {
  return cachedTex('chainLink', () => {
    const c = canvas(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const wire = (dir: 1 | -1, colour: string, width: number) => {
        g.strokeStyle = colour; g.lineWidth = width;
        g.beginPath();
        for (let k = -2; k <= 4; k++) {
          const o = k * (w / 2);
          g.moveTo(o, dir > 0 ? 0 : h); g.lineTo(o + w, dir > 0 ? h : 0);
        }
        g.stroke();
      };
      wire(1, '#5b626b', 9); wire(1, '#aab2bb', 4);
      wire(-1, '#5b626b', 9); wire(-1, '#c3cad2', 4);
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** A bollard's wrap (u round it, v up it): safety yellow, a reflective band near the top,
 *  scuffs at bumper height and road grime at the foot. */
export function bollardTexture(): THREE.Texture {
  return cachedTex('bollard', () => {
    const rnd = mulberry(606);
    const c = canvas(128, 256, (g, w, h) => {
      g.fillStyle = '#f2c417';
      g.fillRect(0, 0, w, h);
      // canvas y runs down: the top of the post is y = 0
      g.fillStyle = '#17181b'; g.fillRect(0, 26, w, 44);
      g.fillStyle = '#f4f5f6'; g.fillRect(0, 31, w, 34);
      g.strokeStyle = 'rgba(160,166,172,0.55)'; g.lineWidth = 1;
      for (let x = -40; x < w + 40; x += 7) { g.beginPath(); g.moveTo(x, 31); g.lineTo(x + 20, 65); g.stroke(); }
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(${40 + rnd() * 40},${36 + rnd() * 30},${30 + rnd() * 20},${0.15 + rnd() * 0.35})`;
        g.fillRect(rnd() * w, 120 + rnd() * 60, 4 + rnd() * 22, 1 + rnd() * 2);
      }
      const grime = g.createLinearGradient(0, h - 56, 0, h);
      grime.addColorStop(0, 'rgba(50,44,36,0)'); grime.addColorStop(1, 'rgba(50,44,36,0.6)');
      g.fillStyle = grime; g.fillRect(0, h - 56, w, 56);
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** The high-voltage placard on the battery yard's fence. */
export function dangerSignTexture(): THREE.Texture {
  return cachedTex('dangerSign', () => {
    const c = canvas(896, 208, (g, w, h) => {
      g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c8102e'; g.fillRect(0, 0, w, 78);
      g.fillStyle = '#ffffff'; g.font = 'bold 60px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('DANGER', w / 2, 42);
      g.fillStyle = '#16181b'; g.font = 'bold 46px Arial, Helvetica, sans-serif';
      g.fillText('HIGH VOLTAGE  ·  BATTERY ENERGY STORAGE', w / 2, 118);
      g.font = '32px Arial, Helvetica, sans-serif';
      g.fillText('AUTHORIZED PERSONNEL ONLY', w / 2, 170);
      g.strokeStyle = '#16181b'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    });
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Subtle oil-stain decal (radial dark blotch). */
export function oilStainTexture(): THREE.Texture {
  return cachedTex('oil', () => {
    const rnd = mulberry(55);
    const c = canvas(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) {
        const x = w / 2 + (rnd() - 0.5) * 36, y = h / 2 + (rnd() - 0.5) * 36, r = 14 + rnd() * 30;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(8,8,10,0.55)');
        grad.addColorStop(0.7, 'rgba(10,10,12,0.25)');
        grad.addColorStop(1, 'rgba(10,10,12,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** A small gate sign: white letters on near-black over an accent bar (the gate's LED colour). */
export function gateSignTexture(text: string, accent: string): THREE.Texture {
  return cachedTex(`gate:${text}:${accent}`, () => {
    const c = canvas(256, 96, (g, w, h) => {
      g.fillStyle = '#121418';
      g.fillRect(0, 0, w, h);
      g.fillStyle = accent;
      g.fillRect(0, h - 12, w, 12);
      g.fillStyle = '#f2f4f6';
      g.font = 'bold 50px Arial, Helvetica, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, (h - 12) / 2 + 2);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}

export const TEXTURES = { asphaltTexture, pvCellTexture, concreteTexture, skyTexture, oilStainTexture } as const;

// ── THE OTTOYARD LOGO, for signage (founder, 2026-09-30) ─────────────────────
// The full logo (mark + wordmark) on its own near-black ground, cropped with a
// margin: src/assets/ottoyard-sign.jpg, 2048 x 540, made from the founder's file.
// One texture, shared by every sign that carries it.

/** Width / height of the logo sign texture: size a sign's face to this. */
export const LOGO_SIGN_ASPECT = 2048 / 540;

let logoSign: THREE.Texture | null = null;
/** A lit sign face carrying the OTTOYARD logo: the texture is its colour and its glow. */
export function logoSignMaterial(glow = 0.55): THREE.MeshStandardMaterial {
  if (!logoSign) {
    logoSign = new THREE.TextureLoader().load(logoSignUrl);
    logoSign.colorSpace = THREE.SRGBColorSpace;
    logoSign.anisotropy = 8;
  }
  return new THREE.MeshStandardMaterial({
    map: logoSign, emissiveMap: logoSign, emissive: new THREE.Color('#ffffff'), emissiveIntensity: glow,
    roughness: 0.45, metalness: 0.1,
  });
}
