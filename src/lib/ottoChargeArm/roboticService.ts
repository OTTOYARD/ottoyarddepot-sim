/**
 * Robotic charging as part of the SERVICE, not as decoration on top of it.
 *
 * The design decision here is the important one. A robot arm could have been
 * bolted on as a renderer-only animation that plays while a vehicle charges.
 * It is modelled instead as real time inside the service:
 *
 *   service duration = connect + charge + disconnect
 *
 * Two things fall out of that, both of which we actually want:
 *
 *  1. THE DEPART GATE IS STRUCTURAL. A vehicle cannot leave before the arm has
 *     retracted, because its service is not over until the retract time has
 *     elapsed. There is no separate flag to forget to check, and no window in
 *     which the sim can drive a car through a connected robot.
 *
 *  2. OTTO-Q SEES THE COST. Robotic connection is ~30 s of stall occupancy per
 *     visit that a human plug-in does not incur in the same way. Because it is
 *     inside the duration, every forward reservation, every wave plan and every
 *     throughput number already accounts for it. If it were renderer-only, the
 *     brain would be planning against a depot that does not exist.
 *
 * TWO MODELS LIVE HERE, and the distinction is the whole point of the file.
 *
 *   phaseAt()           — the PLAN. Where the arm would be if the dwell OTTO-Q
 *                         reserved were the whole truth. Pure in (elapsed,
 *                         duration). It justifies the overhead inside the
 *                         service duration and it is what the .glb baker plays.
 *
 *   advanceArmSession() — the WORLD. What the arm is actually doing, reduced
 *                         from depot state frame by frame. Pure in (previous
 *                         session, inputs), with no duration that can end a
 *                         charge.
 *
 * The renderer drives the SECOND one. It used to drive the first, and that is
 * exactly the founder-reported defect: a reservation is not a charge, so the arm
 * let go when the plan ran out rather than when the car was full.
 */

import {
  CONNECT_SECONDS, DISCONNECT_SECONDS, PHASE_SECONDS, type ArmPhase,
} from './armStateMachine';
import { releaseEntry } from './armMotion';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Which stalls have an arm.
 *
 * DCFC only. Robotic connection is justified by high-power fast charging with
 * hard turnaround pressure; it is not justified across 30 L2 trickle stalls,
 * and pretending otherwise would inflate the capex story.
 */
export function stallHasArm(stallType: string | undefined | null): boolean {
  return stallType === 'dcfc';
}

/** Seconds of robot motion added to a robotic charge service. */
export const ROBOTIC_OVERHEAD_SECONDS = CONNECT_SECONDS + DISCONNECT_SECONDS;

/**
 * Phase of the arm at a robot-served stall, as PLANNED.
 *
 * This is the planning-side model: given the dwell OTTO-Q reserved the stall
 * for, where in the cycle would the arm be? It is what justifies
 * ROBOTIC_OVERHEAD_SECONDS sitting inside the service duration, and it is the
 * clip the .glb baker and the standalone viewer play.
 *
 * IT IS NOT WHAT DRIVES THE DEPOT RENDERER. A plan is a plan: the charge takes
 * as long as the charge takes, and OTTO-Q advances SoC toward target_soc on its
 * own clock. Driving the on-screen arm from this function meant the arm let go
 * when the PLAN said the dwell was over rather than when the CAR was charged —
 * see advanceArmSession below, which is state-driven and has no such clock.
 *
 * @param elapsed  seconds since the service started
 * @param duration total service duration in seconds (already includes overhead)
 */
export function phaseAt(elapsed: number, duration: number): { phase: ArmPhase; t: number } {
  // A service too short to contain a full cycle would otherwise produce
  // nonsense (negative charging windows). Clamp rather than emit a bad phase.
  const usable = Math.max(duration, ROBOTIC_OVERHEAD_SECONDS + 1);
  const e = Math.max(0, Math.min(elapsed, usable));

  const seq: { phase: ArmPhase; dur: number }[] = [
    { phase: 'unstow', dur: PHASE_SECONDS.unstow },
    { phase: 'approach', dur: PHASE_SECONDS.approach },
    { phase: 'align', dur: PHASE_SECONDS.align },
    { phase: 'insert', dur: PHASE_SECONDS.insert },
    { phase: 'latch', dur: PHASE_SECONDS.latch },
    { phase: 'charging', dur: usable - ROBOTIC_OVERHEAD_SECONDS },
    { phase: 'unlatch', dur: PHASE_SECONDS.unlatch },
    { phase: 'extract', dur: PHASE_SECONDS.extract },
    { phase: 'retract', dur: PHASE_SECONDS.retract },
  ];

  let acc = 0;
  for (const s of seq) {
    if (e < acc + s.dur) return { phase: s.phase, t: s.dur > 0 ? (e - acc) / s.dur : 1 };
    acc += s.dur;
  }
  return { phase: 'clear', t: 1 };
}

