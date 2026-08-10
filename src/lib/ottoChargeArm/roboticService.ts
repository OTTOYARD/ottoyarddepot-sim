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
 * The phase is then a PURE FUNCTION of elapsed time and total duration. No
 * shared mutable state between the engine and the renderer, so the picture can
 * never disagree with the world.
 */

import {
  CONNECT_SECONDS, DISCONNECT_SECONDS, PHASE_SECONDS, type ArmPhase,
} from './armStateMachine';

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
 * Phase of the arm at a robot-served stall.
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
