// ============================================================================
// washGate.ts — THE ROLLOVER MACHINE, ONCE PER WASH BAY, AND THE HOLD IT PUTS ON ITS CAR.
//
// The twin seats a car in a wash or detail bay and times the work (otto-q-core 0746), and
// the snapshot says when the seat started and when it ends (0762, `bay_seat`). This file
// plays the bay's machine inside that seat: one session per wash bay, reduced by
// washSession.advanceWashSession from what the snapshot and the motion layer say, stepped
// on the sim clock by TwinMotionDriver.
//
// ONE EVALUATION. WashGantry.tsx draws this session, the car's doors are written from it
// (doorStore, for a detail seat's vacuum), and the car's right to move is read from it.
// So the machine, the doors and the hold cannot disagree.
//
// FAIL-SAFE DIRECTION, the depart gate's: a bay this gate has never seen and a car no
// session covers are NOT held. Only a car whose bay's machine is out of its home is. And
// the hold is bounded once the twin's seat is over (WASH_HOLD_CAP_S): a wedged signal
// must not freeze a car.
// ============================================================================
import {
  advanceWashSession, IDLE_WASH, washDoorsAt, washLetsCarMove, type WashSession,
} from "@/lib/ottoWash/washSession";

/** Largest sim-clock step treated as elapsed time, seconds (the depart gate's, for its reason). */
export const MAX_WASH_CLOCK_STEP_S = 30;

/**
 * Longest the gate may hold a car once the twin's seat is over, sim seconds.
 *
 * DERIVED. From anywhere in the program the way home is at most: wands out (3) + up (3) +
 * doors shut (3) + brushes off the car (2) + the longest return, 15.4 u at 0.8 u/s plus 1 s
 * (20.25), with everything but the retract at WASH_ABORT_SPEED (3x): 11 + 2 = 13 s. 30 s
 * clears that twice over and can only fire on a wedged signal.
 */
export const WASH_HOLD_CAP_S = 30;

/** What the depot says at one wash bay, this step. */
export interface WashBayInput {
  /** RENDERER stall id of the bay (WASH-01 ..). */
  bayId: string;
  /** The car in this bay, or null. */
  vehicleId: string | null;
  /** The twin has this car's seat on in this bay, and the car stands on the bay's pose. */
  active: boolean;
  /** A detail seat: the interior is cleaned first. */
  interior: boolean;
  /** Sim seconds until the twin's seat ends, or null when it published no end. */
  endsInS: number | null;
  /** Sim seconds since the twin seated the car, or null when it published no start. */
  sinceS?: number | null;
}

interface BayState {
  session: WashSession;
  held: boolean;
  /** consecutive sim seconds held while FINISHING (the seat is over): the cap's clock */
  heldForS: number;
}

export class WashGate {
  private bays = new Map<string, BayState>();

  /**
   * Advance every wash bay's machine by `simDt` sim seconds.
   *
   * A bay that drops out of `inputs` (its car gone) is not dropped while its machine is out:
   * it is stepped with no car until it is home, so it finishes on screen instead of jumping
   * home. Then it is forgotten.
   */
  step(simDt: number, inputs: Iterable<WashBayInput>): void {
    const dt = Number.isFinite(simDt) && simDt > 0 ? Math.min(simDt, MAX_WASH_CLOCK_STEP_S) : 0;
    const seen = new Set<string>();
    for (const input of inputs) {
      seen.add(input.bayId);
      const prev = this.bays.get(input.bayId);
      const session = advanceWashSession(prev?.session ?? IDLE_WASH, {
        dt, vehicleId: input.vehicleId, active: input.active, interior: input.interior, endsInS: input.endsInS,
        sinceS: input.sinceS ?? null,
      });
      this.store(input.bayId, prev, session, dt);
    }
    for (const [id, st] of this.bays) {
      if (seen.has(id)) continue;
      if (st.session.phase === "home") { this.bays.delete(id); continue; }
      const session = advanceWashSession(st.session, { dt, vehicleId: null, active: false, interior: false, endsInS: null });
      this.store(id, st, session, dt);
    }
  }

  private store(id: string, prev: BayState | undefined, session: WashSession, dt: number) {
    const held = !washLetsCarMove(session.phase);
    const heldForS = held && session.finishing ? (prev?.held ? prev.heldForS + dt : 0) : 0;
    this.bays.set(id, { session, held, heldForS });
  }

  /** May a car in this bay begin to move? True for any bay whose machine is home. */
  mayMove(bayId: string | null | undefined): boolean {
    if (!bayId) return true;
    const s = this.bays.get(bayId);
    if (!s || !s.held) return true;
    return s.heldForS >= WASH_HOLD_CAP_S;
  }

  /** This bay's session, or null when none is tracked. */
  session(bayId: string | null | undefined): WashSession | null {
    if (!bayId) return null;
    return this.bays.get(bayId)?.session ?? null;
  }

  /** Bays whose machine is holding its car, for the operator trace. */
  holding(): string[] {
    const out: string[] = [];
    for (const [id, s] of this.bays) if (s.held && s.heldForS < WASH_HOLD_CAP_S) out.push(id);
    return out;
  }

  /** Every car with its doors open in a bay, and how far (0..1, both doors alike). */
  doors(): [string, number][] {
    const out: [string, number][] = [];
    for (const s of this.bays.values()) {
      const id = s.session.vehicleId;
      if (!id) continue;
      const f = washDoorsAt(s.session);
      if (f > 0) out.push([id, f]);
    }
    return out;
  }

  clear(): void {
    this.bays.clear();
  }
}
