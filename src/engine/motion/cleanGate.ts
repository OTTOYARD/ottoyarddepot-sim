// ============================================================================
// cleanGate.ts — THE OTTO-CLEAN ARM, ONCE PER STALL, AND THE HOLD IT PUTS ON ITS CAR.
//
// The cabin clean is the twin's step (otto-q-core 0758): a must-do interior tidy of a
// car charging on a fast charger is done by that stall's cleaning arm, from started_at
// to ends_at, and the snapshot publishes both on the visit atom with the stall
// (robot_stall_id). This file plays that step: one cleaning session per fast-charger
// stall, reduced by cleanSession.advanceCleanSession from what the snapshot and the
// motion layer say, stepped on the sim clock by TwinMotionDriver.
//
// ONE PROGRAM PER VEHICLE (2026-11-13). The twin's row says which car is in the stall, and the session
// that starts for it plays that vehicle's own clean program: its door openings, its seats, its roof
// (ottoCleanArm/cleanPrograms.ts). The session carries the program's key, so CleanArm.tsx, the 2D plan
// and the Robotics tab's follow all draw the same program from the same session.
//
// ONE EVALUATION, NOT TWO. The OTTO-CHARGE ARM is evaluated twice (ChargingArm.tsx draws
// one, armGate.ts gates motion on the other) and has to keep them in step. The cleaning
// arm is evaluated here only: CleanArm.tsx draws this session, the fleet's doors are
// written from it (doorStore), and the car's right to move is read from it. So the
// arm, the doors and the hold cannot disagree.
//
// FAIL-SAFE DIRECTION, the depart gate's: a stall with no arm, a stall this gate has
// never seen, and a car no session covers are NOT held. Only a car whose cleaning arm
// is out (or whose doors are open) is. And the hold is bounded once the twin's step
// is over (CLEAN_HOLD_CAP_S): a wedged signal must not freeze a car.
// ============================================================================
import {
  advanceCleanSession, cleanDoors, cleanLetsCarMove, cleanSessionProgram, IDLE_CLEAN, portDoorsOpen,
  type CleanInput, type CleanSession,
} from "@/lib/ottoCleanArm/cleanSession";
import type { ChargeArmState } from "@/lib/ottoChargeArm/mateSequence";
import { sidesFor, type CleanSides } from "@/lib/ottoCleanArm/cleanArmPose";
import { cleanProgramFor } from "@/lib/ottoCleanArm/cleanPrograms";
import { stallHasArm } from "@/lib/ottoChargeArm/roboticService";
import type { TwinVehicle } from "@/lib/ottoTwin";

/** Largest sim-clock step treated as elapsed time, seconds (the depart gate's, for its reason). */
export const MAX_CLEAN_CLOCK_STEP_S = 30;

/**
 * The step the gate feeds the reducer, sim seconds: washGate's WASH_SUBSTEP_S, for its reason. A frame's
 * sim time is played in steps of at most this, so a slow frame costs the arm no time against the twin's step.
 *
 * MEASURED 2026-10-21 (cleanGate.test.ts reproduces it): stepped once a frame, the reducer takes at most
 * MAX_CLEAN_STEP_S (2 s) a call and drops the rest, so against the twin's 5.8-minute step (348 s) the arm
 * was cut off in ascend_b at 3 sim-seconds a frame with 96 s on side B instead of 146, and at 6 or more
 * it never reached side B at all. 60 fps at 3x is 0.05 s a frame, so a fast device was never short.
 */
export const CLEAN_SUBSTEP_S = 0.25;

/**
 * Play `dt` sim seconds of one stall in steps of at most CLEAN_SUBSTEP_S. The step's end was read at the END
 * of the frame, so each step sees it as it stood when that step ended. The charge arm's stillness
 * (`mayEnter`) is the frame's: the two arms interlock frame by frame, as they always have.
 */
function advanceBy(s: CleanSession, dt: number, input: Omit<CleanInput, "dt">): CleanSession {
  let done = 0;
  do {
    const step = Math.min(dt - done, CLEAN_SUBSTEP_S);
    done += step;
    const before = dt - done; // how long before the frame's end this step ends
    s = advanceCleanSession(s, {
      ...input, dt: step, endsInS: input.endsInS === null ? null : input.endsInS + before,
      heldS: (input.heldS ?? 0) > 0 ? (input.heldS ?? 0) + before : 0,
    });
  } while (dt - done > 1e-9);
  return s;
}

