/**
 * The two detail arms, measured through the whole of their work (arms out, the four zones, arms stowed):
 *   · every sensor is in reach, and every joint stays inside its limits and never jumps;
 *   · no joint and no carriage moves faster than an arm of this kind can;
 *   · every link keeps its distance from the car, and only the pad touches it, only on a sensor;
 *   · the two arms keep apart, and each carriage stays on its track.
 */
import { describe, it, expect } from 'vitest';
import { MOUNT_HEIGHT_M } from '@/lib/ottoChargeArm/cobotSpec';
import {
  DETAIL_FOLD, DETAIL_SPEC, DOCK_DY_M, POLISH_TURN, SENSORS, SIDES, TRACK_TO_M, TRACK_X_M, aim, carGapM, stowed, zoneSensors,
  zoneTurns, type ArmState, type B3,
} from './detailArm';
import { programPoseAt } from './washPose';
import { DETAIL_ARM, WASH_PHASE_S, WASH_WIPE, WIPE_STATIONS } from './washSpec';

const DT = 0.02;
type Step = { phase: string; t: number; arms: readonly [ArmState, ArmState] };
const STEPS: Step[] = [];
for (const phase of WASH_WIPE) {
  const n = Math.round(WASH_PHASE_S[phase as keyof typeof WASH_PHASE_S] / DT);
  for (let i = 0; i <= n; i++) STEPS.push({ phase, t: i / n, arms: programPoseAt(phase, i / n).arms });
}
const each = (f: (a: ArmState, k: number, s: Step, prev: ArmState | null) => void) =>
  STEPS.forEach((s, i) => s.arms.forEach((a, k) => f(a, k, s, i > 0 && STEPS[i - 1].phase === s.phase ? STEPS[i - 1].arms[k] : null)));
const JOINTS = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'] as const;
/** The least distance from a link (a line from a to b, radius r) to the car, metres. */
function linkGap(a: B3, b: B3, r: number): number {
  let m = Infinity;
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    m = Math.min(m, carGapM({ x: a.x + (b.x - a.x) * f, dy: a.dy + (b.dy - a.dy) * f, y: a.y + (b.y - a.y) * f }) - r);
  }
  return m;
}
const shoulder = (a: ArmState): B3 => ({ x: a.side * TRACK_X_M, dy: a.rail, y: MOUNT_HEIGHT_M + DETAIL_SPEC.shoulderHeight });

describe('the sensors', () => {
  it('lists twelve on each side of the car, three in each of four zones', () => {
    for (const side of SIDES) {
      expect(SENSORS[side]).toHaveLength(12);
      expect(new Set(SENSORS[side].map((s) => s.id)).size).toBe(12);
      for (const z of WIPE_STATIONS) { expect(zoneSensors(side, z), z).toHaveLength(3); expect(zoneTurns(z)).toBe(3); }
    }
    // the two arms go round the roof lidar opposite ways
    expect(zoneSensors(1, 'roof').map((s) => s.id)).toEqual(['pod_fore', 'pod_side', 'pod_aft']);
    expect(zoneSensors(-1, 'roof').map((s) => s.id)).toEqual(['pod_aft', 'pod_side', 'pod_fore']);
  }, 120_000);

  it('puts every sensor on the car, with the pad facing into it, in reach of its arm', () => {
    for (const side of SIDES) for (const s of SENSORS[side]) {
      expect(Math.abs(carGapM(s.p)), s.id).toBeLessThan(1e-3);
      expect(Math.hypot(s.axis.x, s.axis.dy, s.axis.y)).toBeCloseTo(1, 9);
      // a step back along the axis is outside the car; a step along it is inside
      expect(carGapM({ x: s.p.x - s.axis.x * 0.05, dy: s.p.dy - s.axis.dy * 0.05, y: s.p.y - s.axis.y * 0.05 }), s.id).toBeGreaterThan(0.02);
      expect(aim(side, s.rail, s.p, s.axis, s.flip).reachable, `${side} ${s.id}`).toBe(true);
      expect(s.rail).toBeGreaterThan(DOCK_DY_M);
      expect(s.rail).toBeLessThan(TRACK_TO_M);
    }
  }, 120_000);

  it('mirrors the west arm\'s sensors from the east arm\'s', () => {
    for (const w of SENSORS[-1]) {
      const e = SENSORS[1].find((s) => s.id === w.id)!;
      expect(w.p.x).toBeCloseTo(-e.p.x, 6);
      expect(w.p.dy).toBeCloseTo(e.p.dy, 6);
      expect(w.p.y).toBeCloseTo(e.p.y, 6);
    }
  }, 120_000);
});

