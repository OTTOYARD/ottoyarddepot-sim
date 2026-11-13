// A fleet vehicle's CABIN as the cleaning arm needs it: its door openings, how each open door leaf stands, its seats,
// its floor and its headliner. Everything is DERIVED from the vehicle's own spec (surface, doors, seats, dims) by the
// rules build.ts draws the model with, so the robot works to the car the yard draws. Nothing here is typed per vehicle.
//
// FRAME: the cleaning arm's car frame (ottoCleanArm/cleanArmPose.ts), which is the model's own (surface.ts): metres,
// x along the car + toward the nose from the car's centre, y up from grade, z across + toward the right flank. A spec's
// `xr` (metres back from the front bumper) is x = length / 2 - xr.
//
// WHAT IS ASSUMED, and stays an assumption until a vehicle's maker publishes it (docs/CLEAN-ARM-PER-VEHICLE.md):
//   - the cabin's inner face is the body skin moved in by CABIN_LINER_M at every station (build.ts draws a 0.040 m
//     body skin and a 0.055 m door);
//   - the floor, the seats, the dash and the steering wheel are the ones build.ts draws, as boxes;
//   - two hinged doors that share a cut line have a pillar between them, PILLAR_HALF_M each side of the line (the
//     model cuts the two doors on one line and draws no pillar);
//   - the body is symmetric left to right; the steering wheel is counted on both flanks.
import { clearanceToCar, type CarBox, type CarSolid } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { fleetCarSolidInCarFrame } from './carSolid';
import { doorPointAt, doorRigOf, type DoorRig } from './doorRigs';
import type { DoorKind, DoorSpec, VehicleSpec } from './spec';
import { K_BELT, K_TOP, makeSurface, polyline, type Surface } from './surface';

export interface Vec3 { x: number; y: number; z: number }

/** The cabin's inner face stands this far inside the body's outer skin. */
export const CABIN_LINER_M = 0.065;
/** A door's thickness, outer skin to inner trim (build.ts). */
export const DOOR_THICKNESS_M = 0.055;
/** Half the width of the pillar taken to stand between two hinged doors that share a cut line. */
export const PILLAR_HALF_M = 0.05;
/** The floor mat's top above the floor panel's middle (build.ts draws a 0.03 m panel). */
const FLOOR_HALF_M = 0.015;

export type LeafStands = 'out' | 'along' | 'up';

/** One open door leaf, as the solid a robot keeps clear of. Right flank; the left is its mirror. */
export interface CabinLeaf {
  id: string;
  kind: DoorKind;
  /** A hinged leaf stands out from its hinge, a sliding panel lies along the body, a butterfly door is up. */
  stands: LeafStands;
  /** The open leaf's bounds, car frame, right flank. */
  box: CarBox;
}

/** One door opening on a flank, side-relative (the right flank's numbers; the left flank's z is mirrored). */
export interface CabinAperture {
  /** 'door' when the flank has one opening, else 'front door' / 'rear door'. */
  name: string;
  /** The doors that open it (right-flank ids). Two sliding panels that part from one line make one opening. */
  doorIds: string[];
  kind: DoorKind;
  /** The clear opening along the car at mid body side, x0 (rear edge) < x1 (front edge). */
  x0: number;
  x1: number;
  /** Heights of the lower cut (the sill), the beltline and the upper cut at the opening's middle. */
  sill: number;
  belt: number;
  top: number;
  /** The flank's distance from the centre line at the opening: the body's half-width there. */
  z: number;
  /** The clear opening in side view, [x, y] round its edge. */
  outline: [number, number][];
}

export interface CabinSeat {
  /** Along the car: the seat's reference station. */
  x: number;
  /** Across the car: the seat's middle. */
  z: number;
  /** +1 faces the nose, -1 faces the tail. */
  facing: 1 | -1;
  width: number;
  /** Top of the cushion. */
  cushionTop: number;
  /** The cushion as a box (floor to its top), then the backrest in three leaning slabs, then the headrests. */
  cushion: CarBox;
  back: CarBox[];
  head: CarBox[];
}

/** Where a segment crosses the body side on a flank, and how far the wand's section stands inside the opening there. */
export interface ApertureCrossing { x: number; y: number; margin: number }

