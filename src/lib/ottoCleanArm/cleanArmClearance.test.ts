/**
 * DOES THE CLEANING ARM TOUCH ANYTHING IT SHOULD NOT?
 *
 * The OTTO-CLEAN ARM works inside a moving car's cabin beside a charge arm that is
 * plugged into the same car, under a canopy, next to the next stall. Every one of those
 * is measured here, over the WHOLE cycle on BOTH stall columns, against the solids the
 * renderer draws (vehicleEnvelope's car and doors, cabin and seats), and against the
 * OTTO-CHARGE ARM's links through its whole duty cycle at every inlet the fleet presents.
 *
 * Margins, and why each is what it is:
 *   0.10 m  every link outside the car, to the car and to the open doors — the charge
 *           arm's own structural margin (cobotSpec.ts), so both robots keep one rule;
 *   0.03 m  the wand's section to the door aperture's edges, on every plane it crosses;
 *   0.00 m  the wand and nozzle stay inside the cabin's free volume (which is already
 *           1 cm inside the liner) and 0.01 m off the seats: the nozzle is SUPPOSED to
 *           come close to what it cleans, its mouth 2-8 cm off the surface;
 *   0.10 m  the two robots, from each other. Measured 0.148 m when this was written, and
 *           where: the cleaning wand inside the cabin, reaching for the rear bench on the
 *           port flank, against the charge arm's connector outside the same flank, with
 *           the flank panel between them.
 */
