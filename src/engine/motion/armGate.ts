// ============================================================================
// armGate.ts — THE DEPART GATE. The renderer's half of the founder's rule:
//
//   "stay connected the entire time until the car is at desired SoC and then the
//    arm gets ready to disconnect and retract back … and THEN the vehicle can
//    move."
//
// The first two clauses already shipped. `vehicleMayMove()` in
// lib/ottoChargeArm/armStateMachine.ts has always been the definition of the
// third — a whitelist, total over its input, failing to "held" on anything it
// does not recognise — and until this file existed NOTHING IN THE MOTION PATH
// CALLED IT. A car could pull away from a DCFC stall with the arm still inside
// its charge port.
//
// WHY THE GATE LIVES HERE AND NOT IN THE ARM COMPONENT.
// The arm's phase is stepped inside ChargingArm.tsx's R3F frame loop, in a ref
// that nothing outside that component can read (its dev-only __arms map exists
// precisely because the value is otherwise unreachable). The motion driver is a
// plain module with no access to the scene graph. So the driver evaluates the
// SAME reducer — advanceArmSession, imported, not reimplemented — over the SAME
// inputs, and both are started and released by the SAME shared fact: the
// vehicle's roster status, which the driver publishes and the component reads.
// There is one definition of the cycle (armStateMachine) and one reducer
// (roboticService); this is a second EVALUATION of them, not a second model.
//
// The two evaluations can therefore differ by at most the frame in which the
// roster flip is observed. The driver sees it first, so on paper it could open
// the gate up to one frame (~16 ms) before the component's arm finishes its
// retract. Two things bound that: the hold is also asserted by OTTO-Q's own
// robotic tether (an independent authority — either one holding is enough), and
// a car released from rest needs far longer than a frame to move a body length.
//
// FAIL-SAFE DIRECTION, stated explicitly because it is the opposite of the arm's:
//   · armStateMachine.vehicleMayMove fails to HELD on an unknown phase — right,
//     because it is answering about an arm that is definitely there.
//   · THIS gate fails to NOT-HELD on an unknown STALL — right, because the
//     question here is "is there an arm on this stall at all?", and the answer
//     for an L2 stall, a wash bay, a staging spot, or a stall no session has
//     ever touched is no. Holding a car because a signal is absent would freeze
//     the depot; that is the deadlock the brief forbids.
//
// And the hold is BOUNDED even when a signal is stuck — see HOLD_CAP_S.
// ============================================================================
import {
  advanceArmSession, isArmCommitted, IDLE_SESSION, stallHasArm, MIN_DEMATE_SPEED,
  type ArmSession,
} from "@/lib/ottoChargeArm/roboticService";
import {
  vehicleMayMove, DISCONNECT_SECONDS, type ArmPhase,
} from "@/lib/ottoChargeArm/armStateMachine";

/**
 * Largest sim-clock step treated as elapsed time, seconds.
 *
 * Same value and same reason as ChargingArm's MAX_CLOCK_STEP_S: the depot clock
 * can JUMP (a scrub, a run change, a snapshot from a new run) and a jump is not
 * thirty seconds of the world happening. Feeding it to the reducer would
 * fast-forward a whole cycle in one step — and here that would silently open the
 * gate, which is worse than the visual glitch it prevents in the component.
 */
export const MAX_ARM_CLOCK_STEP_S = 30;

/**
 * Longest physically possible release, sim seconds.
 *
 * DISCONNECT_SECONDS / MIN_DEMATE_SPEED = 11.5 / 0.4 = 28.75 s at the shipped
 * timings — what roboticService's own clamp allows when OTTO-Q's tether deadline
 * is very distant. Nothing legitimate takes longer to let go.
 *
 * A FUNCTION, not a const: DISCONNECT_SECONDS is now served by the backend
 * (`ottoq_twin_snapshot` -> arm.timings) and can change mid-run. Frozen at
 * module load this would have gone on describing the timings the bundle
 * happened to ship with, which is the same drift the seam was built to end —
 * just relocated into the renderer.
 */
export function maxPhysicalDemateS(): number {
  return DISCONNECT_SECONDS / MIN_DEMATE_SPEED;
}

/**
 * Hard ceiling on how long the gate may hold one car in a TRANSIENT phase, in
 * sim seconds.
 *
 * DERIVED, not chosen. The worst legitimate uninterrupted hold outside
 * 'charging' is a full reach followed by a maximally slow release:
 *   CONNECT_SECONDS (18.5) + maxPhysicalDemateS() (28.75) = 47.25 s.
 * 60 clears that and can then only fire on a signal that is wedged — at which
 * point the car moves. A car frozen forever by a stuck signal is the failure
 * this project has already paid for once (one unmapped enum word aborting every
 * decision in the system), and a gate that cannot time out is that same failure
 * wearing a safety hat.
 *
 * 'charging' IS EXCLUDED FROM THIS CLOCK, and that exclusion is the whole
 * founder rule rather than a loophole: the hold lasts as long as the charge
 * lasts, so it ends on a STATE and never on a duration. A twenty-minute charge
 * must not age out into "you may drive off with the connector in". The moment
 * OTTO-Q stops calling the car 'charging' the phase leaves 'charging' and this
 * clock starts, which is exactly when a bound is wanted.
 */
export const HOLD_CAP_S = 60;

