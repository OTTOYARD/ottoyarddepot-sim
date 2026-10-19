/**
 * Clearance of the OTTO-CLEAN ARM against everything it works beside, metres.
 *
 * Pure geometry over cleanArmPose's points. The arm's links are modelled as
 * CAPSULES (segments with a radius), each sampled along its length against analytic
 * solids: the car (vehicleEnvelope's convex silhouette x full-width slab, with the
 * wheels and the roof pod), the two open doors, the cabin's free volume and seats,
 * and the aperture the wand must pass through. The tests sweep the whole cycle
 * through these; the sandbox HUD prints the same numbers.
 *
 * WHAT MAY BE INSIDE THE CAR: only the part of the wand past the aperture plane, and
 * the nozzle. Everything else — the column, the SCARA, the mast, the wrist, the wand
 * up to the door — is measured against the WHOLE car solid, cabin included, so the
 * margin there means "outside the car", full stop.
 */

import {
  carSolidInArmFrame, clearanceToCar, clearanceToDoor, CABIN_VOID, DOOR, seatBoxes, tumblehomeScale,
  GLASS_PROUD_M, SIDE_PANEL_M, BODY_BEVEL_M, type CarBox,
} from '@/lib/ottoChargeArm/vehicleEnvelope';
import { CLEAN_ARM, FLANK_PAINT_Z } from './cleanArmSpec';
import type { CleanArmPoints, Vec3 } from './cleanArmPose';

/** The car solid, in the CAR frame: carSolidInArmFrame with the arm base on the centreline at grade. */
const CAR = carSolidInArmFrame(0, 0);

/** Signed distance from a car-frame point to the parked car (positive = clear air). */
export function carClearance(p: Vec3): number {
  // carSolidInArmFrame(0, 0) puts the car's centreline at arm-frame z = 0 and grade at y = 0,
  // with x along the car: exactly the car frame.
  return clearanceToCar(p, CAR);
}

export interface Capsule { a: Vec3; b: Vec3; r: number; name: string }

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);

/** The arm's rigid bodies as capsules, OUTSIDE-the-car parts first. Radii are each body's half-diagonal. */
export function cleanArmCapsules(pt: CleanArmPoints, columnTopY: number): { outside: Capsule[]; wand: Capsule; nozzle: Capsule[] } {
  const A = CLEAN_ARM;
  const half = (w: number, h: number) => Math.hypot(w, h) / 2;
  const sec = A.mast.sections;
  const y2 = pt.mastTop.y;
  const outerTop = { ...pt.mastTop, y: y2 + A.mast.outerAbove };
  const outerBot = { ...pt.mastTop, y: y2 - A.mast.outerBelow };
  const outside: Capsule[] = [
    { name: 'column', a: { ...pt.j1, y: columnTopY }, b: { ...pt.j1, y: pt.j1.y + A.j1.h / 2 }, r: (A.column.w * Math.SQRT2) / 2 },
    { name: 'J1', a: { ...pt.j1, y: pt.j1.y - A.j1.h / 2 }, b: { ...pt.j1, y: pt.j1.y + A.j1.h / 2 }, r: A.j1.r },
    { name: 'link 1', a: pt.j1, b: pt.elbow, r: half(A.link1.w, A.link1.h) },
    { name: 'J2', a: { ...pt.elbow, y: pt.elbow.y - A.j2.h }, b: { ...pt.elbow, y: pt.elbow.y + 0.02 }, r: A.j2.r },
    { name: 'link 2', a: { ...pt.elbow, y: y2 }, b: pt.mastTop, r: half(A.link2.w, A.link2.h) },
    { name: 'mast, outer', a: outerTop, b: outerBot, r: (sec[0] * Math.SQRT2) / 2 },
    { name: 'mast', a: outerBot, b: pt.foot, r: (sec[1] * Math.SQRT2) / 2 },
    { name: 'wrist', a: pt.foot, b: pt.pivot, r: A.wrist.r * 1.25 },
  ];
  // The nozzle head is flat: 0.15 m wide across the wand's pitch axis, 0.05 m thick.
  // Modelled as its two edges, each a capsule of its half-thickness, and its mouth (the
  // tip) — which may come close to the surface it cleans, never into it.
  const across = { x: -Math.sin(Math.atan2(pt.n.z, pt.n.x)), y: 0, z: Math.cos(Math.atan2(pt.n.z, pt.n.x)) };
  const w2 = A.nozzle.w / 2 - A.nozzle.h / 2;
  const edge = (sgn: number): Capsule => ({
    name: 'nozzle edge', r: A.nozzle.h / 2,
    a: add(pt.knuckle, mul(across, sgn * w2 * 0.5)), b: add(pt.tip, mul(across, sgn * w2)),
  });
  return {
    outside,
    wand: { name: 'wand', a: pt.pivot, b: pt.knuckle, r: A.wand.r },
    nozzle: [edge(1), edge(-1)],
  };
}

