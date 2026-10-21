/**
 * THE WASH SESSION — what a bay's rollover machine is doing this frame, reduced from what
 * the twin says is true. The same shape as the OTTO-CLEAN ARM's session (cleanSession.ts)
 * for the same reasons: pure in (previous session, inputs), at most one phase transition
 * per call so no phase is skipped however the inputs move, and no module state.
 *
 * THE TWIN OWNS THE SEAT, THE RENDERER OWNS THE CHOREOGRAPHY. The engine seats a car in a
 * wash or detail bay and times the work (otto-q-core 0746), and the snapshot says when the
 * seat started and when it ends (0762, `bay_seat`). This reducer plays the machine's
 * program inside that window:
 *   · it STARTS when the car is parked on the bay's pose and its seat is on;
 *   · the program's length is fixed as it starts (paceProgram): the passes stretch or
 *     shrink within what a real machine can do, and a detail seat's vacuum takes what is
 *     left after the exterior;
 *   · when the seat ends first, or the car is not the one the machine started on, it
 *     FINISHES from wherever it is: wands out the way they went in, doors shut, brushes
 *     and air knives off the car at their own speed, then home at WASH_ABORT_SPEED. It
 *     never moves over the car with anything still on it.
 *
 * ONE EVALUATION. The motion driver steps this once per bay (engine/motion/washGate.ts);
 * WashGantry.tsx draws that session, the doors read it through doorStore, and the car's
 * right to move is read from it.
 */
