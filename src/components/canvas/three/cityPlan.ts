/**
 * THE CITY AROUND THE DEPOT: its layout. Scenery only.
 *
 * The founder, 2026-10-04: "what do you think about building out a little bit of an
 * urban/metro scene around the depot? Maybe some buildings and scenery?" This file is
 * that scene's plan: the street grid, the blocks between the streets, what stands on
 * each block, and the street trees and lights. UrbanSurround.tsx draws it. Nothing
 * else reads it and none of it is world state: the fleet never drives into the city.
 * The one public street the fleet uses is the south road (arrivals spawn on it east of
 * the IN gate, departures end at the OUT gate), and it keeps exactly its old place and
 * width. Between the two avenues DepotGround still draws it.
 *
 * WORLD coordinates throughout (coordUtils.toWorld): +X is plan WEST, -X plan EAST,
 * +Z NORTH, -Z SOUTH, 1 unit = 0.4785 m. The fenced lot is X -144..144, Z -96..104.
 *
 * Deterministic: one seed, no Math.random. Every viewer sees the same city, and
 * cityPlan.test.ts pins what must never happen: a building on the depot, on the road
 * the fleet uses, or around a camera.
 *
 * It leans on Nashville without copying it. Low industrial blocks ring the depot, the
 * buildings rise toward a downtown skyline to the north, a river runs down the east
 * side of downtown under its bridges, and the tallest tower wears two spires.
 */

export interface Rect { x0: number; x1: number; z0: number; z1: number }

// ---- streets ---------------------------------------------------------------------

export interface StreetLine {
  /** x of a north-south street, z of an east-west one. */
  at: number;
  width: number;
  kind: 'local' | 'major' | 'frontage';
}

export const SIDEWALK = 6;
/** Sidewalks stand this far above the street: the curb. */
export const CURB_H = 0.3;

/** North-south streets, east (-X) to west (+X). The two at +-174 are the depot's avenues. */
export const NS_STREETS: readonly StreetLine[] = [
  { at: -1046, width: 14, kind: 'local' },
  { at: -850, width: 14, kind: 'local' },
  { at: -566, width: 14, kind: 'local' },
  { at: -370, width: 22, kind: 'major' },
  { at: -174, width: 14, kind: 'local' },
  { at: 174, width: 14, kind: 'local' },
  { at: 370, width: 22, kind: 'major' },
  { at: 566, width: 14, kind: 'local' },
  { at: 762, width: 14, kind: 'local' },
  { at: 958, width: 14, kind: 'local' },
  { at: 1154, width: 14, kind: 'local' },
];

/** The south road at the depot's gates: DepotGround's road, the one street the fleet drives. */
export const SOUTH_ROAD: StreetLine = { at: -105, width: 13, kind: 'frontage' };

/** East-west streets, south to north. */
export const EW_STREETS: readonly StreetLine[] = [
  { at: -885, width: 14, kind: 'local' },
  { at: -690, width: 14, kind: 'local' },
  { at: -495, width: 14, kind: 'local' },
  { at: -300, width: 22, kind: 'major' },
  SOUTH_ROAD,
  { at: 132, width: 14, kind: 'local' },
  { at: 330, width: 14, kind: 'local' },
  { at: 528, width: 22, kind: 'major' },
  { at: 726, width: 14, kind: 'local' },
  { at: 924, width: 14, kind: 'local' },
  { at: 1122, width: 22, kind: 'major' },
  { at: 1320, width: 14, kind: 'local' },
  { at: 1518, width: 14, kind: 'local' },
  { at: 1716, width: 22, kind: 'major' },
  { at: 1914, width: 14, kind: 'local' },
];

export const CITY: Rect = { x0: -1250, x1: 1250, z0: -960, z1: 2000 };

/** The camera's far plane: past the skyline and out to where the fog has swallowed the
 *  plain. Depth precision barely depends on it (it is set by the 1 u near plane). */
export const CITY_VIEW_FAR = 6500;

/** The plain beyond the city, out to where the fog has swallowed everything. */
export const FAR_GROUND: Rect = { x0: -6000, x1: 6000, z0: -6000, z1: 6000 };

/** The river's channel. It runs the whole length of the map, under a bridge at every street. */
export const RIVER = { x0: -760, x1: -650, water: -4, deckBottom: -2.2 } as const;

/** The depot's own block, inside the sidewalks of the streets around it. DepotGround
 *  lays its grass over exactly this; the city draws everything else. */
export const DEPOT_BLOCK: Rect = { x0: -161, x1: 161, z0: -98.5, z1: 119 };

/** Where DepotGround's stretch of the south road stops and the city's takes over: the
 *  inner pavement edges of the two avenues. */
export const DEPOT_ROAD_SPAN = { x0: -167, x1: 167 } as const;

/** Across the road from the gates the Entrance camera stands on the lawn; no building
 *  comes nearer the road than this. */
export const ENTRANCE_LAWN: Rect = { x0: -260, x1: 260, z0: -172, z1: -98.5 };

/** Near the depot, nothing stands taller than this: the corner cameras of the live
 *  viewer orbit the lot ~208 u out at 96 u up, and the Operator preset hovers at 90 u. */
export const NEAR_RING = { radius: 440, maxHeight: 40 } as const;

/** Lot centre, the point the rings are measured from. */
const HUB = { x: 0, z: 4 };

// ---- facades (shared with cityTextures.ts) ---------------------------------------

export type Facade = 'glass' | 'office' | 'brick' | 'stucco' | 'storefront' | 'industrial';

/**
 * How a facade texture tiles. A tile is `tileBays` bays by `tileFloors` floors; a
 * `fitHeight` facade stretches one tile over the mass's full height (a shopfront
 * podium, a warehouse wall) instead of repeating by floor.
 */
export const FACADE_SPEC: Record<Facade, { bay: number; floor: number; tileBays: number; tileFloors: number; fitHeight: boolean }> = {
  glass: { bay: 6, floor: 8.2, tileBays: 8, tileFloors: 8, fitHeight: false },
  office: { bay: 7, floor: 7.6, tileBays: 8, tileFloors: 8, fitHeight: false },
  brick: { bay: 7, floor: 7.0, tileBays: 8, tileFloors: 8, fitHeight: false },
  stucco: { bay: 8, floor: 6.8, tileBays: 8, tileFloors: 8, fitHeight: false },
  storefront: { bay: 12, floor: 9, tileBays: 4, tileFloors: 1, fitHeight: true },
  industrial: { bay: 16, floor: 0, tileBays: 4, tileFloors: 1, fitHeight: true },
};