import { describe, it, expect } from 'vitest';
import { CLEAN_CHAIN, CLEAN_ARM, MAST_FOOT_MAX, type CleanPhase } from './cleanArmSpec';
import {
  cleanJointsAt, cleanArmPoints, sidesFor, STROKES, STROKE_TARGETS, strokeJoints, doorsAt, exitEnd,
  type CleanJoints, type CleanSides,
} from './cleanArmPose';
import {
  cleanArmCapsules, capsuleMin, carClearance, apertureMargin, cabinRoom, seatClearance, doorsClearance,
  FLOOR_TOP, type Capsule,
} from './cleanArmClearance';
import { FLANK_PAINT_Z } from './cleanArmSpec';
import { OTTO_CHARGE_ARM, MOUNT_HEIGHT_M, PEDESTAL_TO_CAR_CENTRE_M } from '@/lib/ottoChargeArm/cobotSpec';
import { forwardElbow, forwardWristCentre, forwardTCP, type JointAngles } from '@/lib/ottoChargeArm/cobotIK';
import { poseFor } from '@/lib/ottoChargeArm/armMotion';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { portInArmFrame } from '@/lib/ottoChargeArm/depotPlacement';
import { CAR_WIDTH_M, clearanceToDoor } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { CHARGER_STALL_ANGLE, DCFC_ROW_PITCH } from '@/lib/sitePlan';
import { METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import type { ArmPhase } from '@/lib/ottoChargeArm/armStateMachine';

const COLUMN_TOP = 5.3;
const SIDES: CleanSides[] = [sidesFor(1), sidesFor(-1)];
const sideOf = (phase: CleanPhase, s: CleanSides) => (phase.endsWith('_b') ? s.b : s.a);
const inside = (p: CleanPhase) => /^(enter|clean|exit)_/.test(p);

/** Every pose of the cycle, finely: the clean phases at 1/600, the moves at 1/60. */
function* cycle(): Generator<{ phase: CleanPhase; t: number; sides: CleanSides; q: CleanJoints }> {
  for (const sides of SIDES) {
    for (const phase of CLEAN_CHAIN) {
      const n = phase.startsWith('clean') ? 600 : 60;
      for (let i = 0; i <= n; i++) yield { phase, t: i / n, sides, q: cleanJointsAt(phase, i / n, sides) };
    }
  }
}

/** The wand and nozzle sampled: points inboard of the panels must be in the cabin, off the seats. */
function wandWorst(caps: ReturnType<typeof cleanArmCapsules>) {
  let room = Infinity, seat = Infinity, outCar = Infinity;
  for (const c of [caps.wand, ...caps.nozzle]) {
    const n = 48;
    for (let k = 0; k <= n; k++) {
      const p = { x: c.a.x + (c.b.x - c.a.x) * k / n, y: c.a.y + (c.b.y - c.a.y) * k / n, z: c.a.z + (c.b.z - c.a.z) * k / n };
      const az = Math.abs(p.z);
      const cc = carClearance(p) - c.r;
      if (az >= FLANK_PAINT_Z + 0.1) outCar = Math.min(outCar, cc);
      else if (az < CAR_WIDTH_M / 2 - 0.08 && cc < 0.03) {
        room = Math.min(room, cabinRoom(p) - c.r);
        seat = Math.min(seat, seatClearance(p) - c.r);
      }
    }
  }
  return { room, seat, outCar };
}

describe('the cleaning arm and the car it cleans', () => {
  it('keeps every link outside the car by 0.10 m and off both open doors by 0.10 m, all cycle', { timeout: 120000 }, () => {
    let car = Infinity, door = Infinity, n = 0;
    for (const { phase, t, q } of cycle()) {
      const caps = cleanArmCapsules(cleanArmPoints(q), COLUMN_TOP);
      const open = doorsAt(phase, t);
      for (const c of caps.outside) {
        car = Math.min(car, capsuleMin(c, carClearance));
        door = Math.min(door, doorsClearance(c, open));
      }
      n++;
    }
    // two columns x (two clean phases at 601 samples + seventeen moves at 61)
    expect(n).toBe(2 * (2 * 601 + 17 * 61));
    expect(car, `links to car ${car.toFixed(4)} m`).toBeGreaterThanOrEqual(0.1);
    expect(door, `links to doors ${door.toFixed(4)} m`).toBeGreaterThanOrEqual(0.1);
  });

  it('only ever puts the wand in the car through the door, with 0.03 m round its section', () => {
    let worst = Infinity, crossings = 0;
    for (const { phase, sides, q } of cycle()) {
      if (!inside(phase)) continue;
      const am = apertureMargin(cleanArmPoints(q), sideOf(phase, sides));
      if (!am) continue;
      crossings++;
      worst = Math.min(worst, am.margin);
    }
    expect(crossings).toBeGreaterThan(2000);
    expect(worst, `aperture margin ${worst.toFixed(4)} m`).toBeGreaterThanOrEqual(0.03);
  });

  it('keeps the wand and nozzle in the cabin, off the seats, and off the car outside the door', { timeout: 120000 }, () => {
    let room = Infinity, seat = Infinity, outCar = Infinity;
    for (const { q } of cycle()) {
      const w = wandWorst(cleanArmCapsules(cleanArmPoints(q), COLUMN_TOP));
      room = Math.min(room, w.room); seat = Math.min(seat, w.seat); outCar = Math.min(outCar, w.outCar);
    }
    expect(room, `cabin room ${room.toFixed(4)} m`).toBeGreaterThanOrEqual(0);
    expect(seat, `seats ${seat.toFixed(4)} m`).toBeGreaterThanOrEqual(0.01);
    expect(outCar, `wand outside the door ${outCar.toFixed(4)} m`).toBeGreaterThanOrEqual(0.03);
  });

  it('cleans what it says: the nozzle mouth 2-8 cm off the cushion, back or floor it works', () => {
    for (const side of [1, -1] as const) {
      STROKES.forEach((k, i) => {
        const tip = cleanArmPoints(strokeJoints(k, side)).tip;
        const what = STROKE_TARGETS[i].what;
        if (what.includes('cushion')) expect(tip.y - 0.7, `${what} k${i}`).toBeGreaterThan(0.02);
        if (what.includes('cushion')) expect(tip.y - 0.7, `${what} k${i}`).toBeLessThan(0.08);
        if (what.includes('back')) {
          const face = what.startsWith('rear') ? -0.85 : 0.85;
          const gap = Math.abs(face - tip.x);
          expect(gap, `${what} k${i}`).toBeGreaterThan(0.02);
          expect(gap, `${what} k${i}`).toBeLessThan(0.15);
        }
        if (what.includes('floor') && i > 0) {
          expect(tip.y - FLOOR_TOP, `${what} k${i}`).toBeGreaterThan(0.015);
          expect(tip.y - FLOOR_TOP, `${what} k${i}`).toBeLessThan(0.08);
        }
      });
    }
  });

  it('comes out the way it went in when the step ends early, from any point of a clean', { timeout: 120000 }, () => {
    // the way out from wherever the wand is: exit (from that pose), then up and home
    let car = Infinity, door = Infinity, ap = Infinity, room = Infinity, seat = Infinity, aborts = 0;
    for (const sides of SIDES) {
      for (const phase of ['enter_a', 'clean_a', 'enter_b', 'clean_b'] as const) {
        const side = sideOf(phase, sides);
        const exitPhase = phase.endsWith('_a') ? 'exit_a' : 'exit_b';
        for (let i = 0; i <= 30; i++) {
          const from = cleanJointsAt(phase, i / 30, sides);
          aborts++;
          for (let k = 0; k <= 24; k++) {
            const q = cleanJointsAt(exitPhase, k / 24, sides, { from });
            const pt = cleanArmPoints(q);
            const caps = cleanArmCapsules(pt, COLUMN_TOP);
            for (const c of caps.outside) { car = Math.min(car, capsuleMin(c, carClearance)); door = Math.min(door, doorsClearance(c, 1)); }
            const am = apertureMargin(pt, side);
            if (am) ap = Math.min(ap, am.margin);
            const w = wandWorst(caps);
            room = Math.min(room, w.room); seat = Math.min(seat, w.seat);
          }
          // and on up to the ready pose from where the exit left it
          const end = exitEnd(from, side);
          for (let k = 0; k <= 20; k++) {
            const q = cleanJointsAt(phase.endsWith('_a') ? 'ascend_a' : 'ascend_b', k / 20, sides, { from: end });
            for (const c of cleanArmCapsules(cleanArmPoints(q), COLUMN_TOP).outside) car = Math.min(car, capsuleMin(c, carClearance));
          }
        }
      }
    }
    expect(aborts).toBe(2 * 4 * 31);
    expect(car, `links to car ${car.toFixed(4)}`).toBeGreaterThanOrEqual(0.1);
    expect(door, `links to doors ${door.toFixed(4)}`).toBeGreaterThanOrEqual(0.1);
    expect(ap, `aperture ${ap.toFixed(4)}`).toBeGreaterThanOrEqual(0.03);
    expect(room, `cabin room ${room.toFixed(4)}`).toBeGreaterThanOrEqual(0);
    expect(seat, `seats ${seat.toFixed(4)}`).toBeGreaterThanOrEqual(0.01);
  });

  it('parks above every car: stowed and swinging, nothing comes below 2 m over the car', () => {
    for (const { phase, q } of cycle()) {
      if (!['home', 'doors_open', 'swing_a', 'swing_b', 'return', 'doors_close'].includes(phase)) continue;
      const pt = cleanArmPoints(q);
      expect(Math.min(pt.foot.y, pt.pivot.y, pt.knuckle.y, pt.tip.y), phase).toBeGreaterThan(2.0);
    }
    expect(MAST_FOOT_MAX).toBeGreaterThan(2.2);
  });
});

// ═══════════════════════════════════════════════════════ BESIDE THE CHARGE ARM ═══

/** Distance between two segments (closest points), metres. */
function segSeg(p1: { x: number; y: number; z: number }, q1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number }, q2: { x: number; y: number; z: number }): number {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const dot = (a: typeof r, b: typeof r) => a.x * b.x + a.y * b.y + a.z * b.z;
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) { s = t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  return Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z);
}

