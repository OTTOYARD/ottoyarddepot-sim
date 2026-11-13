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
 * ONE PROGRAM PER VEHICLE (2026-11-13). The cycle a session plays is its vehicle's CleanProgram (cleanArmPose.ts,
 * cleanPrograms.ts): the openings it visits and the strokes at each. The twin says which car is in the stall, the
 * gate passes its model key as the cycle starts, and the session keeps it to the end: the arm finishes on the
 * program it started. A car the twin does not name is cleaned by the generic program, as before.
 *
 * ONE EVALUATION. The motion driver steps this reducer once per stall (engine/motion/
 * cleanGate.ts); the renderer draws that session, the fleet's doors read it through
 * doorStore, and the car's right to move is read from it. The doors, the arm and the
 * hold cannot disagree because there is only one of them.
 */

import {
  CLEAN_SIDE_NOMINAL_S, CLEAN_SIDE_MIN_S, CLEAN_SIDE_MAX_S, cleanPhaseOf,
  isCleanHome, isCleanWork, phaseMove, phaseVisit, type CleanPhase,
} from './cleanArmSpec';
import { cleanJointsAt, GENERIC_PROGRAM, type CleanJoints, type CleanProgram, type CleanSides } from './cleanArmPose';
import { cleanProgramFor } from './cleanPrograms';

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
  /** the clean phases' planned lengths, sim seconds, fixed as each one begins: the first and second opening's */
  cleanA: number;
  cleanB: number;
  /** ...and the third and fourth opening's, on a vehicle whose program visits that many */
  cleanC?: number;
  cleanD?: number;
  /** the program this cycle plays: the vehicle's fleet model key. Absent: the generic car's. Set as the cycle starts. */
  program?: string;
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
  /**
   * The arm stands still: it found an item in the cabin and waits for an attendant to secure it (otto-q-core 0814,
   * foundItems.ts). The twin says so. Every joint keeps its pose until the stop ends. Absent reads false.
   */
  held?: boolean;
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
   * The model of the car in the stall, as the twin names it (fleetModels/assign.fleetModelKeyFor), or null. Read as
   * the cycle starts; a cycle under way keeps the program it started.
   */
  model?: string | null;
  /**
   * May the arm leave home for the car? False while the stall's OTTO-CHARGE ARM is
   * moving (reaching for the port or letting go): the doors open as the charge arm
   * mates, and the cleaning arm goes in once the connector is latched, the order Chase
   * set out. Absent reads true.
   */
  mayEnter?: boolean;
  /**
   * Sim seconds the arm must still stand still for an item it found in the cabin (0814), or 0. The twin's end time
   * already counts this wait, so the caller passes `endsInS` less it: the arm's own work is as long as before.
   */
  heldS?: number;
}

type Planned = Pick<CleanSession, 'cleanA' | 'cleanB' | 'cleanC' | 'cleanD'>;
const PLAN_KEYS = ['cleanA', 'cleanB', 'cleanC', 'cleanD'] as const;

/** A phase's length at nominal speed, given the session's planned clean lengths. */
export function cleanPhaseLength(p: CleanPhase, s: Planned, program: CleanProgram = GENERIC_PROGRAM): number {
  if (p === 'home') return Infinity;
  if (isCleanWork(p)) return s[PLAN_KEYS[phaseVisit(p)]] ?? CLEAN_SIDE_NOMINAL_S;
  return program.seconds[p] ?? 0;
}

/** Sim seconds of the cycle still to run from (phase, elapsed), at nominal speed, along the full chain. */
export function remainingCycleS(s: Pick<CleanSession, 'phase' | 'phaseElapsed' | 'program'> & Planned): number {
  if (s.phase === 'home') return 0;
  const program = cleanProgramFor(s.program);
  const i = program.chain.indexOf(s.phase);
  let r = Math.max(0, cleanPhaseLength(s.phase, s, program) - s.phaseElapsed);
  for (let k = i + 1; k < program.chain.length; k++) r += cleanPhaseLength(program.chain[k], s, program);
  return r;
}

/** Fixed motion and clean phases still to come AFTER `phase` on the full chain. */
function after(phase: CleanPhase, program: CleanProgram): { fixed: number; cleans: number } {
  const i = program.chain.indexOf(phase);
  let fixed = 0, cleans = 0;
  for (let k = i + 1; k < program.chain.length; k++) {
    const p = program.chain[k];
    if (isCleanWork(p)) cleans++;
    else fixed += program.seconds[p] ?? 0;
  }
  return { fixed, cleans };
}

