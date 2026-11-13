/**
 * DOES THE CLEANING ARM TOUCH ANYTHING IT SHOULD NOT, ON EACH FLEET VEHICLE?
 *
 * cleanArmClearance.test.ts holds the arm to the yard's one generic car. Each fleet vehicle has its own clean program
 * (cleanPrograms.ts), written from its own cabin; this holds each program to its own vehicle: body, open door leaves,
 * door openings, cabin, seats and roof (fleetModels/cabin.ts), over the WHOLE cycle, on both flanks, and beside the
 * OTTO-CHARGE ARM where that vehicle's own mate puts it (mateSolver.solveMate).
 *
 * The margins are cleanArmClearance.test.ts's own (cleanArmFleetClearance.FLEET_MARGIN):
 *   0.10 m  every part outside the wand, to the vehicle and to its open door leaves;
 *   0.03 m  the wand's section to the door opening's edges, and the wand outside the door to a leaf or a sensor;
 *   0.00 m  the wand and nozzle inside the cabin's free volume, 0.01 m off the seats;
 *   0.10 m  the two robots, from each other.
 * Each test prints the worst it measured (FLEET-CLEAN ...): docs/CLEAN-ARM-PER-VEHICLE.md quotes those lines.
 *
 * WHAT THE CHARGE ARM IS HERE: its links as capsules from its own forward kinematics (cleanArmClearance.test.ts's
 * model), plus its two connectors, with its base where the mate puts it. The pair as the yard DRAWS them (the CAD,
 * triangle to triangle) is held for the generic car by robotics/cadYard.test.ts and is not run per vehicle here.
 */
import { describe, it, expect } from 'vitest';
import { FLEET_SPECS } from '@/lib/fleetModels/fleet';
import { cabinProfile } from '@/lib/fleetModels/cabin';
import { mateTarget } from '@/lib/fleetModels/ports';
import { OTTO_CHARGE_ARM, MOUNT_HEIGHT_M, PEDESTAL_TO_CAR_CENTRE_M, METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { forwardElbow, forwardWristCentre, forwardTCP, STOWED, type JointAngles } from '@/lib/ottoChargeArm/cobotIK';
import { poseFor } from '@/lib/ottoChargeArm/armMotion';
import { ARM_REACH, connectorFace, solveMate, type Mate } from '@/lib/ottoChargeArm/mateSolver';
import type { ArmPhase } from '@/lib/ottoChargeArm/armStateMachine';
import { CHARGER_STALL_ANGLE, DCFC_ROW_PITCH } from '@/lib/sitePlan';
import { CLEAN_ARM, isCleanWork, phaseMove, phaseVisit, wandMayBeInside, cleanPhaseOf, type CleanPhase } from './cleanArmSpec';
import {
  cleanArmPoints, cleanJointsAt, doorsAt, exitEnd, phaseSide, sidesFor, visitGeom, visitSide,
  type CleanJoints, type CleanProgram, type CleanSides,
} from './cleanArmPose';
import { cleanArmCapsules, type Capsule } from './cleanArmClearance';
import { FLEET_COLUMN_TOP, FLEET_MARGIN, jointLimitBreach, measureFleetPose, type FleetPoseMeasure } from './cleanArmFleetClearance';
import { cleanProgramFor } from './cleanPrograms';
import { advanceCleanSession, cleanSessionJoints, IDLE_CLEAN, type CleanSession } from './cleanSession';

const BOTH: CleanSides[] = [sidesFor(1), sidesFor(-1)];
const CASES = FLEET_SPECS.map((spec) => ({ key: spec.key, spec }));

/** Every pose of a program's cycle on one stall side: the clean phases at 1/240, the moves at 1/40. */
function* cycle(program: CleanProgram, sides: CleanSides): Generator<{ phase: CleanPhase; t: number; q: CleanJoints }> {
  for (const phase of program.chain) {
    const n = isCleanWork(phase) ? 240 : 40;
    for (let i = 0; i <= n; i++) yield { phase, t: i / n, q: cleanJointsAt(phase, i / n, sides, { program }) };
  }
}

interface Worst { linkCar: number; linkLeaf: number; aperture: number; wandOut: number; room: number; seat: number; at: Record<string, string> }
const newWorst = (): Worst => ({ linkCar: Infinity, linkLeaf: Infinity, aperture: Infinity, wandOut: Infinity, room: Infinity, seat: Infinity, at: {} });
function take(w: Worst, m: FleetPoseMeasure, label: string): void {
  const set = (k: Exclude<keyof Worst, 'at'>, v: number) => { if (v < w[k]) { w[k] = v; w.at[k] = label; } };
  set('linkCar', m.linkCar); set('linkLeaf', m.linkLeaf); set('aperture', m.aperture);
  set('wandOut', Math.min(m.wandSkin, m.wandLeaf, m.wandEquipment)); set('room', m.room); set('seat', m.seat);
}
const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : 'n/a');

