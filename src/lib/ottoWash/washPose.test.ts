/**
 * The wash machine against the car it works on, measured against the solid the car mesh is
 * built from (vehicleEnvelope.ts), at every moment of both programs and of every early end:
 *   · nothing rigid touches the car: the frame, the air knives and the wipe arms' masts keep their gap;
 *   · only the soft pads touch the car, only at the four places they wipe, and they press in no deeper
 *     than a pad gives;
 *   · no door opens, and nothing goes into the car;
 *   · stowed, the machine clears a car driving under it, roof pod and all.
 */
import { describe, it, expect } from 'vitest';
import { carSolidInArmFrame, clearanceToCar } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { advanceWashSession, IDLE_WASH, type WashSession } from './washSession';
import { WIPE_TARGET, washPoseAt, wipeJoints, type WashPose } from './washPose';
import { WASH_GANTRY as G, WASH_TRAVEL, WIPE_STATIONS, isWipe, stationOf, washChain } from './washSpec';
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
  // ended early: mid-pass, in the cabin hold, in the settle, and at each place the arms wipe
  ...poses(false, 300, 120), ...poses(true, 990, 300), ...poses(true, 990, 8),
  ...poses(false, 300, 210), ...poses(false, 300, 225), ...poses(false, 300, 240), ...poses(false, 300, 258),
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

const W = G.wipe;
/** How far a pad may press into the car's solid, plan u: the pad's own give (6 mm of spring and its foam). */
const PAD_GIVE = 0.03;
/** The least a rigid part of an arm keeps off the car, plan u (0.10 m, the cleaning arm's rule). */
const RIGID_GAP = 0.2;