export interface CabinProfile {
  key: string;
  length: number;
  width: number;
  height: number;
  /** Top of the floor mat. */
  floorTop: number;
  /** The headliner over the cabin's middle, on the centre line. */
  headliner: number;
  /** The cabin along the car: nothing is cleaned ahead of x1 (the dash, or a rear-facing seat's back) or behind x0. */
  x0: number;
  x1: number;
  apertures: CabinAperture[];
  leaves: CabinLeaf[];
  seats: CabinSeat[];
  /** Fixed things in the cabin that are not seats (the steering wheel), counted on both flanks. */
  fixtures: CarBox[];
  /** The outer solid the robots keep their structure off: hull x full width, wheels, roof equipment (CarSolid). */
  solid: CarSolid;
  /** Every sensor and body-mounted mirror as a box, car frame. */
  equipment: CarBox[];

  /** Signed distance to the body's outer skin in the section at this station (negative inside), and where round it. */
  skin(p: Vec3): { sd: number; tt: number; xr: number };
  /**
   * Distance from a point OUTSIDE the body to its skin, where that skin is not an open doorway (Infinity in front of
   * one: the opening's own margin governs there).
   */
  outsideSkin(p: Vec3): number;
  /** How far a point is inside the cabin's free volume (positive inside). In an open doorway there is no side wall. */
  room(p: Vec3): number;
  /** Distance to the nearest seat part or cabin fixture (negative inside one). */
  seatClearance(p: Vec3): number;
  /** The headliner's height over (x, z). */
  ceilingAt(x: number, z: number): number;
  /** Distance to the vehicle's outside: its solid and its equipment (positive in clear air). */
  bodyClearance(p: Vec3): number;
  /** Distance to the nearest door leaf on either flank, open `open01` (1 by default). Capped at LEAF_FAR_M. */
  leafClearance(p: Vec3, open01?: number): number;
  /**
   * The same with each flank's doors at their own opening: the right flank's (+z) and the left flank's. A flank
   * whose doors are shut is not measured (a shut door is the body). Openings are read to the nearest 1 / LEAF_STEPS.
   */
  leafClearanceAt(p: Vec3, openRight: number, openLeft: number): number;
  /**
   * Distance to the nearest door leaf on either flank ANYWHERE IN ITS TRAVEL, shut to open (LEAF_STEPS positions): a
   * hinged leaf's free edge and a butterfly door pass nearer some things on the way than where they come to rest.
   */
  leafSweptClearance(p: Vec3): number;
  /**
   * Where the segment a -> b crosses the body side on `side` at the outer skin and at the door's inner face, and the
   * WORST margin of a round section of radius `r` inside aperture `index` there. Null when it does not cross.
   */
  crossing(a: Vec3, b: Vec3, side: 1 | -1, index: number, r: number): ApertureCrossing | null;
  /** Is this station and height inside aperture `index`, and by how much (metres, negative outside)? */
  openingMargin(x: number, y: number, index: number): number;
}

/** A door's travel is measured at this many positions, shut to open (a 65 degree swing in steps of 1.3 degrees). */
export const LEAF_STEPS = 50;

/** leafClearance never reports more than this: far from every leaf is all a caller needs to know. */
export const LEAF_FAR_M = 0.6;

const STATION_M = 0.02;
const TT_STEP = 0.25;
const N_TT = Math.round(K_TOP / TT_STEP) + 1;

interface Station { z: Float64Array; y: Float64Array; arc: Float64Array }

function boxDistance(p: Vec3, b: CarBox): number {
  const dx = Math.max(b.x0 - p.x, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, p.y - b.y1);
  const dz = Math.max(b.z0 - p.z, p.z - b.z1);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
  return outside > 0 ? outside : Math.max(dx, dy, dz);
}

const mirrorZ = (b: CarBox): CarBox => ({ ...b, z0: -b.z1, z1: -b.z0 });

/** A point cloud with a grid over it: the distance from a point to the nearest cloud point, capped. */
class Cloud {
  private cells = new Map<number, number[]>();
  private pts: number[] = [];
  readonly box: CarBox = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  constructor(private cell: number) {}
  private key(i: number, j: number, k: number): number { return (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512); }
  add(x: number, y: number, z: number): void {
    const n = this.pts.length / 3;
    this.pts.push(x, y, z);
    const c = this.cell;
    const k = this.key(Math.floor(x / c), Math.floor(y / c), Math.floor(z / c));
    const list = this.cells.get(k);
    if (list) list.push(n); else this.cells.set(k, [n]);
    const b = this.box;
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x);
    b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
    b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z);
  }
  get size(): number { return this.pts.length / 3; }
  /** Distance to the nearest point, or `far` when none is within it. */
  distance(p: Vec3, far: number): number {
    if (boxDistance(p, this.box) >= far) return far;
    const c = this.cell;
    const r = Math.ceil(far / c);
    const ci = Math.floor(p.x / c), cj = Math.floor(p.y / c), ck = Math.floor(p.z / c);
    let best = far * far;
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
      const list = this.cells.get(this.key(i, j, k));
      if (!list) continue;
      for (const n of list) {
        const dx = this.pts[3 * n] - p.x, dy = this.pts[3 * n + 1] - p.y, dz = this.pts[3 * n + 2] - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  }
}

