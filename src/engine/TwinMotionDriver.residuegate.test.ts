// ============================================================================
// THE DOOR THAT WAS OPEN — the motion-residue re-rail, gated.
//
// The depart gate shipped with three marked doors out of a DCFC stall and a
// comment claiming those were all of them. They were not (there are five; see
// the sweep in TwinMotionDriver's THE DEPART GATE header). The MOTION-RESIDUE
// REPAIR in reconcile's stability branch also calls assignRail(), and it only
// runs when `e.lane === lane` — precisely the case the lane-change gate cannot
// see, because that one requires `lane !== e.lane`. So a car docked on a
// charger with the arm still in its port, handed enough position residue, was
// re-railed and simply drove away: the exact founder-visible defect the gate
// exists to prevent, past a gate that reported zero refusals while it happened.
//
// This file is the regression. It builds the smallest state that reaches that
// branch — one car, one DCFC stall, one dwell leg so the arm mates for real —
// and then does the one thing the branch is looking for: displaces the body
// from its stall pose. With the gate the car does not move and the refusal
// counter ticks. Without it (delete `&& this.armReleases(e)` from the residue
// branch) the SECOND test here fails on the very next reconcile — verified by
// deleting exactly that and re-running this file: 1 failed | 2 passed.
//
// It deliberately asserts on the DRIVER's own observable state — tracker /
// reverse / poseStore distance / armHoldRefusals — not on an internal flag, so
// it cannot pass on a gate that is present but inert.
// ============================================================================
import { describe, it, expect, beforeEach } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { poseStore } from "./motion/poseStore";
import { useDepotStore } from "@/store/depotStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";

type Internals = {
  entries: Map<string, {
    car: { x: number; y: number; heading: number; speed: number };
    tracker: unknown | null;
    reverse: unknown | null;
    lane: string | null;
    stallId: string | null;
    playback: string;
    dwellStartMs: number | null;
  }>;
};

const VEHICLE = "veh-residue-1";
const TWIN_STALL = "twin-dcfc-01";
const RENDER_STALL = "DCFC-01";
/** wall-clock start for the synthetic sim clock; any fixed instant works */
const T0 = Date.parse("2026-08-11T14:00:00.000Z");

function entry() {
  return (twinMotionDriver as unknown as Internals).entries.get(VEHICLE)!;
}

/** One snapshot: the car charging on TWIN_STALL, with the DWELL leg that is the
 *  only thing on the wire carrying a service window (what proves it is parked,
 *  which is what lets the arm start a mate). */
