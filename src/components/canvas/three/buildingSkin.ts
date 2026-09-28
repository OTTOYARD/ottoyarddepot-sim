import * as THREE from 'three';

/**
 * Materials + procedural textures for the built environment (walls, doors, roofs,
 * interiors, equipment). Zero network assets; every texture is drawn once on a
 * canvas and cached. UVs come from StaticBatch in WORLD UNITS, so each texture's
 * `repeat` is "repeats per plan unit" (1u = 0.4785 m).
 *
 * MeshStandardMaterial throughout, not Physical: none of these surfaces needs a
 * clearcoat or transmission, and the standard shader is markedly cheaper on the
 * hundreds of fragments a facade covers.
 */

const texCache = new Map<string, THREE.Texture>();
const matCache = new Map<string, THREE.Material>();

function tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat: [number, number], srgb = true): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d')!, w, h);
    t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(repeat[0], repeat[1]);
    texCache.set(key, t);
  }
  return t;
}

function mat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Insulated metal wall panel: vertical ribs every ~0.43 m, faint weathering. */
function ribbedPanel(base: string, light: string, dark: string, seed: number) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const ribs = 4;
    const pitch = w / ribs;
    for (let i = 0; i < ribs; i++) {
      const x = i * pitch;
      g.fillStyle = light; g.fillRect(x + pitch * 0.08, 0, pitch * 0.06, h);
      g.fillStyle = dark; g.fillRect(x + pitch * 0.14, 0, pitch * 0.04, h);
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x + pitch * 0.94, 0, pitch * 0.06, h);
    }
    const r = rng(seed);
    for (let i = 0; i < 2200; i++) {
      const v = r() > 0.5 ? 255 : 0;
      g.fillStyle = `rgba(${v},${v},${v},${0.012 + r() * 0.02})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 6);
    }
    // horizontal panel joint every ~2.4 m (texture height = 5u)
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, h - 2, w, 2);
  };
}

/** Graphite ribbed cladding — the OTTOYARD ops-building skin. */
export function wallGraphite() {
  return mat('wallGraphite', () => new THREE.MeshStandardMaterial({
    map: tex('ribGraphite', 256, 256, ribbedPanel('#3a3f47', 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.22)', 3), [1 / 1.7, 1 / 5]),
    color: '#ffffff', roughness: 0.55, metalness: 0.35, envMapIntensity: 0.8,
  }));
}

/** Light silver ribbed cladding — the wash hall skin. */
export function wallSilver() {
  return mat('wallSilver', () => new THREE.MeshStandardMaterial({
    map: tex('ribSilver', 256, 256, ribbedPanel('#9aa2ab', 'rgba(255,255,255,0.22)', 'rgba(0,0,0,0.18)', 7), [1 / 1.7, 1 / 5]),
    color: '#ffffff', roughness: 0.45, metalness: 0.4, envMapIntensity: 0.9,
  }));
}

/** Painted CMU / interior partition. */
export function interiorBlock() {
  return mat('interiorBlock', () => new THREE.MeshStandardMaterial({
    map: tex('cmu', 256, 256, (g, w, h) => {
      g.fillStyle = '#d6d9dc'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
      const bh = h / 8, bw = w / 2;
      for (let row = 0; row < 8; row++) {
        g.beginPath(); g.moveTo(0, row * bh); g.lineTo(w, row * bh); g.stroke();
        const off = row % 2 ? bw / 2 : 0;
        for (let x = off; x < w; x += bw) { g.beginPath(); g.moveTo(x, row * bh); g.lineTo(x, (row + 1) * bh); g.stroke(); }
      }
    }, [1 / 3.3, 1 / 3.3]),
    color: '#ffffff', roughness: 0.9, metalness: 0,
  }));
}

/** Sealed shop floor — service bays. */
export function shopFloor() {
  return mat('shopFloor', () => new THREE.MeshStandardMaterial({
    map: tex('shopFloor', 256, 256, (g, w, h) => {
      g.fillStyle = '#8f959c'; g.fillRect(0, 0, w, h);
      const r = rng(11);
      for (let i = 0; i < 5000; i++) {
        const v = 110 + r() * 80;
        g.fillStyle = `rgba(${v},${v},${v + 4},0.10)`;
        g.fillRect(r() * w, r() * h, 1, 1);
      }
      g.strokeStyle = 'rgba(40,44,48,0.45)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 1); g.lineTo(w, 1); g.moveTo(1, 0); g.lineTo(1, h); g.stroke();
    }, [1 / 12, 1 / 12]),
    color: '#ffffff', roughness: 0.32, metalness: 0.05, envMapIntensity: 0.9,
  }));
}

/** Wet wash-bay concrete: darker, glossier. */
export function washFloor() {
  return mat('washFloor', () => new THREE.MeshStandardMaterial({
    map: tex('washFloor', 256, 256, (g, w, h) => {
      g.fillStyle = '#5d646b'; g.fillRect(0, 0, w, h);
      const r = rng(19);
      for (let i = 0; i < 60; i++) {
        const x = r() * w, y = r() * h, rad = 10 + r() * 50;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(30,36,42,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }, [1 / 10, 1 / 10]),
    color: '#ffffff', roughness: 0.12, metalness: 0.1, envMapIntensity: 1.3,
  }));
}

/** Single-ply roof membrane (TPO), light grey. */
export function roofMembrane() {
  return mat('roofMembrane', () => new THREE.MeshStandardMaterial({
    map: tex('tpo', 256, 256, (g, w, h) => {
      g.fillStyle = '#b9bdc2'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.06)';
      for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 2, h); // seams
      const r = rng(5);
      for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 2, 2); }
    }, [1 / 6, 1 / 6]),
    color: '#ffffff', roughness: 0.85, metalness: 0,
  }));
}

/** Rolled-up door curtain: horizontal aluminium slats. */
export function doorSlats() {
  return mat('doorSlats', () => new THREE.MeshStandardMaterial({
    map: tex('slats', 64, 256, (g, w, h) => {
      g.fillStyle = '#c3c8ce'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) {
        g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, y, w, 2);
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, y + 3, w, 2);
      }
    }, [1, 1 / 2.5]),
    color: '#ffffff', roughness: 0.4, metalness: 0.6, envMapIntensity: 0.9,
  }));
}

/** Yellow/black hazard banding for jamb guards and column bases. */
export function hazardBand() {
  return mat('hazardBand', () => new THREE.MeshStandardMaterial({
    map: tex('hazard', 128, 128, (g, w, h) => {
      g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#16181b';
      for (let i = -h; i < w + h; i += 32) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 + h, h); g.lineTo(i + h, h); g.closePath(); g.fill();
      }
    }, [1 / 1.2, 1 / 1.2]),
    color: '#ffffff', roughness: 0.5, metalness: 0.1,
  }));
}

export function safetyYellowPaint() {
  return mat('safetyYellowPaint', () => new THREE.MeshStandardMaterial({ color: '#f0b90b', roughness: 0.45, metalness: 0.15 }));
}

export function aluminiumTrim() {
  return mat('aluminiumTrim', () => new THREE.MeshStandardMaterial({ color: '#c9ced4', roughness: 0.3, metalness: 0.85, envMapIntensity: 1.0 }));
}

export function darkSteel() {
  return mat('darkSteel', () => new THREE.MeshStandardMaterial({ color: '#262a31', roughness: 0.5, metalness: 0.6 }));
}

export function galvanizedSteel() {
  return mat('galvanizedSteel', () => new THREE.MeshStandardMaterial({ color: '#8e969f', roughness: 0.42, metalness: 0.8, envMapIntensity: 0.9 }));
}

export function liftBlue() {
  return mat('liftBlue', () => new THREE.MeshStandardMaterial({ color: '#1f5fa8', roughness: 0.45, metalness: 0.3 }));
}

export function toolRed() {
  return mat('toolRed', () => new THREE.MeshStandardMaterial({ color: '#b01e2d', roughness: 0.35, metalness: 0.35 }));
}

export function brushFoam(color: string) {
  return mat(`brush${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 }));
}

