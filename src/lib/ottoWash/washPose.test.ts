/**
 * The wash machine against the car it works on, measured against the solid the car mesh is
 * built from (vehicleEnvelope.ts), at every moment of both programs and of every early end:
 *   · nothing rigid touches the car, and a brush presses in no deeper than its bristles give;
 *   · the air knives keep their gap; the wands enter the car only through an open door, into
 *     the cabin's free space, clear of the seats;
 *   · nothing touches an open door;
 *   · retracted, the machine clears a car driving under it, roof pod and all.
 */
import { describe, it, expect } from 'vitest';
import {
  carSolidInArmFrame, clearanceToCar, clearanceToDoor, CABIN_VOID, DOOR, seatBoxes,
} from '@/lib/ottoChargeArm/vehicleEnvelope';
import { METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { advanceWashSession, IDLE_WASH, type WashSession } from './washSession';
import { washPoseAt, type WashPose } from './washPose';
import { WASH_GANTRY as G, WASH_TRAVEL, washChain } from './washSpec';
import { CAR_HALF_LEN_U, CAR_HALF_WIDTH_U, CAR_TOP_U, carTopU } from './carShape';

const M = METRES_PER_PLAN_UNIT;
const CAR = carSolidInArmFrame(0, 0);

/** A bay-frame point (plan u) in the car frame (metres): the car faces north, its right flank is east (+x). */
const toCar = (x: number, dy: number, y: number) => ({ x: -dy * M, y: y * M, z: x * M });
/**
 * Clearance from a bay-frame point to the car, plan u (negative inside). A point well outside
 * the car's bounding box returns its distance to that box: a lower bound, and far clear.
 */
function carGap(x: number, dy: number, y: number): number {
  const far = Math.max(Math.abs(x) - CAR_HALF_WIDTH_U, Math.abs(dy) - CAR_HALF_LEN_U, y - CAR_TOP_U);
  if (far > 1.5) return far;
  return clearanceToCar(toCar(x, dy, y), CAR) / M;
}
/** The box every door stays inside at any opening, bay frame: either flank, out to its swing, hinge to rear edge. */
const DOOR_BOX = {
  x0: CAR_HALF_WIDTH_U - 0.2, x1: (CAR_HALF_WIDTH_U * M + DOOR.hingeOut + (DOOR.alongMax - DOOR.alongMin)) / M + 0.2,
  dy0: -DOOR.alongMax / M - 0.2, dy1: -DOOR.alongMin / M + 0.2, y0: DOOR.sill / M - 0.2, y1: DOOR.top / M + 0.2,
};
/** Clearance from a bay-frame point to the nearer door, open `f`, plan u (a lower bound when far from both). */
function doorGap(x: number, dy: number, y: number, f: number): number {
  const ax = Math.abs(x);
  const far = Math.max(DOOR_BOX.x0 - ax, ax - DOOR_BOX.x1, DOOR_BOX.dy0 - dy, dy - DOOR_BOX.dy1, DOOR_BOX.y0 - y, y - DOOR_BOX.y1);
  if (far > 1.0) return far;
  return Math.min(clearanceToDoor(toCar(x, dy, y), 1, f), clearanceToDoor(toCar(x, dy, y), -1, f)) / M;
}

/** The poses of a program, stepped a frame at a time and kept every `keep` sim seconds, and of an early end of it. */
function poses(interior: boolean, seat: number, endAt?: number, keep = 0.5): { s: WashSession; p: WashPose }[] {
  const out: { s: WashSession; p: WashPose }[] = [];
  let s = IDLE_WASH;
  let next = 0;
  for (let t = 0; t < seat + 60; t += 0.1) {
    const on = endAt === undefined ? t < seat : t < endAt;
    s = advanceWashSession(s, { dt: 0.1, vehicleId: 'car', active: on, interior, endsInS: on ? seat - t : null });
    if (t >= next) { out.push({ s, p: washPoseAt(s) }); next = t + keep; }
  }
  return out;
}

const ALL: { s: WashSession; p: WashPose }[] = [
  ...poses(false, 300),
  ...poses(true, 990),
  // ended early, mid-pass, mid-vacuum and mid-travel
  ...poses(false, 300, 120), ...poses(true, 990, 300), ...poses(true, 990, 8), ...poses(true, 990, 900),
];

/** Sample points on a vertical cylinder's surface (axis at x, dy; heights y0..y1), radius r. */
function cylinderPoints(x: number, dy: number, y0: number, y1: number, r: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    for (let j = 0; j <= 8; j++) out.push([x + r * Math.cos(a), dy + r * Math.sin(a), y0 + ((y1 - y0) * j) / 8]);
  }
  return out;
}

