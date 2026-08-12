/**
 * OTTO-CHARGE ARM — connection state machine.
 *
 * ONE definition of the cycle, shared by:
 *   - the baked animation clip in the .glb
 *   - the standalone viewer
 *   - the depot renderer component
 *   - (mirrored) the OTTO-Q backend enum
 *
 * The states are modelled on how a real automatic connection device has to
 * behave, not on what looks good:
 *
 *   - Nothing moves until the vehicle is STOPPED and its parking brake is set.
 *     A robot that starts reaching toward a still-rolling car is a safety
 *     incident, not a demo.
 *   - The connector is MECHANICALLY LATCHED to the inlet before any current
 *     flows, and current is ramped to zero before it unlatches. That ordering
 *     is not stylistic; it is what the connector-lock provisions of IEC 61851-1
 *     require, and it is the reason a plugged-in vehicle cannot simply drive off.
 *   - There is an explicit CLEAR state AFTER retraction. The vehicle is not
 *     released when charging finishes; it is released when the arm is physically
 *     out of the way. Those are different moments and conflating them is how a
 *     simulation ends up showing a car driving through a robot.
 *   - There is an ABORT path. Real mating fails sometimes.
 *
 * TIMINGS are in REAL SECONDS for a single cycle. They are tunable assumptions
 * unless marked otherwise — see ROBOTIC_ARM.md for what is sourced and what is
 * estimated. They are deliberately conservative.
 */

export type ArmPhase =
  | 'stowed'        // folded on the plinth, nothing in the aisle
  | 'unstow'        // lifting clear of the cradle
  | 'approach'      // moving to the standoff point off the port
  | 'align'         // vision closing the last few cm; slow
  | 'insert'        // driving the connector into the inlet
  | 'latch'         // connector lock engaging; NO current yet
  | 'charging'      // locked and delivering
  | 'unlatch'       // current at zero, lock releasing
  | 'extract'       // pulling the connector straight back out along the port axis
  | 'retract'       // folding back to the cradle
  | 'clear'         // arm home; vehicle is free to move
  | 'fault';        // mate failed or obstruction; needs resolution

/** Ordered phases of a nominal cycle. */
export const NOMINAL_SEQUENCE: ArmPhase[] = [
  'stowed', 'unstow', 'approach', 'align', 'insert', 'latch',
  'charging', 'unlatch', 'extract', 'retract', 'clear',
];

/** The phases that have a fixed duration. 'charging' lasts as long as it lasts. */
export type TimedArmPhase = Exclude<ArmPhase, 'charging' | 'stowed' | 'clear' | 'fault'>;

/**
 * THE SHIPPED DEFAULTS — and the ONLY place this file states a number.
 *
 * These are what the arm does when nobody has said otherwise: the conservative
 * assumptions documented in ROBOTIC_ARM.md. They are ALSO the seed values of
 * `ottoq_policy_params` in otto-q-core, and `public.ottoq_arm_timings()` falls
 * back to exactly these if its policy read fails. Three copies of a number is
 * normally a smell; here it is deliberate and safe, because each copy is a
 * FLOOR the system degrades to, never a value it operates on while connected.
 * The value it operates on comes from the backend — see applyArmTimings.
 */
export const ARM_TIMING_DEFAULTS: Readonly<Record<TimedArmPhase, number>> = Object.freeze({
  unstow: 3.0,
  approach: 6.0,
  align: 4.5,
  insert: 3.0,
  latch: 2.0,
  unlatch: 2.0,
  extract: 3.0,
  retract: 6.5,
});

/**
 * Seconds each phase takes.
 *
 * MUTABLE BY DESIGN, and mutated ONLY by applyArmTimings() below. This used to
 * be a `const` literal, which made it the second of two homes for one physical
 * constant: the same 2.0 + 3.0 + 6.5 = 11.5 s demate window was also hardcoded
 * in `twin.ottoq_sim_stop_charge_session` as `v_demate_s`. Two repos, one robot,
 * nothing keeping them honest — retune the arm here and the orchestration goes
 * on reserving the plug for the old window.
 *
 * The object identity is stable and the keys are read live, so every existing
 * `PHASE_SECONDS.retract` call site picks up served values with no change.
 */
export const PHASE_SECONDS: Record<TimedArmPhase, number> = { ...ARM_TIMING_DEFAULTS };

/**
 * Total seconds of robot motion added to a charge visit.
 *
 * `let`, not `const`, so ES module live bindings carry a retune to every
 * importer. Recomputed by applyArmTimings(); never assigned anywhere else.
 */