export function rubberBlack() {
  return mat('rubberBlack', () => new THREE.MeshStandardMaterial({ color: '#141619', roughness: 0.9, metalness: 0 }));
}

/** Office curtain wall: dark, reflective, opaque (no transmission pass). */
export function officeGlass() {
  return mat('officeGlass', () => new THREE.MeshStandardMaterial({
    color: '#233040', roughness: 0.06, metalness: 0.75, envMapIntensity: 1.6,
  }));
}

/** Ceiling LED panel / wall pack lens. */
export function ledPanel(intensity = 2.2) {
  return mat(`led${intensity}`, () => new THREE.MeshStandardMaterial({
    color: '#ffffff', emissive: new THREE.Color('#f4f7ff'), emissiveIntensity: intensity, roughness: 0.6, toneMapped: false,
  }));
}

/** Soft interior bounce: bay back walls read LIT from outside, not a black hole. */
export function litInterior() {
  return mat('litInterior', () => new THREE.MeshStandardMaterial({
    color: '#c9ced5', emissive: new THREE.Color('#fbfcff'), emissiveIntensity: 0.07, roughness: 0.9,
  }));
}

export function statusLamp(color: string) {
  return mat(`lamp${color}`, () => new THREE.MeshStandardMaterial({
    color, emissive: new THREE.Color(color), emissiveIntensity: 2.0, roughness: 0.4, toneMapped: false,
  }));
}

/** Backlit sign lettering on a panel. Texture carries the text. */
export function signTexture(text: string, opts: { fg?: string; bg?: string; w?: number; h?: number; font?: string } = {}): THREE.Texture {
  const key = `sign:${text}:${opts.fg}:${opts.bg}`;
  let t = texCache.get(key);
  if (!t) {
    const w = opts.w ?? 1024, h = opts.h ?? 192;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = opts.bg ?? 'rgba(0,0,0,0)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = opts.fg ?? '#ffffff';
    g.font = opts.font ?? `600 ${Math.round(h * 0.62)}px "Inter Tight", "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // letter-spacing by hand (canvas letterSpacing is not universal)
    const spacing = h * 0.08;
    const chars = [...text];
    const widths = chars.map((ch) => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let x = (w - total) / 2;
    chars.forEach((ch, i) => { g.fillText(ch, x + widths[i] / 2, h / 2 + h * 0.03); x += widths[i] + spacing; });
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    texCache.set(key, t);
  }
  return t;
}