/** Sample spacing of a door leaf's cloud, metres, and what that costs a measured distance (half a cell's diagonal). */
const LEAF_SAMPLE_M = 0.025;
export const LEAF_SLACK_M = 0.018;

interface Opening {
  doors: DoorSpec[];
  front: (tt: number) => number;
  rear: (tt: number) => number;
  ttLow: number;
  ttHigh: number;
}

/**
 * The door openings of one flank, front to rear, from the door specs. Two sliding panels that part from a shared line
 * make ONE opening, as wide as the panels leave clear; every other door is its own opening.
 */
function openingsOf(doors: DoorSpec[]): Opening[] {
  const at = (d: DoorSpec) => polyline(d.front)(4.2);
  const list = [...doors].sort((a, b) => at(a) - at(b));
  const out: Opening[] = [];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    const next = list[i + 1];
    const dFront = polyline(d.front), dRear = polyline(d.rear);
    const travel = (q: DoorSpec, f: (tt: number) => number, r: (tt: number) => number) => (tt: number) => q.travel ?? r(tt) - f(tt);
    if (d.kind === 'slide' && next && next.kind === 'slide' && (d.slideDir ?? -1) === 1 && (next.slideDir ?? -1) === -1) {
      // the front panel runs forward and the rear panel runs back: no pillar, one opening
      const nFront = polyline(next.front), nRear = polyline(next.rear);
      const tf = travel(d, dFront, dRear), tr = travel(next, nFront, nRear);
      out.push({
        doors: [d, next],
        front: (tt) => Math.max(dFront(tt), dRear(tt) - tf(tt)),
        rear: (tt) => Math.min(nRear(tt), nFront(tt) + tr(tt)),
        ttLow: Math.max(d.ttLow, next.ttLow), ttHigh: Math.min(d.ttHigh, next.ttHigh),
      });
      i++;
      continue;
    }
    if (d.kind === 'slide') {
      // one panel: it uncovers as much of its own opening as it travels
      const t = travel(d, dFront, dRear);
      const fwd = (d.slideDir ?? -1) === 1;
      out.push({
        doors: [d],
        front: (tt) => (fwd ? Math.max(dFront(tt), dRear(tt) - t(tt)) : dFront(tt)),
        rear: (tt) => (fwd ? dRear(tt) : Math.min(dRear(tt), dFront(tt) + t(tt))),
        ttLow: d.ttLow, ttHigh: d.ttHigh,
      });
      continue;
    }
    out.push({ doors: [d], front: dFront, rear: dRear, ttLow: d.ttLow, ttHigh: d.ttHigh });
  }
  // a pillar between two openings that share a cut line
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i], b = out[i + 1];
    const mid = (a.ttLow + a.ttHigh) / 2;
    if (Math.abs(a.rear(mid) - b.front(mid)) > 2 * PILLAR_HALF_M) continue;
    const ar = a.rear, bf = b.front;
    a.rear = (tt) => ar(tt) - PILLAR_HALF_M;
    b.front = (tt) => bf(tt) + PILLAR_HALF_M;
  }
  return out;
}

const cache = new Map<string, CabinProfile>();

/** The cabin of a fleet vehicle. Memoized by the spec's key: the profile carries the body's sampled sections. */
export function cabinProfile(spec: VehicleSpec): CabinProfile {
  const hit = cache.get(spec.key);
  if (hit) return hit;
  const made = makeProfile(spec);
  cache.set(spec.key, made);
  return made;
}

