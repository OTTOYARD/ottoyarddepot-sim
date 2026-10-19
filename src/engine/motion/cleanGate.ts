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
  advanceCleanSession, cleanLetsCarMove, IDLE_CLEAN, type CleanSession,
} from "@/lib/ottoCleanArm/cleanSession";
import { doorsAt, sidesFor, type CleanSides } from "@/lib/ottoCleanArm/cleanArmPose";
import { stallHasArm } from "@/lib/ottoChargeArm/roboticService";
import type { TwinVehicle } from "@/lib/ottoTwin";

/** Largest sim-clock step treated as elapsed time, seconds (the depart gate's, for its reason). */
export const MAX_CLEAN_CLOCK_STEP_S = 30;

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
 * The atom is the interior tidy with status 'in_progress' and a robot_stall_id that
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
    if (!a || a.svc !== "interior_tidy" || a.status !== "in_progress") continue;
    if (typeof a.robot_stall_id !== "string" || a.robot_stall_id === "") continue;
    const stall = rendererStall(a.robot_stall_id);
    if (!stall) continue;
    const placedHere = typeof bv.stall_id === "string" && rendererStall(bv.stall_id) === stall;
    return { stall, placedHere, startMs: ms(a.started_at), endsMs: ms(a.ends_at) };
  }
  return null;
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
  /** The stall's charge-port sign (depotPlacement.towardFor). */
  toward: 1 | -1;
  /** The charge arm is still (latched, or not working), so the cleaning arm may go in. */
  mayEnter: boolean;
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
      const session = advanceCleanSession(prev?.session ?? IDLE_CLEAN, {
        dt, vehicleId: input.vehicleId, active: input.active, endsInS: input.endsInS,
        sides, mayEnter: input.mayEnter,
      });
      this.store(input.stallId, prev, session, sides, dt);
    }
    for (const [id, st] of this.stalls) {
      if (seen.has(id)) continue;
      if (st.session.phase === "home") { this.stalls.delete(id); continue; }
      const session = advanceCleanSession(st.session, {
        dt, vehicleId: null, active: false, endsInS: null, sides: st.sides,
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

  /** The cleaning arm is moving over or beside the car: no charge arm may start a mate. */
  blocksMate(stallId: string | null | undefined): boolean {
    const s = this.session(stallId);
    return !!s && OUT_OVER_THE_CAR(s.phase);
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

  /** Every car with its doors open, and how far (0..1, both doors alike). */
  doors(): [string, number][] {
    const out: [string, number][] = [];
    for (const s of this.stalls.values()) {
      const id = s.session.vehicleId;
      if (!id) continue;
      const f = doorsAt(s.session.phase, s.session.t);
      if (f > 0) out.push([id, f]);
    }
    return out;
  }

  clear(): void {
    this.stalls.clear();
  }
}
