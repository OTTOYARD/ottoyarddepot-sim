// THE ORDER OF A MATE, as one function the 3D yard and the 2D plan both play (armFleetClearance.test.ts holds this
// order clear of every fleet vehicle). The machine goes through five stops, one at a time, and back the same way:
//   0 home: base at the stall's middle, arm folded
//   1 base where the arm unfolds, arm folded
//   2 the same place, arm at its standoff pose (here the session's unstow, approach and retract play)
//   3 base where it mates along the rail, arm holding the standoff pose
//   4 cross-slide in (here the session's align to extract play, with the car's connector forward)
// At each step the arm takes the next stop's pose FIRST and only then does the base move. A mate the solver refuses
// (the inlet is on the car's other side) moves nothing.
import { poseFor, slewAngles, type ArmPose, type ArmTarget } from './armMotion';
import type { ArmPhase } from './armStateMachine';
import { STOWED, type JointAngles } from './cobotIK';
import { OTTO_CHARGE_ARM, type CobotSpec } from './cobotSpec';
import { ARM_REACH } from './mateSolver';
import { isArmHome } from './roboticService';
import type { ArmMate } from './vehiclePort';

/** The base's speed along its rail, the cross-slide's, and a connector's plunge. Metres a second of depot time. */
export const RAIL_SPEED_MPS = 1.0;
export const CROSS_SPEED_MPS = 0.25;
export const PLUNGE_SPEED_MPS = 0.15;

/** The phases the arm plays at the inlet, with the cross-slide in. */
export const AT_INLET: ReadonlySet<ArmPhase> = new Set<ArmPhase>(['align', 'insert', 'latch', 'charging', 'unlatch', 'extract']);

export interface MateSeq {
  /** which of the five stops the machine is at */
  stop: number;
  /** the carriage along its rail and the cross-slide toward the car, metres */
  slide: number;
  cross: number;
  /** each connector's plunge, metres forward */
  ccs: number;
  nacs: number;
  /** the last mate's base positions: a release goes back through the stops it came by */
  last: { unfold: number; slide: number; cross: number };
  /** the joint angles drawn: they chase the requested pose at the arm's bounded joint speed */
  shown: JointAngles;
  latch: number;
}

export function newMateSeq(): MateSeq {
  return { stop: 0, slide: 0, cross: 0, ccs: 0, nacs: 0, last: { unfold: 0, slide: 0, cross: 0 }, shown: { ...STOWED }, latch: 0 };
}

const FOLDED: ArmPose = { angles: STOWED, latch: 0, engaged: false, ok: true };
const gap = (x: JointAngles, y: JointAngles) => Math.max(
  Math.abs(x.j1 - y.j1), Math.abs(x.j2 - y.j2), Math.abs(x.j3 - y.j3), Math.abs(x.j4 - y.j4), Math.abs(x.j5 - y.j5));

/**
 * Advance the machine by `dt` seconds of depot time and return the pose it asks for. `mate` null is a car whose
 * port the twin has not said: the arm works from the stall's middle, as it did before it had a base stage.
 * `s.shown` is slewed here; the caller draws `s.shown`, `s.slide`, `s.cross`, `s.ccs` and `s.nacs`.
 */
export function stepMateSeq(
  s: MateSeq, phase: ArmPhase, t: number, target: ArmTarget | null, mate: ArmMate | null, dt: number,
  spec: CobotSpec = OTTO_CHARGE_ARM,
): ArmPose {
  const ok = !!mate?.mate.ok;
  const out = !isArmHome(phase) && ok;
  const step = (cur: number, goal: number, rate: number) => cur + Math.max(-rate * dt, Math.min(rate * dt, goal - cur));
  const want = !out ? 0 : AT_INLET.has(phase) ? 4 : 2;
  if (ok) s.last = { unfold: mate!.mate.unfoldSlideM, slide: mate!.mate.slideM, cross: mate!.mate.crossM };
  const stopBase = (n: number) => ({ slide: n === 0 ? 0 : n <= 2 ? s.last.unfold : s.last.slide, cross: n === 4 ? s.last.cross : 0 });
  const roll = (a: JointAngles): JointAngles => (ok ? { ...a, j6: mate!.j6 } : a);
  const standoff = target && ok ? roll(poseFor({ phase: 'approach', t: 1 }, target, spec).angles) : STOWED;
  const stopArm = (n: number) => (n <= 1 ? STOWED : standoff);
  const headsBack = s.ccs < 0.004 && s.nacs < 0.004;
  const dir = Math.sign(want - s.stop);
  let request: JointAngles | null = null; // null: the session's own pose plays
  if (dir !== 0) {
    const n = s.stop + dir;
    const g = stopBase(n);
    request = stopArm(n);
    if (gap(s.shown, request) < 0.06 && headsBack) {
      s.slide = step(s.slide, g.slide, RAIL_SPEED_MPS);
      s.cross = step(s.cross, g.cross, CROSS_SPEED_MPS);
      if (Math.abs(s.slide - g.slide) < 0.01 && Math.abs(s.cross - g.cross) < 0.004) {
        s.slide = g.slide;
        s.cross = g.cross;
        s.stop = n;
      }
    }
  } else if (s.stop === 0) {
    s.slide = step(s.slide, 0, RAIL_SPEED_MPS);
    s.cross = step(s.cross, 0, CROSS_SPEED_MPS);
  }
  // The connector the car takes is forward only while the machine is at the inlet and staying there.
  const working = ok && s.stop === 4 && want === 4;
  s.ccs = step(s.ccs, working && mate!.mate.head === 'CCS1' ? ARM_REACH.headStrokeM : 0, PLUNGE_SPEED_MPS);
  s.nacs = step(s.nacs, working && mate!.mate.head === 'NACS' ? ARM_REACH.headStrokeM : 0, PLUNGE_SPEED_MPS);

  // No car has ever docked here: no inlet to solve to, the arm sits folded.
  let pose: ArmPose = FOLDED;
  if (target) {
    if (!mate) pose = poseFor({ phase, t }, target, spec);
    else if (!ok) pose = { ...FOLDED, ok: false };
    else if (request) pose = { ...FOLDED, angles: request };
    else if (s.stop !== 0) {
      // The head's roll keeps the connector upright on this approach (0 on a square side mate).
      const p = poseFor({ phase, t }, target, spec);
      pose = p.ok ? { ...p, angles: roll(p.angles) } : p;
    }
  }
  s.shown = slewAngles(s.shown, pose.angles, dt);
  return pose;
}
