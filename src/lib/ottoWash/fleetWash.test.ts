/**
 * THE DETAIL ARMS ON EACH FLEET VEHICLE: the program the rule makes for it (fleetWash.ts), measured through the whole
 * of the arms' work against that vehicle's own solid (fleetModels/washSolid.ts), with the margins the generic car's
 * tests hold (detailArm.test.ts, washPose.test.ts, and cadYard.test.ts for the pad and the head):
 *   · every place is reached: the pad's face is on the place within 1 mm and square to the rule's direction, and each
 *     sensor the place cleans is under the pad, on its plane, inside what the foam gives;
 *   · the arm is in reach at every point of every path, inside DETAIL_SPEC's limits and DETAIL_FOLD;
 *   · each carriage stays on its track, and no joint or carriage is faster than an arm of this kind;
 *   · every link stays 0.10 m off the vehicle; the wrist's housings 0.08 m; the head and its camera 0.045 m;
 *     the pad's face goes no deeper than its foam gives, 15 mm, and only at a place;
 *   · the two pads stay 0.28 m apart and the two wrists 0.45 m; the stowed gantry stays 0.5 m from every arm;
 *   · a sensor the machine cannot do is left out, and the reason is stated with its number.
 */
import { describe, it, expect } from 'vitest';
import { MOUNT_HEIGHT_M } from '@/lib/ottoChargeArm/cobotSpec';
import { FLEET_SPECS } from '@/lib/fleetModels';
import { isCleanable, sensorMap, PAD_RADIUS_M } from '@/lib/fleetModels/sensorMap';
import {
  DETAIL_FOLD, DETAIL_SPEC, DOCK_DY_M, POLISH_TURN, SIDES, TRACK_TO_M, TRACK_X_M, aim, stowed, zoneSensors, zoneTurns,
  type ArmState, type B3,
} from './detailArm';
import {
  GANTRY_NORTH_M, GANTRY_ROOM_M, HEAD_GAP_M, HOUSING_GAP_M, LINK_GAP_M, PADS_APART_M, PAD_GIVE_M, PLACE_MERGE, ROLL_MAX,
  WRISTS_APART_M, WRIST_BEND_MAX, armRoom, armSouth, fleetDetailProgram, padOnPlace,
} from './fleetWash';
import { programPoseAt } from './washPose';
import { washProgramFor } from './washProgram';
import { DETAIL_ARM, WASH_PHASE_S, WASH_WIPE, WIPE_STATIONS, isWipe, stationOf, type WashPhase } from './washSpec';

const DT = 0.02;
const JOINTS = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'] as const;
type Step = { phase: WashPhase; t: number; arms: readonly [ArmState, ArmState] };

function linkGap(gap: (p: B3) => number, a: B3, b: B3, r: number): number {
  let m = Infinity;
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    m = Math.min(m, gap({ x: a.x + (b.x - a.x) * f, dy: a.dy + (b.dy - a.dy) * f, y: a.y + (b.y - a.y) * f }) - r);
  }
  return m;
}
const shoulder = (a: ArmState): B3 => ({ x: a.side * TRACK_X_M, dy: a.rail, y: MOUNT_HEIGHT_M + DETAIL_SPEC.shoulderHeight });
const dist = (a: B3, b: B3) => Math.hypot(a.x - b.x, a.dy - b.dy, a.y - b.y);
const dot = (a: B3, b: B3) => a.x * b.x + a.dy * b.dy + a.y * b.y;

/** What each vehicle's program was measured to do, for docs/WASH-PER-VEHICLE.md (printed with WASH_REPORT=1). */
const REPORT: Record<string, Record<string, number | string>> = {};