function snap(atMs: number, state = "charging_dcfc"): TwinSnapshot {
  return {
    run: {
      sim_run_id: "residue-gate", scenario: "busy_day", status: "running",
      sim_clock: new Date(atMs).toISOString(),
      tick_count: 1, time_scale: 1, seed: 1, speed_x: 1,
    },
    legs: [{
      leg_id: "L1", vehicle_id: VEHICLE, seq: 1,
      leg_type: "charge_dcfc", intent: null, kind: "charge_curve",
      from_stall: null, to_stall: TWIN_STALL,
      from_x: null, from_y: null, to_x: null, to_y: null,
      start_sim: new Date(T0).toISOString(),
      end_sim: new Date(T0 + 1_800_000).toISOString(),
      duration_s: 1800, status: "active", geometry: "measured",
    }],
    fleet: {
      counts: {}, total: 1,
      vehicles: [{
        id: VEHICLE, av_id: "AV-1", make: "Zoox", platform: "robotaxi",
        state, soc: 42, stall_id: TWIN_STALL,
      }],
    },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

/** Drive the car to a FULLY MATED arm: poll the snapshot on an advancing sim
 *  clock (reconcile re-anchors it, which is the only way sim time passes in a
 *  test) until the arm reaches 'charging'.
 *
 *  'charging' specifically, not merely "held": every other held phase is
 *  TRANSIENT and ages out under armGate's HOLD_CAP_S, so a test that settled
 *  for 'unstow' would be asserting against a hold that expires on a timer. The
 *  connector-in-the-port hold is the open-ended one, and it is the one the
 *  founder rule is about. */
function dockWithArmMated(): number {
  twinMotionDriver.clear();
  useDepotStore.setState({
    stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
  });
  twinMotionDriver.setTwinStallMap([
    { id: TWIN_STALL, code: "NASH-DCFC-STALL-01", type: "dcfc" },
  ]);

  let t = T0;
  for (let i = 0; i < 24; i++) {
    twinMotionDriver.reconcile(snap(t));
    // 1 s of motion, then the arm steps against the sim delta this poll carried
    for (let k = 0; k < 20; k++) twinMotionDriver.tickMotion(0.05);
    if (twinMotionDriver.armPhaseAt(RENDER_STALL) === "charging") break;
    t += 30_000; // the reducer takes at most one phase per step
  }
  return t;
}

describe("DEPART GATE (1 of 5) — the motion-residue re-rail", () => {
  let t = T0;

  beforeEach(() => { t = dockWithArmMated(); });

  it("SETUP IS REAL: the car is parked on DCFC-01 with the arm holding it", () => {
    const e = entry();
    expect(e.stallId).toBe(RENDER_STALL);
    expect(e.lane).toBe("dcfc");
    expect(e.tracker).toBeNull();
    expect(e.reverse).toBeFalsy();
    // the hold is the arm's own, not a stuck tether: stalls_status is empty
    expect(twinMotionDriver.armHolds).toContain(RENDER_STALL);
    expect(twinMotionDriver.armPhaseAt(RENDER_STALL)).toBe("charging");
  });

  it("REFUSES to re-rail a docked car for position residue while the arm is on it", () => {
    const e = entry();
    const st = useDepotStore.getState().stalls.find((s) => s.id === RENDER_STALL)!;
    // 3.0u of residue — comfortably past the branch's 1.8u threshold. With the
    // gate deleted this exact setup hands the car a 330.38u rail and it has
    // travelled 25.02u of it by the end of this loop (22.74u straight-line from
    // the STALL; `from` below is the displaced pose, 3.0u further out, so the
    // assertion's own datum reads 24.92u). Arm still at phase 'charging',
    // armHoldRefusals 0.
    e.car.x = st.position.x + 3.0;
    const before = twinMotionDriver.armHoldRefusals;
    const from = { x: e.car.x, y: e.car.y };

    // the branch fires on RECONCILE, so poll it the way the live bridge does
    for (let i = 0; i < 4; i++) {
      t += 1_000;
      twinMotionDriver.reconcile(snap(t));
      for (let k = 0; k < 20; k++) twinMotionDriver.tickMotion(0.05);
    }

    const after = entry();
    expect(after.tracker).toBeNull();          // never railed
    expect(after.reverse).toBeFalsy();         // never began the 11u back-out
    expect(after.stallId).toBe(RENDER_STALL);  // kept its charger
    // and it did not physically travel: the parked branch holds pose
    const p = poseStore.get(VEHICLE) ?? after.car;
    expect(Math.hypot(p.x - from.x, p.y - from.y)).toBeLessThan(0.5);
    // THE GATE IS WHAT DID IT, not an accident of the threshold. Without this
    // assertion a gate that never ran would still pass the ones above.
    expect(twinMotionDriver.armHoldRefusals).toBeGreaterThan(before);
    expect(twinMotionDriver.armHolds).toContain(RENDER_STALL);
  });

  it("THE HOLD IS NOT A FREEZE — the arm demates and the car is released", () => {
    const e = entry();
    const st = useDepotStore.getState().stalls.find((s) => s.id === RENDER_STALL)!;
    e.car.x = st.position.x + 3.0;
    let maxHeldForS = 0;

    // The roster flips off 'charging' — that flip is what ends the session on
    // BOTH evaluations of the arm cycle, so the demate begins. 4 s per poll
    // rather than the 30 s used to mate, so the release phases play out on
    // their own timings instead of one-per-jump.
    for (let i = 0; i < 20; i++) {
      t += 4_000;
      // The commit-and-hold dwell floor is 12 REAL seconds and this whole test
      // runs in milliseconds, so without ageing the clock the lane change is
      // suppressed and the car never stops charging at all. Same device, same
      // reason, as TwinMotionDriver.armgate.test.ts's replay.
      if (e.dwellStartMs != null) e.dwellStartMs -= 13_000;
      twinMotionDriver.reconcile(snap(t, "charge_complete_holding"));
      for (let k = 0; k < 20; k++) twinMotionDriver.tickMotion(0.05);
      maxHeldForS = Math.max(maxHeldForS, twinMotionDriver.armHeldForS(RENDER_STALL));
      if (!twinMotionDriver.armHolds.includes(RENDER_STALL)) break;
    }

    expect(twinMotionDriver.armHolds).not.toContain(RENDER_STALL);
    // It cleared because the arm FINISHED, not because HOLD_CAP_S (60 s) timed
    // the hold out. Measured peak here: 28.0 sim-seconds of continuous hold,
    // over unlatch → extract → retract → clear.
    expect(maxHeldForS).toBeLessThan(30);
    // and the gate stops refusing: the residue repair was DEFERRED, not cancelled
    const refusalsWhenClear = twinMotionDriver.armHoldRefusals;
    t += 1_000;
    twinMotionDriver.reconcile(snap(t, "charge_complete_holding"));
    for (let k = 0; k < 20; k++) twinMotionDriver.tickMotion(0.05);
    expect(twinMotionDriver.armHoldRefusals).toBe(refusalsWhenClear);
  });
});