/**
 * Longest the gate may hold a car once the twin's step is over, sim seconds.
 *
 * DERIVED. From anywhere in the cycle the way home is at most exit (3.5) + ascend (3)
 * + raise (1.5) + return (4) + doors (3) = 15 s of motion, played at ABORT_SPEED (3x):
 * 5 s. 30 s clears that six times over and can only fire on a wedged signal. While
 * the step is ON the hold is open-ended, as a charge's is: it ends on the twin's
 * state, never on a duration.
 */
export const CLEAN_HOLD_CAP_S = 30;

/** The twin's interior clean of one car by a stall's cleaning arm, read off the snapshot. */
export interface CabinClean {
  /** RENDERER stall id of the stall whose arm does it. */
  stall: string;
  /** The twin still places the car on that stall (a re-tasked car is not cleaned). */
  placedHere: boolean;
  /** The step's start and end, epoch ms on the BACKEND's sim clock (simNow's domain). */
  startMs: number | null;
  endsMs: number | null;
}

const ms = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * The cabin clean the twin has in progress for this car by a stall's arm, or null.
 *
 * The atom is the interior tidy, or the arm's deep clean, with status 'in_progress' and a robot_stall_id that
 * maps to a renderer stall. A technician's tidy carries no robot_stall_id, so it is
 * never played here. Total: any missing or malformed field reads as no clean.
 */
export function cabinCleanOf(
  bv: Pick<TwinVehicle, "stall_id" | "visit">,
  rendererStall: (twinStallId: string) => string | undefined,
): CabinClean | null {
  const atoms = bv.visit?.atoms;
  if (!Array.isArray(atoms)) return null;
  for (const a of atoms) {
    // the arm's deep program (otto-q-core 0815) is an interior deep clean with the same fields: the visit's tidy, when it
    // has one, runs with it over the same window, so either atom gives the same clean
    if (!a || (a.svc !== "interior_tidy" && a.svc !== "interior_deep_clean") || a.status !== "in_progress") continue;
    if (typeof a.robot_stall_id !== "string" || a.robot_stall_id === "") continue;
    const stall = rendererStall(a.robot_stall_id);
    if (!stall) continue;
    const placedHere = typeof bv.stall_id === "string" && rendererStall(bv.stall_id) === stall;
    return { stall, placedHere, startMs: ms(a.started_at), endsMs: ms(a.ends_at) };
  }
  return null;
}

/**
 * The post of this car's CABIN STOP, as a renderer stall, or null (otto-q-core 0817).
 *
 * A parked car with an interior deep clean and no charge to do is sent to a free fast-charger post. It stands there,
 * not plugged in, while the post's arm runs the deep program. The engine marks the stop on the deep-clean atom
 * (cabin_stop_stall_id) from the tick it sends the car until the post is freed. The car's state says only "charged,
 * holding", which is also every car that has just finished a charge, so the mark is the one thing that says this car
 * belongs ON the post. True only while the twin also places the car on that stall. Total: a missing or malformed
 * field reads as no stop.
 */
export function cabinStopOf(
  bv: Pick<TwinVehicle, "stall_id" | "visit">,
  rendererStall: (twinStallId: string) => string | undefined,
): string | null {
  const atoms = bv.visit?.atoms;
  if (!Array.isArray(atoms) || typeof bv.stall_id !== "string") return null;
  for (const a of atoms) {
    if (!a || a.svc !== "interior_deep_clean") continue;
    if (a.status !== "pending" && a.status !== "in_progress") continue;
    if (typeof a.cabin_stop_stall_id !== "string" || a.cabin_stop_stall_id !== bv.stall_id) continue;
    return rendererStall(a.cabin_stop_stall_id) ?? null;
  }
  return null;
}

/**
 * What the cleaning arm needs to know of its stall's OTTO-CHARGE ARM, from what that arm is doing and what the twin
 * says of the car. ONE composition, for the motion driver and for the tests that drive the two gates together.
 * The charge arm is STILL when it is latched, or stowed with no mate coming (a mate starts only on a parked car that
 * is charging on a charger that has not faulted). A faulted charger's arm lets go: the cleaning arm leaves the
 * charger's flank so that it can.
 */
export function chargeArmFacts(
  chargeArm: ChargeArmState, car: { charging: boolean; parked: boolean; chargerFaulted: boolean },
): Pick<CleanStallInput, "mayEnter" | "chargeArm" | "mateComing" | "portYield"> {
  const mateComing = car.charging && car.parked && !car.chargerFaulted;
  return {
    mayEnter: chargeArm === "latched" || (chargeArm === "stowed" && !mateComing),
    chargeArm, mateComing,
    portYield: car.chargerFaulted && chargeArm !== "stowed",
  };
}