/** Per-building colour, multiplied into the facade texture (which is drawn near-neutral). */
export const TINTS: Record<Facade, readonly string[]> = {
  glass: ['#a9bdd1', '#97b0c6', '#aec3c0', '#c2b7a6', '#a6afba', '#8ea8c2'],
  office: ['#ece7dc', '#e2ded6', '#d6dce2', '#e8dccb', '#d3cdc2'],
  brick: ['#b06a55', '#9e5f4e', '#b88066', '#986555', '#c2a07f', '#8c5647', '#cbb092'],
  stucco: ['#e8e0d2', '#e2d6c2', '#d9ddd9', '#e2d2c2', '#d4d8cb', '#e6dac8'],
  storefront: ['#ffffff', '#f4f1ec', '#eef0f2'],
  industrial: ['#e6e9eb', '#dce2e6', '#e9e3d8', '#d4dddb', '#e0e5e9', '#c8d2db'],
};

// ---- what the plan holds ---------------------------------------------------------

export type BlockUse = 'depot' | 'industrial' | 'mixed' | 'downtown' | 'residential' | 'park' | 'river';
export type Surface = 'street' | 'plaza' | 'yard' | 'lawn' | 'path' | 'far';

export interface Mass extends Rect {
  y0: number;
  y1: number;
  facade: Facade;
  tint: string;
  /** Where the window pattern starts, in tiles, so neighbours do not light the same windows. */
  u: number;
  v: number;
}

export interface Building {
  id: string;
  use: BlockUse;
  /** Bottom up; the roof and its equipment sit on the last one. */
  masses: Mass[];
  /** Rooftop units: HVAC boxes, plant rooms. */
  equipment: number;
  waterTower?: boolean;
  solar?: boolean;
  skylights?: boolean;
  /** Tapering spires (base centre, base half-width, from y0 up h). */
  spires?: { x: number; z: number; r: number; y0: number; h: number }[];
  /** A four-sided glass roof over the top mass. */
  pyramid?: Rect & { y0: number; h: number };
  /** Red obstruction lights at the very top. */
  beacons?: { x: number; y: number; z: number }[];
}

export interface Block { id: string; use: BlockUse; outer: Rect; lot: Rect }
export interface GroundRect extends Rect { surface: Surface }
export interface Paint extends Rect { paint: 'white' | 'yellow' | 'amber' }
export interface Tree { x: number; z: number; h: number; r: number; tone: number }
export interface StreetLight { x: number; z: number; /** unit vector the arm reaches over the street */ dx: number; dz: number }
/** A traffic signal: a pole on a corner, its mast arm reaching `reach` u over the street along (dx, dz). */
export interface Signal { x: number; z: number; dx: number; dz: number; reach: number }
export interface Bridge { z0: number; z1: number }

export interface CityPlan {
  blocks: Block[];
  ground: GroundRect[];
  /** Raised curb-height slabs (top at CURB_H). */
  sidewalks: Rect[];
  paint: Paint[];
  buildings: Building[];
  trees: Tree[];
  lights: StreetLight[];
  signals: Signal[];
  fountains: { x: number; z: number; r: number }[];
  bridges: Bridge[];
  water: Rect[];
}

// ---- deterministic randomness ----------------------------------------------------

export const CITY_SEED = 20261004;

type Rng = () => number;

/** mulberry32: small, fast, and the same on every machine. */
function prng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const range = (r: Rng, a: number, b: number) => a + (b - a) * r();
const irange = (r: Rng, a: number, b: number) => Math.min(b, a + Math.floor(r() * (b - a + 1)));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))];
const chance = (r: Rng, p: number) => r() < p;

// ---- geometry helpers ------------------------------------------------------------

export const rectW = (r: Rect) => r.x1 - r.x0;
export const rectD = (r: Rect) => r.z1 - r.z0;
export function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.z0 < b.z1 + pad && b.z0 < a.z1 + pad;
}
const inset = (r: Rect, d: number): Rect => ({ x0: r.x0 + d, x1: r.x1 - d, z0: r.z0 + d, z1: r.z1 - d });
const centre = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
/** Snap a length down to whole bays (never below `min` bays). */
const bays = (len: number, bay: number, min = 2) => Math.max(min, Math.floor(len / bay)) * bay;

// ---- the grid --------------------------------------------------------------------

function blockGrid(): Block[] {
  const xs = [null, ...NS_STREETS, null] as (StreetLine | null)[];
  const zs = [null, ...EW_STREETS, null] as (StreetLine | null)[];
  const out: Block[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const w = xs[i], e = xs[i + 1], s = zs[j], n = zs[j + 1];
      const outer: Rect = {
        x0: w ? w.at + w.width / 2 : CITY.x0,
        x1: e ? e.at - e.width / 2 : CITY.x1,
        z0: s ? s.at + s.width / 2 : CITY.z0,
        z1: n ? n.at - n.width / 2 : CITY.z1,
      };
      const lot: Rect = {
        x0: outer.x0 + (w ? SIDEWALK : 0),
        x1: outer.x1 - (e ? SIDEWALK : 0),
        z0: outer.z0 + (s ? SIDEWALK : 0),
        z1: outer.z1 - (n ? SIDEWALK : 0),
      };
      const id = `B${i}-${j}`;
      // The road runs right along the depot's south fence: no sidewalk on that side.
      if (contains(outer, HUB.x, HUB.z)) { out.push({ id, use: 'depot', outer, lot: DEPOT_BLOCK }); continue; }
      out.push({ id, use: blockUseOf(outer), outer, lot });
    }
  }
  return out;
}

/** Blocks that are parks: a point inside each. */
const PARKS: readonly [number, number][] = [[272, 429], [664, -397], [-468, 1419], [1056, 825]];
/** The block that carries the two-spired tower, and the row of downtown's core. */
const BATWING_AT = { x: -272, z: 1617 };
const CORE_ROW = { z0: 1518, z1: 1716 };
/** Downtown: north of this, between the river and the west side. */
const DOWNTOWN = { z: 1300, x0: -566, x1: 566 };

const contains = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

