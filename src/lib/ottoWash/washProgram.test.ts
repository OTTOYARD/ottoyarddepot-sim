/**
 * WHICH PROGRAM A WASH BAY PLAYS, and the gantry's own passes over each fleet vehicle:
 *   · a car with no fleet model gets the generic program, which is the machine as it was: its poses are pinned;
 *   · a car with a fleet model gets that model's program, from the gate through the session to the pose both views draw;
 *   · the session holds the program to the end, and the seat is the same length for every vehicle;
 *   · over each vehicle's own height, width and length the frame keeps 1.0 u, the air knives 0.3 u, and each arm's
 *     links 0.10 m, at every moment of the program and of early ends (washPose.test.ts's margins);
 *   · stowed, the machine lets each vehicle drive through.
 */
import { describe, it, expect } from 'vitest';
import { METRES_PER_PLAN_UNIT, MOUNT_HEIGHT_M } from '@/lib/ottoChargeArm/cobotSpec';
import { FLEET_SPECS } from '@/lib/fleetModels';
import { FLEET_MODEL_KEYS } from '@/lib/fleetModels/assign';
import { clearVehicleModels, publishVehicleModels, vehicleModelKey } from '@/lib/fleetModels/vehicleModel';
import { WashGate } from '@/engine/motion/washGate';
import {
  DETAIL_SPEC, DOCK_DY_M, GENERIC, SIDES, TRACK_TO_M, TRACK_X_M, armInZone, armOut, armReturn, armStow, armTuck, stowed,
  type ArmState, type B3,
} from './detailArm';
import { GENERIC_SHAPE } from './carShape';
import { advanceWashSession, IDLE_WASH, paceProgram, washPhaseLength, type WashSession } from './washSession';
import { dryerSideContactX, dryerTopContactY, programPoseAt, washPoseAt, type WashPose } from './washPose';
import { GENERIC_WASH, washProgramFor } from './washProgram';
import {
  PASSES_NOMINAL_S, WASH_GANTRY as G, WASH_HOME_DY, WASH_PHASE_S, WASH_TRAVEL, WIPE_FIXED_S, WIPE_PARTS, WIPE_STATIONS, isPass, isWipe, washChain,
} from './washSpec';

const M = METRES_PER_PLAN_UNIT;

describe('the generic program', () => {
  it('is what a car with no fleet model gets', () => {
    for (const k of [null, undefined, '', 'no_such_model']) expect(washProgramFor(k)).toBe(GENERIC_WASH);
    expect(GENERIC_WASH.detail).toBe(GENERIC);
    expect(GENERIC_WASH.shape).toBe(GENERIC_SHAPE);
    expect(GENERIC_WASH.wipeS).toBe(WIPE_FIXED_S);
    expect(WIPE_STATIONS.map((z) => GENERIC_WASH.zoneS[z])).toEqual([21, 21, 38, 40]);
  });

  it('plays the poses it played before there were programs: pinned', () => {
    // every joint and each carriage, through the arms' whole work and early ends of it, summed with a weight for
    // each joint. The number is from the code as it was at ed3cb95 (one car shape, module constants).
    let sum = 0, n = 0;
    const add = (a: ArmState) => {
      for (const j of ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'] as const) { sum += a.q[j] * (1 + (n % 7)); n++; }
      sum += a.rail;
    };
    for (const side of SIDES) {
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        add(armOut(side, t)); add(armStow(side, t));
        for (const z of WIPE_STATIONS) {
          const a = armInZone(side, z, t, WIPE_PARTS);
          add(a);
          for (const u of [0.3, 0.9]) { add(armTuck(a, u)); add(armReturn(armTuck(a, 1), u)); }
        }
      }
    }
    expect(n).toBe(53064);
    expect(sum).toBeCloseTo(35370.308782133, 6);
    // and a pose with no model is the generic program's, the knives too
    const a = washPoseAt({ phase: 'dry_1', t: 0.45, from: null }), b = washPoseAt({ phase: 'dry_1', t: 0.45, from: null, model: null });
    expect(b).toEqual(a);
    expect(dryerTopContactY(0.3)).toBe(dryerTopContactY(0.3, GENERIC_SHAPE));
    expect(dryerSideContactX()).toBeCloseTo(GENERIC_SHAPE.sideU + G.dryer.side.gap, 12);
  }, 120_000);
});