/** Sample points on a horizontal cylinder along x (from x0 to x1) at (dy, y), radius r. */
function hCylinderPoints(x0: number, x1: number, dy: number, y: number, r: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    for (let j = 0; j <= 10; j++) out.push([x0 + ((x1 - x0) * j) / 10, dy + r * Math.cos(a), y + r * Math.sin(a)]);
  }
  return out;
}

/** Sample points on a box's surface (bay frame). */
function boxPoints(x0: number, x1: number, dy0: number, dy1: number, y0: number, y1: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = 4;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) {
    if (i !== 0 && i !== n && j !== 0 && j !== n && k !== 0 && k !== n) continue;
    out.push([x0 + ((x1 - x0) * i) / n, dy0 + ((dy1 - dy0) * j) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}

/** The parts that never come near the car or its doors, in the bay frame, for the machine at `dy`. */
function frameParts(dy: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (const side of [-1, 1]) {
    pts.push(...boxPoints(side * G.legX - G.leg.w / 2, side * G.legX + G.leg.w / 2,
      dy + G.leg.dy - G.leg.d / 2, dy + G.leg.dy + G.leg.d / 2, 0, G.leg.top));
    pts.push(...cylinderPoints(side * G.arch.x, dy + G.arch.dy, 0.3, G.arch.top, G.arch.r));
  }
  pts.push(...boxPoints(-G.legX, G.legX, dy + G.beam.dy0, dy + G.beam.dy1, G.beam.y0, G.beam.y1));
  return pts;
}

/** The moving parts, in the bay frame, for one pose: each with its allowed penetration into the car, plan u. */
function movingParts(p: WashPose): { name: string; pts: [number, number, number][]; squash: number }[] {
  const out: { name: string; pts: [number, number, number][]; squash: number }[] = [];
  for (const side of [-1, 1]) {
    out.push({ name: 'side brush', squash: G.sideBrush.squash,
      pts: cylinderPoints(side * p.sideBrushX, p.dy + G.sideBrush.dy, G.sideBrush.y0, G.sideBrush.y1, G.sideBrush.r) });
    out.push({ name: 'side air knife', squash: 0,
      pts: boxPoints(side * (p.dryerSideX + G.dryer.side.w / 2) - G.dryer.side.w / 2, side * (p.dryerSideX + G.dryer.side.w / 2) + G.dryer.side.w / 2,
        p.dy + G.dryer.dy - G.dryer.side.d / 2, p.dy + G.dryer.dy + G.dryer.side.d / 2, G.dryer.side.y0, G.dryer.side.y1) });
    // the top brush's hangers, from its axle up to the beam
    out.push({ name: 'top brush hanger', squash: 0,
      pts: boxPoints(side * G.topBrush.hangerX - 0.08, side * G.topBrush.hangerX + 0.08,
        p.dy + G.topBrush.dy - 0.08, p.dy + G.topBrush.dy + 0.08, p.topBrushY, G.beam.y0) });
    // the wand's vertical stage: carriage to its foot
    const foot = G.wand.topY + (G.wand.workY - G.wand.topY) * p.wandDrop;
    out.push({ name: 'wand mast', squash: 0,
      pts: cylinderPoints(side * G.wand.x, p.dy + G.wand.dy, foot, G.beam.y0, G.wand.r) });
  }
  out.push({ name: 'top brush', squash: G.topBrush.squash,
    pts: hCylinderPoints(-G.topBrush.halfLen, G.topBrush.halfLen, p.dy + G.topBrush.dy, p.topBrushY, G.topBrush.r) });
  out.push({ name: 'top air knife', squash: 0,
    pts: boxPoints(-G.dryer.top.halfLen, G.dryer.top.halfLen, p.dy + G.dryer.dy - G.dryer.top.d / 2, p.dy + G.dryer.dy + G.dryer.top.d / 2,
      p.dryerTopY, p.dryerTopY + G.dryer.top.h) });
  return out;
}

/** The wand's horizontal stage (and nozzle): from the carriage in to its tip. */
function wandArm(p: WashPose, side: 1 | -1): [number, number, number][] {
  if (p.wandDrop < 1) return [];
  const tip = G.wand.x + (G.wand.reachX - G.wand.x) * p.wandReach;
  return hCylinderPoints(side * G.wand.x, side * tip, p.dy + G.wand.dy, G.wand.workY, G.wand.r);
}

describe('the machine and the car', () => {
  it('samples both programs and their early ends', () => {
    expect(ALL.length).toBeGreaterThan(5000);
    const seen = new Set(ALL.map((r) => r.s.phase));
    for (const ph of washChain(true)) expect(seen.has(ph)).toBe(true);
    expect(seen.has('retract')).toBe(true);
    expect(seen.has('return')).toBe(true);
  });

  it('never touches the car with the frame: legs, beam and arch', () => {
    let worst = Infinity;
    for (const dy of [WASH_TRAVEL.north, -4, -2, 0, 2, 4, WASH_TRAVEL.south]) {
      for (const [x, d, y] of frameParts(dy)) worst = Math.min(worst, carGap(x, d, y));
    }
    expect(worst).toBeGreaterThan(1.0);
  });

  it('presses a brush in no deeper than its bristles give, and keeps every rigid part off the car', () => {
    const worst = new Map<string, number>();
    for (const { p } of ALL) {
      for (const part of movingParts(p)) {
        let w = worst.get(part.name) ?? Infinity;
        for (const [x, d, y] of part.pts) w = Math.min(w, carGap(x, d, y));
        worst.set(part.name, w);
      }
    }
    expect(worst.get('side brush')!).toBeGreaterThanOrEqual(-G.sideBrush.squash - 1e-3);
    expect(worst.get('top brush')!).toBeGreaterThanOrEqual(-G.topBrush.squash - 1e-3);
    // and both brushes do reach the car (a brush that never touches washes nothing)
    expect(worst.get('side brush')!).toBeLessThan(0);
    expect(worst.get('top brush')!).toBeLessThan(0);
    for (const name of ['side air knife', 'top air knife', 'top brush hanger', 'wand mast']) {
      expect(worst.get(name)!, name).toBeGreaterThan(0.2);
    }
  });

  it('keeps every part off an open door', () => {
    let worst = Infinity;
    let checked = 0;
    for (const { p } of ALL) {
      if (p.doors <= 0) continue;
      checked++;
      const pts = [...frameParts(p.dy), ...movingParts(p).flatMap((m) => m.pts)];
      for (const [x, d, y] of pts) worst = Math.min(worst, doorGap(x, d, y, p.doors));
    }
    expect(checked).toBeGreaterThan(1000);
    expect(worst).toBeGreaterThan(0.25);
  });

  it('puts a wand into the car only through an open door, into the cabin’s free space, clear of the seats', () => {
    const seats = seatBoxes();
    let inside = 0;
    const bad: string[] = [];
    for (const { p } of ALL) {
      for (const side of [1, -1] as const) {
        for (const [x, d, y] of wandArm(p, side)) {
          if (carGap(x, d, y) > 0) continue;
          inside++;
          const c = toCar(x, d, y);
          // through the aperture where it crosses the flank, then in the cabin's void
          const ok = p.doors === 1
            && c.x > Math.max(DOOR.alongMin, CABIN_VOID.alongMin) && c.x < Math.min(DOOR.alongMax, CABIN_VOID.alongMax)
            && c.y > Math.max(DOOR.sill, CABIN_VOID.floor) && c.y < Math.min(DOOR.top, CABIN_VOID.ceiling)
            && !seats.some((b) => c.x > b.x0 && c.x < b.x1 && c.y > b.y0 && c.y < b.y1 && c.z > b.z0 && c.z < b.z1);
          if (!ok && bad.length < 5) bad.push(`${JSON.stringify(c)} doors ${p.doors}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(inside).toBeGreaterThan(1000);
  });
});

describe('a car driving under the machine', () => {
  it('clears the retracted machine, roof pod and all, wherever it stands on its rails', () => {
    // the car's swept volume as it drives along the drive line: its full width and height, every dy
    let worst = Infinity;
    const home = washPoseAt({ phase: 'home', t: 1, vacuumS: 600, from: null });
    for (const dy of [WASH_TRAVEL.north, -5, -2.5, 0, 2.5, 5, WASH_TRAVEL.south]) {
      const p = { ...home, dy };
      const pts = [...frameParts(dy), ...movingParts({ ...washPoseAt({ phase: 'home', t: 1, vacuumS: 600, from: null }), dy }).flatMap((m) => m.pts)];
      void p;
      for (const [x, , y] of pts) {
        const outX = Math.abs(x) - CAR_HALF_WIDTH_U;
        const outY = y - CAR_TOP_U;
        worst = Math.min(worst, Math.max(outX, outY));
      }
    }
    expect(worst).toBeGreaterThan(1.0);
  });

  it('waits clear of the parked car’s nose, so a car pulls up to it', () => {
    const home = washPoseAt({ phase: 'home', t: 1, vacuumS: 600, from: null });
    expect(home.dy + G.dryer.dy + G.dryer.top.d / 2).toBeLessThan(-CAR_HALF_LEN_U - 0.5);
    expect(carTopU(home.dy + G.dryer.dy)).toBeNull();
  });
});