export let CONNECT_SECONDS = 18.5;      // unstow 3 + approach 6 + align 4.5 + insert 3 + latch 2
export let DISCONNECT_SECONDS = 11.5;   // unlatch 2 + extract 3 + retract 6.5
export let CYCLE_OVERHEAD_SECONDS = 30.0;

/** Where the numbers currently in force came from. */
export type ArmTimingSource = 'defaults' | 'backend';

let timingSource: ArmTimingSource = 'defaults';
/** How the demate window was arrived at, as reported by the backend. */
let demateSource: string = 'derived';

/** Provenance, for the diagnostics overlay and for tests that assert the seam. */
export function armTimingProvenance(): { source: ArmTimingSource; demateSource: string } {
  return { source: timingSource, demateSource };
}

/** The shape `ottoq_twin_snapshot` publishes at `arm.timings`. */
export interface ServedArmTimings {
  phase_seconds?: Partial<Record<TimedArmPhase, number>> | null;
  connect_seconds?: number | null;
  demate_seconds?: number | null;
  cycle_overhead_seconds?: number | null;
  demate_source?: string | null;
  source?: string | null;
}

/**
 * A served number is only believed if it is a real, non-negative, plausible
 * duration. Anything else keeps the value already in force.
 *
 * The ceiling is not decoration. A NaN or a wild number here would not throw —
 * it would silently become a phase that never ends, and a phase that never ends
 * is a car this gate never releases. Same failure direction the rest of this
 * file is written against, so it gets the same treatment: reject the input,
 * keep something sane, stay a total function.
 */
const MAX_PLAUSIBLE_PHASE_S = 600;
function believable(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_PLAUSIBLE_PHASE_S
    ? n : null;
}

function recompute(): void {
  CONNECT_SECONDS =
    PHASE_SECONDS.unstow + PHASE_SECONDS.approach + PHASE_SECONDS.align +
    PHASE_SECONDS.insert + PHASE_SECONDS.latch;
  DISCONNECT_SECONDS =
    PHASE_SECONDS.unlatch + PHASE_SECONDS.extract + PHASE_SECONDS.retract;
  CYCLE_OVERHEAD_SECONDS = CONNECT_SECONDS + DISCONNECT_SECONDS;
}

/**
 * Adopt the arm timings the backend serves on `ottoq_twin_snapshot`.
 *
 * THIS IS THE SEAM. `public.ottoq_arm_timings()` in otto-q-core is the one home
 * for these numbers; this function is how they arrive. Call it on every
 * snapshot — it is cheap, idempotent, and the values genuinely can change
 * mid-run (a policy row is settable per run and per depot).
 *
 * The window totals are taken from the SERVED totals when present rather than
 * re-derived from the phases, because they are allowed to disagree: OTTO-Q
 * supports a whole-window `robotic_demate_seconds` override that pins the total
 * without touching its phases. When that is set the animation still plays its
 * three phases while the gate honours the total OTTO-Q is actually reserving
 * the plug for. Re-deriving here would quietly discard the operator's override
 * and put the two worlds back out of step — the exact bug this seam exists to
 * close.
 *
 * Returns true only if a value actually CHANGED — this is called on every
 * snapshot poll, and "the backend confirmed we are already in step" is the
 * common case, not news. Provenance is tracked separately: any payload with at
 * least one believable field flips the source to 'backend', because being
 * confirmed in step is itself worth knowing and is different from never having
 * heard from the backend at all.
 *
 * Never throws: a malformed payload leaves the previous timings in force.
 */
export function applyArmTimings(served: ServedArmTimings | null | undefined): boolean {
  if (!served || typeof served !== 'object') return false;
  let changed = false;
  let understood = false;

  const ps = served.phase_seconds;
  if (ps && typeof ps === 'object') {
    for (const key of Object.keys(ARM_TIMING_DEFAULTS) as TimedArmPhase[]) {
      const v = believable(ps[key]);
      if (v === null) continue;
      understood = true;
      if (v !== PHASE_SECONDS[key]) {
        PHASE_SECONDS[key] = v;
        changed = true;
      }
    }
  }

  recompute();

  // Served totals win over the derived sums — see the note above on overrides.
  const connect = believable(served.connect_seconds);
  if (connect !== null) {
    understood = true;
    if (connect !== CONNECT_SECONDS) changed = true;
    CONNECT_SECONDS = connect;
  }
  const demate = believable(served.demate_seconds);
  if (demate !== null) {
    understood = true;
    if (demate !== DISCONNECT_SECONDS) changed = true;
    DISCONNECT_SECONDS = demate;
  }
  const cycle = believable(served.cycle_overhead_seconds);
  if (cycle !== null) understood = true;
  CYCLE_OVERHEAD_SECONDS = cycle !== null ? cycle : CONNECT_SECONDS + DISCONNECT_SECONDS;

  if (understood) {
    timingSource = 'backend';
    demateSource = typeof served.demate_source === 'string' ? served.demate_source : 'derived';
  }
  return changed;
}