function blockUseOf(outer: Rect): BlockUse {
  const { x: cx, z: cz } = centre(outer);
  if (cx > -850 && cx < -566) return 'river';
  if (PARKS.some(([x, z]) => contains(outer, x, z))) return 'park';
  const d = Math.hypot(cx - HUB.x, cz - HUB.z);
  if (d < NEAR_RING.radius) return 'industrial';
  if (cz > DOWNTOWN.z && cx > DOWNTOWN.x0 && cx < DOWNTOWN.x1) return 'downtown';
  if (cz < SOUTH_ROAD.at) return d < 640 ? 'industrial' : 'residential';
  if (cx < -850) return 'residential';
  return 'mixed';
}

// ---- what stands on a block ------------------------------------------------------

interface Ctx { r: Rng; block: Block; out: Building[]; n: number }

function mass(r: Rng, rect: Rect, y0: number, y1: number, facade: Facade, tint?: string): Mass {
  const s = FACADE_SPEC[facade];
  return {
    x0: rect.x0, x1: rect.x1, z0: rect.z0, z1: rect.z1, y0, y1, facade,
    tint: tint ?? pick(r, TINTS[facade]),
    u: irange(r, 0, s.tileBays - 1) / s.tileBays,
    v: s.fitHeight ? 0 : irange(r, 0, s.tileFloors - 1) / s.tileFloors,
  };
}

function add(ctx: Ctx, b: Omit<Building, 'id' | 'use'>) {
  ctx.out.push({ ...b, id: `${ctx.block.id}.${ctx.n++}`, use: ctx.block.use });
}

/** A street-front building: optional shopfront podium, floors above, sometimes a set-back top. */
function midrise(ctx: Ctx, fp: Rect, floors: number, facade: Facade, podium: boolean) {
  const { r } = ctx;
  const s = FACADE_SPEC[facade];
  const tint = pick(r, TINTS[facade]);
  const masses: Mass[] = [];
  let y = 0;
  if (podium && floors >= 3) {
    masses.push(mass(r, fp, 0, 9, 'storefront'));
    y = 9;
    floors -= 1;
  }
  y += floors * s.floor;
  masses.push(mass(r, fp, masses.length ? 9 : 0, y, facade, tint));
  // a set-back top floor or two on the taller ones
  if (floors >= 7 && chance(r, 0.45) && rectW(fp) > 30 && rectD(fp) > 30) {
    const k = range(r, 0.12, 0.2);
    const top: Rect = { x0: fp.x0 + rectW(fp) * k, x1: fp.x1 - rectW(fp) * k, z0: fp.z0 + rectD(fp) * k, z1: fp.z1 - rectD(fp) * k };
    const extra = irange(r, 1, 2) * s.floor;
    masses.push(mass(r, top, y, y + extra, facade, tint));
  }
  add(ctx, {
    masses,
    equipment: ctx.block.use === 'residential' ? 0 : irange(r, 1, 3),
    waterTower: facade === 'brick' && floors <= 8 && chance(r, 0.22),
  });
}

/** Buildings lining all four edges of a lot, a courtyard left in the middle. */
function perimeter(ctx: Ctx, lot: Rect, o: {
  depth: [number, number]; width: [number, number]; floors: [number, number];
  facades: readonly Facade[]; podium: number; gap: number;
}) {
  const { r } = ctx;
  const dN = range(r, o.depth[0], o.depth[1]);
  const dS = range(r, o.depth[0], o.depth[1]);
  const dE = range(r, o.depth[0], o.depth[1]);
  const dW = range(r, o.depth[0], o.depth[1]);
  if (rectD(lot) < dN + dS + 12 || rectW(lot) < dE + dW + 12) {
    // too small for a courtyard: one building
    midrise(ctx, inset(lot, 2), irange(r, o.floors[0], o.floors[1]), pick(r, o.facades), chance(r, o.podium));
    return;
  }
  const row = (a0: number, a1: number, place: (s0: number, s1: number) => Rect, corner: boolean) => {
    let a = a0;
    while (a1 - a > o.width[0] * 0.6) {
      const facade = pick(r, o.facades);
      const bay = FACADE_SPEC[facade].bay;
      let w = bays(range(r, o.width[0], o.width[1]), bay, 3);
      if (a1 - (a + w) < o.width[0]) w = a1 - a;           // the last one takes what is left
      let floors = irange(r, o.floors[0], o.floors[1]);
      if (corner && (a === a0 || a + w >= a1)) floors += irange(r, 0, 2);
      midrise(ctx, place(a, a + w), floors, facade, chance(r, o.podium));
      a += w;
      if (chance(r, o.gap)) a += range(r, 6, 12);           // an alley or a side yard
    }
  };
  // north and south rows run the full width (they own the corners)
  row(lot.x0, lot.x1, (s0, s1) => ({ x0: s0, x1: s1, z0: lot.z1 - dN, z1: lot.z1 }), true);
  row(lot.x0, lot.x1, (s0, s1) => ({ x0: s0, x1: s1, z0: lot.z0, z1: lot.z0 + dS }), true);
  // east and west rows fill between them, off the courtyard by an alley
  const z0 = lot.z0 + dS + 4, z1 = lot.z1 - dN - 4;
  row(z0, z1, (s0, s1) => ({ x0: lot.x0, x1: lot.x0 + dE, z0: s0, z1: s1 }), false);
  row(z0, z1, (s0, s1) => ({ x0: lot.x1 - dW, x1: lot.x1, z0: s0, z1: s1 }), false);
}

