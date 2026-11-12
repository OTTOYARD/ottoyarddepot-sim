/**
 * The wash machine against the car it works on, measured against the solid the car mesh is
 * built from (vehicleEnvelope.ts), at every moment of both programs and of every early end:
 *   · nothing rigid touches the car: the frame, the air knives and the detail arms' links keep their gap;
 *   · only the soft pads touch the car, only on a sensor (detailArm.test.ts measures each one);
 *   · no door opens, and nothing goes into the car;
 *   · the gantry and the arms never share a part of the bay: the gantry stows at the entrance, the arms at the exit;
 *   · stowed, the machine clears a car driving under it, roof pod and all.
 */
import { describe, it, expect } from 'vitest';
import { carSolidInArmFrame, clearanceToCar } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { advanceWashSession, IDLE_WASH, type WashSession } from './washSession';
import { washPoseAt, type WashPose } from './washPose';
import { WASH_GANTRY as G, WASH_HOME_DY, WASH_TRAVEL, isPass, isWipe, washChain } from './washSpec';
import { DETAIL_SPEC, DOCK_DY_M, TRACK_TO_M, TRACK_X_M, carGapM, stowed, type ArmState, type B3 } from './detailArm';
import { MOUNT_HEIGHT_M } from '@/lib/ottoChargeArm/cobotSpec';
import { CAR_HALF_LEN_U, CAR_HALF_WIDTH_U, CAR_TOP_U } from './carShape';

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
  ...poses(false, 390),
  ...poses(true, 990),
  // ended early: mid-pass, in the cabin hold, in the settle
  ...poses(false, 390, 120), ...poses(true, 990, 300), ...poses(true, 990, 8),
  // and every 4 s of the detail arms' work
  ...Array.from({ length: 40 }, (_, k) => poses(false, 390, 216 + 4 * k)).flat(),
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

/** The parts that never come near the car, in the bay frame, for the machine at `dy`. */
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

/** The least a rigid part of an arm keeps off the car, metres (the cleaning arm's rule). */
const RIGID_GAP_M = 0.10;
/** The least distance from a link (a line from a to b, radius r) to the car, metres. */
function linkGap(a: B3, b: B3, r: number): number {
  let m = Infinity;
  for (let i = 0; i <= 10; i++) {
    const f = i / 10;
    m = Math.min(m, carGapM({ x: a.x + (b.x - a.x) * f, dy: a.dy + (b.dy - a.dy) * f, y: a.y + (b.y - a.y) * f }) - r);
  }
  return m;
}
const shoulder = (a: ArmState): B3 => ({ x: a.side * TRACK_X_M, dy: a.rail, y: MOUNT_HEIGHT_M + DETAIL_SPEC.shoulderHeight });
/** An arm's links off the car: upper arm, forearm, wrist. */
const armGap = (a: ArmState) => Math.min(
  linkGap(shoulder(a), a.elbow, DETAIL_SPEC.radii.upper), linkGap(a.elbow, a.wrist, DETAIL_SPEC.radii.fore),
  carGapM(a.wrist) - DETAIL_SPEC.radii.wristR);
/** The farthest south any part of an arm is (its reach toward the gantry), and the farthest any part is from grade. */
const armSouth = (a: ArmState) => Math.max(a.rail, a.elbow.dy, a.wrist.dy, a.pad.dy);

/** The air knives, in the bay frame. */
function knifePoints(p: WashPose): [number, number, number][] {
  const kd = p.dy + G.dryer.dy;
  const pts = boxPoints(-G.dryer.top.halfLen, G.dryer.top.halfLen, kd - G.dryer.top.d / 2, kd + G.dryer.top.d / 2, p.dryerTopY, p.dryerTopY + G.dryer.top.h);
  for (const side of [-1, 1]) {
    const x0 = side * p.dryerSideX, x1 = side * (p.dryerSideX + G.dryer.side.w);
    pts.push(...boxPoints(Math.min(x0, x1), Math.max(x0, x1), kd - G.dryer.side.d / 2, kd + G.dryer.side.d / 2, G.dryer.side.y0, G.dryer.side.y1));
  }
  return pts;
}