/** Back to the shipped defaults. For tests, and for a renderer losing its backend. */
export function resetArmTimings(): void {
  Object.assign(PHASE_SECONDS, ARM_TIMING_DEFAULTS);
  recompute();
  timingSource = 'defaults';
  demateSource = 'derived';
}

/** Is the connector mechanically locked to the vehicle right now? */
export function isTethered(p: ArmPhase): boolean {
  return p === 'latch' || p === 'charging' || p === 'unlatch';
}

/**
 * May the vehicle move?
 *
 * Deliberately a WHITELIST, not a blacklist. An unrecognised phase returns
 * false — the vehicle stays put. This project has been bitten before by a
 * seam that treated an unmapped enum value as "proceed"; one unmapped word
 * aborted every decision in the system while the caller reported success.
 * A gate like this must be a TOTAL function over its input domain, and it must
 * fail to the SAFE side.
 */
export function vehicleMayMove(p: ArmPhase | string | null | undefined): boolean {
  return p === 'stowed' || p === 'clear';
}

/** Does this phase mean the arm is mid-motion (for status LED / telemetry)? */
export function isMoving(p: ArmPhase): boolean {
  return p === 'unstow' || p === 'approach' || p === 'align' ||
         p === 'insert' || p === 'extract' || p === 'retract';
}

/** Status colour for the arm's LED rings, by phase. */
export function statusColor(p: ArmPhase): number {
  switch (p) {
    case 'stowed':
    case 'clear':    return 0x00e5ff; // teal — idle, safe
    case 'unstow':
    case 'approach':
    case 'retract':  return 0xffb020; // amber — moving
    case 'align':
    case 'insert':
    case 'extract':  return 0xffd54a; // bright amber — precision move
    case 'latch':
    case 'unlatch':  return 0xc8102e; // OTTOYARD red — locking / unlocking
    case 'charging': return 0x35d07f; // green — delivering
    case 'fault':    return 0xff2d2d; // hard red
    default:         return 0x00e5ff;
  }
}

export interface CyclePoint {
  phase: ArmPhase;
  /** 0..1 progress within the current phase. */
  t: number;
  /** Seconds since the cycle began. */
  elapsed: number;
}

/**
 * Where in the cycle are we at time `t` seconds, given a charging dwell of
 * `chargeSeconds`? Used to bake the .glb animation and to drive the viewer.
 */
export function cycleAt(t: number, chargeSeconds: number): CyclePoint {
  const seq: { phase: ArmPhase; dur: number }[] = [
    { phase: 'stowed', dur: 1.5 },
    { phase: 'unstow', dur: PHASE_SECONDS.unstow },
    { phase: 'approach', dur: PHASE_SECONDS.approach },
    { phase: 'align', dur: PHASE_SECONDS.align },
    { phase: 'insert', dur: PHASE_SECONDS.insert },
    { phase: 'latch', dur: PHASE_SECONDS.latch },
    { phase: 'charging', dur: chargeSeconds },
    { phase: 'unlatch', dur: PHASE_SECONDS.unlatch },
    { phase: 'extract', dur: PHASE_SECONDS.extract },
    { phase: 'retract', dur: PHASE_SECONDS.retract },
    { phase: 'clear', dur: 2.0 },
  ];
  const total = seq.reduce((s, x) => s + x.dur, 0);
  const tt = ((t % total) + total) % total;
  let acc = 0;
  for (const s of seq) {
    if (tt < acc + s.dur) return { phase: s.phase, t: (tt - acc) / s.dur, elapsed: tt };
    acc += s.dur;
  }
  return { phase: 'clear', t: 1, elapsed: tt };
}

/** Total seconds of one full demo cycle. */
export function cycleDuration(chargeSeconds: number): number {
  return 1.5 + PHASE_SECONDS.unstow + PHASE_SECONDS.approach + PHASE_SECONDS.align +
    PHASE_SECONDS.insert + PHASE_SECONDS.latch + chargeSeconds + PHASE_SECONDS.unlatch +
    PHASE_SECONDS.extract + PHASE_SECONDS.retract + 2.0;
}