function warehouses(ctx: Ctx, lot: Rect) {
  const { r } = ctx;
  // one, two or four parcels
  const parcels: Rect[] = [];
  const mx = (lot.x0 + lot.x1) / 2, mz = (lot.z0 + lot.z1) / 2;
  const k = rectW(lot) > 90 && rectD(lot) > 90 ? irange(r, 0, 2) : 0;
  if (k === 0) parcels.push(lot);
  else if (k === 1) {
    if (rectW(lot) >= rectD(lot)) parcels.push({ ...lot, x1: mx - 4 }, { ...lot, x0: mx + 4 });
    else parcels.push({ ...lot, z1: mz - 4 }, { ...lot, z0: mz + 4 });
  } else {
    parcels.push(
      { x0: lot.x0, x1: mx - 4, z0: lot.z0, z1: mz - 4 }, { x0: mx + 4, x1: lot.x1, z0: lot.z0, z1: mz - 4 },
      { x0: lot.x0, x1: mx - 4, z0: mz + 4, z1: lot.z1 }, { x0: mx + 4, x1: lot.x1, z0: mz + 4, z1: lot.z1 },
    );
  }
  for (const p of parcels) {
    if (rectW(p) < 34 || rectD(p) < 34) continue;
    if (chance(r, 0.22)) {
      // a two- or three-storey flex office with its parking court beside it
      const s = FACADE_SPEC.office;
      const alongX = rectW(p) >= rectD(p);
      const w = bays(Math.min(alongX ? rectW(p) * 0.55 : rectW(p) - 16, 70), s.bay);
      const d = bays(Math.min(alongX ? rectD(p) - 16 : rectD(p) * 0.55, 42), s.bay);
      const x0 = alongX ? (chance(r, 0.5) ? p.x0 + 8 : p.x1 - 8 - w) : p.x0 + (rectW(p) - w) / 2;
      const z0 = alongX ? p.z0 + (rectD(p) - d) / 2 : (chance(r, 0.5) ? p.z0 + 8 : p.z1 - 8 - d);
      const floors = irange(r, 2, 3);
      add(ctx, {
        masses: [mass(r, { x0, x1: x0 + w, z0, z1: z0 + d }, 0, floors * s.floor, 'office')],
        equipment: irange(r, 1, 3),
      });
      continue;
    }
    const sx = range(r, 8, 16), sz = range(r, 8, 16);
    const fp: Rect = inset({ x0: p.x0 + sx, x1: p.x1 - sx, z0: p.z0 + sz, z1: p.z1 - sz }, 0);
    // leave a truck court along the longer side
    const yard = range(r, 0.18, 0.32);
    if (rectW(fp) >= rectD(fp)) {
      if (chance(r, 0.5)) fp.z0 += rectD(fp) * yard; else fp.z1 -= rectD(fp) * yard;
    } else if (chance(r, 0.5)) fp.x0 += rectW(fp) * yard; else fp.x1 -= rectW(fp) * yard;
    if (rectW(fp) < 20 || rectD(fp) < 20) continue;
    const h = irange(r, 13, 24);
    add(ctx, {
      masses: [mass(r, fp, 0, h, 'industrial')],
      equipment: irange(r, 1, 4),
      skylights: chance(r, 0.55),
      solar: chance(r, 0.35),
    });
  }
}

function towerBlock(ctx: Ctx, lot: Rect, core: boolean, batwing: boolean) {
  const { r } = ctx;
  const mx = (lot.x0 + lot.x1) / 2, mz = (lot.z0 + lot.z1) / 2;
  const quads: Rect[] = [
    { x0: lot.x0, x1: mx - 3, z0: lot.z0, z1: mz - 3 }, { x0: mx + 3, x1: lot.x1, z0: lot.z0, z1: mz - 3 },
    { x0: lot.x0, x1: mx - 3, z0: mz + 3, z1: lot.z1 }, { x0: mx + 3, x1: lot.x1, z0: mz + 3, z1: lot.z1 },
  ];
  const towerQuads = new Set<number>([irange(r, 0, 3)]);
  if (core && chance(r, 0.5)) towerQuads.add(3 - [...towerQuads][0]); // the diagonal quarter
  quads.forEach((q, qi) => {
    if (rectW(q) < 40 || rectD(q) < 40) return;
    if (batwing && qi === [...towerQuads][0]) { batwingTower(ctx, q); return; }
    if (towerQuads.has(qi)) { tower(ctx, q, core); return; }
    // podium-and-midrise quarters
    const facade = pick(r, ['office', 'brick', 'glass', 'office'] as const);
    const s = FACADE_SPEC[facade];
    const fp: Rect = {
      x0: q.x0 + 2, x1: q.x0 + 2 + bays(rectW(q) - 4, s.bay),
      z0: q.z0 + 2, z1: q.z0 + 2 + bays(rectD(q) - 4, s.bay),
    };
    midrise(ctx, fp, irange(r, core ? 6 : 5, core ? 14 : 11), facade, true);
  });
}

function tower(ctx: Ctx, q: Rect, core: boolean) {
  const { r } = ctx;
  const facade: Facade = chance(r, 0.7) ? 'glass' : 'office';
  const s = FACADE_SPEC[facade];
  const w = bays(Math.min(rectW(q) - 14, range(r, 50, 70)), s.bay);
  const d = bays(Math.min(rectD(q) - 14, range(r, 46, 66)), s.bay);
  const c = centre(q);
  const fp: Rect = { x0: c.x - w / 2, x1: c.x + w / 2, z0: c.z - d / 2, z1: c.z + d / 2 };
  const tint = pick(r, TINTS[facade]);
  const floors = core ? irange(r, 18, 25) : irange(r, 12, 20);
  const podiumH = 3 * 7.6;
  const pod: Rect = inset(fp, -6);
  const masses: Mass[] = [
    mass(r, { ...pod, x0: Math.max(pod.x0, q.x0 + 1), x1: Math.min(pod.x1, q.x1 - 1), z0: Math.max(pod.z0, q.z0 + 1), z1: Math.min(pod.z1, q.z1 - 1) }, 0, 9, 'storefront'),
  ];
  masses.push(mass(r, masses[0], 9, podiumH, 'office'));
  let y = podiumH + floors * s.floor;
  masses.push(mass(r, fp, podiumH, y, facade, tint));
  const b: Omit<Building, 'id' | 'use'> = { masses, equipment: irange(r, 0, 2) };
  const crown = pick(r, ['flat', 'stepped', 'spire', 'pyramid', 'stepped'] as const);
  if (crown === 'stepped') {
    let top = fp;
    for (let k = 0; k < 2; k++) {
      top = inset(top, Math.max(s.bay, rectW(top) * 0.12));
      if (rectW(top) < 16 || rectD(top) < 16) break;
      const add2 = irange(r, 2, 4) * s.floor;
      masses.push(mass(r, top, y, y + add2, facade, tint));
      y += add2;
    }
  } else if (crown === 'pyramid') {
    b.pyramid = { ...inset(fp, 1), y0: y, h: Math.min(rectW(fp), rectD(fp)) * range(r, 0.45, 0.7) };
    y += b.pyramid.h;
  } else if (crown === 'spire') {
    const h = range(r, 30, 60);
    b.spires = [{ x: c.x, z: c.z, r: 1.6, y0: y, h }];
    y += h;
  }
  b.beacons = [{ x: c.x, y: y + 0.6, z: c.z }];
  add(ctx, b);
}