describe('the machine and the car', () => {
  it('samples both programs and their early ends', () => {
    const seen = new Set(ALL.map(({ s }) => s.phase));
    for (const ph of [...washChain(true), 'retract', 'return', 'home']) expect(seen, ph).toContain(ph);
    expect(ALL.length).toBeGreaterThan(5000);
  }, 120_000);

  it('never touches the car with the frame: legs, beam and arch', () => {
    let least = Infinity;
    for (const { p } of ALL) for (const [x, dy, y] of frameParts(p.dy)) least = Math.min(least, carGap(x, dy, y));
    expect(least).toBeGreaterThan(1.0);
  }, 120_000);

  it('keeps the air knives off the car, at their gap', () => {
    let least = Infinity;
    for (const { p } of ALL) for (const [x, dy, y] of knifePoints(p)) least = Math.min(least, carGap(x, dy, y));
    expect(least).toBeGreaterThan(0.3);
  }, 120_000);

  it('keeps each detail arm\'s links 0.10 m off the car at every moment, early ends and all', () => {
    let least = Infinity, where = '';
    for (const { s, p } of ALL) for (const a of p.arms) {
      const g = armGap(a);
      if (g < least) { least = g; where = `${s.phase}@${s.t.toFixed(2)} ${a.side}`; }
    }
    expect(least, where).toBeGreaterThan(RIGID_GAP_M);
  }, 120_000);

  it('touches the car with the pads only, and only while the arms work', () => {
    let touched = 0;
    for (const { s, p } of ALL) for (const a of p.arms) {
      const gap = carGapM(a.pad);
      expect(gap, `${s.phase}@${s.t.toFixed(2)}`).toBeGreaterThan(-1e-3);
      if (a.engage > 0) { expect(isWipe(s.phase)).toBe(true); expect(gap).toBeLessThan(1e-3); touched++; }
      if (!isWipe(s.phase) && s.phase !== 'retract') expect(gap, `${s.phase} clear`).toBeGreaterThan(0.14);
    }
    expect(touched).toBeGreaterThan(200);
  }, 120_000);

  it('keeps the arms in their docks while the gantry travels, and the gantry home while the arms are out', () => {
    for (const { s, p } of ALL) {
      const docked = p.arms.every((a, k) => {
        const st = stowed(k === 0 ? 1 : -1);
        return Math.abs(a.rail - DOCK_DY_M) < 1e-9 && Math.abs(a.q.j2 - st.q.j2) < 1e-9 && Math.abs(a.q.j3 - st.q.j3) < 1e-9;
      });
      const home = Math.abs(p.dy - WASH_HOME_DY) < 1e-9;
      if (isPass(s.phase) || s.phase === 'cabin_hold' || s.phase === 'settle') expect(docked, s.phase).toBe(true);
      if (isWipe(s.phase) || s.phase === 'arms_out' || s.phase === 'arms_stow') expect(home, s.phase).toBe(true);
      // whatever the moment, the gantry's north face is south of every part of both arms, with room between
      const gantryNorth = (p.dy + G.beam.dy0) * M;
      for (const a of p.arms) expect(gantryNorth - armSouth(a), `${s.phase}@${s.t.toFixed(2)}`).toBeGreaterThan(0.5);
    }
  }, 120_000);

  it('keeps each carriage on its track and the gantry on its rails', () => {
    for (const { s, p } of ALL) {
      expect(p.dy).toBeGreaterThanOrEqual(WASH_TRAVEL.north - 1e-9);
      expect(p.dy).toBeLessThanOrEqual(WASH_TRAVEL.home + 1e-9);
      expect(p.dy + G.leg.dy + G.trolley.d / 2).toBeLessThan(G.rail.to);
      for (const a of p.arms) {
        expect(a.rail, s.phase).toBeGreaterThanOrEqual(DOCK_DY_M - 1e-9);
        expect(a.rail, s.phase).toBeLessThanOrEqual(TRACK_TO_M + 1e-9);
      }
    }
  }, 120_000);

  it('opens no door and puts nothing into the car', () => {
    for (const { p } of ALL) {
      expect(p).not.toHaveProperty('doors');
      for (const a of p.arms) for (const q of [a.pad, a.wrist, a.elbow]) expect(carGapM(q)).toBeGreaterThan(-1e-3);
    }
  }, 120_000);
});

describe('a car driving through the bay', () => {
  it('clears the stowed machine, roof pod and all, wherever the gantry stands on its rails', () => {
    for (let dy = WASH_TRAVEL.north; dy <= WASH_TRAVEL.home; dy += 0.4) {
      const p = washPoseAt({ phase: 'home', t: 1, from: null });
      // the beam and the stowed top knife over the car's path; the side knives beside it
      expect(G.beam.y0 - CAR_TOP_U).toBeGreaterThan(1.0);
      expect(p.dryerTopY - CAR_TOP_U).toBeGreaterThan(1.0);
      expect(p.dryerSideX - CAR_HALF_WIDTH_U).toBeGreaterThan(1.0);
    }
  }, 120_000);

  it('passes between the docked arms on its way out, with 0.6 m a side', () => {
    const p = washPoseAt({ phase: 'home', t: 1, from: null });
    for (const a of p.arms) {
      for (const q of [a.pad, a.wrist, a.elbow]) expect(Math.abs(q.x) - CAR_HALF_WIDTH_U * M).toBeGreaterThan(0.6);
      expect(TRACK_X_M - DETAIL_SPEC.radii.base - CAR_HALF_WIDTH_U * M).toBeGreaterThan(0.6);
    }
  }, 120_000);

  it('finds the gantry stowed at the entrance, behind the parked car, and the stop light green', () => {
    const p = washPoseAt({ phase: 'home', t: 1, from: null });
    expect(p.dy).toBe(WASH_TRAVEL.home);
    expect(p.dy + G.beam.dy0).toBeGreaterThan(CAR_HALF_LEN_U);
    expect(p.stop).toBe(false);
  }, 120_000);
});