/** What the depot says at one fast-charger stall, this step. */
export interface CleanStallInput {
  /** RENDERER stall id. */
  stallId: string;
  /** Renderer stall type: only a stall with an OTTO-CHARGE ARM ('dcfc') has a cleaning arm. */
  stallType: string | null | undefined;
  /** The car in this stall, or null. */
  vehicleId: string | null;
  /** The twin's clean of this car by this stall's arm is in progress, and the car stands
   *  on its stall pose to the centimetre (the wand goes into the cabin). */
  active: boolean;
  /** Sim seconds until the twin's step ends, or null when it published no end. */
  endsInS: number | null;
  /** Sim seconds the arm still stands still for an item it found in the cabin (otto-q-core 0814), or 0. */
  heldS?: number;
  /** The stall's charge-port sign (depotPlacement.towardFor). */
  toward: 1 | -1;
  /** The charge arm is still (latched, or not working), so the cleaning arm may go in. */
  mayEnter: boolean;
  /**
   * The model of the car in the stall, as the twin's row names it (fleetModels/assign.fleetModelKeyFor), or null.
   * It picks the arm's program for this car (ottoCleanArm/cleanPrograms.ts): each vehicle has its own doors, seats
   * and roof. Null or absent: the generic car's program.
   */
  model?: string | null;
  /**
   * What the stall's OTTO-CHARGE ARM is doing (armGate.armState) and whether a mate is about to start. The gate
   * reads the PORT flank's rule from them and from the car's program (portAllowed). Absent: no charge arm beside
   * the car, so the port flank needs nothing.
   */
  chargeArm?: ChargeArmState;
  mateComing?: boolean;
  /** The charge arm must move now (its charger faulted with the connector in): the arm leaves the port flank. */
  portYield?: boolean;
}

/**
 * MAY THE PORT FLANK'S DOORS BE OPEN NOW? Only while the charge arm is still, with no mate coming, in a state the
 * car's program measured clear of its open port-flank door leaves (CleanProgram.beside, chargeArmBeside.ts):
 * latched at this vehicle's mate, or stowed at its home.
 */
export function portAllowed(
  beside: { stowed: boolean; latched: boolean }, chargeArm: ChargeArmState | undefined, mateComing: boolean,
): boolean {
  if (chargeArm === undefined) return true;
  if (chargeArm === "latched") return beside.latched;
  if (chargeArm === "stowed") return beside.stowed && !mateComing;
  return false;
}

interface StallState {
  session: CleanSession;
  sides: CleanSides;
  held: boolean;
  /** consecutive sim seconds held while FINISHING (the step is over) — the cap's clock */
  heldForS: number;
}

/** The phases in which the arm is moving over or beside the car. */
const OUT_OVER_THE_CAR = (p: CleanSession["phase"]) =>
  p !== "home" && p !== "doors_open" && p !== "doors_close";

export class CleanGate {
  private stalls = new Map<string, StallState>();

  /**
   * Advance every fast-charger stall's cleaning session by `simDt` sim seconds.
   *
   * A stall that drops out of `inputs` (its car gone) is not dropped while its arm is
   * out: it is stepped with no car until it is home, so the arm finishes on screen
   * instead of jumping home. Then it is forgotten.
   */
  step(simDt: number, inputs: Iterable<CleanStallInput>): void {
    const dt = Number.isFinite(simDt) && simDt > 0 ? Math.min(simDt, MAX_CLEAN_CLOCK_STEP_S) : 0;
    const seen = new Set<string>();
    for (const input of inputs) {
      if (!stallHasArm(input.stallType)) continue;
      seen.add(input.stallId);
      const prev = this.stalls.get(input.stallId);
      const sides = sidesFor(input.toward);
      const session = advanceBy(prev?.session ?? IDLE_CLEAN, dt, {
        vehicleId: input.vehicleId, active: input.active, endsInS: input.endsInS,
        sides, mayEnter: input.mayEnter, heldS: input.heldS, model: input.model ?? null,
        // the port flank's rule is the program's the session plays (the one it started with), or the one it would start
        portOk: portAllowed(
          cleanProgramFor(prev && prev.session.phase !== "home" ? prev.session.program : input.model).beside,
          input.chargeArm, input.mateComing === true),
        portYield: input.portYield === true,
      });
      this.store(input.stallId, prev, session, sides, dt);
    }
    for (const [id, st] of this.stalls) {
      if (seen.has(id)) continue;
      if (st.session.phase === "home") { this.stalls.delete(id); continue; }
      const session = advanceBy(st.session, dt, {
        vehicleId: null, active: false, endsInS: null, sides: st.sides,
      });
      this.store(id, st, session, st.sides, dt);
    }
  }

