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

/** Seconds each phase takes, excluding 'charging' which lasts as long as it lasts. */
export const PHASE_SECONDS: Record<Exclude<ArmPhase, 'charging' | 'stowed' | 'clear' | 'fault'>, number> = {
  unstow: 3.0,
  approach: 6.0,
  align: 4.5,
  insert: 3.0,
  latch: 2.0,
  unlatch: 2.0,
  extract: 3.0,
  retract: 6.5,
};

/** Total seconds of robot motion added to a charge visit, both ends combined. */
export const CONNECT_SECONDS =
  PHASE_SECONDS.unstow + PHASE_SECONDS.approach + PHASE_SECONDS.align +
  PHASE_SECONDS.insert + PHASE_SECONDS.latch;               // 18.5 s
export const DISCONNECT_SECONDS =
  PHASE_SECONDS.unlatch + PHASE_SECONDS.extract + PHASE_SECONDS.retract; // 11.5 s
export const CYCLE_OVERHEAD_SECONDS = CONNECT_SECONDS + DISCONNECT_SECONDS; // 30 s

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