/**
 * The OTTO-CHARGE ARM as capsules in the CAR frame, from its own forward kinematics.
 * Radii are its housings' (cobotSpec radii x ARM_SCALE) rounded UP, so a clear result
 * is clear of the drawn arm; the connector is the tool length's capsule.
 */
function chargeArmCapsules(a: JointAngles, toward: 1 | -1): Capsule[] {
  const s = OTTO_CHARGE_ARM;
  // arm base frame -> car frame: the pedestal at the port flank, arm +Z at the car,
  // arm +X = -toward * along (portInArmFrame), so Ry(PI) for toward = +1, identity for -1
  const toCar = (p: { x: number; y: number; z: number }) => ({
    x: toward > 0 ? -p.x : p.x,
    y: p.y + MOUNT_HEIGHT_M,
    z: toward > 0 ? toward * PEDESTAL_TO_CAR_CENTRE_M - p.z : toward * PEDESTAL_TO_CAR_CENTRE_M + p.z,
  });
  const base = toCar({ x: 0, y: 0, z: 0 });
  const shoulder = toCar({ x: 0, y: s.shoulderHeight, z: 0 });
  const elbow = toCar(forwardElbow(a, s));
  const wrist = toCar(forwardWristCentre(a, s));
  const tcp = toCar(forwardTCP(a, s));
  return [
    { name: 'charge base', a: base, b: shoulder, r: s.radii.base * 1.15 },
    { name: 'charge upper arm', a: shoulder, b: elbow, r: Math.max(s.radii.shoulder, s.radii.upper * 1.2, s.radii.elbow) },
    { name: 'charge forearm', a: elbow, b: wrist, r: Math.max(s.radii.elbow, s.radii.fore * 1.2) },
    { name: 'charge wrist + connector', a: wrist, b: tcp, r: s.radii.wristR * 1.3 },
  ];
}