/**
 * The length to give a clean phase as it begins: the twin's time left, less the fixed
 * motion still to come, shared between this clean phase and any still to come. Bounded:
 * the strokes blur below CLEAN_SIDE_MIN_S, and nothing is cleaned for an hour. No end
 * time published -> the nominal length.
 */
export function paceClean(phase: CleanPhase, endsInS: number | null, program: CleanProgram = GENERIC_PROGRAM): number {
  if (endsInS === null || !Number.isFinite(endsInS)) return CLEAN_SIDE_NOMINAL_S;
  const { fixed, cleans } = after(phase, program);
  return clamp((endsInS - fixed) / (cleans + 1), CLEAN_SIDE_MIN_S, CLEAN_SIDE_MAX_S);
}

/** The next phase on the way. While finishing, the openings still to come are skipped once the arm is out and up. */
function nextPhase(p: CleanPhase, finishing: boolean, program: CleanProgram): CleanPhase {
  if (finishing) {
    const m = phaseMove(p);
    if (m === 'raise' || m === 'swing') return 'return';
    if (p === 'return') return 'doors_close';
    if (p === 'doors_close') return 'home';
  }
  const i = program.chain.indexOf(p);
  return i >= 0 && i + 1 < program.chain.length ? program.chain[i + 1] : 'home';
}

/** The phases that start from wherever the arm is, and so capture `from` as they begin. */
const startsFromPose = (p: CleanPhase): boolean => {
  const m = phaseMove(p);
  return m === 'exit' || m === 'ascend' || p === 'return';
};

/**
 * Where to go when the step ends mid-cycle, and at what point of that phase, so the
 * pose is continuous. Mirror phases (doors, lower/raise) resume at 1 - t; generic
 * phases (exit, ascend, return) start from the pose the arm holds. Null: carry on.
 */