/**
 * Fraction of the charge actually delivered at `elapsed`.
 *
 * State of charge must not start rising during APPROACH and must not keep
 * rising during RETRACT — current only flows while the connector is latched.
 * Showing SoC climb while the arm is still in the air is a small lie that an
 * OEM reviewer will spot immediately.
 */
export function chargeProgress(elapsed: number, duration: number): number {
  const usable = Math.max(duration, ROBOTIC_OVERHEAD_SECONDS + 1);
  const window = usable - ROBOTIC_OVERHEAD_SECONDS;
  if (window <= 0) return 0;
  return Math.max(0, Math.min(1, (elapsed - CONNECT_SECONDS) / window));
}

// ═══════════════════════════════════════════════════════════════════════════
// THE ARM SESSION — driven by STATE, not by a stopwatch.
//
// FOUNDER-OBSERVED: "the arm stays connected for a bit and then SNAPS UP to its
// original unconnected position." Two defects in one sentence, both traceable
// to the renderer having asked the wrong question.
//
//  (a) IT LET GO EARLY. phaseAt() above answers "where would the arm be if the
//      dwell OTTO-Q reserved were the whole truth?". The dwell is a RESERVATION.
//      The real session ends when the pack reaches target_soc, which is a
//      different number every visit. When the reservation ran out first, the
//      local cycle marched on to 'clear' with the car still taking current.
//
//  (b) IT SNAPPED. Once that local cycle passed its end the phase became
//      'clear', whose pose is STOWED, in ONE frame — from a fully mated pose to
//      the cradle with nothing in between. No amount of retiming fixes that; a
//      phase resolved by sampling an absolute clock has no memory, so it cannot
//      guarantee it played the phases between two samples.
//
// This reducer answers the right question instead: "given what I was doing last
// frame and what the depot says is true NOW, what am I doing this frame?" It is
// a pure function of (previous session, inputs) — no module state, no hidden
// clock — so it is exhaustively testable, and because every transition is a
// STEP ALONG THE CHAIN it can never skip a phase however violently its inputs
// move. 'charging' has no duration at all: there is no timeout, ever.
//
// The two inputs are the two authorities, and each answers only what it owns:
//   · the VEHICLE's state says whether current is flowing (connect + hold);
//   · the STALL's robotic tether says the session is over and how long OTTO-Q
//     has allowed for the demate (release + pacing).
// ═══════════════════════════════════════════════════════════════════════════

/** How long the arm sits at 'clear' — home, but still announcing itself — before
 *  it is simply 'stowed'. Cosmetic only; both poses are identical. */
export const CLEAR_SECONDS = 2.0;

/** Largest step the reducer will take in one call, in sim seconds. A backgrounded
 *  tab or a paused-then-resumed run can hand back an enormous delta; fast-
 *  forwarding a 30 s cycle in a single frame is the snap this whole file exists
 *  to prevent. The cycle simply plays on across the following frames. */
export const MAX_SESSION_STEP_S = 2.0;

/** Bounds on how far OTTO-Q's demate deadline may stretch or compress the
 *  physical unlatch → extract → retract. A robot has a top speed and a real
 *  minimum; a deadline of zero must not teleport it home, and a very distant one
 *  must not leave it creeping for minutes. */
export const MIN_DEMATE_SPEED = 0.4;
export const MAX_DEMATE_SPEED = 3.0;

/** Reaching for the inlet. Ordered. */
export const MATE_CHAIN: readonly ArmPhase[] = ['unstow', 'approach', 'align', 'insert', 'latch'];
/** Letting go. Ordered. */
export const DEMATE_CHAIN: readonly ArmPhase[] = ['unlatch', 'extract', 'retract'];

const MATE_SET: ReadonlySet<ArmPhase> = new Set(MATE_CHAIN);
const DEMATE_SET: ReadonlySet<ArmPhase> = new Set(DEMATE_CHAIN);

/** Phases in which the arm is folded on its plinth and free to take a new car. */
export function isArmHome(p: ArmPhase): boolean {
  return p === 'stowed' || p === 'clear';
}

/** Is the arm mated, or on its way to being mated, right now? */
export function isArmCommitted(p: ArmPhase): boolean {
  return MATE_SET.has(p) || p === 'charging' || DEMATE_SET.has(p);
}