/** The charge arm's duty cycle at one inlet: every timed phase, sampled. */
function chargeDuty(port: { along: number; height: number }, toward: 1 | -1): JointAngles[] {
  const target = { port: portInArmFrame(port.along, port.height, CAR_WIDTH_M / 2, toward), normal: { x: 0, y: 0, z: -1 } };
  const phases: ArmPhase[] = ['unstow', 'approach', 'align', 'insert', 'latch', 'charging', 'unlatch', 'extract', 'retract'];
  const out: JointAngles[] = [];
  for (const phase of phases) for (let i = 0; i <= 6; i++) out.push(poseFor({ phase, t: i / 6 }, target, OTTO_CHARGE_ARM).angles);
  return out;
}

describe('the cleaning arm beside the charge arm', () => {
  // the inlets the fleet presents: every family's band corners (portFor's own spread)
  const ports: { along: number; height: number }[] = [];
  for (const oem of ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null]) {
    let aLo = Infinity, aHi = -Infinity, hLo = Infinity, hHi = -Infinity;
    for (let i = 0; i < 200; i++) {
      const p = portFor(`probe-${i}`, oem);
      aLo = Math.min(aLo, p.along); aHi = Math.max(aHi, p.along); hLo = Math.min(hLo, p.height); hHi = Math.max(hHi, p.height);
    }
    for (const along of [aLo, aHi]) for (const height of [hLo, hHi]) ports.push({ along, height });
  }

  it('never comes within 0.10 m of the charge arm, whatever either is doing, at any inlet', { timeout: 120000 }, () => {
    let worst = Infinity, worstAt = '';
    for (const toward of [1, -1] as const) {
      const sides = sidesFor(toward);
      // the cleaning arm's whole cycle as capsules, once
      const clean: { caps: Capsule[]; at: string }[] = [];
      for (const phase of CLEAN_CHAIN) {
        const n = phase.startsWith('clean') ? 80 : 10;
        for (let i = 0; i <= n; i++) {
          const caps = cleanArmCapsules(cleanArmPoints(cleanJointsAt(phase, i / n, sides)), COLUMN_TOP);
          clean.push({ caps: [...caps.outside, caps.wand, ...caps.nozzle], at: `${phase}@${(i / n).toFixed(2)}` });
        }
      }
      for (const port of ports) {
        for (const a of chargeDuty(port, toward)) {
          const charge = chargeArmCapsules(a, toward);
          for (const c of clean) {
            for (const cc of c.caps) {
              for (const ch of charge) {
                const d = segSeg(cc.a, cc.b, ch.a, ch.b) - cc.r - ch.r;
                if (d < worst) { worst = d; worstAt = `${c.at} ${cc.name} vs ${ch.name}, toward ${toward}`; }
              }
            }
          }
        }
      }
    }
    expect(worst, `${worst.toFixed(4)} m at ${worstAt}`).toBeGreaterThanOrEqual(0.1);
  });

  it('keeps the open doors 0.10 m off the charge arm through its whole duty cycle', () => {
    let worst = Infinity;
    for (const toward of [1, -1] as const) {
      for (const port of ports) {
        for (const a of chargeDuty(port, toward)) {
          for (const c of chargeArmCapsules(a, toward)) {
            for (const side of [1, -1] as const) {
              worst = Math.min(worst, capsuleMin(c, (p) => clearanceToDoor(p, side, 1)));
            }
          }
        }
      }
    }
    expect(worst, `${worst.toFixed(4)} m`).toBeGreaterThanOrEqual(0.1);
  });
});

describe('the cleaning arm beside the next stall', () => {
  it('cannot reach the next stall’s arm: two reach envelopes fit between neighbours', () => {
    // the farthest any part gets from J1's axis, over the whole cycle
    let reach = 0;
    for (const { q } of cycle()) {
      const pt = cleanArmPoints(q);
      for (const p of [pt.elbow, pt.mastTop, pt.pivot, pt.knuckle, pt.tip]) {
        reach = Math.max(reach, Math.hypot(p.x - CLEAN_ARM.mountX, p.z));
      }
    }
    // neighbouring fast-charger stalls stand DCFC_ROW_PITCH apart along the lane; square to
    // the cars that is pitch x sin(stall angle). Two envelopes and their housings fit in it.
    const apart = DCFC_ROW_PITCH * Math.sin((CHARGER_STALL_ANGLE * Math.PI) / 180) * METRES_PER_PLAN_UNIT;
    expect(2 * (reach + 0.2)).toBeLessThan(apart);
  });
});
