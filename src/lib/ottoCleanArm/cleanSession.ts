/**
 * THE CLEANING SESSION — what the OTTO-CLEAN ARM is doing this frame, reduced from
 * what the twin says is true. The same shape as the OTTO-CHARGE ARM's session
 * (roboticService.advanceArmSession), for the same reasons: pure in (previous
 * session, inputs), at most one step along the chain per call so no phase is ever
 * skipped however violently the inputs move, and no module state.
 *
 * THE TWIN OWNS THE STEP, THE RENDERER OWNS THE CHOREOGRAPHY. The engine (otto-q-core
 * 0758) says a car's interior clean is done by its stall's cleaning arm, when it
 * started and when it ends. This reducer plays the cycle inside that window:
 *   · it STARTS when the car is parked in the stall and its clean is in progress;
 *   · each clean phase is given the time the twin has left as it begins (paceClean),
 *     inside bounds a real robot has, and the fixed moves speed up (to MAX_PACE) if
 *     the arm is behind;
 *   · when the step is no longer in progress — done, the car re-tasked, the car gone —
 *     it FINISHES from wherever it is: a wand in the car comes out the way it went in
 *     (cleanArmPose's exit, which works from any pose), a move toward the car turns
 *     back, and the arm goes home and the doors shut, at up to ABORT_SPEED. It never
 *     takes a short cut across the car.
 *
 * ONE EVALUATION. The motion driver steps this reducer once per stall (engine/motion/
 * cleanGate.ts); the renderer draws that session, the fleet's doors read it through
 * doorStore, and the car's right to move is read from it. The doors, the arm and the
 * hold cannot disagree because there is only one of them.
 */

import {
  CLEAN_CHAIN, CLEAN_PHASE_S, CLEAN_SIDE_NOMINAL_S, CLEAN_SIDE_MIN_S, CLEAN_SIDE_MAX_S,
  isCleanHome, type CleanPhase,
} from './cleanArmSpec';
import { cleanJointsAt, type CleanJoints, type CleanSides } from './cleanArmPose';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Largest step the reducer takes in one call, sim seconds — the same guard as the charge arm's. */
export const MAX_CLEAN_STEP_S = 2.0;
/** How fast the arm may hurry home when the step ended before the cycle did. */
export const ABORT_SPEED = 3.0;
/** How fast it may hurry to keep to the twin's end time while the step is still on. */
export const MAX_PACE = 2.0;

export interface CleanSession {
  phase: CleanPhase;
  /** sim seconds spent in `phase` */
  phaseElapsed: number;
  /** 0..1 through `phase` */
  t: number;
  /** the car this cycle is cleaning; held to the end so the arm finishes against the car it entered */
  vehicleId: string | null;
  /** the clean phases' planned lengths, sim seconds, fixed as each one begins */
  cleanA: number;
  cleanB: number;
  /** true once the twin's step is over and the arm is on its way home */
  finishing: boolean;
  /** the joints when the current phase began, for the phases that start from wherever the arm is */
  from: CleanJoints | null;
  /**
   * The car whose cycle this arm has already played to the end, while the twin still
   * calls its step in progress. The twin closes a step on the first tick after its end
   * time, up to a tick after the arm is home; without this the arm would clean the
   * same car again. Cleared as soon as the step is not in progress or the car changes.
   */
  completedFor: string | null;
}

export const IDLE_CLEAN: CleanSession = Object.freeze({
  phase: 'home' as CleanPhase, phaseElapsed: 0, t: 1, vehicleId: null,
  cleanA: CLEAN_SIDE_NOMINAL_S, cleanB: CLEAN_SIDE_NOMINAL_S, finishing: false, from: null,
  completedFor: null,
});

export interface CleanInput {
  /** sim seconds since the previous call */
  dt: number;
  /** the car parked in this stall, or null */
  vehicleId: string | null;
  /** the twin says this car's interior clean is in progress, by this stall's arm, and the car is parked */
  active: boolean;
  /** sim seconds until the twin's step ends, or null when it published no end */
  endsInS: number | null;
  /** which flank this stall's arm cleans first (the far one) and second (the port one) */
  sides: CleanSides;
  /**
   * May the arm leave home for the car? False while the stall's OTTO-CHARGE ARM is
   * moving (reaching for the port or letting go): the doors open as the charge arm
   * mates, and the cleaning arm goes in once the connector is latched, the order Chase
   * set out. Absent reads true.
   */
  mayEnter?: boolean;
}

/** A phase's length at nominal speed, given the session's planned clean lengths. */
export function cleanPhaseLength(p: CleanPhase, s: Pick<CleanSession, 'cleanA' | 'cleanB'>): number {
  if (p === 'home') return Infinity;
  if (p === 'clean_a') return s.cleanA;
  if (p === 'clean_b') return s.cleanB;
  return CLEAN_PHASE_S[p];
}