export interface ArmSession {
  phase: ArmPhase;
  /** Seconds spent so far inside `phase`. Unbounded for 'charging' — that is the
   *  entire point: the hold lasts as long as the charge lasts. */
  phaseElapsed: number;
  /** 0..1 progress through `phase`. Pinned at 1 for the open-ended phases. */
  t: number;
  /** The vehicle this session is serving. Held across the demate even after the
   *  car has left the roster, so the retract plays out against the port the arm
   *  actually mated to rather than snapping to a default. */
  vehicleId: string | null;
}

/** A folded, unassigned arm. The initial state of every stall. */
export const IDLE_SESSION: ArmSession = Object.freeze({
  phase: 'stowed' as ArmPhase, phaseElapsed: 0, t: 1, vehicleId: null,
});

export interface ArmSessionInput {
  /** Sim seconds since the previous call. Clamped internally. */
  dt: number;
  /** The vehicle docked in this stall, or null when the stall is empty. */
  vehicleId: string | null;
  /** OTTO-Q says this vehicle is taking current at this stall (charging_dcfc /
   *  charging_l2) AND it is physically parked. The connect trigger and the hold
   *  condition are the same fact — that is what makes the hold open-ended. */
  charging: boolean;
  /** Seconds of demate still owed per the stall's robotic tether, or null when
   *  the backend published no tether. Presence means "session over, let go";
   *  the value paces the release against OTTO-Q's own deadline. */
  tetherRemainingS: number | null;
}

/** Seconds a phase lasts. Infinite for the phases that end on an EVENT, not a
 *  clock: 'stowed' (until a car charges), 'charging' (until the charge is done),
 *  'fault' (until an operator resolves it). */
export function phaseDuration(p: ArmPhase): number {
  if (p === 'clear') return CLEAR_SECONDS;
  if (p === 'stowed' || p === 'charging' || p === 'fault') return Infinity;
  return PHASE_SECONDS[p as keyof typeof PHASE_SECONDS];
}

/** The next phase once this one has run its course. Never skips. */
function timedNext(p: ArmPhase): ArmPhase {
  switch (p) {
    case 'unstow': return 'approach';
    case 'approach': return 'align';
    case 'align': return 'insert';
    case 'insert': return 'latch';
    case 'latch': return 'charging';
    case 'unlatch': return 'extract';
    case 'extract': return 'retract';
    case 'retract': return 'clear';
    case 'clear': return 'stowed';
    default: return p;
  }
}

/**
 * A transition demanded by the WORLD rather than by the clock, or null when the
 * world is content with what the arm is already doing.
 *
 * Where a demate ENTERS the chain is a physical question, not a bookkeeping one,
 * and it is NOT simply "the first phase of the release at t=0". A release phase
 * at t=0 is a pose at the INLET, so entering there from a half-finished reach
 * sends the arm out to the car before it folds home — measured at 142° on one
 * joint for an abort just after leaving the cradle.
 *
 * releaseEntry() answers it properly: it returns the point on the release chain
 * whose pose IS the pose the arm is already holding. The geometry lives with the
 * pose function, which is the only place that knows the choreography; this
 * reducer just asks. An interrupted mate is then continuous by construction, and
 * an arm that had barely unstowed rejoins near the END of retract — which is
 * correct, because it is nearly home already.
 */
function forcedNext(
  p: ArmPhase, phaseT: number, demate: boolean, charging: boolean,
): { phase: ArmPhase; t: number } | null {
  if (demate) return releaseEntry(p, phaseT);
  if (charging && p === 'stowed') return { phase: 'unstow', t: 0 };
  return null;
}

/** Seconds of physical demate still owed from this point in the chain. */
export function remainingDemateSeconds(phase: ArmPhase, phaseElapsed: number): number {
  const i = DEMATE_CHAIN.indexOf(phase);
  if (i < 0) return 0;
  let r = Math.max(0, PHASE_SECONDS[phase as keyof typeof PHASE_SECONDS] - phaseElapsed);
  for (let k = i + 1; k < DEMATE_CHAIN.length; k++) {
    r += PHASE_SECONDS[DEMATE_CHAIN[k] as keyof typeof PHASE_SECONDS];
  }
  return r;
}

/**
 * Playback rate for the release, so the arm is home when OTTO-Q says the stall
 * is free — bounded, and continuous in the deadline.
 *
 * The previous code solved the same problem by RESOLVING the phase from the
 * deadline each frame. That is what made the tether a second, competing source
 * of truth: two answers to "what phase is this?" that could disagree, and did.
 * Scaling the rate instead leaves exactly one answer — the chain — and lets the
 * deadline influence only how fast it is walked. A deadline that jumps changes
 * the speed, never the pose.
 */