describe('the program follows the car in the bay', () => {
  it('knows each car\'s model from the twin\'s row, as the yard draws it', () => {
    clearVehicleModels();
    publishVehicleModels([
      { id: 'a', port: { profile: 'zoox_robotaxi' } }, { id: 'b', make: 'Tesla', model: 'Cybercab' }, { id: 'c', make: 'Acme', model: 'Van' },
    ]);
    expect(vehicleModelKey('a')).toBe('zoox_robotaxi');
    expect(vehicleModelKey('b')).toBe('tesla_cybercab');
    expect(vehicleModelKey('c')).toBeNull();
    expect(vehicleModelKey(null)).toBeNull();
    publishVehicleModels([{ id: 'a' }]);
    expect(vehicleModelKey('a')).toBeNull();
    clearVehicleModels();
  });

  it('has a program for each of the six models, each its own', () => {
    const progs = FLEET_MODEL_KEYS.map((k) => washProgramFor(k));
    expect(new Set(progs).size).toBe(6);
    progs.forEach((p, i) => {
      expect(p.key).toBe(FLEET_MODEL_KEYS[i]);
      expect(p.fleet).not.toBeNull();
      expect(p.detail).not.toBe(GENERIC);
      expect(washProgramFor(FLEET_MODEL_KEYS[i])).toBe(p);
    });
  }, 120_000);

  it('goes from the gate to the session to the pose: the arms go to that vehicle\'s places, and to the generic car\'s with no model', () => {
    const run = (model: string | null) => {
      const gate = new WashGate();
      const seen = new Set<string>();
      let session: WashSession | null = null;
      for (let t = 0; t < 420; t += 0.25) {
        gate.step(0.25, [{ bayId: 'WASH-01', vehicleId: 'car', active: t < 390, interior: false, model, endsInS: 390 - t }]);
        session = gate.session('WASH-01');
        if (session && isWipe(session.phase)) for (const a of washPoseAt(session).arms) if (a.engage > 0 && a.sensor) seen.add(a.sensor);
        if (t === 100) expect(session?.model ?? null).toBe(model);
      }
      expect(session?.phase).toBe('home');
      return seen;
    };
    const generic = run(null);
    expect([...generic].sort()).toEqual(GENERIC.sensors[1].map((s) => s.id).sort());
    for (const key of ['tesla_cybercab', 'waymo_ojai'] as const) {
      const prog = washProgramFor(key);
      const want = new Set([...prog.detail.sensors[1], ...prog.detail.sensors[-1]].map((s) => s.id));
      expect([...run(key)].sort()).toEqual([...want].sort());
    }
  }, 120_000);

  it('holds the program the seat started with, whatever the row says later', () => {
    let s = IDLE_WASH;
    for (let t = 0; t < 250; t += 0.5) {
      s = advanceWashSession(s, { dt: 0.5, vehicleId: 'car', active: true, interior: false, model: t < 50 ? 'zoox_robotaxi' : 'tesla_model_y', endsInS: 390 - t });
      if (t > 1) expect(s.model).toBe('zoox_robotaxi');
    }
    expect(isWipe(s.phase) || s.phase === 'arms_out' || s.phase === 'dry_2').toBe(true);
  });

  it('keeps the seat one length: a vehicle with more places takes the time from the passes, inside their floor', () => {
    for (const key of FLEET_MODEL_KEYS) {
      const prog = washProgramFor(key);
      const zones = WIPE_STATIONS.reduce((a, z) => a + prog.zoneS[z], 0);
      expect(zones, key).toBeGreaterThanOrEqual(120 - 1e-6);
      expect(prog.wipeS, key).toBeCloseTo(WASH_PHASE_S.arms_out + zones + prog.stowS, 9);
      for (const z of WIPE_STATIONS) expect(washPhaseLength(`wipe_${z}`, { passScale: 1, cabinS: 0, from: null, model: key })).toBe(prog.zoneS[z]);
      // the twin's program is 4.5 minutes (washSpec.PASS_NOMINAL_S): the passes still get more than their floor of 0.4
      const { passScale } = paceProgram(false, 270, key);
      expect(passScale, `${key}: the passes run at ${passScale.toFixed(2)} of their nominal time`).toBeGreaterThan(0.4);
      expect(passScale * PASSES_NOMINAL_S + prog.wipeS + WASH_PHASE_S.settle + WASH_PHASE_S.done).toBeLessThanOrEqual(270);
      // the arms' time is within 20 s of the generic program's
      expect(prog.wipeS - WIPE_FIXED_S, key).toBeLessThan(20);
    }
    expect(washPhaseLength('wipe_roof', { passScale: 1, cabinS: 0, from: null })).toBe(WASH_PHASE_S.wipe_roof);
  }, 120_000);
});