function finishInto(phase: CleanPhase, t: number): { phase: CleanPhase; t: number } | null {
  if (phase === 'doors_open') return { phase: 'doors_close', t: 1 - t };
  const i = phaseVisit(phase);
  switch (phaseMove(phase)) {
    case 'swing': return { phase: 'return', t: 0 };
    case 'lower': return { phase: cleanPhaseOf('raise', i), t: 1 - t };
    case 'descend': return { phase: cleanPhaseOf('ascend', i), t: 0 };
    case 'enter': case 'clean': return { phase: cleanPhaseOf('exit', i), t: 0 };
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
    // a vehicle whose program visits no opening is one this arm cannot clean (cleanPrograms.ts): it stays home
    const startWith = cleanProgramFor(input.model);
    if (!(input.active && input.vehicleId) || stillDone || startWith.visits.length === 0) {
      return { ...IDLE_CLEAN, vehicleId: input.vehicleId, completedFor: stillDone ? prev.completedFor : null };
    }
    // START: the doors open first; each clean phase's length is set as it begins
    const started: CleanSession = { ...IDLE_CLEAN, phase: 'doors_open', t: 0, vehicleId: input.vehicleId };
    if (startWith !== GENERIC_PROGRAM) started.program = startWith.key;
    return started;
  }

  const program = cleanProgramFor(prev.program);
  const { phase, phaseElapsed } = prev;
  let { finishing, from } = prev;
  const plan: Planned = { cleanA: prev.cleanA, cleanB: prev.cleanB };
  if (prev.cleanC !== undefined) plan.cleanC = prev.cleanC;
  if (prev.cleanD !== undefined) plan.cleanD = prev.cleanD;
  const vehicleId = prev.vehicleId;
  const completedFor: string | null = null;
  const keep = (): Pick<CleanSession, 'program'> & Planned => (prev.program === undefined ? plan : { ...plan, program: prev.program });
  const lengthOf = (p: CleanPhase) => cleanPhaseLength(p, plan, program);
  const poseNow = (): CleanJoints =>
    cleanJointsAt(phase, lengthOf(phase) > 0 ? clamp(phaseElapsed / lengthOf(phase), 0, 1) : 1, sides, { from, program });
  const done = (s: Pick<CleanSession, 'phase' | 'phaseElapsed' | 'from'>): CleanSession =>
    finishStep({ ...s, vehicleId, finishing, completedFor, ...keep() }, program);

  // THE STOP CONDITION: the twin no longer says this car is being cleaned here, or the
  // car in the stall is not the car the arm went into.
  const over = !input.active || input.vehicleId !== vehicleId;
  if (over && !finishing) {
    finishing = true;
    const L = lengthOf(phase);
    const tNow = L > 0 ? clamp(phaseElapsed / L, 0, 1) : 1;
    const into = finishInto(phase, tNow);
    if (into) {
      const fromPose = startsFromPose(into.phase) ? poseNow() : null;
      // one transition this call; the pose is continuous across it by construction
      return done({ phase: into.phase, phaseElapsed: into.t * lengthOf(into.phase), from: fromPose });
    }
  }

  // THE STOP FOR A FOUND ITEM: while the twin says an attendant has not secured it, the arm keeps its pose. Only an
  // arm that works stops: one already on its way home goes home (the car left, or the step is over).
  if (!finishing && (input.heldS ?? 0) > 0) {
    return { ...done({ phase, phaseElapsed, from }), held: true };
  }

  // pace: while the step is on, keep to the twin's end; once it is over, hurry home
  let speed = 1;
  if (finishing) speed = ABORT_SPEED;
  else if (input.endsInS !== null && Number.isFinite(input.endsInS)) {
    const left = remainingCycleS({ phase, phaseElapsed, ...keep() });
    if (left > 0) speed = clamp(left / Math.max(input.endsInS, 0.25), 1, MAX_PACE);
  }

  const len = lengthOf(phase);
  const budget = dt * speed;
  // THE WAIT FOR THE CHARGE ARM: the doors stand open and the arm stays home until
  // the connector is latched (or no charge arm is working). Static: doors_open's pose
  // at its end is the stowed pose with the doors fully open.
  if (phase === 'doors_open' && !finishing && input.mayEnter === false && phaseElapsed + budget >= len) {
    return done({ phase, phaseElapsed: len, from });
  }
  if (phaseElapsed + budget < len) {
    return done({ phase, phaseElapsed: phaseElapsed + budget, from });
  }

  // ONE transition per call (the charge arm's rule: a phase entered and left inside one
  // call is a phase the viewer never sees); the unspent time is dropped.
  const endPose = cleanJointsAt(phase, 1, sides, { from, program });
  const next = nextPhase(phase, finishing, program);
  if (next === 'home') {
    // home, doors shut: remember the car if the twin still has its step open
    const still = input.active && input.vehicleId === vehicleId ? vehicleId : null;
    return { ...IDLE_CLEAN, vehicleId: input.vehicleId, completedFor: still };
  }
  if (isCleanWork(next)) plan[PLAN_KEYS[phaseVisit(next)]] = paceClean(next, input.endsInS, program);
  from = startsFromPose(next) ? endPose : null;
  return done({ phase: next, phaseElapsed: 0, from });
}

function finishStep(s: Omit<CleanSession, 't'>, program: CleanProgram): CleanSession {
  const L = cleanPhaseLength(s.phase, s, program);
  const t = Number.isFinite(L) && L > 0 ? clamp(s.phaseElapsed / L, 0, 1) : 1;
  return { ...s, t };
}

/** The program a session plays: its vehicle's, or the generic car's. */
export function cleanSessionProgram(s: Pick<CleanSession, 'program'>): CleanProgram {
  return cleanProgramFor(s.program);
}

/** The joints this session shows. */
export function cleanSessionJoints(s: CleanSession, sides: CleanSides): CleanJoints {
  return cleanJointsAt(s.phase, s.t, sides, { from: s.from, program: cleanProgramFor(s.program) });
}

/**
 * The arm's status light, by what it is doing: the OTTO-CHARGE ARM's palette, so one light means
 * one thing. One function for the 3D arm (CleanArm.tsx) and the 2D plan's (Robots2D.tsx).
 */
export function cleanStatusColor(s: Pick<CleanSession, 'phase' | 'finishing' | 'held'>): number {
  const p = s.phase;
  if (p === 'home') return 0x00e5ff;                       // teal: home, safe
  if (s.held) return 0xff5ea8;                             // pink: stopped for an item in the cabin, a person is needed
  if (s.finishing) return 0xffb020;                        // amber: on its way out
  if (isCleanWork(p)) return 0x35d07f;                     // green: working
  if (p.startsWith('enter') || p.startsWith('exit')) return 0xffd54a; // bright amber: through the door
  return 0xffb020;                                         // amber: moving
}

/** May the car in this stall move? Only when its cleaning arm is home and its doors are shut. */
export function cleanLetsCarMove(p: CleanPhase): boolean {
  return isCleanHome(p);
}