/** Sim seconds of the cycle still to run from (phase, elapsed), at nominal speed, along the full chain. */
export function remainingCycleS(s: Pick<CleanSession, 'phase' | 'phaseElapsed' | 'cleanA' | 'cleanB'>): number {
  if (s.phase === 'home') return 0;
  const i = CLEAN_CHAIN.indexOf(s.phase);
  let r = Math.max(0, cleanPhaseLength(s.phase, s) - s.phaseElapsed);
  for (let k = i + 1; k < CLEAN_CHAIN.length; k++) r += cleanPhaseLength(CLEAN_CHAIN[k], s);
  return r;
}

/** Fixed motion and clean phases still to come AFTER `phase` on the full chain. */
function after(phase: CleanPhase): { fixed: number; cleans: number } {
  const i = CLEAN_CHAIN.indexOf(phase);
  let fixed = 0, cleans = 0;
  for (let k = i + 1; k < CLEAN_CHAIN.length; k++) {
    const p = CLEAN_CHAIN[k];
    if (p === 'clean_a' || p === 'clean_b') cleans++;
    else fixed += CLEAN_PHASE_S[p];
  }
  return { fixed, cleans };
}

/**
 * The length to give a clean phase as it begins: the twin's time left, less the fixed
 * motion still to come, shared between this clean phase and any still to come. Bounded:
 * the strokes blur below CLEAN_SIDE_MIN_S, and nothing is cleaned for an hour. No end
 * time published -> the nominal length.
 */
export function paceClean(phase: 'clean_a' | 'clean_b', endsInS: number | null): number {
  if (endsInS === null || !Number.isFinite(endsInS)) return CLEAN_SIDE_NOMINAL_S;
  const { fixed, cleans } = after(phase);
  return clamp((endsInS - fixed) / (cleans + 1), CLEAN_SIDE_MIN_S, CLEAN_SIDE_MAX_S);
}

/** The next phase on the way. While finishing, side B is skipped once side A is out. */
function nextPhase(p: CleanPhase, finishing: boolean): CleanPhase {
  if (finishing) {
    if (p === 'raise_a') return 'return';
    if (p === 'swing_b') return 'return';
    if (p === 'return') return 'doors_close';
    if (p === 'doors_close') return 'home';
  }
  const i = CLEAN_CHAIN.indexOf(p);
  return i >= 0 && i + 1 < CLEAN_CHAIN.length ? CLEAN_CHAIN[i + 1] : 'home';
}

/** The phases that start from wherever the arm is, and so capture `from` as they begin. */
const FROM_PHASES: ReadonlySet<CleanPhase> = new Set(['exit_a', 'exit_b', 'ascend_a', 'ascend_b', 'return']);

/**
 * Where to go when the step ends mid-cycle, and at what point of that phase, so the
 * pose is continuous. Mirror phases (doors, lower/raise) resume at 1 - t; generic
 * phases (exit, ascend, return) start from the pose the arm holds. Null: carry on.
 */
function finishInto(phase: CleanPhase, t: number): { phase: CleanPhase; t: number } | null {
  switch (phase) {
    case 'doors_open': return { phase: 'doors_close', t: 1 - t };
    case 'swing_a': return { phase: 'return', t: 0 };
    case 'lower_a': return { phase: 'raise_a', t: 1 - t };
    case 'descend_a': return { phase: 'ascend_a', t: 0 };
    case 'enter_a': case 'clean_a': return { phase: 'exit_a', t: 0 };
    case 'swing_b': return { phase: 'return', t: 0 };
    case 'lower_b': return { phase: 'raise_b', t: 1 - t };
    case 'descend_b': return { phase: 'ascend_b', t: 0 };
    case 'enter_b': case 'clean_b': return { phase: 'exit_b', t: 0 };
    default: return null; // already on the way out or home
  }
}