describe.each(FLEET_SPECS.map((spec) => ({ key: spec.key, spec })))('the detail arms on $key', ({ key, spec }) => {
  const prog = washProgramFor(key);
  const fleet = fleetDetailProgram(spec);
  const gap = fleet.gap;
  const map = sensorMap(spec);
  const STEPS: Step[] = [];
  for (const phase of WASH_WIPE) {
    const len = isWipe(phase) ? prog.zoneS[stationOf(phase)] : phase === 'arms_stow' ? prog.stowS : WASH_PHASE_S.arms_out;
    const n = Math.max(1, Math.round(len / DT));
    for (let i = 0; i <= n; i++) STEPS.push({ phase, t: i / n, arms: programPoseAt(phase, i / n, key).arms });
  }
  const each = (f: (a: ArmState, k: number, s: Step, prev: ArmState | null) => void) =>
    STEPS.forEach((s, i) => s.arms.forEach((a, k) => f(a, k, s, i > 0 && STEPS[i - 1].phase === s.phase ? STEPS[i - 1].arms[k] : null)));
  const R: Record<string, number | string> = (REPORT[key] = {});
  const places = SIDES.reduce((n, side) => n + fleet.sensors[side].length, 0);

  it('is the program the wash bay plays for this model, and no other', () => {
    expect(prog.key).toBe(key);
    expect(prog.detail).toBe(fleet);
    expect(washProgramFor(key)).toBe(prog);
    expect(places).toBeGreaterThan(0);
  });

  it('accounts for every sensor of the vehicle: cleaned at a place, or left out with the reason and its number', () => {
    const cleanable = spec.sensors.filter(isCleanable).map((s) => s.id);
    const left = new Set(fleet.skipped.flatMap((s) => s.sensors));
    for (const id of cleanable) {
      const done = fleet.cleaned.has(id), out = left.has(id) || map.buried.some((b) => b.sensor === id);
      expect(done || out, `${id} is neither cleaned nor left out`).toBe(true);
    }
    for (const s of fleet.skipped) {
      expect(s.text.length, s.face).toBeGreaterThan(20);
      expect(Number.isFinite(s.best) || s.why === 'pad', s.face).toBe(true);
    }
    // a sensor wholly left out has none of its faces at a place
    const whole = cleanable.filter((id) => !fleet.cleaned.has(id));
    R.sensors = cleanable.length; R.cleaned = cleanable.length - whole.length; R.places = places;
    R.leftOut = whole.join(' ') || '-';
    R.partly = [...new Set(fleet.skipped.flatMap((s) => s.sensors))].filter((id) => fleet.cleaned.has(id)).join(' ') || '-';
    expect(cleanable.length - whole.length).toBeGreaterThan(0);
  });

  it('puts the pad on every sensor it cleans: under the pad, on its plane, inside what the foam gives', () => {
    let off = 0, plane = 0, tilt = 0, deep = 0, head = Infinity;
    for (const side of SIDES) for (const s of fleet.sensors[side]) {
      const n: B3 = { x: -s.axis.x, dy: -s.axis.dy, y: -s.axis.y };
      expect(Math.abs(gap(s.p)), `${s.id}: the place is on the vehicle`).toBeLessThan(1e-3);
      const faces = map.faces.filter((f) => f.arm === side && (s.faces ?? []).includes(f.id));
      expect(faces.length, s.id).toBeGreaterThan(0);
      for (const f of faces) {
        const d = { x: f.p.x - s.p.x, dy: f.p.dy - s.p.dy, y: f.p.y - s.p.y };
        const across = Math.hypot(d.x - n.x * dot(d, n), d.dy - n.dy * dot(d, n), d.y - n.y * dot(d, n));
        const sin = Math.sqrt(Math.max(0, 1 - dot(n, f.out) ** 2));
        off = Math.max(off, across); plane = Math.max(plane, Math.abs(dot(d, n)));
        tilt = Math.max(tilt, (Math.asin(Math.min(1, sin)) * 180) / Math.PI);
        // the face's centre is under the pad, and the pad turned off the face still holds it inside its give
        expect(across + Math.min(f.r, PLACE_MERGE.faceM), `${s.id} ${f.id}`).toBeLessThanOrEqual(PAD_RADIUS_M + 1e-9);
        expect(Math.abs(dot(d, n)) + Math.min(f.r, PAD_RADIUS_M) * sin, `${s.id} ${f.id}`).toBeLessThanOrEqual(PAD_GIVE_M + PLACE_MERGE.planeM + 1e-9);
      }
      const on = padOnPlace(s.p, s.axis, gap);
      deep = Math.min(deep, on.pad); head = Math.min(head, on.head);
      expect(aim(side, s.rail, s.p, s.axis, s.flip).reachable, `${side} ${s.id}`).toBe(true);
      expect(s.rail).toBeGreaterThan(DOCK_DY_M);
      expect(s.rail).toBeLessThan(TRACK_TO_M);
    }
    R.faceOffMm = +(off * 1000).toFixed(1); R.tiltDeg = +tilt.toFixed(1); R.padDeepMm = +(deep * 1000).toFixed(1); R.headMm = +(head * 1000).toFixed(1);
    expect(deep).toBeGreaterThanOrEqual(-PAD_GIVE_M);
    expect(head).toBeGreaterThan(HEAD_GAP_M);
    void plane;
  });

  it('keeps every joint inside its limits, in reach at every point of every path', () => {
    let elbow = 0, wrist = 0, j4 = 0;
    each((a, k, s) => {
      const at = `${s.phase}@${s.t.toFixed(4)} ${k ? 'W' : 'E'} ${a.sensor}`;
      for (const j of JOINTS) {
        const [lo, hi] = DETAIL_SPEC.limits[j];
        expect(a.q[j], `${at} ${j}`).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(a.q[j], `${at} ${j}`).toBeLessThanOrEqual(hi + 1e-9);
      }
      if (a.esc && !a.mid) expect(aim(a.side, a.rail, a.esc.p, a.esc.axis, a.esc.flip).reachable, at).toBe(true);
      elbow = Math.max(elbow, Math.abs(a.q.j3)); wrist = Math.max(wrist, Math.abs(a.q.j5));
      if (!a.mid && gap(a.pad) < DETAIL_ARM.safeM) j4 = Math.max(j4, Math.abs(a.q.j4));
      expect(a.rail, at).toBeGreaterThanOrEqual(DOCK_DY_M - 1e-9);
      expect(a.rail, at).toBeLessThanOrEqual(TRACK_TO_M + 1e-9);
    });
    R.elbow = +elbow.toFixed(3); R.wrist = +wrist.toFixed(3); R.roll = +j4.toFixed(3);
    expect(elbow).toBeLessThanOrEqual(DETAIL_FOLD.elbowMax + 1e-9);
    expect(wrist).toBeLessThanOrEqual(DETAIL_FOLD.wristMax + 1e-9);
    expect(wrist).toBeLessThan(WRIST_BEND_MAX);
    expect(j4).toBeLessThan(ROLL_MAX);
  }, 300_000);

  it('moves no joint faster than an arm of this kind does, and no carriage faster than its drive', () => {
    const D = Math.PI / 180;
    const limit = { j1: 120 * D, j2: 120 * D, j3: 150 * D, j4: 210 * D, j5: 210 * D, j6: 210 * D };
    const worst: Record<string, number> = {}, where: Record<string, string> = {};
    let rail = 0;
    each((a, k, s, prev) => {
      if (!prev) return;
      for (const j of JOINTS) {
        const v = Math.abs(a.q[j] - prev.q[j]) / DT;
        if (v > (worst[j] ?? 0)) { worst[j] = v; where[j] = `${s.phase}@${s.t.toFixed(4)} ${k ? 'W' : 'E'} ${a.sensor}`; }
      }
      rail = Math.max(rail, Math.abs(a.rail - prev.rail) / DT);
    });
    R.speed = JOINTS.map((j) => `${j} ${((worst[j] ?? 0) / limit[j] * 100).toFixed(0)}%`).join(' '); R.railMps = +rail.toFixed(2);
    for (const j of JOINTS) expect(worst[j], `${j} at ${where[j]}`).toBeLessThan(limit[j]);
    expect(rail).toBeLessThan(DETAIL_ARM.railMps);
  }, 300_000);

  it('joins each phase to the next with no jump', () => {
    for (let i = 1; i < STEPS.length; i++) {
      if (STEPS[i].phase === STEPS[i - 1].phase) continue;
      STEPS[i].arms.forEach((a, k) => {
        const b = STEPS[i - 1].arms[k];
        for (const j of JOINTS) expect(Math.abs(a.q[j] - b.q[j]), `${STEPS[i].phase} ${j}`).toBeLessThan(1e-6);
        expect(Math.abs(a.rail - b.rail)).toBeLessThan(1e-6);
      });
    }
  }, 300_000);

  it('keeps every rigid part of each arm off the vehicle, by the generic car\'s margins', () => {
    let upper = Infinity, fore = Infinity, wrist = Infinity, housings = Infinity, head = Infinity;
    const at = { upper: '', fore: '', wrist: '', housings: '', head: '' };
    each((a, k, s) => {
      const tag = `${s.phase}@${s.t.toFixed(4)} ${k ? 'W' : 'E'} ${a.sensor}`;
      const u = linkGap(gap, shoulder(a), a.elbow, DETAIL_SPEC.radii.upper), f = linkGap(gap, a.elbow, a.wrist, DETAIL_SPEC.radii.fore);
      const w = gap(a.wrist) - DETAIL_SPEC.radii.wristR;
      if (u < upper) { upper = u; at.upper = tag; }
      if (f < fore) { fore = f; at.fore = tag; }
      if (w < wrist) { wrist = w; at.wrist = tag; }
      const room = armRoom(a, gap, 4);
      if (room.housings < housings) { housings = room.housings; at.housings = tag; }
      if (room.head < head) { head = room.head; at.head = tag; }
    });
    R.upperMm = +(upper * 1000).toFixed(0); R.foreMm = +(fore * 1000).toFixed(0); R.wristMm = +(wrist * 1000).toFixed(0);
    R.housingsMm = +(housings * 1000).toFixed(0); R.cameraMm = +(head * 1000).toFixed(0);
    expect(upper, at.upper).toBeGreaterThan(LINK_GAP_M);
    expect(fore, at.fore).toBeGreaterThan(LINK_GAP_M);
    expect(wrist, at.wrist).toBeGreaterThan(LINK_GAP_M);
    // the wrist as the CAD draws it: its actuators, and the camera and bracket beside the pad
    expect(housings, at.housings).toBeGreaterThan(HOUSING_GAP_M);
    expect(head, at.head).toBeGreaterThan(HEAD_GAP_M);
  }, 300_000);

  it('touches the vehicle with the pad only, at a place only, and square to the rule\'s direction', () => {
    const polished = new Map<string, number>();
    each((a, k, s) => {
      const g = gap(a.pad);
      const at = `${s.phase}@${s.t.toFixed(4)} ${k ? 'W' : 'E'} ${a.sensor}`;
      expect(g, at).toBeGreaterThan(-1e-3);
      if (a.engage > 0) {
        const sen = fleet.sensors[a.side].find((x) => x.id === a.sensor)!;
        expect(g, at).toBeLessThan(1e-3);
        expect(dist(a.pad, sen.p), at).toBeLessThan(1e-3);
        expect(dot(a.axis, sen.axis), at).toBeGreaterThan(0.9999);
        const key2 = `${a.side}:${sen.id}`;
        polished.set(key2, Math.max(polished.get(key2) ?? 0, Math.abs(a.q.j6)));
      } else if (a.sensor === null) {
        // on no place's business (riding, tucked, lifting away to wait): never nearer than its hover
        expect(g, at).toBeGreaterThan(DETAIL_ARM.hoverM - 0.01);
      }
    });
    expect(polished.size).toBe(places);
    for (const [key2, turn] of polished) expect(turn, key2).toBeGreaterThan(0.95 * POLISH_TURN);
    for (const z of WIPE_STATIONS) expect(zoneTurns(z, fleet)).toBeGreaterThanOrEqual(Math.max(zoneSensors(1, z, fleet).length, zoneSensors(-1, z, fleet).length));
  }, 300_000);

  it('keeps the two arms apart, and both clear of the stowed gantry', () => {
    let pads = Infinity, wrists = Infinity, room = Infinity, padsAt = '', wristsAt = '';
    for (const s of STEPS) {
      const [e, w] = s.arms;
      const dw = dist(e.wrist, w.wrist), dp = dist(e.pad, w.pad);
      if (dw < wrists) { wrists = dw; wristsAt = `${s.phase}@${s.t.toFixed(4)} ${e.sensor} ${w.sensor}`; }
      if (dp < pads) { pads = dp; padsAt = `${s.phase}@${s.t.toFixed(4)} ${e.sensor} ${w.sensor}`; }
      for (const a of s.arms) room = Math.min(room, GANTRY_NORTH_M - armSouth(a));
    }
    R.padsM = +pads.toFixed(3); R.wristsM = +wrists.toFixed(3); R.gantryM = +room.toFixed(3);
    expect(pads, padsAt).toBeGreaterThan(PADS_APART_M);
    expect(wrists, wristsAt).toBeGreaterThan(WRISTS_APART_M);
    expect(room).toBeGreaterThan(GANTRY_ROOM_M);
  }, 300_000);

  it('starts and ends in the docks, folded', () => {
    const first = STEPS[0].arms, last = STEPS[STEPS.length - 1].arms;
    for (const [k, side] of [[0, 1], [1, -1]] as const) {
      const st = stowed(side);
      for (const arm of [first[k], last[k]]) {
        expect(arm.rail).toBeCloseTo(DOCK_DY_M, 9);
        for (const j of JOINTS) expect(arm.q[j], j).toBeCloseTo(st.q[j], 9);
      }
      // folded in its dock, the arm lets this vehicle drive out with 0.6 m a side (washPose.test.ts)
      for (const p of [st.pad, st.wrist, st.elbow]) expect(Math.abs(p.x) - fleet.solid.halfWidth).toBeGreaterThan(0.25);
    }
    R.wipeS = +prog.wipeS.toFixed(0); R.needS = +fleet.needS.toFixed(0);
    if (process.env.WASH_REPORT) console.log(`WASH ${key} ${JSON.stringify(R)}\n` + fleet.skipped.map((s) => `   left out ${s.side > 0 ? 'E' : 'W'} ${s.face} (${s.label}): ${s.why} ${s.best.toFixed(3)} / ${s.limit} :: ${s.text}`).join('\n'));
  });
});