/** Each arm's mast, in the bay frame: a vertical cylinder from the wrist up to the carriage under the beam. */
function mastPoints(p: WashPose): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (const side of [-1, 1]) pts.push(...cylinderPoints(side * p.mastX, p.dy + W.dy, p.padY, G.beam.y0, W.mastR));
  return pts;
}
/** Each pad's centre and 12 points on its rim, as the wrist has turned it (face-on: in, aft or fore). */
function padPoints(p: WashPose): { centre: [number, number, number][]; rim: [number, number, number][] } {
  const centre: [number, number, number][] = [], rim: [number, number, number][] = [];
  for (const side of [-1, 1]) {
    centre.push([side * p.padX, p.padDy, p.padY]);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * 2 * Math.PI, c = W.padR * Math.cos(a), s2 = W.padR * Math.sin(a);
      if (p.padFace === 'in') rim.push([side * p.padX, p.padDy + c, p.padY + s2]);
      else if (p.padFace === 'down') rim.push([side * p.padX + c, p.padDy + s2, p.padY]);
      else rim.push([side * p.padX + c, p.padDy, p.padY + s2]);
    }
  }
  return { centre, rim };
}
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
  });

  it('never touches the car with the frame: legs, beam and arch', () => {
    let least = Infinity;
    for (const { p } of ALL) for (const [x, dy, y] of frameParts(p.dy)) least = Math.min(least, carGap(x, dy, y));
    expect(least).toBeGreaterThan(1.0);
  });

  it('keeps the air knives off the car, at their gap', () => {
    let least = Infinity;
    for (const { p } of ALL) for (const [x, dy, y] of knifePoints(p)) least = Math.min(least, carGap(x, dy, y));
    expect(least).toBeGreaterThan(0.3);
  });

  it('keeps each arm\'s mast 0.10 m off the car at every moment', () => {
    let least = Infinity;
    for (const { p } of ALL) for (const [x, dy, y] of mastPoints(p)) least = Math.min(least, carGap(x, dy, y));
    expect(least).toBeGreaterThan(RIGID_GAP);
  });

  it('touches the car with the pads only, only while it wipes, and no deeper than a pad gives', () => {
    let deepest = Infinity;
    for (const { s, p } of ALL) {
      const { centre, rim } = padPoints(p);
      const gap = Math.min(...centre.map(([x, dy, y]) => carGap(x, dy, y)));
      const rimGap = Math.min(...rim.map(([x, dy, y]) => carGap(x, dy, y)));
      // the pad's face stands half its thickness from its centre: on the car's surface, less the pad's give
      expect(gap, `${s.phase}@${s.t.toFixed(2)} centre`).toBeGreaterThan(W.padT / 2 - PAD_GIVE);
      expect(rimGap, `${s.phase}@${s.t.toFixed(2)} rim`).toBeGreaterThan(-PAD_GIVE);
      deepest = Math.min(deepest, gap);
      // off its place, a pad is well clear of the car
      if (!isWipe(s.phase) && s.phase !== 'retract') expect(gap, `${s.phase} clear`).toBeGreaterThan(RIGID_GAP);
    }
    expect(deepest).toBeLessThan(W.padT / 2 + 0.05); // and it does reach the car
  });

  it('puts each pad on its place: the nose, the side cameras, the roof pod and the tail', () => {
    const whole = poses(false, 300, undefined, 0.1);
    for (const st of WIPE_STATIONS) {
      const k = WIPE_TARGET[st];
      const on = whole.filter(({ s, p }) => isWipe(s.phase) && stationOf(s.phase) === st && p.wipeEngage === 1);
      expect(on.length, st).toBeGreaterThan(10);
      for (const { p } of on) {
        expect(p.padFace).toBe(k.yaw === 1 ? 'aft' : k.yaw === -1 ? 'fore' : 'in');
        expect(p.padY).toBeCloseTo(k.y, 6);
        // the wipe is a small stroke about the place: across the bay or along it
        expect(Math.abs(p.padX - k.x)).toBeLessThanOrEqual((k.sweep.axis === 'x' ? k.sweep.amp : 0) + 1e-6);
        expect(Math.abs(p.padDy - k.padDy)).toBeLessThanOrEqual((k.sweep.axis === 'dy' ? k.sweep.amp : 0) + 1e-6);
        // and the pad is on the car there
        const gap = Math.min(carGap(p.padX, p.padDy, p.padY), carGap(-p.padX, p.padDy, p.padY));
        expect(gap, `${st} on the car`).toBeLessThan(W.padT / 2 + 0.06);
      }
      // the wipe goes both ways over the place
      const along = on.map(({ p }) => (k.sweep.axis === 'x' ? p.padX - k.x : p.padDy - k.padDy));
      expect(Math.max(...along)).toBeGreaterThan(0.8 * k.sweep.amp);
      expect(Math.min(...along)).toBeLessThan(-0.8 * k.sweep.amp);
    }
  });

  it('keeps the arms inside what the machine is built for: its cross travel, its drop and its rails', () => {
    const lowMin = 550 / (M * 1000);            // cad wash_gantry.WIPE_LOW_MM
    const xMin = 330 / (M * 1000);              // cad wash_gantry.WIPE_X_MIN
    for (const { s, p } of ALL) {
      expect(p.mastX, s.phase).toBeGreaterThanOrEqual(xMin);
      expect(p.mastX, s.phase).toBeLessThanOrEqual(W.parkX + 1e-9);
      expect(p.padY, s.phase).toBeGreaterThanOrEqual(lowMin);
      expect(p.padY, s.phase).toBeLessThanOrEqual(W.stowY + 1e-9);
      expect(p.dy).toBeGreaterThanOrEqual(WASH_TRAVEL.north - 1e-9);
      expect(p.dy).toBeLessThanOrEqual(WASH_TRAVEL.south + 1e-9);
      expect(Math.abs(p.padYaw)).toBeLessThanOrEqual(1);
    }
    for (const st of WIPE_STATIONS) {
      const j = wipeJoints(WIPE_TARGET[st]);
      expect(j.dy, st).toBeGreaterThan(WASH_TRAVEL.north);
      expect(j.dy, st).toBeLessThan(WASH_TRAVEL.south);
    }
  });

  it('opens no door and puts nothing into the car', () => {
    for (const { p } of ALL) {
      expect(p).not.toHaveProperty('doors');
      for (const side of [-1, 1]) {
        // a pad's centre is never inside the car's box by more than its give
        const inBox = Math.abs(side * p.padX) < CAR_HALF_WIDTH_U - 0.1 && Math.abs(p.padDy) < CAR_HALF_LEN_U - 0.1 && p.padY < (carTopU(p.padDy) ?? 0) - 0.1;
        expect(inBox).toBe(false);
      }
    }
  });
});

describe('a car driving under the machine', () => {
  it('clears the stowed machine, roof pod and all, wherever it stands on its rails', () => {
    for (let dy = WASH_TRAVEL.north; dy <= WASH_TRAVEL.south; dy += 0.4) {
      const p = washPoseAt({ phase: 'home', t: 1, from: null });
      p.dy = dy; p.padDy = dy + W.dy;
      // the beam and the stowed top knife over the car's path; the parked arms and side knives beside it
      expect(G.beam.y0 - CAR_TOP_U).toBeGreaterThan(1.0);
      expect(p.dryerTopY - CAR_TOP_U).toBeGreaterThan(1.0);
      expect(p.dryerSideX - CAR_HALF_WIDTH_U).toBeGreaterThan(1.0);
      expect(p.padX - W.padR - CAR_HALF_WIDTH_U).toBeGreaterThan(1.0);
      expect(p.mastX - W.mastR - CAR_HALF_WIDTH_U).toBeGreaterThan(1.0);
    }
  });

  it('waits clear of the parked car’s nose, so a car pulls up to it', () => {
    const p = washPoseAt({ phase: 'home', t: 1, from: null });
    expect(p.dy + G.beam.dy1).toBeLessThan(-CAR_HALF_LEN_U);
    expect(p.stop).toBe(false);
  });
});