import {
  INTERIOR_FIXED_S, PASS_NOMINAL_S, PASS_SCALE_MAX, PASS_SCALE_MIN, PASSES_NOMINAL_S, VACUUM_MAX_S,
  VACUUM_MIN_S, VACUUM_NOMINAL_S, WASH_ABORT_SPEED, WASH_END_MARGIN_S, WASH_HOME_DY, WASH_PHASE_S,
  WASH_RETURN_UPS, isPass, washChain, type WashPhase,
} from './washSpec';
import { washPoseAt, type WashPose } from './washPose';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Largest step the reducer takes in one call, sim seconds (the arms' guard). */
export const MAX_WASH_STEP_S = 2.0;

export interface WashSession {
  phase: WashPhase;
  /** sim seconds spent in `phase` */
  phaseElapsed: number;
  /** 0..1 through `phase` */
  t: number;
  /** the car this program is for; held to the end so the machine finishes on the car it started on */
  vehicleId: string | null;
  /** this program includes the interior clean (a detail seat) */
  interior: boolean;
  /** the passes' pace: 1 = nominal (PASS_NOMINAL_S); fixed when the program starts */
  passScale: number;
  /** the vacuum's length, sim seconds; fixed when the program starts */
  vacuumS: number;
  /** the seat is over and the machine is on its way home */
  finishing: boolean;
  /** the machine's pose when the current phase began, for the phases that start from wherever it is */
  from: WashPose | null;
  /**
   * The car whose program this machine has already played to the end, while the twin still
   * has its seat on (the twin closes a seat on the first tick after its timer). Without this
   * the machine would wash the same car again. Cleared when the seat is off or the car changes.
   */
  completedFor: string | null;
}

export const IDLE_WASH: WashSession = Object.freeze({
  phase: 'home' as WashPhase, phaseElapsed: 0, t: 1, vehicleId: null, interior: false,
  passScale: 1, vacuumS: VACUUM_NOMINAL_S, finishing: false, from: null, completedFor: null,
});

export interface WashInput {
  /** sim seconds since the previous call */
  dt: number;
  /** the car in this bay, or null */
  vehicleId: string | null;
  /** the twin has this car's seat on in this bay, and the car stands on the bay's pose */
  active: boolean;
  /** the seat is a detail seat: the interior is cleaned before the exterior */
  interior: boolean;
  /** sim seconds until the twin's seat ends, or null when it published no end */
  endsInS: number | null;
  /**
   * Sim seconds since the twin seated the car (0762 `bay_seat.since`), or null when it published no start. A machine
   * that first sees a car well into its seat (a viewer that opened the page mid-wash) joins the program where the
   * twin's seat has it, so every viewer shows the same pass and it agrees with the card's meter.
   */
  sinceS?: number | null;
}

/**
 * The time a car takes to pull in and stop before the program starts, sim seconds: the twin's robotic lanes allow
 * half a minute (otto-q-core 0746: pull in 0.5, program, pull out 0.5).
 */
export const PULL_IN_S = 30;
/** A car first seen this far into its seat is joined in progress; a car seen sooner is still pulling in. */
export const JOIN_LATE_S = 50;

/** A phase's length at nominal speed for this session. */
export function washPhaseLength(p: WashPhase, s: Pick<WashSession, 'passScale' | 'vacuumS' | 'from'>): number {
  if (p === 'home') return Infinity;
  if (isPass(p)) return PASS_NOMINAL_S[p] * s.passScale;
  if (p === 'vacuum') return s.vacuumS;
  if (p === 'return') {
    const dy = s.from?.dy ?? WASH_HOME_DY;
    return Math.max(1, Math.abs(dy - WASH_HOME_DY) / WASH_RETURN_UPS + 1);
  }
  return WASH_PHASE_S[p];
}

/**
 * The program's pace for a seat that ends in `endsInS` sim seconds: how much the passes
 * stretch or shrink, and how long the vacuum runs. No end published -> nominal.
 */
export function paceProgram(interior: boolean, endsInS: number | null): { passScale: number; vacuumS: number } {
  if (endsInS === null || !Number.isFinite(endsInS)) return { passScale: 1, vacuumS: VACUUM_NOMINAL_S };
  const avail = endsInS - WASH_END_MARGIN_S - WASH_PHASE_S.done;
  if (!interior) {
    return { passScale: clamp(avail / PASSES_NOMINAL_S, PASS_SCALE_MIN, PASS_SCALE_MAX), vacuumS: VACUUM_NOMINAL_S };
  }
  const forVacuum = avail - INTERIOR_FIXED_S - PASSES_NOMINAL_S;
  if (forVacuum >= VACUUM_MIN_S) return { passScale: 1, vacuumS: Math.min(forVacuum, VACUUM_MAX_S) };
  // a short seat: the passes give up time down to their floor, the vacuum keeps its floor
  const passes = avail - INTERIOR_FIXED_S - VACUUM_MIN_S;
  return { passScale: clamp(passes / PASSES_NOMINAL_S, PASS_SCALE_MIN, 1), vacuumS: VACUUM_MIN_S };
}

/** Sim seconds of the program still to run from (phase, elapsed), at nominal speed. */
export function remainingProgramS(s: Pick<WashSession, 'phase' | 'phaseElapsed' | 'interior' | 'passScale' | 'vacuumS' | 'from'>): number {
  if (s.phase === 'home') return 0;
  const chain = washChain(s.interior);
  const i = chain.indexOf(s.phase);
  let r = Math.max(0, washPhaseLength(s.phase, s) - s.phaseElapsed);
  if (i < 0) return r;
  for (let k = i + 1; k < chain.length; k++) r += washPhaseLength(chain[k], s);
  return r;
}

/** The next phase on the way home once the seat is over. */
function finishingNext(p: WashPhase): WashPhase {
  switch (p) {
    case 'wands_out': return 'wands_up';
    case 'wands_up': return 'doors_close';
    case 'doors_close': return 'return';
    case 'retract': return 'return';
    default: return 'home';
  }
}

/**
 * Where to go when the seat ends mid-program, and at what point of that phase, so the pose
 * is continuous. Mirror phases resume at 1 - t; the rest start from the pose the machine
 * holds. Null: already on the way home.
 */
function finishInto(phase: WashPhase, t: number): { phase: WashPhase; t: number } | null {
  switch (phase) {
    case 'settle': case 'done': return { phase: 'home', t: 0 };
    case 'doors_open': return { phase: 'doors_close', t: 1 - t };
    case 'wands_down': return { phase: 'wands_up', t: 0 }; // wands_up starts from the drop it has
    case 'wands_in': case 'vacuum': return { phase: 'wands_out', t: 0 };
    case 'wands_out': case 'wands_up': case 'doors_close': case 'retract': case 'return': return null;
    default: return { phase: 'retract', t: 0 }; // travel or a pass: off the car, then home
  }
}

/** The phases that start from wherever the machine is, and capture `from` as they begin. */
const FROM_PHASES: ReadonlySet<WashPhase> = new Set(['wands_out', 'wands_up', 'doors_close', 'retract', 'return', 'to_cabin', 'to_start']);

/** Advance one bay's machine by one frame. Pure. */
export function advanceWashSession(prev: WashSession, input: WashInput): WashSession {
  const dt = clamp(Number.isFinite(input.dt) ? input.dt : 0, 0, MAX_WASH_STEP_S);

  if (prev.phase === 'home') {
    const stillDone = prev.completedFor !== null && input.active && input.vehicleId === prev.completedFor;
    if (!(input.active && input.vehicleId) || stillDone) {
      return { ...IDLE_WASH, vehicleId: input.vehicleId, completedFor: stillDone ? prev.completedFor : null };
    }
    // JOIN: the car is well into its seat (this viewer opened mid-wash), so take up the program where the seat has it
    const since = input.sinceS;
    if (since != null && Number.isFinite(since) && since > JOIN_LATE_S
        && input.endsInS !== null && Number.isFinite(input.endsInS)) {
      const joined = seekProgram(input.vehicleId, input.interior, since - PULL_IN_S, input.endsInS);
      if (joined) return joined;
      // the program is already over: the machine is home and done with this car
      return { ...IDLE_WASH, vehicleId: input.vehicleId, completedFor: input.vehicleId };
    }
    // START: the car has stopped under the stop light
    return finishStep({ ...IDLE_WASH, phase: 'settle', phaseElapsed: 0, vehicleId: input.vehicleId, interior: input.interior });
  }

  const { phase, phaseElapsed } = prev;
  let { finishing, from, passScale, vacuumS } = prev;
  const { vehicleId, interior } = prev;
  const poseNow = (): WashPose => washPoseAt(prev);

  // THE STOP CONDITION: the twin no longer has this car's seat on here, or the car in the
  // bay is not the car the machine started on.
  const over = !input.active || input.vehicleId !== vehicleId;
  if (over && !finishing) {
    finishing = true;
    const into = finishInto(phase, prev.t);
    if (into) {
      if (into.phase === 'home') return { ...IDLE_WASH, vehicleId: input.vehicleId };
      const fromPose = FROM_PHASES.has(into.phase) ? poseNow() : null;
      const next = { phase: into.phase, phaseElapsed: 0, vehicleId, interior, passScale, vacuumS, finishing, from: fromPose, completedFor: null };
      next.phaseElapsed = into.t * washPhaseLength(into.phase, next);
      return finishStep(next);
    }
  }

  // pace: while the seat is on, keep to the twin's end; once it is over, hurry home
  let speed = 1;
  if (finishing) speed = phase === 'retract' ? 1 : WASH_ABORT_SPEED;
  else if (input.endsInS !== null && Number.isFinite(input.endsInS)) {
    const left = remainingProgramS(prev);
    if (left > 0) speed = clamp(left / Math.max(input.endsInS - WASH_END_MARGIN_S, 0.25), 1, 2);
  }

  const len = washPhaseLength(phase, prev);
  const budget = dt * speed;
  if (phaseElapsed + budget < len) {
    return finishStep({ phase, phaseElapsed: phaseElapsed + budget, vehicleId, interior, passScale, vacuumS, finishing, from, completedFor: null });
  }

  // ONE transition per call; the unspent time is dropped
  const endPose = washPoseAt({ ...prev, t: 1 });
  let next: WashPhase;
  if (finishing) next = finishingNext(phase);
  else {
    const chain = washChain(interior);
    const i = chain.indexOf(phase);
    next = i >= 0 && i + 1 < chain.length ? chain[i + 1] : 'home';
  }
  if (next === 'home') {
    const still = input.active && input.vehicleId === vehicleId ? vehicleId : null;
    return { ...IDLE_WASH, vehicleId: input.vehicleId, completedFor: still };
  }
  if (phase === 'settle') ({ passScale, vacuumS } = paceProgram(interior, input.endsInS));
  from = FROM_PHASES.has(next) ? endPose : null;
  return finishStep({ phase: next, phaseElapsed: 0, vehicleId, interior, passScale, vacuumS, finishing, from, completedFor: null });
}

/**
 * The session `offset` sim seconds into a program that started `offset` seconds ago and must be home `endsInS`
 * seconds from now: paced as it would have been when it started, the phase and the time into it found by walking the
 * chain, each from-phase's pose the end of the phase before it. Null when the program is already over.
 */
export function seekProgram(vehicleId: string | null, interior: boolean, offset: number, endsInS: number): WashSession | null {
  const settle = WASH_PHASE_S.settle;
  const { passScale, vacuumS } = paceProgram(interior, offset + endsInS - settle);
  let left = Math.max(0, offset);
  let from: WashPose | null = null;
  for (const phase of washChain(interior)) {
    const base = { phase, phaseElapsed: 0, vehicleId, interior, passScale, vacuumS, finishing: false, completedFor: null };
    const here = { ...base, from: FROM_PHASES.has(phase) ? from : null };
    const L = washPhaseLength(phase, here);
    if (left < L) return finishStep({ ...here, phaseElapsed: left });
    left -= L;
    from = washPoseAt({ ...here, t: 1 });
  }
  return null;
}

function finishStep(s: Omit<WashSession, 't'>): WashSession {
  const L = washPhaseLength(s.phase, s);
  const t = Number.isFinite(L) && L > 0 ? clamp(s.phaseElapsed / L, 0, 1) : 1;
  return { ...s, t };
}

/** May the car in this bay move? Only when the machine is home with everything off the car. */
export function washLetsCarMove(p: WashPhase): boolean {
  return p === 'home' || p === 'done';
}

/** How far the car's doors stand open (0..1) for this session: the pose's own doors, one evaluation. */
export function washDoorsAt(s: WashSession): number {
  return washPoseAt(s).doors;
}
