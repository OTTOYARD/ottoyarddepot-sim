// ============================================================================
// tireGate.ts — THE TIRE MACHINE, ONCE PER SERVICE BAY, AND THE HOLD IT PUTS ON ITS CAR.
//
// OTTO-Q seats a car in a service bay for its tire work (otto-q-core 0842: a worn set replaced, or the quarterly
// rotation) and times the seat, and the snapshot says when the seat started, when it ends and what work it is for
// (0762 `bay_seat`, 0843 `work`). This file plays the bay's OTTO-TIRE machine inside that seat: one session per service
// bay, reduced by tireSession.advanceTireSession, stepped on the sim clock by TwinMotionDriver.
//
// ONE EVALUATION. TireBay.tsx draws this session, the car's height on the lift is written from it (liftStore), and the
// car's right to move is read from it. So the machine, the lift under the car and the hold cannot disagree.
//
// FAIL-SAFE DIRECTION, the wash gate's: a bay this gate has never seen and a car no session covers are NOT held. Only a
// car whose bay's machine is out of its home is, and the way home is bounded (tireSession.FINISH_S).
// ============================================================================
import {
  advanceTireSession, carRise, IDLE_TIRE, tireLetsCarMove, type TireInput, type TireSession,
} from "@/lib/ottoTire/tireSession";

/** The step the gate feeds the reducer, sim seconds: a frame's sim time is played in steps of at most this. */
export const TIRE_SUBSTEP_S = 0.5;
/** Largest sim-clock step treated as elapsed time, seconds (the wash gate's). */
export const MAX_TIRE_CLOCK_STEP_S = 30;

/** What the depot says at one service bay, this step. */
export interface TireBayInput extends Omit<TireInput, "dt"> {
  /** RENDERER stall id of the bay (the service bays' ids in structurePlan.OPS_SHELL). */
  bayId: string;
}

export class TireGate {
  private sessions = new Map<string, TireSession>();

  /** Play `dt` sim seconds at each bay the depot reports this step. */
  step(dt: number, bays: readonly TireBayInput[]): void {
    const total = Math.min(Math.max(0, dt), MAX_TIRE_CLOCK_STEP_S);
    for (const b of bays) {
      let s = this.sessions.get(b.bayId) ?? IDLE_TIRE;
      let done = 0;
      do {
        const step = Math.min(total - done, TIRE_SUBSTEP_S);
        done += step;
        // the seat's clocks were read at the end of the frame: each step sees them as they stood when it ended
        const before = total - done;
        s = advanceTireSession(s, {
          ...b, dt: step,
          endsInS: b.endsInS != null ? b.endsInS + before : null,
          sinceS: b.sinceS != null ? Math.max(0, b.sinceS - before) : null,
        });
      } while (done < total - 1e-9);
      this.sessions.set(b.bayId, s);
    }
    // a bay the depot no longer reports a car in: its machine finishes and goes home on its own clock
    const seen = new Set(bays.map((b) => b.bayId));
    for (const [id, s] of this.sessions) {
      if (seen.has(id) || s.phase === "home") continue;
      this.sessions.set(id, advanceTireSession(s, {
        dt: total, vehicleId: null, active: false, job: null, model: null, endsInS: null, sinceS: null,
      }));
    }
  }

  /** What the machine in this bay is doing, or null when no session covers it. */
  session(bayId: string): TireSession | null {
    return this.sessions.get(bayId) ?? null;
  }

  /** May the car in this bay move? Only with its machine at home. */
  mayMove(bayId: string): boolean {
    const s = this.sessions.get(bayId);
    return !s || tireLetsCarMove(s);
  }

  /** Bays whose machine is holding its car, for the operator trace. */
  holding(): string[] {
    return [...this.sessions].filter(([, s]) => !tireLetsCarMove(s)).map(([id]) => id);
  }

  /** Each car on a lift, and how far its body is raised (metres): what liftStore is synced to. */
  lifts(): [string, number][] {
    const out: [string, number][] = [];
    for (const s of this.sessions.values()) {
      if (!s.vehicleId) continue;
      const m = carRise(s);
      if (m > 0) out.push([s.vehicleId, m]);
    }
    return out;
  }

  clear(): void {
    this.sessions.clear();
  }
}