/** Advance one cleaning arm by one frame. Pure. */
export function advanceCleanSession(prev: CleanSession, input: CleanInput): CleanSession {
  const dt = clamp(Number.isFinite(input.dt) ? input.dt : 0, 0, MAX_CLEAN_STEP_S);
  const { sides } = input;

  if (isCleanHome(prev.phase)) {
    // the same car, still in the same step, after its cycle ran to the end: stay home
    const stillDone = prev.completedFor !== null && input.active && input.vehicleId === prev.completedFor;
    if (!(input.active && input.vehicleId) || stillDone) {
      return { ...IDLE_CLEAN, vehicleId: input.vehicleId, completedFor: stillDone ? prev.completedFor : null };
    }
    // START: the doors open first; each clean phase's length is set as it begins
    return { ...IDLE_CLEAN, phase: 'doors_open', t: 0, vehicleId: input.vehicleId };
  }

  const { phase, phaseElapsed } = prev;
  let { cleanA, cleanB, finishing, from } = prev;
  const vehicleId = prev.vehicleId;
  const completedFor: string | null = null;
  const poseNow = (): CleanJoints =>
    cleanJointsAt(phase, cleanPhaseLength(phase, { cleanA, cleanB }) > 0
      ? clamp(phaseElapsed / cleanPhaseLength(phase, { cleanA, cleanB }), 0, 1) : 1, sides, { from });

  // THE STOP CONDITION: the twin no longer says this car is being cleaned here, or the
  // car in the stall is not the car the arm went into.
  const over = !input.active || input.vehicleId !== vehicleId;
  if (over && !finishing) {
    finishing = true;
    const L = cleanPhaseLength(phase, { cleanA, cleanB });
    const tNow = L > 0 ? clamp(phaseElapsed / L, 0, 1) : 1;
    const into = finishInto(phase, tNow);
    if (into) {
      const fromPose = FROM_PHASES.has(into.phase) ? poseNow() : null;
      const L2 = cleanPhaseLength(into.phase, { cleanA, cleanB });
      // one transition this call; the pose is continuous across it by construction
      return finishStep({ phase: into.phase, phaseElapsed: into.t * L2, vehicleId, cleanA, cleanB, finishing, from: fromPose, completedFor });
    }
  }

  // pace: while the step is on, keep to the twin's end; once it is over, hurry home
  let speed = 1;
  if (finishing) speed = ABORT_SPEED;
  else if (input.endsInS !== null && Number.isFinite(input.endsInS)) {
    const left = remainingCycleS({ phase, phaseElapsed, cleanA, cleanB });
    if (left > 0) speed = clamp(left / Math.max(input.endsInS, 0.25), 1, MAX_PACE);
  }

  const len = cleanPhaseLength(phase, { cleanA, cleanB });
  const budget = dt * speed;
  // THE WAIT FOR THE CHARGE ARM: the doors stand open and the arm stays home until
  // the connector is latched (or no charge arm is working). Static: doors_open's pose
  // at its end is the stowed pose with the doors fully open.
  if (phase === 'doors_open' && !finishing && input.mayEnter === false && phaseElapsed + budget >= len) {
    return finishStep({ phase, phaseElapsed: len, vehicleId, cleanA, cleanB, finishing, from, completedFor });
  }
  if (phaseElapsed + budget < len) {
    return finishStep({ phase, phaseElapsed: phaseElapsed + budget, vehicleId, cleanA, cleanB, finishing, from, completedFor });
  }

  // ONE transition per call (the charge arm's rule: a phase entered and left inside one
  // call is a phase the viewer never sees); the unspent time is dropped.
  const endPose = cleanJointsAt(phase, 1, sides, { from });
  const next = nextPhase(phase, finishing);
  if (next === 'home') {
    // home, doors shut: remember the car if the twin still has its step open
    const still = input.active && input.vehicleId === vehicleId ? vehicleId : null;
    return { ...IDLE_CLEAN, vehicleId: input.vehicleId, completedFor: still };
  }
  if (next === 'clean_a') cleanA = paceClean('clean_a', input.endsInS);
  if (next === 'clean_b') cleanB = paceClean('clean_b', input.endsInS);
  from = FROM_PHASES.has(next) ? endPose : null;
  return finishStep({ phase: next, phaseElapsed: 0, vehicleId, cleanA, cleanB, finishing, from, completedFor });
}

function finishStep(s: Omit<CleanSession, 't'>): CleanSession {
  const L = cleanPhaseLength(s.phase, s);
  const t = Number.isFinite(L) && L > 0 ? clamp(s.phaseElapsed / L, 0, 1) : 1;
  return { ...s, t };
}

/** The joints this session shows. */
export function cleanSessionJoints(s: CleanSession, sides: CleanSides): CleanJoints {
  return cleanJointsAt(s.phase, s.t, sides, { from: s.from });
}

/**
 * The arm's status light, by what it is doing: the OTTO-CHARGE ARM's palette, so one light means
 * one thing. One function for the 3D arm (CleanArm.tsx) and the 2D plan's (Robots2D.tsx).
 */
export function cleanStatusColor(s: Pick<CleanSession, 'phase' | 'finishing'>): number {
  const p = s.phase;
  if (p === 'home') return 0x00e5ff;                       // teal: home, safe
  if (s.finishing) return 0xffb020;                        // amber: on its way out
  if (p === 'clean_a' || p === 'clean_b') return 0x35d07f; // green: working
  if (p.startsWith('enter') || p.startsWith('exit')) return 0xffd54a; // bright amber: through the door
  return 0xffb020;                                         // amber: moving
}

/** May the car in this stall move? Only when its cleaning arm is home and its doors are shut. */
export function cleanLetsCarMove(p: CleanPhase): boolean {
  return isCleanHome(p);
}