/**
 * The tallest tower: a nod to Nashville's two-spired AT&T Building, not a copy. A
 * dark glass shaft, a peaked glass crown, and two tall corner spires.
 */
function batwingTower(ctx: Ctx, q: Rect) {
  const { r } = ctx;
  const s = FACADE_SPEC.glass;
  const c = centre(q);
  const w = bays(Math.min(rectW(q) - 12, 64), s.bay), d = bays(Math.min(rectD(q) - 12, 44), s.bay);
  const fp: Rect = { x0: c.x - w / 2, x1: c.x + w / 2, z0: c.z - d / 2, z1: c.z + d / 2 };
  const podiumH = 3 * 7.6;
  const shaftTop = podiumH + 26 * s.floor;
  const pod = inset(fp, -5);
  const masses: Mass[] = [
    mass(r, pod, 0, 9, 'storefront'),
    mass(r, pod, 9, podiumH, 'office', '#d9d6cf'),
    mass(r, fp, podiumH, shaftTop, 'glass', '#8ea3ba'),
  ];
  // the crown block, a little narrower, carrying the peak between the spires
  const crownBox: Rect = { x0: fp.x0 + 7, x1: fp.x1 - 7, z0: fp.z0 + 3, z1: fp.z1 - 3 };
  masses.push(mass(r, crownBox, shaftTop, shaftTop + 3 * s.floor, 'glass', '#8ea3ba'));
  const crownTop = shaftTop + 3 * s.floor;
  const spireH = 72;
  const spires = [
    { x: fp.x0 + 4, z: c.z, r: 3.2, y0: shaftTop, h: crownTop - shaftTop + spireH },
    { x: fp.x1 - 4, z: c.z, r: 3.2, y0: shaftTop, h: crownTop - shaftTop + spireH },
  ];
  add(ctx, {
    masses,
    equipment: 0,
    pyramid: { ...crownBox, y0: crownTop, h: 34 },
    spires,
    beacons: spires.map((sp) => ({ x: sp.x, y: sp.y0 + sp.h + 0.6, z: sp.z })),
  });
}

function houses(ctx: Ctx, lot: Rect) {
  perimeter(ctx, lot, {
    depth: [18, 30], width: [24, 44], floors: [2, 4],
    facades: ['stucco', 'stucco', 'brick'], podium: 0.05, gap: 0.45,
  });
}

// ---- ground, paint, trees, lights -------------------------------------------------

function groundFor(b: Block, out: GroundRect[], fountains: CityPlan['fountains'], trees: Tree[], r: Rng) {
  const L = b.lot;
  switch (b.use) {
    case 'depot':
      return; // DepotGround's grass
    case 'mixed':
    case 'downtown':
      out.push({ ...L, surface: 'plaza' });
      return;
    case 'residential':
      out.push({ ...L, surface: 'lawn' });
      return;
    case 'industrial': {
      // a lawn strip along every street-facing edge, the truck yard inside it
      const e = 5;
      const front = overlaps(L, ENTRANCE_LAWN) ? Math.max(e, L.z1 - ENTRANCE_LAWN.z0) : e;
      out.push(
        { ...L, z0: L.z1 - front, surface: 'lawn' },
        { ...L, z1: L.z0 + e, surface: 'lawn' },
        { x0: L.x0, x1: L.x0 + e, z0: L.z0 + e, z1: L.z1 - front, surface: 'lawn' },
        { x0: L.x1 - e, x1: L.x1, z0: L.z0 + e, z1: L.z1 - front, surface: 'lawn' },
        { x0: L.x0 + e, x1: L.x1 - e, z0: L.z0 + e, z1: L.z1 - front, surface: 'yard' },
      );
      return;
    }
    case 'park': {
      const c = centre(L);
      const p = 2.5; // path half-width
      const plaza = 11;
      // two crossing paths, a round plaza with a fountain where they meet
      out.push(
        { x0: c.x - p, x1: c.x + p, z0: L.z0, z1: c.z - plaza, surface: 'path' },
        { x0: c.x - p, x1: c.x + p, z0: c.z + plaza, z1: L.z1, surface: 'path' },
        { x0: L.x0, x1: c.x - plaza, z0: c.z - p, z1: c.z + p, surface: 'path' },
        { x0: c.x + plaza, x1: L.x1, z0: c.z - p, z1: c.z + p, surface: 'path' },
        { x0: c.x - plaza, x1: c.x + plaza, z0: c.z - plaza, z1: c.z + plaza, surface: 'path' },
        { x0: L.x0, x1: c.x - p, z0: L.z0, z1: c.z - p, surface: 'lawn' },
        { x0: c.x + p, x1: L.x1, z0: L.z0, z1: c.z - p, surface: 'lawn' },
        { x0: L.x0, x1: c.x - p, z0: c.z + p, z1: L.z1, surface: 'lawn' },
        { x0: c.x + p, x1: L.x1, z0: c.z + p, z1: L.z1, surface: 'lawn' },
      );
      // the four lawn quarters overlap the plaza square; cut them back around it
      fixParkPlaza(out, c, p, plaza);
      fountains.push({ x: c.x, z: c.z, r: 6 });
      for (let x = L.x0 + 9; x < L.x1 - 6; x += 17) {
        for (let z = L.z0 + 9; z < L.z1 - 6; z += 17) {
          const jx = x + range(r, -4, 4), jz = z + range(r, -4, 4);
          if (Math.abs(jx - c.x) < p + 4 || Math.abs(jz - c.z) < p + 4) continue;
          if (Math.abs(jx - c.x) < plaza + 4 && Math.abs(jz - c.z) < plaza + 4) continue;
          if (chance(r, 0.18)) continue;
          trees.push(tree(r, jx, jz, 1.15));
        }
      }
      return;
    }
    case 'river': {
      // greenway on each bank, a promenade along the water, the channel between
      const prom = 5;
      const westBank = { x0: RIVER.x1, x1: L.x1 };
      const eastBank = { x0: L.x0, x1: RIVER.x0 };
      out.push(
        { x0: westBank.x0, x1: westBank.x0 + prom, z0: L.z0, z1: L.z1, surface: 'path' },
        { x0: westBank.x0 + prom, x1: westBank.x1, z0: L.z0, z1: L.z1, surface: 'lawn' },
        { x0: eastBank.x1 - prom, x1: eastBank.x1, z0: L.z0, z1: L.z1, surface: 'path' },
        { x0: eastBank.x0, x1: eastBank.x1 - prom, z0: L.z0, z1: L.z1, surface: 'lawn' },
      );
      for (const bank of [westBank, eastBank]) {
        const tx = bank === westBank ? bank.x0 + prom + 4 : bank.x1 - prom - 4;
        for (let z = L.z0 + 8; z < L.z1 - 6; z += 22) trees.push(tree(r, tx + range(r, -1.5, 1.5), z + range(r, -3, 3), 1.05));
        for (let z = L.z0 + 14; z < L.z1 - 6; z += 26) {
          const x = range(r, bank.x0 + prom + 12, bank.x1 - (bank === westBank ? 8 : prom + 12));
          if (chance(r, 0.6)) trees.push(tree(r, x, z + range(r, -4, 4), 1.1));
        }
      }
      return;
    }
  }
}