/** What the depot says is true at one arm-served stall, this step. */
export interface ArmStallInput {
  /** RENDERER stall id. */
  stallId: string;
  /** Renderer stall TYPE. Only 'dcfc' carries an arm — stallHasArm decides, not this file. */
  stallType: string | null | undefined;
  /** The vehicle physically in this stall, or null when it is empty. */
  vehicleId: string | null;
  /**
   * OTTO-Q says this vehicle is taking current here — i.e. its published roster
   * status is 'charging'. THE SAME FACT ChargingArm reads off the roster, which
   * is what keeps the two evaluations in step.
   */
  chargingState: boolean;
  /**
   * The car is physically parked: it has a published service window. Required to
   * START a mate (an arm reaching into a stall a car is still taxiing toward is
   * the invented picture the renderer must never draw), NOT to continue one.
   */
  parked: boolean;
  /** Seconds of demate still owed per OTTO-Q's robotic tether, or null when none. */
  tetherRemainingS: number | null;
}

interface StallState {
  session: ArmSession;
  /** true while this stall is refusing to release its car */
  held: boolean;
  /** consecutive SIM seconds spent held in a TRANSIENT phase — the cap's clock.
   *  Zero while the arm is 'charging', which is open-ended by design. */
  heldForS: number;
}

/**
 * Per-stall arm sessions, and the movement answer derived from them.
 *
 * Owned by TwinMotionDriver (one instance), stepped once per motion tick against
 * the sim clock.
 */
export class ArmGate {
  private stalls = new Map<string, StallState>();

  /**
   * Advance every arm-served stall by `simDt` sim seconds.
   *
   * `inputs` must cover every stall that could be holding a car — INCLUDING
   * stalls whose car has just been dropped from the snapshot. A stall that stops
   * appearing entirely is treated as gone and its session is dropped; that is
   * safe because a dropped stall can no longer be consulted about a car.
   */
  step(simDt: number, inputs: Iterable<ArmStallInput>): void {
    const dt = Number.isFinite(simDt) && simDt > 0
      ? Math.min(simDt, MAX_ARM_CLOCK_STEP_S)
      : 0;
    const seen = new Set<string>();

    for (const input of inputs) {
      if (!stallHasArm(input.stallType)) continue; // no arm here — nothing to gate
      seen.add(input.stallId);
      const prev = this.stalls.get(input.stallId);
      const before = prev?.session ?? IDLE_SESSION;

      // EXACTLY ChargingArm's composition, deliberately duplicated line-for-line
      // rather than paraphrased: the window proves the car is parked and opens
      // the mate; once the arm is committed the window may vanish (a re-plan
      // drops the dwell leg) without yanking the connector out of the car.
      const charging = input.vehicleId !== null && input.chargingState
        && (input.parked || isArmCommitted(before.phase));

      const session = advanceArmSession(before, {
        dt,
        vehicleId: input.vehicleId,
        charging,
        tetherRemainingS: input.tetherRemainingS,
      });

      // TWO AUTHORITIES, EITHER OF WHICH MAY HOLD.
      //  · the arm's own phase — the renderer's half, and the thing that was missing;
      //  · OTTO-Q's robotic tether — the orchestrator saying the connector is still
      //    mechanically on the car. It is published per stall on stalls_status and
      //    already stops the ORCHESTRATOR moving the car; a motion gate that
      //    ignored it could still drive a car the backend has locked.
      // A hold from either is a hold. Absence of both is release.
      const held = input.tetherRemainingS !== null || !vehicleMayMove(session.phase);
      // The cap's clock runs only while the hold is TRANSIENT — see HOLD_CAP_S.
      const transient = held && session.phase !== "charging";
      const heldForS = transient ? (prev?.held ? prev.heldForS + dt : 0) : 0;
      this.stalls.set(input.stallId, { session, held, heldForS });
    }

    for (const id of this.stalls.keys()) if (!seen.has(id)) this.stalls.delete(id);
  }

  /**
   * May a car sitting in this stall physically begin to move?
   *
   * TOTAL over every string. A stall with no session — no arm, never engaged, or
   * simply not known to this gate — answers TRUE. See the fail-safe note at the
   * top of the file: absence of an arm is not a reason to freeze a car.
   */
  mayMove(stallId: string | null | undefined): boolean {
    if (!stallId) return true;
    const s = this.stalls.get(stallId);
    if (!s) return true;
    if (!s.held) return true;
    return s.heldForS >= HOLD_CAP_S; // bounded: a wedged signal must not deadlock
  }

  /** The arm's phase at this stall, or null when this gate is not tracking it. */
  phase(stallId: string | null | undefined): ArmPhase | null {
    if (!stallId) return null;
    return this.stalls.get(stallId)?.session.phase ?? null;
  }

  /** Sim seconds this stall has been holding its car. 0 when it is not holding. */
  heldFor(stallId: string | null | undefined): number {
    if (!stallId) return 0;
    const s = this.stalls.get(stallId);
    return s?.held ? s.heldForS : 0;
  }

  /** Stalls currently refusing to release their car — for the operator trace. */
  holding(): string[] {
    const out: string[] = [];
    for (const [id, s] of this.stalls) if (s.held && s.heldForS < HOLD_CAP_S) out.push(id);
    return out;
  }

  clear(): void {
    this.stalls.clear();
  }
}