export function demateSpeed(
  phase: ArmPhase, phaseElapsed: number, tetherRemainingS: number | null,
): number {
  if (tetherRemainingS === null || !DEMATE_SET.has(phase)) return 1;
  const remain = remainingDemateSeconds(phase, phaseElapsed);
  if (!(remain > 0)) return 1;
  const want = remain / Math.max(tetherRemainingS, 0.25);
  if (!Number.isFinite(want)) return MAX_DEMATE_SPEED;
  return clamp(want, MIN_DEMATE_SPEED, MAX_DEMATE_SPEED);
}

/**
 * Advance one arm by one frame. Pure.
 *
 * @param prev  the session as of the previous frame (IDLE_SESSION to begin)
 * @param input what the depot says is true now
 */
export function advanceArmSession(prev: ArmSession, input: ArmSessionInput): ArmSession {
  const dt = clamp(Number.isFinite(input.dt) ? input.dt : 0, 0, MAX_SESSION_STEP_S);

  let phase = prev.phase;
  let phaseElapsed = Math.max(0, prev.phaseElapsed);
  let vehicleId = prev.vehicleId;

  // A folded arm takes whatever car is in its stall. A committed one keeps the
  // car it committed to: swapping the target mid-mate would move the IK goal
  // under the connector, which is precisely a teleport.
  if (isArmHome(phase)) vehicleId = input.vehicleId;

  // THE RELEASE CONDITION, and the only one. Any of:
  //   · OTTO-Q published a robotic tether on this stall — the session is over
  //     and the demate window has started;
  //   · the vehicle is no longer taking current here;
  //   · the car the arm committed to is no longer the car in the stall.
  // Note what is NOT in this list: elapsed time. There is no duration anywhere
  // in this function that can end a charge.
  const lostVehicle = !isArmHome(phase) && input.vehicleId !== vehicleId;
  const demate = lostVehicle || input.tetherRemainingS !== null || !input.charging;

  let budget = dt * demateSpeed(phase, phaseElapsed, input.tetherRemainingS);

  // Walk the chain. Every step is to the ADJACENT phase — nothing here can jump.
  //
  // AT MOST ONE transition per call, and the unspent time is then dropped on the
  // floor. That is deliberate, and it is the difference between "the reducer
  // passed through unlatch" and "the screen SHOWED unlatch": one call is one
  // drawn frame, so a phase that is both entered and finished inside a single
  // call is a phase the founder never sees. The whole 2 s unlatch fits inside one
  // clamped step, and a loaded machine or a high playback multiplier produces
  // exactly those steps — this was caught by the huge-step test, not by reading.
  //
  // Continuity wins over clock-accuracy here. The cost is a lost fraction of a
  // frame per transition (~0.16 s across a whole 30 s cycle at 60 fps), which is
  // invisible; a skipped phase is the reported bug.
  let stepped = false;
  for (let guard = 0; guard < 16; guard++) {
    const durNow = phaseDuration(phase);
    const tNow = Number.isFinite(durNow) && durNow > 0 ? clamp(phaseElapsed / durNow, 0, 1) : 1;
    const forced = forcedNext(phase, tNow, demate, input.charging);
    if (forced !== null) {
      // Land at the POSE-MATCHING point in the new phase, not at its start.
      const d = phaseDuration(forced.phase);
      phase = forced.phase;
      phaseElapsed = Number.isFinite(d) ? clamp(forced.t, 0, 1) * d : 0;
      budget = 0; stepped = true;
      continue;                       // the phase we just entered may demand another hop
    }
    if (stepped) break;
    const dur = phaseDuration(phase);
    if (phaseElapsed + budget < dur) { phaseElapsed += budget; budget = 0; break; }
    phase = timedNext(phase); phaseElapsed = 0; budget = 0; stepped = true;
  }

  const dur = phaseDuration(phase);
  if (!Number.isFinite(dur)) {
    // 'charging' is open-ended by design; keep the accumulator inside the range
    // where float addition still resolves a frame.
    phaseElapsed = Math.min(phaseElapsed, 1e7);
  }
  const t = Number.isFinite(dur) && dur > 0 ? clamp(phaseElapsed / dur, 0, 1) : 1;

  if (isArmHome(phase)) vehicleId = input.vehicleId;

  return { phase, phaseElapsed, t, vehicleId };
}