/** Park lawns are laid as four quarters between the paths; trim them off the plaza square. */
function fixParkPlaza(out: GroundRect[], c: { x: number; z: number }, p: number, plaza: number) {
  const square: Rect = { x0: c.x - plaza, x1: c.x + plaza, z0: c.z - plaza, z1: c.z + plaza };
  for (let i = out.length - 4; i < out.length; i++) {
    const q = out[i];
    if (!overlaps(q, square)) continue;
    // keep the L-shape as two rects: the part beyond the square in x, and in z
    const east = q.x1 <= c.x;  // this quarter lies on the low-x side
    const south = q.z1 <= c.z;
    const xCut = east ? square.x0 : square.x1;
    const zCut = south ? square.z0 : square.z1;
    const a: GroundRect = east ? { ...q, x1: xCut } : { ...q, x0: xCut };
    const b: GroundRect = east ? { ...q, x0: xCut } : { ...q, x1: xCut };
    if (south) b.z1 = zCut; else b.z0 = zCut;
    out.splice(i, 1, a, b);
    i++;
  }
  void p;
}

function tree(r: Rng, x: number, z: number, scale = 1): Tree {
  return { x, z, h: (5 + r() * 3.5) * scale, r: (1.9 + r() * 1.3) * scale, tone: Math.floor(r() * 4) };
}

/** Whether a point is clear of every intersection by `pad` (trees, lights and paint keep off them). */
function clearOfCrossings(x: number, z: number, pad: number) {
  for (const s of NS_STREETS) if (Math.abs(x - s.at) < s.width / 2 + pad) {
    for (const t of EW_STREETS) if (Math.abs(z - t.at) < t.width / 2 + pad) return false;
  }
  return true;
}
const onBridge = (x: number) => x > RIVER.x0 - 2 && x < RIVER.x1 + 2;
/** The sidewalk right in front of the Entrance camera (50, 6, -135): nothing planted there. */
export const ENTRANCE_FOREGROUND: Rect = { x0: -25, x1: 125, z0: -140, z1: -98.5 };
const nearHub = (x: number, z: number, d: number) => Math.hypot(x - HUB.x, z - HUB.z) < d;

function streetsAndPaint(ground: GroundRect[], paint: Paint[]) {
  // east-west streets run the full width; the depot's stretch of the south road is DepotGround's
  for (const s of EW_STREETS) {
    const z0 = s.at - s.width / 2, z1 = s.at + s.width / 2;
    if (s === SOUTH_ROAD) {
      ground.push({ x0: CITY.x0, x1: DEPOT_ROAD_SPAN.x0, z0, z1, surface: 'street' });
      ground.push({ x0: DEPOT_ROAD_SPAN.x1, x1: CITY.x1, z0, z1, surface: 'street' });
    } else {
      ground.push({ x0: CITY.x0, x1: CITY.x1, z0, z1, surface: 'street' });
    }
  }
  // north-south streets between them, so no two pavement rects overlap at a crossing
  const zEdges = [CITY.z0, ...EW_STREETS.flatMap((s) => [s.at - s.width / 2, s.at + s.width / 2]), CITY.z1];
  for (const s of NS_STREETS) {
    for (let k = 0; k < zEdges.length; k += 2) {
      ground.push({ x0: s.at - s.width / 2, x1: s.at + s.width / 2, z0: zEdges[k], z1: zEdges[k + 1], surface: 'street' });
    }
  }

  // ---- paint: centre lines, lane lines, crosswalks ----
  const xEdges = [CITY.x0, ...NS_STREETS.flatMap((s) => [s.at - s.width / 2, s.at + s.width / 2]), CITY.x1];
  // along x (east-west streets), segment by segment between crossings
  for (const s of EW_STREETS) {
    for (let k = 0; k < xEdges.length; k += 2) {
      const a = xEdges[k] + 3, b = xEdges[k + 1] - 3;
      if (b - a < 4) continue;
      if (s === SOUTH_ROAD) {
        // the depot road's amber dashes, on DepotGround's 20 u phase
        for (let x = Math.ceil((a + 4) / 20) * 20; x <= b - 4; x += 20) {
          if (x > DEPOT_ROAD_SPAN.x0 - 4 && x < DEPOT_ROAD_SPAN.x1 + 4) continue;
          paint.push({ x0: x - 4, x1: x + 4, z0: s.at - 0.25, z1: s.at + 0.25, paint: 'amber' });
        }
        continue;
      }
      centreLine(paint, 'x', s, a, b);
    }
  }
  for (const s of NS_STREETS) {
    for (let k = 0; k < zEdges.length; k += 2) {
      const a = zEdges[k] + 3, b = zEdges[k + 1] - 3;
      if (b - a < 4) continue;
      centreLine(paint, 'z', s, a, b);
    }
  }
  // zebra crosswalks on every approach of the crossings near the depot
  for (const ns of NS_STREETS) {
    for (const ew of EW_STREETS) {
      if (!nearHub(ns.at, ew.at, 900)) continue;
      const cw = 5; // crosswalk depth
      // across the east-west street, on each side of the north-south one
      for (const side of [-1, 1]) {
        const x = ns.at + side * (ns.width / 2 + 1.5 + cw / 2);
        if (onBridge(x)) continue;
        for (let z = ew.at - ew.width / 2 + 1; z <= ew.at + ew.width / 2 - 1.6; z += 1.9) {
          paint.push({ x0: x - cw / 2, x1: x + cw / 2, z0: z, z1: z + 0.9, paint: 'white' });
        }
      }
      // across the north-south street, on each side of the east-west one
      for (const side of [-1, 1]) {
        const z = ew.at + side * (ew.width / 2 + 1.5 + cw / 2);
        for (let x = ns.at - ns.width / 2 + 1; x <= ns.at + ns.width / 2 - 1.6; x += 1.9) {
          paint.push({ x0: x, x1: x + 0.9, z0: z - cw / 2, z1: z + cw / 2, paint: 'white' });
        }
      }
    }
  }
}