/** Minimum over a capsule (sampled every `step` metres) of f(point) - radius. */
export function capsuleMin(c: Capsule, f: (p: Vec3) => number, step = 0.02): number {
  const d = sub(c.b, c.a);
  const L = len(d);
  const n = Math.max(1, Math.ceil(L / step));
  let best = Infinity;
  for (let i = 0; i <= n; i++) best = Math.min(best, f(add(c.a, mul(d, i / n))) - c.r);
  return best;
}

/** Signed distance to an axis-aligned box (car frame). Negative inside. */
export function boxDistance(p: Vec3, b: CarBox): number {
  const dx = Math.max(b.x0 - p.x, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, p.y - b.y1);
  const dz = Math.max(b.z0 - p.z, p.z - b.z1);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
  return outside > 0 ? outside : Math.max(dx, dy, dz);
}

/**
 * How far a point is INSIDE the cabin's free volume (positive = inside, with that much
 * room). The side walls are the flank panels; where the point is in line with a door
 * aperture there is no side wall (the door is open), and apertureMargin governs the
 * wand's passage there instead.
 */
export function cabinRoom(p: Vec3): number {
  const v = CABIN_VOID;
  const hw = v.halfWidth * tumblehomeScale(p.y);
  const inDoorway = p.x > DOOR.alongMin && p.x < DOOR.alongMax && p.y > v.floor && p.y < v.ceiling;
  const lateral = inDoorway ? Infinity : hw - Math.abs(p.z);
  return Math.min(p.x - v.alongMin, v.alongMax - p.x, p.y - v.floor, v.ceiling - p.y, lateral);
}

const SEATS = seatBoxes();
/** Distance from a point to the nearest seat part (negative inside one). */
export function seatClearance(p: Vec3): number {
  let best = Infinity;
  for (const b of SEATS) best = Math.min(best, boxDistance(p, b));
  return best;
}

/** The floor mat's top (the floor the nozzle skims). */
export const FLOOR_TOP = CABIN_VOID.floor + 0.012;

/**
 * Where the wand's axis crosses the aperture plane on `side`, and how far the wand's
 * SECTION stands inside the aperture there (its footprint on the plane is the radius
 * over the cosine of its angle to the plane's normal). Null when the wand does not
 * reach the plane.
 */
export function apertureMargin(pt: CleanArmPoints, side: 1 | -1): { x: number; y: number; margin: number } | null {
  // The opening is a prism through the body side: from the glass face (the car's full
  // width) in to the flank panels' inner face, where the cabin's tunnel is a bevel
  // narrower top and bottom. An oblique wand crosses each plane at a different point,
  // so it is measured at the outer, middle and inner planes.
  const outer = FLANK_PAINT_Z + GLASS_PROUD_M, inner = FLANK_PAINT_Z - SIDE_PANEL_M;
  const planes: { z: number; y0: number; y1: number }[] = [
    { z: outer, y0: DOOR.sill, y1: DOOR.top },
    { z: FLANK_PAINT_Z, y0: DOOR.sill, y1: DOOR.top },
    { z: inner, y0: DOOR.sill + BODY_BEVEL_M, y1: DOOR.top - BODY_BEVEL_M },
  ];
  const a = pt.pivot, b = pt.tip;
  const cosN = Math.abs(pt.u.z) || 1e-6; // the wand's angle to the planes' normal (z)
  const r = CLEAN_ARM.wand.r;
  // the wand section's footprint on a plane: half-extent along x and along y
  const rx = r * Math.sqrt(1 - pt.u.y * pt.u.y) / cosN;
  const ry = r * Math.sqrt(1 - pt.u.x * pt.u.x) / cosN;
  let worst: { x: number; y: number; margin: number } | null = null;
  for (const pl of planes) {
    const zPlane = side * pl.z;
    if ((a.z - zPlane) * (b.z - zPlane) > 0) continue; // the wand does not reach this plane
    const t = (zPlane - a.z) / (b.z - a.z);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const margin = Math.min(x - rx - DOOR.alongMin, DOOR.alongMax - (x + rx), y - ry - pl.y0, pl.y1 - (y + ry));
    if (!worst || margin < worst.margin) worst = { x, y, margin };
  }
  return worst;
}

/** Clearance of a capsule from both doors standing open `open01`. */
export function doorsClearance(c: Capsule, open01: number): number {
  return Math.min(
    capsuleMin(c, (p) => clearanceToDoor(p, 1, open01)),
    capsuleMin(c, (p) => clearanceToDoor(p, -1, open01)),
  );
}