function makeProfile(spec: VehicleSpec): CabinProfile {
  const s: Surface = makeSurface(spec.curves);
  const L = s.length;
  const d = spec.dims;

  // ── the body's sections, sampled once ────────────────────────────────────────────────────────────────────────
  const nSt = Math.ceil(L / STATION_M) + 1;
  const stations: Station[] = [];
  for (let i = 0; i < nSt; i++) {
    const xr = Math.min(L, i * STATION_M);
    const z = new Float64Array(N_TT), y = new Float64Array(N_TT), arc = new Float64Array(N_TT);
    for (let k = 0; k < N_TT; k++) {
      const p = s.point(xr, Math.min(K_TOP, k * TT_STEP), 1);
      z[k] = Math.max(0, p[2]); y[k] = p[1];
      arc[k] = k === 0 ? 0 : arc[k - 1] + Math.hypot(z[k] - z[k - 1], y[k] - y[k - 1]);
    }
    stations.push({ z, y, arc });
  }

  /** Signed distance in one station's section, and the ring parameter of the nearest skin point. */
  function inSection(st: Station, az: number, y: number): { sd: number; tt: number } {
    let best = Infinity, tt = 0, crossings = 0;
    for (let k = 0; k + 1 < N_TT; k++) {
      const az0 = st.z[k], ay0 = st.y[k], ez = st.z[k + 1] - az0, ey = st.y[k + 1] - ay0;
      const wz = az - az0, wy = y - ay0;
      const t = Math.max(0, Math.min(1, (wz * ez + wy * ey) / (ez * ez + ey * ey || 1)));
      const dz = wz - ez * t, dy = wy - ey * t;
      const dd = dz * dz + dy * dy;
      if (dd < best) { best = dd; tt = (k + t) * TT_STEP; }
      // a ray toward +z from the point: the left half of the ring is never on it
      if ((ay0 > y) !== (ay0 + ey > y) && az < az0 + (ez * (y - ay0)) / ey) crossings++;
    }
    return { sd: (crossings % 2 === 1 ? -1 : 1) * Math.sqrt(best), tt };
  }

  function skin(p: Vec3): { sd: number; tt: number; xr: number } {
    const xr = L / 2 - p.x;
    const az = Math.abs(p.z);
    if (xr <= 0 || xr >= L) {
      const out = xr <= 0 ? -xr : xr - L;
      const e = inSection(stations[xr <= 0 ? 0 : nSt - 1], az, p.y);
      return { sd: Math.hypot(out, Math.max(e.sd, 0)) || 1e-9, tt: e.tt, xr };
    }
    const f = xr / STATION_M;
    const i = Math.min(nSt - 2, Math.floor(f));
    const u = f - i;
    const a = inSection(stations[i], az, p.y), b = inSection(stations[i + 1], az, p.y);
    return { sd: a.sd + (b.sd - a.sd) * u, tt: u < 0.5 ? a.tt : b.tt, xr };
  }

  /** The skin's height on the body side at a station and ring parameter, and its arc length round the section. */
  function sideAt(xr: number, tt: number): { y: number; z: number; arc: number } {
    const i = Math.max(0, Math.min(nSt - 1, Math.round(xr / STATION_M)));
    const st = stations[i];
    const f = Math.max(0, Math.min(N_TT - 1.000001, tt / TT_STEP));
    const k = Math.floor(f), u = f - k;
    return {
      y: st.y[k] + (st.y[k + 1] - st.y[k]) * u, z: st.z[k] + (st.z[k + 1] - st.z[k]) * u,
      arc: st.arc[k] + (st.arc[k + 1] - st.arc[k]) * u,
    };
  }
  /** The ring parameter on the body side at a height (the side is monotone in y between the sill and the roof rail). */
  function ttAt(xr: number, y: number): number {
    let lo = 1.5, hi = 9.5;
    for (let n = 0; n < 24; n++) { const m = (lo + hi) / 2; if (sideAt(xr, m).y < y) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  // ── doors, openings, leaves ──────────────────────────────────────────────────────────────────────────────────
  const allDoors = spec.doors(s);
  const right = allDoors.filter((q) => q.side === 1);
  const openings = openingsOf(right);
  const wheels = [d.frontAxle, d.frontAxle + d.wheelbase].map((xr) => ({ xr, y: d.tyreRadius, r: spec.archRadius + 0.03 }));

  /** Metres inside opening `index` at a skin point (negative outside it). */
  function marginAt(index: number, xr: number, tt: number): number {
    const o = openings[index];
    const here = sideAt(xr, tt);
    let m = Math.min(xr - o.front(tt), o.rear(tt) - xr, here.arc - sideAt(xr, o.ttLow).arc, sideAt(xr, o.ttHigh).arc - here.arc);
    for (const w of wheels) m = Math.min(m, Math.hypot(xr - w.xr, here.y - w.y) - w.r);
    return m;
  }
  const openingMargin = (x: number, y: number, index: number): number => {
    const xr = L / 2 - x;
    return marginAt(index, xr, ttAt(xr, y));
  };

  const apertures: CabinAperture[] = openings.map((o, i) => {
    const ttMid = 4.2;
    const xf = o.front(ttMid), xb = o.rear(ttMid);
    const xm = (xf + xb) / 2;
    const outline: [number, number][] = [];
    const steps = 16;
    for (let k = 0; k <= steps; k++) { const tt = o.ttLow + ((o.ttHigh - o.ttLow) * k) / steps; outline.push([L / 2 - o.front(tt), sideAt(o.front(tt), tt).y]); }
    for (let k = steps; k >= 0; k--) { const tt = o.ttLow + ((o.ttHigh - o.ttLow) * k) / steps; outline.push([L / 2 - o.rear(tt), sideAt(o.rear(tt), tt).y]); }
    let z = 0;
    for (let xr = xf; xr <= xb; xr += 0.05) z = Math.max(z, s.at(xr).hw);
    return {
      name: openings.length === 1 ? 'door' : i === 0 ? 'front door' : i === openings.length - 1 ? 'rear door' : `door ${i + 1}`,
      doorIds: o.doors.map((q) => q.id), kind: o.doors[0].kind,
      x0: L / 2 - xb, x1: L / 2 - xf,
      sill: sideAt(xm, o.ttLow).y, belt: sideAt(xm, K_BELT).y, top: sideAt(xm, o.ttHigh).y, z, outline,
    };
  });

  // every door's leaf as a cloud of its outer skin and its inner trim, at the pose its rig gives it
  const rigs = new Map<string, DoorRig>(right.map((q) => [q.id, doorRigOf(q, s)]));
  const mirrorHost = spec.mirrors
    ? right.find((q) => polyline(q.front)(K_BELT) <= spec.mirrors!.xr && spec.mirrors!.xr <= polyline(q.rear)(K_BELT))
    : undefined;
  /** A door's shut skin, sampled: [outer point, inner point] pairs in the model frame. */
  const shut = new Map<string, number[]>();
  for (const q of right) {
    const front = polyline(q.front), rear = polyline(q.rear);
    const pts: number[] = [];
    const ttN = Math.ceil((q.ttHigh - q.ttLow) / 0.08);
    for (let j = 0; j <= ttN; j++) {
      const tt = q.ttLow + ((q.ttHigh - q.ttLow) * j) / ttN;
      const xf = front(tt), xb = rear(tt);
      const xN = Math.max(1, Math.ceil((xb - xf) / LEAF_SAMPLE_M));
      for (let i = 0; i <= xN; i++) {
        const xr = xf + ((xb - xf) * i) / xN;
        const p = s.point(xr, tt, 1);
        if (wheels.some((w) => Math.hypot(xr - w.xr, p[1] - w.y) < w.r - 0.03)) continue;
        const n = s.normalAt(xr, tt, 1);
        pts.push(p[0], p[1], p[2], p[0] - n[0] * DOOR_THICKNESS_M, p[1] - n[1] * DOOR_THICKNESS_M, p[2] - n[2] * DOOR_THICKNESS_M);
      }
    }
    if (mirrorHost === q && spec.mirrors) {
      // the door mirror rides on its door: its head as a block of points (build.ts section 7)
      const m = s.point(spec.mirrors.xr, K_BELT + 0.25, 1);
      const c = [m[0] - 0.01, spec.mirrors.y + 0.03, m[2] + 0.17];
      const h = [0.05, 0.065, 0.1];
      for (let i = -2; i <= 2; i++) for (let j = -3; j <= 3; j++) for (let k = -4; k <= 4; k++) {
        pts.push(c[0] + (h[0] * i) / 2, c[1] + (h[1] * j) / 3, c[2] + (h[2] * k) / 4);
      }
    }
    shut.set(q.id, pts);
  }
  const leafClouds = new Map<number, Cloud[]>();
  function cloudsAt(open01: number): Cloud[] {
    const key = Math.round(open01 * 1000);
    const hit = leafClouds.get(key);
    if (hit) return hit;
    const made: Cloud[] = [];
    for (const q of right) {
      const rig = rigs.get(q.id)!;
      const c = new Cloud(0.15);
      const pts = shut.get(q.id)!;
      for (let i = 0; i < pts.length; i += 3) {
        const p = doorPointAt(rig, open01, [pts[i], pts[i + 1], pts[i + 2]]);
        c.add(p[0], p[1], p[2]);
      }
      made.push(c);
    }
    leafClouds.set(key, made);
    return made;
  }
  function leafClearance(p: Vec3, open01 = 1): number {
    const q = p.z >= 0 ? p : { x: p.x, y: p.y, z: -p.z };
    let best = LEAF_FAR_M;
    for (const c of cloudsAt(open01)) best = Math.min(best, c.distance(q, LEAF_FAR_M));
    return best >= LEAF_FAR_M ? LEAF_FAR_M : best - LEAF_SLACK_M;
  }
  const stepOf = (open01: number) => Math.round(Math.min(1, Math.max(0, open01)) * LEAF_STEPS) / LEAF_STEPS;
  function leafClearanceAt(p: Vec3, openRight: number, openLeft: number): number {
    let best = LEAF_FAR_M;
    const r = stepOf(openRight), l = stepOf(openLeft);
    if (openRight > 0) for (const c of cloudsAt(Math.max(r, 1 / LEAF_STEPS))) best = Math.min(best, c.distance(p, LEAF_FAR_M));
    const q = { x: p.x, y: p.y, z: -p.z };
    if (openLeft > 0) for (const c of cloudsAt(Math.max(l, 1 / LEAF_STEPS))) best = Math.min(best, c.distance(q, LEAF_FAR_M));
    return best >= LEAF_FAR_M ? LEAF_FAR_M : best - LEAF_SLACK_M;
  }
  function leafSweptClearance(p: Vec3): number {
    const q = p.z >= 0 ? p : { x: p.x, y: p.y, z: -p.z };
    let best = LEAF_FAR_M;
    for (let k = 1; k <= LEAF_STEPS; k++) for (const c of cloudsAt(k / LEAF_STEPS)) best = Math.min(best, c.distance(q, LEAF_FAR_M));
    return best >= LEAF_FAR_M ? LEAF_FAR_M : best - LEAF_SLACK_M;
  }
  const stands = (k: DoorKind): LeafStands => (k === 'hinge' ? 'out' : k === 'slide' ? 'along' : 'up');
  const leaves: CabinLeaf[] = right.map((q, i) => ({ id: q.id, kind: q.kind, stands: stands(q.kind), box: { ...cloudsAt(1)[i].box } }));

  // ── the cabin: floor, seats, dash, steering wheel (build.ts section 6) ───────────────────────────────────────
  const floorY = s.at(L / 2).yb + 0.11;
  const floorTop = floorY + FLOOR_HALF_M;
  const y0 = floorY + 0.3;
  const seats: CabinSeat[] = spec.seats.map((st) => {
    const w = st.width ?? 0.5;
    const sx = L / 2 - st.xr;
    const span = (a: number, b: number): [number, number] => {
      const p = sx + st.facing * a, q = sx + st.facing * b;
      return [Math.min(p, q), Math.max(p, q)];
    };
    const box = (lx0: number, lx1: number, ya: number, yb: number, z0: number, z1: number): CarBox => {
      const [x0, x1] = span(lx0, lx1);
      return { x0, x1, y0: ya, y1: yb, z0, z1 };
    };
    // the backrest: a 0.13 x 0.62 m slab leaning 0.2 rad, as three boxes that follow the lean
    const front = (y: number) => -0.1763 - 0.2028 * (y - 0.0329);
    const rear = (y: number) => -0.3037 - 0.2028 * (y - 0.0071);
    const cuts = [0, 0.22, 0.43, 0.642];
    const back: CarBox[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) back.push(box(rear(cuts[i + 1]), front(cuts[i]), y0 + cuts[i], y0 + cuts[i + 1], st.z - w / 2, st.z + w / 2));
    const n = Math.max(1, Math.round(w / 0.5));
    const head: CarBox[] = [];
    for (let i = 0; i < n; i++) {
      const hz = st.z + st.facing * (i - (n - 1) / 2) * (w / n);
      head.push(box(-0.44, -0.34, y0 + 0.63, y0 + 0.81, hz - 0.13, hz + 0.13));
    }
    return {
      x: sx, z: st.z, facing: st.facing, width: w, cushionTop: y0 + 0.065,
      cushion: box(-0.23, 0.27, floorTop, y0 + 0.065, st.z - w / 2, st.z + w / 2), back, head,
    };
  });
  const forward = spec.seats.filter((q) => q.facing > 0);
  const hasDash = forward.length > 0 && spec.seats.every((q) => q.facing > 0);
  const fixtures: CarBox[] = [];
  let x1 = Infinity;
  if (hasDash) {
    const dashXr = Math.min(...forward.map((q) => q.xr)) - 0.72;
    x1 = L / 2 - (dashXr + 0.17);
    if (spec.steeringWheel) {
      // a 0.18 m wheel tilted 0.4 rad on the left; taken on both flanks so one program serves both
      const st = s.at(dashXr);
      const c = { x: L / 2 - dashXr - 0.3, y: st.belt - 0.06 };
      const b: CarBox = { x0: c.x - 0.1, x1: c.x + 0.1, y0: c.y - 0.2, y1: c.y + 0.2, z0: -0.37 - 0.2, z1: -0.37 + 0.2 };
      fixtures.push(b, mirrorZ(b));
    }
  }
  // the cabin ends at the far face of the backrest that closes each end
  const x0 = Math.min(...seats.filter((q) => q.facing > 0).flatMap((q) => [...q.back, ...q.head].map((b) => b.x0)));
  const cabinX0 = Number.isFinite(x0) ? x0 : -L / 2;
  const cabinX1 = Number.isFinite(x1) ? x1 : L / 2;

  const seatBoxes: CarBox[] = [...seats.flatMap((q) => [q.cushion, ...q.back, ...q.head]), ...fixtures];
  const seatClearance = (p: Vec3): number => {
    let best = Infinity;
    for (const b of seatBoxes) best = Math.min(best, boxDistance(p, b));
    return best;
  };

  /** Is the skin point nearest to a section point inside an open doorway? */
  function inDoorway(e: { tt: number; xr: number }): boolean {
    for (const o of openings) {
      if (e.tt >= o.ttLow && e.tt <= o.ttHigh && e.xr >= o.front(e.tt) && e.xr <= o.rear(e.tt)) return true;
    }
    return false;
  }
  function room(p: Vec3): number {
    const e = skin(p);
    if (e.sd >= 0) return -e.sd; // outside the body: no room at all
    // in an open doorway there is no side wall: the aperture's own margin governs the wand there
    const wall = inDoorway(e) ? Infinity : -e.sd - CABIN_LINER_M;
    return Math.min(wall, p.y - floorTop, p.x - cabinX0, cabinX1 - p.x);
  }
  function outsideSkin(p: Vec3): number {
    const e = skin(p);
    return inDoorway(e) ? Infinity : e.sd;
  }

  function ceilingAt(x: number, z: number): number {
    const xr = L / 2 - x;
    let lo = floorTop, hi = s.at(xr).yt;
    for (let n = 0; n < 24; n++) {
      const m = (lo + hi) / 2;
      if (-skin({ x, y: m, z }).sd - CABIN_LINER_M > 0) lo = m; else hi = m;
    }
    return lo;
  }

  // ── the outside ──────────────────────────────────────────────────────────────────────────────────────────────
  const solid = fleetCarSolidInCarFrame(spec);
  const equipment: CarBox[] = [];
  for (const q of spec.sensors) {
    let c: [number, number, number];
    if (q.pos) c = [L / 2 - q.pos[0], q.pos[1], q.pos[2]];
    else if (q.on) {
      const side = q.on.side === 0 ? 1 : q.on.side;
      const p = s.point(q.on.xr, q.on.tt, side);
      const n = s.normalAt(q.on.xr, q.on.tt, side);
      const lift = q.on.lift ?? 0;
      c = [p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift];
    } else continue;
    // each shape as build.ts draws it, as the box round it
    const sz = q.size ?? [];
    let hx: number, hz: number, y0: number, y1: number;
    if (q.shape === 'spinLidar' || q.shape === 'dome') {
      // an upright cylinder or a dome standing ON its mark: [radius, height]
      const r = (sz[0] ?? (q.shape === 'dome' ? 0.3 : 0.08)) * 1.15, h = sz[1] ?? (q.shape === 'dome' ? 0.14 : 0.12);
      hx = hz = r; y0 = c[1]; y1 = c[1] + h;
    } else if (q.shape === 'puckLidar' || q.shape === 'camera') {
      // a short cylinder lying along the way it looks: [radius, length]. Its yaw is not read: its length both ways.
      const r = (sz[0] ?? 0.05) * 1.15, len = sz[1] ?? 0.07;
      hx = hz = Math.max(r, len); y0 = c[1] - r; y1 = c[1] + r;
    } else {
      // a box centred on its mark: [length, height, width]. Square to the car it keeps its length and width (a
      // quarter turn swaps them); at any other yaw its plan extent is its larger side both ways.
      const l = sz[0] ?? 0.1, h = sz[1] ?? 0.08, w = sz[2] ?? 0.12;
      const yaw = Math.abs(q.yawDeg ?? 0) % 180;
      const square = yaw < 1 || yaw > 179, quarter = Math.abs(yaw - 90) < 1;
      const big = Math.max(l, w) / 2;
      hx = square ? l / 2 : quarter ? w / 2 : big;
      hz = square ? w / 2 : quarter ? l / 2 : big;
      y0 = c[1] - h / 2; y1 = c[1] + h / 2;
    }
    equipment.push({ x0: c[0] - hx, x1: c[0] + hx, y0, y1, z0: c[2] - hz, z1: c[2] + hz });
  }
  if (spec.mirrors && !mirrorHost) {
    for (const side of [1, -1] as const) {
      const m = s.point(spec.mirrors.xr, K_BELT + 0.25, side);
      equipment.push({ x0: m[0] - 0.07, x1: m[0] + 0.05, y0: spec.mirrors.y - 0.04, y1: spec.mirrors.y + 0.1, z0: Math.min(m[2], m[2] + side * 0.28), z1: Math.max(m[2], m[2] + side * 0.28) });
    }
  }
  const bodyClearance = (p: Vec3): number => {
    let best = clearanceToCar(p, solid);
    for (const b of equipment) best = Math.min(best, boxDistance(p, b));
    return best;
  };

  function crossing(a: Vec3, b: Vec3, side: 1 | -1, index: number, r: number): ApertureCrossing | null {
    const A = side > 0 ? a : { x: a.x, y: a.y, z: -a.z };
    const B = side > 0 ? b : { x: b.x, y: b.y, z: -b.z };
    const at = (t: number): Vec3 => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, z: A.z + (B.z - A.z) * t });
    const len = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) || 1e-9;
    const u = { x: (B.x - A.x) / len, y: (B.y - A.y) / len, z: (B.z - A.z) / len };
    const cosN = Math.max(Math.abs(u.z), 1e-6);
    const rx = (r * Math.sqrt(Math.max(0, 1 - u.y * u.y))) / cosN;
    const ry = (r * Math.sqrt(Math.max(0, 1 - u.x * u.x))) / cosN;
    let worst: ApertureCrossing | null = null;
    // the outer skin, half way through the door's thickness, and its inner face
    for (const level of [0, -DOOR_THICKNESS_M / 2, -DOOR_THICKNESS_M]) {
      const N = 40;
      let prev = skin(at(0)).sd - level;
      for (let i = 1; i <= N; i++) {
        const cur = skin(at(i / N)).sd - level;
        if (prev > 0 && cur <= 0) {
          let lo = (i - 1) / N, hi = i / N;
          for (let n = 0; n < 18; n++) { const m = (lo + hi) / 2; if (skin(at(m)).sd - level > 0) lo = m; else hi = m; }
          const p = at((lo + hi) / 2);
          const e = skin(p);
          const o = openings[index];
          const here = sideAt(e.xr, e.tt);
          let margin = Math.min(
            e.xr - rx - o.front(e.tt), o.rear(e.tt) - (e.xr + rx),
            here.arc - ry - sideAt(e.xr, o.ttLow).arc, sideAt(e.xr, o.ttHigh).arc - (here.arc + ry),
          );
          for (const w of wheels) margin = Math.min(margin, Math.hypot(e.xr - w.xr, here.y - w.y) - w.r - Math.max(rx, ry));
          if (!worst || margin < worst.margin) worst = { x: p.x, y: p.y, margin };
          break;
        }
        prev = cur;
      }
    }
    return worst;
  }

  const mid = (cabinX0 + cabinX1) / 2;
  return {
    key: spec.key, length: L, width: d.width, height: d.height,
    floorTop, headliner: ceilingAt(mid, 0), x0: cabinX0, x1: cabinX1,
    apertures, leaves, seats, fixtures, solid, equipment,
    skin, outsideSkin, room, seatClearance, ceilingAt, bodyClearance, leafClearance, leafClearanceAt, leafSweptClearance, crossing, openingMargin,
  };
}