/** Double yellow down the middle; on the four-lane streets, dashed white between the lanes too. */
function centreLine(paint: Paint[], along: 'x' | 'z', s: StreetLine, a: number, b: number) {
  const line = (off: number, w: number, p0: number, p1: number, kind: Paint['paint']) => {
    paint.push(along === 'x'
      ? { x0: p0, x1: p1, z0: s.at + off - w / 2, z1: s.at + off + w / 2, paint: kind }
      : { x0: s.at + off - w / 2, x1: s.at + off + w / 2, z0: p0, z1: p1, paint: kind });
  };
  line(-0.3, 0.22, a, b, 'yellow');
  line(0.3, 0.22, a, b, 'yellow');
  if (s.kind === 'major') {
    for (const off of [-5.5, 5.5]) {
      for (let p = a + 2; p + 6 <= b; p += 14) line(off, 0.25, p, p + 6, 'white');
    }
  }
}

function sidewalksFor(b: Block, out: Rect[]) {
  const O = b.outer, L = b.lot;
  if (b.use === 'depot') {
    // west, east and north only: the road runs against the south fence
    out.push({ x0: O.x0, x1: L.x0, z0: L.z0, z1: O.z1 }, { x0: L.x1, x1: O.x1, z0: L.z0, z1: O.z1 }, { x0: L.x0, x1: L.x1, z0: L.z1, z1: O.z1 });
    return;
  }
  if (L.z0 > O.z0) out.push({ x0: O.x0, x1: O.x1, z0: O.z0, z1: L.z0 });
  if (L.z1 < O.z1) out.push({ x0: O.x0, x1: O.x1, z0: L.z1, z1: O.z1 });
  if (L.x0 > O.x0) out.push({ x0: O.x0, x1: L.x0, z0: L.z0, z1: L.z1 });
  if (L.x1 < O.x1) out.push({ x0: L.x1, x1: O.x1, z0: L.z0, z1: L.z1 });
}

/** Street trees and lights along every sidewalk near the depot. */
function streetFurniture(blocks: Block[], trees: Tree[], lights: StreetLight[], r: Rng) {
  for (const b of blocks) {
    const O = b.outer, L = b.lot;
    // each sidewalk run: its curb line, which way the street lies, and its extent
    const runs: { along: 'x' | 'z'; curb: number; toStreet: number; a: number; b: number }[] = [];
    if (L.z0 > O.z0) runs.push({ along: 'x', curb: O.z0, toStreet: -1, a: O.x0, b: O.x1 });
    if (L.z1 < O.z1) runs.push({ along: 'x', curb: O.z1, toStreet: 1, a: O.x0, b: O.x1 });
    if (L.x0 > O.x0) runs.push({ along: 'z', curb: O.x0, toStreet: -1, a: O.z0, b: O.z1 });
    if (L.x1 < O.x1) runs.push({ along: 'z', curb: O.x1, toStreet: 1, a: O.z0, b: O.z1 });
    for (const run of runs) {
      const off = run.curb - run.toStreet * 1.7; // tree pits 1.7 u in from the curb
      const lamp = run.curb - run.toStreet * 0.8;
      const mid = run.along === 'x' ? { x: (run.a + run.b) / 2, z: run.curb } : { x: run.curb, z: (run.a + run.b) / 2 };
      const dHub = Math.hypot(mid.x - HUB.x, mid.z - HUB.z);
      if (b.use === 'depot' && run.along === 'x' && run.toStreet < 0) continue;
      if (dHub < 640) {
        for (let p = run.a + 10; p <= run.b - 10; p += 24) {
          const x = run.along === 'x' ? p : off, z = run.along === 'x' ? off : p;
          if (onBridge(x) || !clearOfCrossings(x, z, 9) || contains(ENTRANCE_FOREGROUND, x, z)) continue;
          if (b.use === 'downtown' && chance(r, 0.35)) continue;
          trees.push(tree(r, x + range(r, -0.6, 0.6), z + range(r, -0.6, 0.6), 0.95));
        }
      }
      if (dHub < 820) {
        const phase = run.toStreet > 0 ? 22 : 46;
        for (let p = run.a + phase; p <= run.b - 8; p += 48) {
          const x = run.along === 'x' ? p : lamp, z = run.along === 'x' ? lamp : p;
          if (!clearOfCrossings(x, z, 4) || contains(ENTRANCE_FOREGROUND, x, z)) continue;
          lights.push(run.along === 'x' ? { x, z, dx: 0, dz: run.toStreet } : { x, z, dx: run.toStreet, dz: 0 });
        }
      }
    }
  }
}

/** Signals at the crossings near the depot: two diagonal corners, one arm over each street. */
function trafficSignals(): Signal[] {
  const out: Signal[] = [];
  for (const ns of NS_STREETS) {
    for (const ew of EW_STREETS) {
      if (!nearHub(ns.at, ew.at, 560) || onBridge(ns.at)) continue;
      const hx = ns.width / 2 + 1.4, hz = ew.width / 2 + 1.4;
      // the +x/+z corner reaches over the north-south street, the -x/-z corner over the east-west one
      out.push({ x: ns.at + hx, z: ew.at + hz, dx: -1, dz: 0, reach: hx });
      out.push({ x: ns.at - hx, z: ew.at - hz, dx: 0, dz: 1, reach: hz });
    }
  }
  return out;
}

// ---- the plan --------------------------------------------------------------------