describe('the arms through their work', () => {
  it('keeps every joint inside its limits', () => {
    each((a, _k, s) => {
      for (const j of JOINTS) {
        const [lo, hi] = DETAIL_SPEC.limits[j];
        expect(a.q[j], `${s.phase}@${s.t.toFixed(3)} ${j}`).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(a.q[j], `${s.phase}@${s.t.toFixed(3)} ${j}`).toBeLessThanOrEqual(hi + 1e-9);
      }
    });
    // the forearm's roll stays well away from its limit, so it never has to go round the other way
    // (it reaches the limit only above the track, where the wrist turns over: `mid`)
    let j4 = 0;
    each((a) => { if (!a.mid && carGapM(a.pad) < DETAIL_ARM.safeM) j4 = Math.max(j4, Math.abs(a.q.j4)); });
    expect(j4).toBeLessThan(2.7);
  }, 120_000);

  it('is in reach at every point of every path, and never folds past what its own parts allow', () => {
    // the CAD's clash check found where the arm's castings meet (DETAIL_FOLD): the limits are in DETAIL_SPEC, and the
    // solver says "not reachable" when a pose would need more
    let elbow = 0, wrist = 0;
    each((a, k, s) => {
      if (a.esc && !a.mid) {
        expect(aim(a.side, a.rail, a.esc.p, a.esc.axis, a.esc.flip).reachable, `${s.phase}@${s.t.toFixed(3)} ${k ? 'W' : 'E'} ${a.sensor}`).toBe(true);
      }
      elbow = Math.max(elbow, Math.abs(a.q.j3)); wrist = Math.max(wrist, Math.abs(a.q.j5));
    });
    expect(elbow).toBeLessThanOrEqual(DETAIL_FOLD.elbowMax + 1e-9);
    expect(wrist).toBeLessThanOrEqual(DETAIL_FOLD.wristMax + 1e-9);
    expect(wrist).toBeLessThan(1.66);  // the clash check measured the wrist clear at 1.66, and found the clash at 1.85
  }, 120_000);

  it('moves no joint faster than an arm of this kind does, and no carriage faster than its drive', () => {
    // A 1.75 m collaborative arm's joints: base and shoulder 120 deg/s, elbow 150 deg/s, wrists 210 deg/s
    // (read 2026-11-12, https://www.universal-robots.com/manuals/latest/en/techsheets/ur20/, via search results).
    // ASSUMPTION: this longer arm is held to the same joint speeds.
    const D = Math.PI / 180;
    const limit = { j1: 120 * D, j2: 120 * D, j3: 150 * D, j4: 210 * D, j5: 210 * D, j6: 210 * D };
    const worst: Record<string, number> = {};
    let rail = 0;
    each((a, _k, _s, prev) => {
      if (!prev) return;
      for (const j of JOINTS) worst[j] = Math.max(worst[j] ?? 0, Math.abs(a.q[j] - prev.q[j]) / DT);
      rail = Math.max(rail, Math.abs(a.rail - prev.rail) / DT);
    });
    for (const j of JOINTS) expect(worst[j], j).toBeLessThan(limit[j]);
    expect(rail).toBeLessThan(DETAIL_ARM.railMps);
    expect(rail).toBeGreaterThan(0.8); // and it does ride its track
  }, 120_000);

  it('joins each phase to the next with no jump', () => {
    for (let i = 1; i < STEPS.length; i++) {
      if (STEPS[i].phase === STEPS[i - 1].phase) continue;
      STEPS[i].arms.forEach((a, k) => {
        const b = STEPS[i - 1].arms[k];
        for (const j of JOINTS) expect(Math.abs(a.q[j] - b.q[j]), `${STEPS[i].phase} ${j}`).toBeLessThan(1e-6);
        expect(Math.abs(a.rail - b.rail)).toBeLessThan(1e-6);
      });
    }
  }, 120_000);

  it('keeps every link off the car: the upper arm, the forearm and the wrist', () => {
    let upper = Infinity, fore = Infinity, wrist = Infinity;
    each((a) => {
      upper = Math.min(upper, linkGap(shoulder(a), a.elbow, DETAIL_SPEC.radii.upper));
      fore = Math.min(fore, linkGap(a.elbow, a.wrist, DETAIL_SPEC.radii.fore));
      // the wrist's housing: a ball at the wrist centre
      wrist = Math.min(wrist, carGapM(a.wrist) - DETAIL_SPEC.radii.wristR);
    });
    expect(upper).toBeGreaterThan(0.10);
    expect(fore).toBeGreaterThan(0.10);
    expect(wrist).toBeGreaterThan(0.10);
  }, 120_000);

  it('touches the car with the pad only, on a sensor only, and square to it', () => {
    const polished = new Map<string, number>();
    each((a, k, s) => {
      const gap = carGapM(a.pad);
      const at = `${s.phase}@${s.t.toFixed(3)} ${k ? 'W' : 'E'}`;
      expect(gap, at).toBeGreaterThan(-1e-3);
      if (a.engage > 0) {
        const sen = SENSORS[a.side].find((x) => x.id === a.sensor)!;
        expect(gap, at).toBeLessThan(1e-3);
        expect(Math.hypot(a.pad.x - sen.p.x, a.pad.dy - sen.p.dy, a.pad.y - sen.p.y), at).toBeLessThan(1e-3);
        expect(a.axis.x * sen.axis.x + a.axis.dy * sen.axis.dy + a.axis.y * sen.axis.y, at).toBeGreaterThan(0.9999);
        const key = `${a.side}:${sen.id}`;
        polished.set(key, Math.max(polished.get(key) ?? 0, Math.abs(a.q.j6)));
      } else if (a.sensor === null) {
        // on no sensor's business (riding, tucked, lifting away to wait): never nearer than its hover
        expect(gap, at).toBeGreaterThan(DETAIL_ARM.hoverM - 0.01);
      }
    });
    // every sensor of both arms was polished, the pad turning its quarter turn each way
    expect(polished.size).toBe(24);
    for (const [key, turn] of polished) expect(turn, key).toBeGreaterThan(0.95 * POLISH_TURN);
  }, 120_000);

  it('keeps the two arms apart, and their pads on opposite faces of the roof lidar', () => {
    let pads = Infinity, wrists = Infinity;
    for (const s of STEPS) {
      const [e, w] = s.arms;
      wrists = Math.min(wrists, Math.hypot(e.wrist.x - w.wrist.x, e.wrist.dy - w.wrist.dy, e.wrist.y - w.wrist.y));
      pads = Math.min(pads, Math.hypot(e.pad.x - w.pad.x, e.pad.dy - w.pad.dy, e.pad.y - w.pad.y));
      // on the roof lidar the two pads face each other across the dome: never on the same side of it
      if (e.engage > 0 && w.engage > 0 && s.phase === 'wipe_roof') {
        expect(e.axis.x * w.axis.x + e.axis.dy * w.axis.dy, `${s.t}`).toBeLessThan(-0.5);
      }
    }
    // nearest: the two pads 0.30 m apart across the roof lidar, and 0.50 m apart side by side on the nose and the tail
    expect(pads).toBeGreaterThan(0.28);
    expect(wrists).toBeGreaterThan(0.45);
  }, 120_000);

  it('starts and ends in the docks at the exit end, folded along the tracks, clear of a car driving out', () => {
    const first = STEPS[0].arms, last = STEPS[STEPS.length - 1].arms;
    for (const [k, side] of [[0, 1], [1, -1]] as const) {
      const st = stowed(side);
      for (const arm of [first[k], last[k]]) {
        expect(arm.rail).toBeCloseTo(DOCK_DY_M, 9);
        for (const j of JOINTS) expect(arm.q[j], j).toBeCloseTo(st.q[j], 9);
      }
      // folded, nothing of the arm comes inboard of 1.6 m from the drive line: a car 2.0 m wide passes with 0.6 m a side
      for (const p of [st.pad, st.wrist, st.elbow]) expect(Math.abs(p.x)).toBeGreaterThan(1.6);
      // and the pad hangs straight down over its rinse cup
      expect(st.axis.y).toBeLessThan(-0.999);
    }
    expect(DOCK_DY_M).toBeLessThan(-4.5);
  }, 120_000);
});