  private store(id: string, prev: StallState | undefined, session: CleanSession, sides: CleanSides, dt: number) {
    const held = !cleanLetsCarMove(session.phase);
    const heldForS = held && session.finishing ? (prev?.held ? prev.heldForS + dt : 0) : 0;
    this.stalls.set(id, { session, sides, held, heldForS });
  }

  /** May a car in this stall begin to move? True for any stall with no cleaning arm out. */
  mayMove(stallId: string | null | undefined): boolean {
    if (!stallId) return true;
    const s = this.stalls.get(stallId);
    if (!s || !s.held) return true;
    return s.heldForS >= CLEAN_HOLD_CAP_S;
  }

  /** This stall's cleaning session, or null when none is tracked. */
  session(stallId: string | null | undefined): CleanSession | null {
    if (!stallId) return null;
    return this.stalls.get(stallId)?.session ?? null;
  }

  /** The cleaning arm is not home, or the car's doors are not shut. */
  busy(stallId: string | null | undefined): boolean {
    const s = this.session(stallId);
    return !!s && s.phase !== "home";
  }

  /**
   * No charge arm may start a mate: the cleaning arm is moving over or beside the car, or a door on the charger's
   * flank is not shut. An arm that WAITS for the charge arm (parked up, port doors shut) blocks nothing: it waits
   * so that the charge arm can move.
   */
  blocksMate(stallId: string | null | undefined): boolean {
    const s = this.session(stallId);
    return !!s && ((OUT_OVER_THE_CAR(s.phase) && !s.waiting) || portDoorsOpen(s));
  }

  /**
   * What this stall's cleaning arm means for its charge arm: the facts roboticService.armSessionInput reads. ONE
   * composition, for the depart gate and for the drawn arm.
   */
  factsForChargeArm(stallId: string | null | undefined): { cleanBusy: boolean; cleanBlocksMate: boolean; cleanPortDoorsOpen: boolean } {
    return { cleanBusy: this.holdsConnector(stallId), cleanBlocksMate: this.blocksMate(stallId), cleanPortDoorsOpen: this.portDoorsOpen(stallId) };
  }

  /** A door on the charger's flank of the car in this stall is not shut. */
  portDoorsOpen(stallId: string | null | undefined): boolean {
    const s = this.session(stallId);
    return !!s && portDoorsOpen(s);
  }

  /** The cleaning arm waits, parked up with the port doors shut, for the charge arm. */
  waitsForChargeArm(stallId: string | null | undefined): boolean {
    return this.session(stallId)?.waiting === true;
  }

  /**
   * Must a latched connector stay in for the cleaning arm? While that arm is not home (Chase, 2026-10-19: the doors
   * close, the charge completes, then the charge arm retracts), except while it WAITS for the charge arm: then the
   * charge arm is what it waits for.
   */
  holdsConnector(stallId: string | null | undefined): boolean {
    const s = this.session(stallId);
    return !!s && s.phase !== "home" && !s.waiting;
  }

  /** Sim seconds this stall has held its car while finishing; 0 when not holding. */
  heldFor(stallId: string | null | undefined): number {
    if (!stallId) return 0;
    const s = this.stalls.get(stallId);
    return s?.held ? s.heldForS : 0;
  }

  /** Stalls whose cleaning arm is holding its car — for the operator trace. */
  holding(): string[] {
    const out: string[] = [];
    for (const [id, s] of this.stalls) if (s.held && s.heldForS < CLEAN_HOLD_CAP_S) out.push(id);
    return out;
  }

  /** Every car with a door open, and how far its widest-open flank stands (0..1). */
  doors(): [string, number][] {
    return this.doorsByFlank().map(([id, right, left]) => [id, Math.max(right, left)]);
  }

  /**
   * Every car with a door open, and how far each flank's doors stand: [car, right flank, left flank], 0..1. The far
   * flank's doors open first; the port flank's (the charger's) open only while the charge arm allows (cleanSession).
   */
  doorsByFlank(): [string, number, number][] {
    const out: [string, number, number][] = [];
    for (const s of this.stalls.values()) {
      const id = s.session.vehicleId;
      if (!id) continue;
      const d = cleanDoors(s.session, s.sides);
      if (d.right > 0 || d.left > 0) out.push([id, d.right, d.left]);
    }
    return out;
  }

  clear(): void {
    this.stalls.clear();
  }
}