export function buildCityPlan(seed = CITY_SEED): CityPlan {
  const blocks = blockGrid();
  const ground: GroundRect[] = [];
  const sidewalks: Rect[] = [];
  const paint: Paint[] = [];
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const lights: StreetLight[] = [];
  const fountains: CityPlan['fountains'] = [];

  streetsAndPaint(ground, paint);

  const hash = (s: string) => {
    let h = seed ^ 0x9e3779b9;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
  };

  for (const b of blocks) {
    sidewalksFor(b, sidewalks);
    const r = prng(hash(b.id));
    groundFor(b, ground, fountains, trees, r);
    const ctx: Ctx = { r, block: b, out: buildings, n: 0 };
    const c = centre(b.outer);
    let L = b.lot;
    if (overlaps(L, ENTRANCE_LAWN)) L = { ...L, z1: Math.min(L.z1, ENTRANCE_LAWN.z0) };
    if (rectW(L) < 20 || rectD(L) < 20) continue;
    switch (b.use) {
      case 'industrial': warehouses(ctx, L); break;
      case 'residential': houses(ctx, L); break;
      case 'mixed': {
        // taller the further north, toward downtown
        const t = Math.max(0, Math.min(1, (c.z - 150) / 1100));
        const lo = Math.round(3 + t * 4), hi = Math.round(6 + t * 8);
        perimeter(ctx, L, {
          depth: [26, 44], width: [24, 56], floors: [lo, hi],
          facades: ['brick', 'office', 'stucco', 'brick', 'office', 'glass'], podium: 0.65, gap: 0.25,
        });
        if (chance(r, 0.5)) {
          const cc = centre(L);
          trees.push(tree(r, cc.x + range(r, -10, 10), cc.z + range(r, -10, 10), 1.1));
        }
        break;
      }
      case 'downtown': {
        const core = c.z > CORE_ROW.z0 && c.z < CORE_ROW.z1 && Math.abs(c.x) < 300;
        const bat = contains(b.outer, BATWING_AT.x, BATWING_AT.z);
        towerBlock(ctx, L, core, bat);
        break;
      }
      default: break;
    }
  }

  // Nothing tall near the depot: the corner and orbit cameras fly there.
  for (const bl of buildings) {
    const fp = bl.masses[0];
    const d = Math.hypot((fp.x0 + fp.x1) / 2 - HUB.x, (fp.z0 + fp.z1) / 2 - HUB.z);
    if (d < NEAR_RING.radius) {
      for (const m of bl.masses) m.y1 = Math.min(m.y1, NEAR_RING.maxHeight);
      bl.masses = bl.masses.filter((m) => m.y1 > m.y0 + 1);
    }
  }

  streetFurniture(blocks, trees, lights, prng(hash('furniture')));

  // trees never stand in a building (bucketed by 50 u cells: thousands of each)
  const CELL = 50, grid = new Map<string, Mass[]>();
  for (const bl of buildings) {
    for (const m of bl.masses) {
      for (let gx = Math.floor(m.x0 / CELL); gx <= Math.floor(m.x1 / CELL); gx++) {
        for (let gz = Math.floor(m.z0 / CELL); gz <= Math.floor(m.z1 / CELL); gz++) {
          const k = `${gx},${gz}`;
          (grid.get(k) ?? grid.set(k, []).get(k)!).push(m);
        }
      }
    }
  }
  const kept = trees.filter((t) => {
    const pad = t.r * 0.6;
    for (let gx = Math.floor((t.x - pad) / CELL); gx <= Math.floor((t.x + pad) / CELL); gx++) {
      for (let gz = Math.floor((t.z - pad) / CELL); gz <= Math.floor((t.z + pad) / CELL); gz++) {
        for (const m of grid.get(`${gx},${gz}`) ?? []) {
          if (t.x > m.x0 - pad && t.x < m.x1 + pad && t.z > m.z0 - pad && t.z < m.z1 + pad) return false;
        }
      }
    }
    return true;
  });

  const bridges: Bridge[] = EW_STREETS.map((s) => ({ z0: s.at - s.width / 2 - SIDEWALK, z1: s.at + s.width / 2 + SIDEWALK }));
  const water: Rect[] = [{ x0: RIVER.x0, x1: RIVER.x1, z0: FAR_GROUND.z0, z1: FAR_GROUND.z1 }];

  // the plain beyond the city, cut around the river
  const far: Rect[] = [
    { x0: FAR_GROUND.x0, x1: CITY.x0, z0: CITY.z0, z1: CITY.z1 },
    { x0: CITY.x1, x1: FAR_GROUND.x1, z0: CITY.z0, z1: CITY.z1 },
    { x0: FAR_GROUND.x0, x1: RIVER.x0, z0: CITY.z1, z1: FAR_GROUND.z1 },
    { x0: RIVER.x1, x1: FAR_GROUND.x1, z0: CITY.z1, z1: FAR_GROUND.z1 },
    { x0: FAR_GROUND.x0, x1: RIVER.x0, z0: FAR_GROUND.z0, z1: CITY.z0 },
    { x0: RIVER.x1, x1: FAR_GROUND.x1, z0: FAR_GROUND.z0, z1: CITY.z0 },
  ];
  for (const f of far) ground.push({ ...f, surface: 'far' });

  // lamps give way to the signals on the corners
  const signals = trafficSignals();
  const lamps = lights.filter((l) => !signals.some((g) => Math.hypot(g.x - l.x, g.z - l.z) < 6));

  return { blocks, ground, sidewalks, paint, buildings, trees: kept, lights: lamps, signals, fountains, bridges, water };
}

/** Everything in the plan that rises off the ground, as boxes: for the clearance tests. */
export function solidsOf(b: Building): (Rect & { y0: number; y1: number })[] {
  const out: (Rect & { y0: number; y1: number })[] = b.masses.map((m) => ({ x0: m.x0, x1: m.x1, z0: m.z0, z1: m.z1, y0: m.y0, y1: m.y1 }));
  if (b.pyramid) out.push({ ...b.pyramid, y1: b.pyramid.y0 + b.pyramid.h });
  for (const s of b.spires ?? []) out.push({ x0: s.x - s.r, x1: s.x + s.r, z0: s.z - s.r, z1: s.z + s.r, y0: s.y0, y1: s.y0 + s.h });
  return out;
}

