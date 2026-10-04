/**
 * The site's day and night, from the sim clock: the keyframes DayNightLighting lights
 * the depot with, and what follows them (how dark it is, the sky and the haze).
 * Kept out of the component file so the component stays hot-reloadable.
 */

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// keyframes: [hour, sunIntensity, sunColor, sunElev(0..1), hemi, ambient, sky, ground]
const KEYS: [number, number, string, number, number, number, string, string][] = [
  [0,    0.0, '#223a66', 0.05, 0.16, 0.10, '#0e1626', '#10141c'],
  [5,    0.0, '#223a66', 0.05, 0.16, 0.10, '#101a2e', '#10141c'],
  [6.5,  1.6, '#ffbe86', 0.18, 0.55, 0.30, '#ff9d6e', '#4a3b2e'],
  [8,    3.8, '#fff3df', 0.62, 1.55, 0.92, '#9cc4ec', '#5d6258'],
  [12,   4.5, '#fffaf2', 1.00, 1.85, 1.05, '#87b7ea', '#6a6f64'],
  [16,   4.1, '#fff0d8', 0.80, 1.65, 0.95, '#8fb9e8', '#665f54'],
  [18.5, 2.2, '#ffb066', 0.30, 0.70, 0.36, '#ff8a55', '#4a3b2e'],
  [20,   0.4, '#7a5f8a', 0.10, 0.30, 0.18, '#28304e', '#1c1c22'],
  [24,   0.0, '#223a66', 0.05, 0.16, 0.10, '#0e1626', '#10141c'],
];

function mixHex(x: string, y: string, t: number) {
  const px = parseInt(x.slice(1), 16);
  const py = parseInt(y.slice(1), 16);
  const r = Math.round(lerp((px >> 16) & 255, (py >> 16) & 255, t));
  const g = Math.round(lerp((px >> 8) & 255, (py >> 8) & 255, t));
  const b = Math.round(lerp(px & 255, py & 255, t));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function calcLighting(simTime: number) {
  const hour = (simTime / 3600) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && hour > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (hour - a[0]) / Math.max(0.0001, b[0] - a[0])));

  return {
    hour,
    sunI: lerp(a[1], b[1], t),
    sunCol: mixHex(a[2], b[2], t),
    elev: lerp(a[3], b[3], t),
    hemiI: lerp(a[4], b[4], t),
    ambI: lerp(a[5], b[5], t),
    skyCol: mixHex(a[6], b[6], t),
    gndCol: mixHex(a[7], b[7], t),
  };
}

/**
 * How dark the site is: 0 by day, 1 at full night, from the same keyframes as the
 * sun (full night once the sun is below 0.4, none above 2.4). The city's lit windows
 * and street lamps follow it (UrbanSurround).
 */
export function nightLevel(simTime: number): number {
  return nightFromSun(calcLighting(simTime).sunI);
}
export const nightFromSun = (sunI: number) => Math.max(0, Math.min(1, (2.4 - sunI) / 2.0));

/** The backdrop by day, as DepotScene3D creates it: fog colour, and the sky's brightness. */
export const DAY_SKY = { fog: '#b9cde4', background: 0.42 } as const;
/** ...and at full night: the sky dims and the haze turns to dark blue, so the lot, the lamps
 *  and the city's lit windows read against a night sky instead of a daylight one. */
export const NIGHT_SKY = { fog: '#18202d', background: 0.06 } as const;
