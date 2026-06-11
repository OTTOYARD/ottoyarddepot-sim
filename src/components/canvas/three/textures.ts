import * as THREE from 'three';

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

export const TEXTURES = { asphaltTexture, pvCellTexture, concreteTexture, skyTexture, oilStainTexture } as const;