/** The poses of a vehicle's program, stepped a frame at a time and kept every `keep` sim seconds, and of an early end of it. */
function poses(model: string, seat: number, endAt?: number, keep = 0.5): { s: WashSession; p: WashPose }[] {
  const out: { s: WashSession; p: WashPose }[] = [];
  let s = IDLE_WASH;
  let next = 0;
  for (let t = 0; t < seat + 60; t += 0.1) {
    const on = endAt === undefined ? t < seat : t < endAt;
    s = advanceWashSession(s, { dt: 0.1, vehicleId: 'car', active: on, interior: false, model, endsInS: on ? seat - t : null });
    if (t >= next) { out.push({ s, p: washPoseAt(s) }); next = t + keep; }
  }
  return out;
}
function boxPoints(x0: number, x1: number, dy0: number, dy1: number, y0: number, y1: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = 4;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) {
    if (i !== 0 && i !== n && j !== 0 && j !== n && k !== 0 && k !== n) continue;
    out.push([x0 + ((x1 - x0) * i) / n, dy0 + ((dy1 - dy0) * j) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}
function frameParts(dy: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (const side of [-1, 1]) {
    pts.push(...boxPoints(side * G.legX - G.leg.w / 2, side * G.legX + G.leg.w / 2, dy + G.leg.dy - G.leg.d / 2, dy + G.leg.dy + G.leg.d / 2, 0, G.leg.top));
    // the arch's posts
    pts.push(...boxPoints(side * G.arch.x - G.arch.r, side * G.arch.x + G.arch.r, dy + G.arch.dy - G.arch.r, dy + G.arch.dy + G.arch.r, 0.3, G.arch.top));
  }
  pts.push(...boxPoints(-G.legX, G.legX, dy + G.beam.dy0, dy + G.beam.dy1, G.beam.y0, G.beam.y1));
  return pts;
}
function knifePoints(p: WashPose): [number, number, number][] {
  const kd = p.dy + G.dryer.dy;
  const pts = boxPoints(-G.dryer.top.halfLen, G.dryer.top.halfLen, kd - G.dryer.top.d / 2, kd + G.dryer.top.d / 2, p.dryerTopY, p.dryerTopY + G.dryer.top.h);
  for (const side of [-1, 1]) {
    const x0 = side * p.dryerSideX, x1 = side * (p.dryerSideX + G.dryer.side.w);
    pts.push(...boxPoints(Math.min(x0, x1), Math.max(x0, x1), kd - G.dryer.side.d / 2, kd + G.dryer.side.d / 2, G.dryer.side.y0, G.dryer.side.y1));
  }
  return pts;
}

describe.each(FLEET_SPECS.map((spec) => ({ key: spec.key })))('the whole machine over $key', ({ key }) => {
  const prog = washProgramFor(key);
  const solid = prog.fleet!.solid;
  /** clearance from a bay point in plan units to the vehicle, plan u */
  const gapU = (x: number, dy: number, y: number) => solid.gap({ x: x * M, dy: dy * M, y: y * M }) / M;
  const gap = (p: B3) => solid.gap(p);
  const linkGap = (a: B3, b: B3, r: number) => {
    let m = Infinity;
    for (let i = 0; i <= 10; i++) { const f = i / 10; m = Math.min(m, gap({ x: a.x + (b.x - a.x) * f, dy: a.dy + (b.dy - a.dy) * f, y: a.y + (b.y - a.y) * f }) - r); }
    return m;
  };
  const armGap = (a: ArmState) => Math.min(
    linkGap({ x: a.side * TRACK_X_M, dy: a.rail, y: MOUNT_HEIGHT_M + DETAIL_SPEC.shoulderHeight }, a.elbow, DETAIL_SPEC.radii.upper),
    linkGap(a.elbow, a.wrist, DETAIL_SPEC.radii.fore), gap(a.wrist) - DETAIL_SPEC.radii.wristR);
  const seat = 390;
  const ALL = [
    ...poses(key, seat),
    ...poses(key, seat, 120), ...poses(key, seat, 8),
    // and every 6 s of the detail arms' work
    ...Array.from({ length: 28 }, (_, k) => poses(key, seat, seat - 10 - prog.wipeS + 6 * k, 0.5).filter((x) => x.s.finishing || x.s.phase === 'home')).flat(),
  ];

  it('plays the whole program and its early ends inside the seat', () => {
    const seen = new Set(ALL.map(({ s }) => s.phase));
    for (const ph of [...washChain(false), 'retract', 'return', 'home']) expect(seen, ph).toContain(ph);
    // the program is home before the seat ends
    const full = poses(key, seat);
    const end = full.findIndex(({ s }, i) => i > 20 && s.phase === 'home');
    expect(end * 0.5).toBeLessThan(seat);
    expect(full.some(({ p }) => p.arms.some((a) => a.engage > 0))).toBe(true);
  }, 300_000);

  it('never touches the vehicle with the frame, and its knives follow the vehicle at their gap', () => {
    let frame = Infinity, knives = Infinity, least = Infinity;
    for (const { p } of ALL) {
      if (Math.abs(p.dy - WASH_HOME_DY) < 1e-9 && p.dryEngage === 0) continue;
      for (const [x, dy, y] of frameParts(p.dy)) frame = Math.min(frame, gapU(x, dy, y));
      for (const [x, dy, y] of knifePoints(p)) knives = Math.min(knives, gapU(x, dy, y));
      if (p.dryEngage > 0.999) least = Math.min(least, p.dryerSideX - solid.halfWidthIn(G.dryer.side.y0 * M, G.dryer.side.y1 * M) / M);
    }
    expect(frame).toBeGreaterThan(1.0);
    expect(knives).toBeGreaterThan(0.3);
    // the passes do reach this vehicle: the side knives close to their gap from its flank, and the top knife to its roof
    expect(least).toBeLessThan(G.dryer.side.gap + 1e-6);
    const top = dryerTopContactY(0, prog.shape);
    expect(top - (solid.topAt(0) ?? 0) / M).toBeGreaterThanOrEqual(G.dryer.top.gap - 1e-9);
    expect(top).toBeLessThan(G.dryer.top.retractY);
    // the travel covers its whole length: the knives' line passes its nose and the arch's line its tail
    expect(WASH_TRAVEL.north + G.dryer.dy).toBeLessThan(-prog.shape.halfLenU);
    expect(WASH_TRAVEL.south + G.arch.dy).toBeGreaterThan(prog.shape.halfLenU);
  }, 300_000);

  it('keeps each arm\'s links 0.10 m off the vehicle at every moment, early ends and all, and the pads off it but at a place', () => {
    let least = Infinity, where = '';
    for (const { s, p } of ALL) for (const a of p.arms) {
      const g = armGap(a);
      if (g < least) { least = g; where = `${s.phase}@${s.t.toFixed(2)} ${a.side} ${a.sensor}`; }
      const pad = gap(a.pad);
      expect(pad, `${s.phase}@${s.t.toFixed(2)}`).toBeGreaterThan(-1e-3);
      if (a.engage > 0) expect(isWipe(s.phase)).toBe(true);
      if (!isWipe(s.phase) && s.phase !== 'retract') expect(pad, `${s.phase} clear`).toBeGreaterThan(0.14);
      expect(a.rail, s.phase).toBeGreaterThanOrEqual(DOCK_DY_M - 1e-9);
      expect(a.rail, s.phase).toBeLessThanOrEqual(TRACK_TO_M + 1e-9);
    }
    expect(least, where).toBeGreaterThan(0.10);
  }, 300_000);

  it('keeps the arms docked while the gantry travels, the gantry home while the arms are out, and the two apart', () => {
    for (const { s, p } of ALL) {
      const docked = p.arms.every((a, k) => {
        const st = stowed(k === 0 ? 1 : -1);
        return Math.abs(a.rail - DOCK_DY_M) < 1e-9 && Math.abs(a.q.j2 - st.q.j2) < 1e-9 && Math.abs(a.q.j3 - st.q.j3) < 1e-9;
      });
      if (isPass(s.phase) || s.phase === 'settle') expect(docked, s.phase).toBe(true);
      if (isWipe(s.phase) || s.phase === 'arms_out' || s.phase === 'arms_stow') expect(Math.abs(p.dy - WASH_HOME_DY)).toBeLessThan(1e-9);
      const gantryNorth = (p.dy + G.beam.dy0) * M;
      for (const a of p.arms) expect(gantryNorth - Math.max(a.rail, a.elbow.dy, a.wrist.dy, a.pad.dy), `${s.phase}@${s.t.toFixed(2)}`).toBeGreaterThan(0.5);
    }
  }, 300_000);

  it('lets the vehicle drive through: under the stowed gantry and between the docked arms', () => {
    const p = programPoseAt('home', 1, key);
    expect(G.beam.y0 - prog.shape.topU).toBeGreaterThan(1.0);
    expect(p.dryerTopY - prog.shape.topU).toBeGreaterThan(1.0);
    expect(p.dryerSideX - prog.shape.halfWidthU).toBeGreaterThan(1.0);
    // between the docked arms: 0.6 m a side of its body, and 0.35 m of its mirrors
    for (const a of p.arms) for (const q of [a.pad, a.wrist, a.elbow]) {
      expect(Math.abs(q.x) - solid.bodyHalfWidth).toBeGreaterThan(0.6);
      expect(Math.abs(q.x) - solid.halfWidth).toBeGreaterThan(0.35);
    }
    expect(TRACK_X_M - DETAIL_SPEC.radii.base - solid.bodyHalfWidth).toBeGreaterThan(0.6);
    expect(p.dy + G.beam.dy0).toBeGreaterThan(prog.shape.halfLenU);
  });
});