describe.each(CASES)('$key: the cleaning arm and the vehicle it cleans', ({ spec }) => {
  const cabin = cabinProfile(spec);
  const program = cleanProgramFor(spec.key);

  it('has a program of its own that visits each door opening it can stand at, on both flanks', () => {
    expect(program.key).toBe(spec.key);
    expect(program.pivotZ).toBeCloseTo(spec.dims.width / 2 + 0.2, 6);
    const far = program.visits.filter((v) => v.flank === 'far'), port = program.visits.filter((v) => v.flank === 'port');
    // the far flank first, then the port flank, the same openings on each, front to rear
    expect(program.visits.map((v) => v.flank)).toEqual([...far.map(() => 'far'), ...port.map(() => 'port')]);
    expect(port.map((v) => v.aperture)).toEqual(far.map((v) => v.aperture));
    expect(far.map((v) => v.aperture)).toEqual([...far.map((v) => v.aperture)].sort((a, b) => a - b));
    expect(far.length).toBeGreaterThanOrEqual(1);
    expect(far.length).toBeLessThanOrEqual(cabin.apertures.length);
    expect(program.chain.length).toBe(1 + 8 * program.visits.length + 2);
    for (const v of program.visits) {
      expect(v.strokes.length).toBeGreaterThanOrEqual(2);
      expect(v.planeZ).toBeCloseTo(cabin.apertures[v.aperture].z, 6);
    }
  });

  it('keeps every joint inside the arm\'s travel and reach, all cycle', () => {
    let n = 0;
    for (const sides of BOTH) {
      for (const { phase, t, q } of cycle(program, sides)) {
        expect(jointLimitBreach(q), `${phase}@${t.toFixed(3)}`).toBeNull();
        // J1's reach: the SCARA's two links carry the mast axis no further than they are long
        const pt = cleanArmPoints(q);
        expect(Math.hypot(pt.mastTop.x - CLEAN_ARM.mountX, pt.mastTop.z)).toBeLessThanOrEqual(CLEAN_ARM.link1.len + CLEAN_ARM.link2.len + 1e-9);
        n++;
      }
    }
    expect(n).toBe(2 * (program.visits.length * (241 + 7 * 41) + 3 * 41));
  });

  it('holds every margin against its own body, door leaves, door openings, cabin and seats, all cycle, both flanks', { timeout: 600_000 }, () => {
    const w = newWorst();
    let crossings = 0;
    for (const sides of BOTH) {
      for (const { phase, t, q } of cycle(program, sides)) {
        const vi = phaseVisit(phase);
        const side = phaseSide(phase, sides, program);
        const m = measureFleetPose(cabin, q, side, vi >= 0 ? program.visits[vi].aperture : 0, doorsAt(phase, t));
        // stowed and swinging, the arm is over the roof: the park test below measures that, vehicle by vehicle
        const parked = phaseMove(phase) === null || phaseMove(phase) === 'swing';
        take(w, parked ? { ...m, linkCar: Infinity } : m, `${phase}@${t.toFixed(3)} side ${side}`);
        if (Number.isFinite(m.aperture)) {
          crossings++;
          // the wand crosses the body only while the phase says it may be inside
          expect(wandMayBeInside(phase), `${phase}@${t.toFixed(3)} crosses the body`).toBe(true);
        }
        // and outside those phases no part of it is inside the body at all
        if (!wandMayBeInside(phase)) expect(Number.isFinite(m.room), `${phase}@${t.toFixed(3)} inside the body`).toBe(false);
      }
    }
    console.log(`FLEET-CLEAN ${spec.key}: ${program.visits.length} visits; links to body ${f3(w.linkCar)} m (${w.at.linkCar}), to a door leaf ${f3(w.linkLeaf)} m (${w.at.linkLeaf}); `
      + `wand in the opening ${f3(w.aperture)} m (${w.at.aperture}); wand outside ${f3(w.wandOut)} m; cabin room ${f3(w.room)} m; seats ${f3(w.seat)} m (${w.at.seat})`);
    expect(crossings).toBeGreaterThan(program.visits.length * 200);
    expect(w.linkCar, `links to the body, ${w.at.linkCar}`).toBeGreaterThanOrEqual(FLEET_MARGIN.link);
    expect(w.linkLeaf, `links to a door leaf, ${w.at.linkLeaf}`).toBeGreaterThanOrEqual(FLEET_MARGIN.link);
    expect(w.aperture, `wand in the door opening, ${w.at.aperture}`).toBeGreaterThanOrEqual(FLEET_MARGIN.aperture);
    expect(w.wandOut, `wand outside the door, ${w.at.wandOut}`).toBeGreaterThanOrEqual(FLEET_MARGIN.wandOutside);
    expect(w.room, `cabin room, ${w.at.room}`).toBeGreaterThanOrEqual(FLEET_MARGIN.room);
    expect(w.seat, `seats, ${w.at.seat}`).toBeGreaterThanOrEqual(FLEET_MARGIN.seat);
  });

  it('cleans what it says: the nozzle mouth 2-8 cm off a cushion or the floor, 2-15 cm off a seat back, under the headliner', () => {
    for (const v of program.visits.filter((q) => q.flank === 'far')) {
      const g = visitGeom(program, program.visits.indexOf(v));
      v.strokes.forEach((k, i) => {
        if (k.what === 'turn' || i === 0) return;
        // side +1: the stroke as written
        const q = cleanJointsAt(cleanPhaseOf('clean', 0), 0, sidesFor(-1), { program: { ...program, visits: [{ ...v, strokes: [k, k] }] } });
        const tip = cleanArmPoints(q).tip;
        expect(g.planeZ - tip.z, `${k.what} k${i}: inside the body side`).toBeGreaterThan(0.2);
        const gap = cabin.seatClearance(tip);
        if (k.what.includes('cushion')) { expect(gap, `${k.what} k${i}`).toBeGreaterThan(0.02); expect(gap, `${k.what} k${i}`).toBeLessThan(0.08); }
        if (k.what.includes('back')) { expect(gap, `${k.what} k${i}`).toBeGreaterThan(0.02); expect(gap, `${k.what} k${i}`).toBeLessThan(0.15); }
        if (k.what.includes('floor')) { expect(tip.y - cabin.floorTop, `${k.what} k${i}`).toBeGreaterThan(0.015); expect(tip.y - cabin.floorTop, `${k.what} k${i}`).toBeLessThan(0.08); }
        if (k.what === 'air pass') { const under = cabin.ceilingAt(tip.x, tip.z) - tip.y; expect(under, `air pass k${i}`).toBeGreaterThan(0.08); expect(under, `air pass k${i}`).toBeLessThan(0.2); }
      });
    }
  });

  it('comes out the way it went in when the step ends early, from any point at any opening', { timeout: 600_000 }, () => {
    const w = newWorst();
    let aborts = 0;
    for (const sides of BOTH) {
      program.visits.forEach((v, vi) => {
        const side = visitSide(program, vi, sides);
        const g = visitGeom(program, vi);
        for (const move of ['enter', 'clean'] as const) {
          const n = move === 'clean' ? 30 : 8;
          for (let i = 0; i <= n; i++) {
            const from = cleanJointsAt(cleanPhaseOf(move, vi), i / n, sides, { program });
            aborts++;
            for (let k = 0; k <= 20; k++) {
              const q = cleanJointsAt(cleanPhaseOf('exit', vi), k / 20, sides, { from, program });
              expect(jointLimitBreach(q)).toBeNull();
              take(w, measureFleetPose(cabin, q, side, v.aperture), `exit@${(k / 20).toFixed(2)} from ${move}_${vi}@${(i / n).toFixed(2)} side ${side}`);
            }
            // and on up to the ready pose from where the exit left it
            const end = exitEnd(from, side, g);
            for (let k = 0; k <= 8; k++) {
              const q = cleanJointsAt(cleanPhaseOf('ascend', vi), k / 8, sides, { from: end, program });
              take(w, measureFleetPose(cabin, q, side, v.aperture), `ascend@${(k / 8).toFixed(2)} after ${move}_${vi}@${(i / n).toFixed(2)} side ${side}`);
            }
          }
        }
      });
    }
    expect(aborts).toBe(2 * program.visits.length * (31 + 9));
    console.log(`FLEET-CLEAN ${spec.key} way out from anywhere: links to body ${f3(w.linkCar)} m, to a door leaf ${f3(w.linkLeaf)} m; wand in the opening ${f3(w.aperture)} m (${w.at.aperture}); `
      + `wand outside ${f3(w.wandOut)} m; cabin room ${f3(w.room)} m; seats ${f3(w.seat)} m (${w.at.seat})`);
    expect(w.linkCar, w.at.linkCar).toBeGreaterThanOrEqual(FLEET_MARGIN.link);
    expect(w.linkLeaf, w.at.linkLeaf).toBeGreaterThanOrEqual(FLEET_MARGIN.link);
    expect(w.aperture, w.at.aperture).toBeGreaterThanOrEqual(FLEET_MARGIN.aperture);
    expect(w.wandOut, w.at.wandOut).toBeGreaterThanOrEqual(FLEET_MARGIN.wandOutside);
    expect(w.room, w.at.room).toBeGreaterThanOrEqual(FLEET_MARGIN.room);
    expect(w.seat, w.at.seat).toBeGreaterThanOrEqual(FLEET_MARGIN.seat);
  });

  it('parks above it: stowed and swinging, the whole arm stays 0.10 m over the vehicle and over its doors as they move', () => {
    let over = Infinity, clear = Infinity, leaf = Infinity;
    let top = cabin.height;
    for (const e of cabin.equipment) top = Math.max(top, e.y1);
    for (const sides of BOTH) {
      for (const { phase, t, q } of cycle(program, sides)) {
        const move = phaseMove(phase);
        if (move !== null && move !== 'swing') continue;
        const pt = cleanArmPoints(q);
        const caps = cleanArmCapsules(pt, FLEET_COLUMN_TOP);
        for (const c of [...caps.outside, caps.wand, ...caps.nozzle] as Capsule[]) {
          over = Math.min(over, Math.min(c.a.y, c.b.y) - c.r - top);
          for (let k = 0; k <= 12; k++) {
            const p = { x: c.a.x + ((c.b.x - c.a.x) * k) / 12, y: c.a.y + ((c.b.y - c.a.y) * k) / 12, z: c.a.z + ((c.b.z - c.a.z) * k) / 12 };
            clear = Math.min(clear, cabin.bodyClearance(p) - c.r);
            // the doors swing, slide or lift while the arm is stowed, and stand open while it swings
            const opens = phase === 'doors_open' || phase === 'doors_close' ? [0.25, 0.5, 0.75, 1] : [1];
            for (const o of opens) leaf = Math.min(leaf, cabin.leafClearance(p, o) - c.r);
          }
        }
      }
    }
    console.log(`FLEET-CLEAN ${spec.key} parked and swinging: lowest part ${f3(over)} m over the vehicle's top (${top.toFixed(3)} m); ${f3(clear)} m from the vehicle; ${f3(leaf)} m from a door leaf`);
    expect(over, 'height over the vehicle\'s top').toBeGreaterThanOrEqual(0.1);
    expect(clear, 'to the vehicle').toBeGreaterThanOrEqual(0.1);
    expect(leaf, 'to a door leaf').toBeGreaterThanOrEqual(0.1);
  });

  it('cannot reach the next stall\'s arm or its car: two reach envelopes fit between neighbours', () => {
    let reach = 0;
    for (const sides of BOTH) {
      for (const { q } of cycle(program, sides)) {
        const pt = cleanArmPoints(q);
        for (const p of [pt.elbow, pt.mastTop, pt.pivot, pt.knuckle, pt.tip]) reach = Math.max(reach, Math.hypot(p.x - CLEAN_ARM.mountX, p.z));
      }
    }
    const apart = DCFC_ROW_PITCH * Math.sin((CHARGER_STALL_ANGLE * Math.PI) / 180) * METRES_PER_PLAN_UNIT;
    expect(2 * (reach + 0.2)).toBeLessThan(apart);
    // and a neighbour's widest open door leaf stands outside that reach
    const leafOut = Math.max(...cabin.leaves.map((l) => l.box.z1));
    expect(apart - leafOut - reach).toBeGreaterThan(0.5);
  });

  it('plays its own program from the twin\'s row: every phase in order, home by the step\'s end, and home from anywhere', () => {
    const sides = sidesFor(-1);
    const play = (stopAt: number | null) => {
      let s: CleanSession = IDLE_CLEAN;
      const seen: CleanPhase[] = [];
      const after: CleanPhase[] = [];
      const TOTAL = 348;
      for (let t = 0; t < TOTAL + 120; t += 0.25) {
        const active = stopAt === null ? t < TOTAL + 20 : t < stopAt;
        s = advanceCleanSession(s, { dt: 0.25, vehicleId: 'car-1', active, endsInS: Math.max(0, TOTAL - t), sides, model: spec.key });
        if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
        if (!active && after[after.length - 1] !== s.phase) after.push(s.phase);
        // the drawn joints are this program's, and inside the arm's travel at every step
        expect(jointLimitBreach(cleanSessionJoints(s, sides))).toBeNull();
        if (s.phase !== 'home') expect(s.program).toBe(spec.key);
        if (s.phase === 'home' && seen.length > 1) return { seen, after, homeAt: t };
      }
      return { seen, after, homeAt: Infinity };
    };
    const full = play(null);
    expect(full.seen).toEqual([...program.chain, 'home']);
    expect(full.homeAt).toBeGreaterThan(348 - 4);
    expect(full.homeAt).toBeLessThan(348 + 2);
    // the step ends with the wand in the car at the LAST opening, and in the middle of the first: home inside 30 s
    for (const stopAt of [60, 200, 300]) {
      const cut = play(stopAt);
      expect(cut.seen[cut.seen.length - 1]).toBe('home');
      expect(cut.homeAt - stopAt).toBeLessThan(30);
      // once the step is over it only comes out, goes up and goes home: it starts no other opening
      // (the first frame after the stop is the phase it was in, turned into its way out)
      expect(cut.after.slice(1).some((p) => ['swing', 'lower', 'descend', 'enter', 'clean'].includes(phaseMove(p) ?? ''))).toBe(false);
    }
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
 * The OTTO-CHARGE ARM as capsules in the CAR frame, its base where a mate put it (`slide` along its rail, `cross`
 * toward the car). cleanArmClearance.test.ts's model, plus the head's two connectors (the working one `plunge`
 * metres forward). Radii are its housings' rounded UP.
 */
function chargeArmCapsules(a: JointAngles, toward: 1 | -1, slide: number, cross: number, head: Mate['head'], plunge: number): Capsule[] {
  const s = OTTO_CHARGE_ARM;
  const toCar = (p: { x: number; y: number; z: number }) => ({
    x: toward > 0 ? -(p.x + slide) : p.x + slide,
    y: p.y + MOUNT_HEIGHT_M,
    z: toward > 0 ? PEDESTAL_TO_CAR_CENTRE_M - cross - p.z : -PEDESTAL_TO_CAR_CENTRE_M + cross + p.z,
  });
  const base = toCar({ x: 0, y: 0, z: 0 });
  const shoulder = toCar({ x: 0, y: s.shoulderHeight, z: 0 });
  const elbow = toCar(forwardElbow(a, s));
  const wristB = forwardWristCentre(a, s), tcpB = forwardTCP(a, s);
  const wrist = toCar(wristB), tcp = toCar(tcpB);
  const out: Capsule[] = [
    { name: 'charge base', a: base, b: shoulder, r: s.radii.base * 1.15 },
    { name: 'charge upper arm', a: shoulder, b: elbow, r: Math.max(s.radii.shoulder, s.radii.upper * 1.2, s.radii.elbow) },
    { name: 'charge forearm', a: elbow, b: wrist, r: Math.max(s.radii.elbow, s.radii.fore * 1.2) },
    { name: 'charge wrist', a: wrist, b: tcp, r: s.radii.wristR * 1.3 },
  ];
  const L = Math.hypot(tcpB.x - wristB.x, tcpB.y - wristB.y, tcpB.z - wristB.z) || 1;
  const fwd = { x: (tcpB.x - wristB.x) / L, y: (tcpB.y - wristB.y) / L, z: (tcpB.z - wristB.z) / L };
  for (const h of ARM_REACH.heads) {
    const face = connectorFace(a, h, s);
    const push = h === head ? plunge : 0;
    out.push({
      name: `charge connector ${h}`, r: s.radii.wristR * 1.3,
      a: toCar({ x: face.x - fwd.x * 0.16, y: face.y - fwd.y * 0.16, z: face.z - fwd.z * 0.16 }),
      b: toCar({ x: face.x + fwd.x * push, y: face.y + fwd.y * push, z: face.z + fwd.z * push }),
    });
  }
  return out;
}

describe.each(CASES)('$key: the cleaning arm beside the charge arm at this vehicle\'s own mate', ({ spec }) => {
  const cabin = cabinProfile(spec);
  const program = cleanProgramFor(spec.key);
  const DUTY: ArmPhase[] = ['unstow', 'approach', 'align', 'insert', 'latch', 'charging', 'unlatch', 'extract', 'retract'];

  it('keeps the two robots 0.10 m apart in every pose the twin lets them share, and the charge arm off the open doors', { timeout: 600_000 }, () => {
    let worst = Infinity, at = '', leafWorst = Infinity, leafAt = '', mates = 0;
    // every charger stands on the car's LEFT (depotPlacement.towardFor is -1); +1 is kept for a yard that has both
    for (const toward of [-1, 1] as const) {
      const sides = sidesFor(toward);
      const m = solveMate(mateTarget(spec)!, toward === 1);
      if (m.ok) mates++;
      // what the charge arm may be doing while the cleaning arm is out: stowed at its rail's middle, or latched
      const still: { label: string; caps: Capsule[] }[] = [{ label: 'stowed', caps: chargeArmCapsules(STOWED, toward, 0, 0, null, 0) }];
      const target = { port: m.axisPort, normal: m.normal };
      if (m.ok) {
        const a = { ...poseFor({ phase: 'charging', t: 0 }, target, OTTO_CHARGE_ARM).angles, j6: m.ik!.j6 };
        still.push({ label: 'latched', caps: chargeArmCapsules(a, toward, m.slideM, m.crossM, m.head, ARM_REACH.headStrokeM) });
      }
      const pair = (clean: Capsule[], charge: Capsule[], label: string) => {
        for (const c of clean) for (const ch of charge) {
          const d = segSeg(c.a, c.b, ch.a, ch.b) - c.r - ch.r;
          if (d < worst) { worst = d; at = `${c.name} vs ${ch.name}, ${label}, toward ${toward}`; }
        }
      };
      const leaves = (charge: Capsule[], label: string) => {
        for (const ch of charge) for (let k = 0; k <= 16; k++) {
          const p = { x: ch.a.x + ((ch.b.x - ch.a.x) * k) / 16, y: ch.a.y + ((ch.b.y - ch.a.y) * k) / 16, z: ch.a.z + ((ch.b.z - ch.a.z) * k) / 16 };
          const d = cabin.leafClearance(p) - ch.r;
          if (d < leafWorst) { leafWorst = d; leafAt = `${ch.name}, ${label}, toward ${toward}`; }
        }
      };
      // (A) the cleaning arm out over the car, the charge arm stowed or latched
      for (const phase of program.chain) {
        const n = isCleanWork(phase) ? 80 : 12;
        for (let i = 0; i <= n; i++) {
          const caps = cleanArmCapsules(cleanArmPoints(cleanJointsAt(phase, i / n, sides, { program })), FLEET_COLUMN_TOP);
          const clean = [...caps.outside, caps.wand, ...caps.nozzle];
          for (const c of still) pair(clean, c.caps, `clean ${phase}@${(i / n).toFixed(2)}, charge ${c.label}`);
        }
      }
      for (const c of still) leaves(c.caps, `charge ${c.label}`);
      // (B) the cleaning arm home (the doors may stand open), the charge arm through its duty cycle and its base's moves
      if (m.ok) {
        const home = cleanArmCapsules(cleanArmPoints(cleanJointsAt('home', 0, sides, { program })), FLEET_COLUMN_TOP);
        const homeCaps = [...home.outside, home.wand, ...home.nozzle];
        const AT_INLET = new Set<ArmPhase>(['align', 'insert', 'latch', 'charging', 'unlatch', 'extract']);
        for (const phase of DUTY) {
          for (let i = 0; i <= 6; i++) {
            const a = { ...poseFor({ phase, t: i / 6 }, target, OTTO_CHARGE_ARM).angles, j6: m.ik!.j6 };
            const inlet = AT_INLET.has(phase);
            const caps = chargeArmCapsules(a, toward, inlet ? m.slideM : m.unfoldSlideM, inlet ? m.crossM : 0, m.head, inlet ? ARM_REACH.headStrokeM : 0);
            pair(homeCaps, caps, `clean home, charge ${phase}@${(i / 6).toFixed(2)}`);
            leaves(caps, `charge ${phase}@${(i / 6).toFixed(2)}`);
          }
        }
        // the carriage's run along the rail, arm folded; then the standoff pose carried in on the cross-slide
        const hold = { ...poseFor({ phase: 'approach', t: 1 }, target, OTTO_CHARGE_ARM).angles, j6: m.ik!.j6 };
        for (let k = 0; k <= 16; k++) {
          const rail = chargeArmCapsules(STOWED, toward, (m.unfoldSlideM * k) / 16, 0, null, 0);
          pair(homeCaps, rail, `clean home, charge on its rail ${k}/16`); leaves(rail, `charge on its rail ${k}/16`);
          const inn = chargeArmCapsules(hold, toward, m.unfoldSlideM + ((m.slideM - m.unfoldSlideM) * k) / 16, (m.crossM * k) / 16, m.head, 0);
          pair(homeCaps, inn, `clean home, charge base in ${k}/16`); leaves(inn, `charge base in ${k}/16`);
        }
      }
    }
    console.log(`FLEET-CLEAN ${spec.key} beside the charge arm (${mates} of 2 stall sides can charge it): robots ${f3(worst)} m apart at ${at}; charge arm to an open door leaf ${f3(leafWorst)} m at ${leafAt}`);
    expect(mates).toBeGreaterThanOrEqual(1);
    expect(worst, `${worst.toFixed(4)} m at ${at}`).toBeGreaterThanOrEqual(0.1);
    expect(leafWorst, `charge arm to an open door leaf ${leafWorst.toFixed(4)} m at ${leafAt}`).toBeGreaterThanOrEqual(0.1);
  });
});
