// ============================================================================
// THE TEST NOBODY WROTE: does the arm actually mate ON THE LIVE CADENCE?
//
// EVERY OTHER TEST FILE IN THIS REPO RUNS FASTER THAN THE APP'S OWN CLOCK.
// Not one of them calls vi.useFakeTimers or advances performance.now(), and all
// of them finish in well under a second of real time — while DWELL_FLOOR_MS is
// TWELVE REAL WALL-CLOCK SECONDS. So the whole "service clock published to the
// arms" block in TwinMotionDriver.test.ts does ONE reconcile against a car
// placed parked-in-place and asserts (case A below). Case A passed at every
// commit, including the ones where the founder's cockpit showed zero connected
// arms for 45 minutes. A green suite was not evidence.
//
// This file FAKES WALL TIME, so performance.now() — the clock DWELL_FLOOR_MS,
// dwellStartMs and simNow() all read — advances the way it does live, and then
// polls the driver on the live cadence instead of asserting after one call.
//
// It asks the two questions the founder's defect turns on:
//
//   1. Does a car the twin reports charging_dcfc, parked on a DCFC stall, come
//      out of the published roster with a NON-NULL serviceStartTime, and does
//      ChargingArm's own predicate evaluate TRUE — and does it STAY true long
//      enough for the 18.5 s mate to complete, and long after?
//   2. Does a car still TAXIING toward a DCFC stall fail to mate? (Case C. This
//      is the invariant the fix had to keep, and it is worth more than the fix:
//      an arm reaching into an empty stall is a worse depot than an arm that
//      never reaches at all.)
//
// Cases labelled below exactly as they were measured at 68bd8ba, so the before
// and after are comparable line by line. At 68bd8ba: A and B and C passed,
// E and F FAILED.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { useDepotStore } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";
import { useSimulationStore } from "@/store/simulationStore";
import { isArmCommitted, advanceArmSession, IDLE_SESSION } from "@/lib/ottoChargeArm/roboticService";
import type { TwinSnapshot } from "@/lib/ottoTwin";

const CLOCK0 = Date.parse("2026-08-11T18:00:00.000Z");

type Priv = {
  entries: Map<string, { playback: string; dwellStartMs: number | null; lane: string | null; stallId: string | null }>;
};
const priv = () => twinMotionDriver as unknown as Priv;

/** Snapshot with a live sim clock, one DCFC-bound car, and optional dwell legs. */
function dwellSnap(
  vehicles: { id: string; state: string; stall_id?: string | null }[],
  legs: Record<string, unknown>[],
  clockMs: number,
  speedX = 1,
): TwinSnapshot {
  return {
    run: {
      sim_run_id: "review", scenario: "normal_day", status: "running",
      sim_clock: new Date(clockMs).toISOString(),
      tick_count: 1, time_scale: 1, seed: 424242, speed_x: speedX,
    },
    legs,
    fleet: {
      counts: {}, total: vehicles.length,
      vehicles: vehicles.map((v, i) => ({
        id: v.id, av_id: `AV-${i}`, make: "Zoox", platform: "robotaxi",
        state: v.state, soc: 58, stall_id: v.stall_id ?? null,
      })),
    },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

const chargeDwell = (vehicleId: string, twinStall: string, durationS: number, startMs: number) => ({
  leg_id: `${vehicleId}-dwell`, vehicle_id: vehicleId, seq: 2,
  leg_type: "charge_dcfc", intent: null, kind: "charge_session",
  from_stall: twinStall, to_stall: twinStall,
  from_x: null, from_y: null, to_x: null, to_y: null,
  start_sim: new Date(startMs).toISOString(),
  end_sim: new Date(startMs + durationS * 1000).toISOString(),
  duration_s: durationS, status: "active", geometry: "measured",
});

const find = (id: string) => useVehicleStore.getState().vehicles.find((v) => v.id === id);

/** ChargingArm.tsx ~line 205, copied line-for-line. */
function armPredicate(id: string, stallId: string) {
  const v = useVehicleStore.getState().vehicles.find((x) => x.assignedStall === stallId);
  const phase = twinMotionDriver.armPhaseAt(stallId) ?? "stowed";
  const chargingState = v?.status === "charging";
  const parked = v?.serviceStartTime !== null && v?.serviceStartTime !== undefined;
  const charging = !!v && chargingState && (parked || isArmCommitted(phase));
  return { chargingState, parked, charging, phase, vFound: !!v, id };
}

describe("does the arm actually mate on the live cadence?", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance", "Date"] });
    vi.setSystemTime(new Date("2026-08-11T18:00:00.000Z"));
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useSimulationStore.getState().resetConfig();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
    twinMotionDriver.setTwinStallMap([{ id: "twin-d2", code: "NASH-DCFC-STALL-02", type: "dcfc" }]);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("A — one reconcile: the link the tests cover", () => {
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "car", state: "charging_dcfc", stall_id: "twin-d2" }],
      [chargeDwell("car", "twin-d2", 4962, CLOCK0)],
      CLOCK0,
    ));
    const v = find("car")!;
    const p = armPredicate("car", "DCFC-02");
    console.log("[A] assignedStall=%s status=%s serviceStartTime=%s playback=%s parked=%s charging=%s",
      v.assignedStall, v.status, String(v.serviceStartTime),
      priv().entries.get("car")?.playback, p.parked, p.charging);
    expect(v.assignedStall).toBe("DCFC-02");
    expect(v.serviceStartTime).not.toBeNull();
    expect(p.charging).toBe(true);
  });

  it("B — LIVE CADENCE: the twin keeps saying charging_dcfc; does the link hold?", () => {
    // 2 s poll cadence, 120 s of wall time, the run at 3x (the founder's run).
    const SPEED = 3;
    const POLL_MS = 2000;
    const samples: { t: number; playback: string; sst: string; parked: boolean; charging: boolean; phase: string }[] = [];
    let firstNull = -1;
    for (let t = 0; t <= 120000; t += POLL_MS) {
      const clock = CLOCK0 + t * SPEED;
      twinMotionDriver.reconcile(dwellSnap(
        [{ id: "car", state: "charging_dcfc", stall_id: "twin-d2" }],
        [chargeDwell("car", "twin-d2", 4962, CLOCK0)],
        clock, SPEED,
      ));
      // motion ticks between polls, as the render loop does
      for (let k = 0; k < POLL_MS / 16; k++) {
        vi.advanceTimersByTime(16);
        twinMotionDriver.tickMotion(0.016);
      }
      const v = find("car");
      const p = armPredicate("car", "DCFC-02");
      const rec = {
        t: t / 1000,
        playback: priv().entries.get("car")?.playback ?? "-",
        sst: v?.serviceStartTime == null ? "NULL" : v.serviceStartTime.toFixed(0),
        parked: p.parked, charging: p.charging, phase: p.phase,
      };
      samples.push(rec);
      if (rec.sst === "NULL" && firstNull < 0 && t > 0) firstNull = t / 1000;
    }
    for (const s of samples) {
      if (s.t % 20 === 0) {
        console.log("[B] t=%ss playback=%s serviceStartTime=%s parked=%s charging=%s armPhase=%s",
          s.t, s.playback, s.sst, s.parked, s.charging, s.phase);
      }
    }
    const active = samples.filter((s) => s.phase !== "stowed").length;
    const mated = samples.filter((s) => s.phase === "charging").length;
    console.log("[B] SUMMARY samples=%d  serviceStartTime NULL first at t=%ss  non-stowed samples=%d  'charging'-phase samples=%d",
      samples.length, firstNull, active, mated);
    // The claim under review: the arm reaches and holds a mated state.
    expect(mated).toBeGreaterThan(0);
    // …and the window that opened the mate never goes away underneath it. At
    // 68bd8ba this first went NULL at t=12s (DWELL_FLOOR_MS) and stayed NULL.
    expect(firstNull).toBe(-1);
    expect(samples[samples.length - 1].sst).not.toBe("NULL");
  });

  it("G — THE SEAM: charging_dcfc + parked on a DCFC stall ⇒ a window, and STILL a window a minute later", () => {
    // The assertion whose absence let this ship. The published roster is the ONE
    // shared fact between the driver's own armGate and ChargingArm.tsx; if it
    // carries no serviceStartTime for a car that is demonstrably charging in a
    // charger, neither evaluation of the arm cycle can ever start a mate.
    //
    // 68bd8ba: non-null at t=0, NULL from t=12s on (DWELL_FLOOR_MS is REAL
    // seconds). The check has to outlive that floor by a wide margin or it is
    // just case A again with extra steps.
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "car", state: "charging_dcfc", stall_id: "twin-d2" }],
      [chargeDwell("car", "twin-d2", 4962, CLOCK0)], CLOCK0, 1));
    const at0 = find("car")!.serviceStartTime;
    expect(at0).not.toBeNull();

    // 90 REAL seconds — 7.5x DWELL_FLOOR_MS — of frames and polls.
    for (let t = 0; t < 90000; t += 2000) {
      for (let k = 0; k < 2000 / 16; k++) { vi.advanceTimersByTime(16); twinMotionDriver.tickMotion(0.016); }
      twinMotionDriver.reconcile(dwellSnap(
        [{ id: "car", state: "charging_dcfc", stall_id: "twin-d2" }],
        [chargeDwell("car", "twin-d2", 4962, CLOCK0)], CLOCK0 + t + 2000, 1));
    }
    const v = find("car")!;
    console.log("[G] +90 real s: playback=%s serviceStartTime=%s (was %s at t=0) armPhase=%s",
      priv().entries.get("car")?.playback, String(v.serviceStartTime), String(at0),
      twinMotionDriver.armPhaseAt("DCFC-02"));
    expect(v.status).toBe("charging");
    expect(v.assignedStall).toBe("DCFC-02");
    expect(v.serviceStartTime).not.toBeNull();
    // and the driver's OWN evaluation of the cycle got there too
    expect(twinMotionDriver.armPhaseAt("DCFC-02")).toBe("charging");
  });

  it("H — COMMIT-AND-HOLD SURVIVES: a twin flip with no new service stall is still held for the floor", () => {
    // The half of the old block that is CORRECT and must not be traded away.
    // The twin ticks 30 sim-min at a time, so a charge routinely completes in the
    // backend before the renderer has finished showing it. A flip to
    // staged_for_departure is a PREDICTION about where the car will be, and the
    // floor is what makes the charge visible at all. Only a flip that names a
    // different SERVICE stall — a position, not a prediction — now goes straight
    // through (case F).
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "car", state: "charging_dcfc", stall_id: "twin-d2" }],
      [chargeDwell("car", "twin-d2", 4962, CLOCK0)], CLOCK0, 1));
    expect(find("car")!.assignedStall).toBe("DCFC-02");

    // 4 s later — INSIDE the 12 s floor — the twin says it is staged to leave.
    vi.advanceTimersByTime(4000);
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "car", state: "staged_for_departure", stall_id: null }], [], CLOCK0 + 4000, 1));
    const held = { stall: find("car")!.assignedStall, status: find("car")!.status };
    console.log("[H] t=4s twin says staged_for_departure → still rendered on %s as %s (held)",
      held.stall, held.status);
    expect(held.stall).toBe("DCFC-02");   // the dock is still being SEEN
    expect(held.status).toBe("charging");

    // past the floor, the hold releases and live truth flows again
    vi.advanceTimersByTime(9000);
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "car", state: "staged_for_departure", stall_id: null }], [], CLOCK0 + 13000, 1));
    console.log("[H] t=13s past the floor → stall=%s status=%s",
      find("car")!.assignedStall, find("car")!.status);
    expect(find("car")!.status).toBe("staging");
  });

  it("E — THE LIVE OBSERVATION: an arm that starts stowed against an ALREADY-charging car", () => {
    // Exactly what the founder / reviewer saw: the cockpit is opened against a
    // run that is already going. Every car has been docked for longer than the
    // 12 s visible-dwell floor, so its playback has already flipped to
    // 'released' and its roster window is already null. The arm component mounts
    // now, with IDLE_SESSION ('stowed'), and asks its predicate.
    const SPEED = 3;
    // 1) drive the run forward until the car is charging-but-'released'
    for (let t = 0; t <= 60000; t += 2000) {
      twinMotionDriver.reconcile(dwellSnap(
        [{ id: "car", state: "charging_dcfc", stall_id: "twin-d2" }],
        [chargeDwell("car", "twin-d2", 4962, CLOCK0)],
        CLOCK0 + t * SPEED, SPEED,
      ));
      for (let k = 0; k < 2000 / 16; k++) { vi.advanceTimersByTime(16); twinMotionDriver.tickMotion(0.016); }
    }
    const v = find("car")!;
    const pb = priv().entries.get("car")!.playback;
    console.log("[E] state now: twin=charging_dcfc stall=%s playback=%s roster.status=%s roster.serviceStartTime=%s",
      v.assignedStall, pb, v.status, String(v.serviceStartTime));

    // 2) the arm mounts FRESH — this is a page load / component remount, so the
    //    session ref starts at IDLE_SESSION, not at whatever it had before.
    let session = IDLE_SESSION;
    let everCommitted = false;
    for (let f = 0; f < 60 * 45; f++) {          // 45 s of frames at 60 Hz
      const veh = useVehicleStore.getState().vehicles.find((x) => x.assignedStall === "DCFC-02");
      const chargingState = veh?.status === "charging";
      const parked = veh?.serviceStartTime !== null && veh?.serviceStartTime !== undefined;
      const charging = !!veh && chargingState && (parked || isArmCommitted(session.phase));
      session = advanceArmSession(session, {
        dt: (1 / 60) * SPEED, vehicleId: veh?.id ?? null, charging,
        tetherRemainingS: twinMotionDriver.stallTetherRemainingS("DCFC-02"),
      });
      if (session.phase !== "stowed") everCommitted = true;
      if (f % 600 === 0) {
        twinMotionDriver.reconcile(dwellSnap(
          [{ id: "car", state: "charging_dcfc", stall_id: "twin-d2" }],
          [chargeDwell("car", "twin-d2", 4962, CLOCK0)],
          CLOCK0 + (60000 + f * 16) * SPEED, SPEED,
        ));
      }
    }
    console.log("[E] after 45 s of frames: phase=%s  everLeftStowed=%s", session.phase, everCommitted);
    expect(everCommitted).toBe(true);   // the claim: the arm mates
  });

  it("F — DEFECT 8: car drawn on an L2 stall while the twin says charging_dcfc", () => {
    twinMotionDriver.setTwinStallMap([
      { id: "twin-d7", code: "NASH-DCFC-STALL-07", type: "dcfc" },
      { id: "twin-l27", code: "NASH-L2-STALL-27", type: "l2" },
    ]);
    // the twin had it on L2 first
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "car", state: "charging_l2", stall_id: "twin-l27" }], [], CLOCK0, 1));
    console.log("[F] t=0  rendered stall=%s lane=%s", find("car")?.assignedStall, priv().entries.get("car")?.lane);
    // 4 s later the twin says charging_dcfc on DCFC-07 — INSIDE the 12 s floor
    vi.advanceTimersByTime(4000);
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "car", state: "charging_dcfc", stall_id: "twin-d7" }], [], CLOCK0 + 4000, 1));
    const during = { stall: find("car")?.assignedStall, lane: priv().entries.get("car")?.lane };
    console.log("[F] t=4s  twin says charging_dcfc/NASH-DCFC-STALL-07 (maps to %s) → rendered stall=%s lane=%s",
      "DCFC-07", during.stall, during.lane);
    // 13 s in, past DWELL_FLOOR_MS
    vi.advanceTimersByTime(9500);
    twinMotionDriver.reconcile(dwellSnap(
      [{ id: "car", state: "charging_dcfc", stall_id: "twin-d7" }], [], CLOCK0 + 13500, 1));
    console.log("[F] t=13.5s → rendered stall=%s lane=%s",
      find("car")?.assignedStall, priv().entries.get("car")?.lane);
    // The renderer had the right answer and drew the other stall:
    expect(during.stall).toBe("DCFC-07");
  });

  it("C — INVARIANT: a car still TAXIING to a DCFC stall must NOT be mated", () => {
    // prime the driver so the newcomer drives in from the ingress rather than
    // being placed parked in-place
    twinMotionDriver.reconcile(dwellSnap([{ id: "seed", state: "staged_for_departure" }], [], CLOCK0, 1));
    const SPEED = 1;
    let worstParked = false, worstCharging = false, worstPhase = "stowed";
    let dockedAt = -1;
    const trail: string[] = [];
    for (let t = 0; t <= 180000; t += 500) {
      twinMotionDriver.reconcile(dwellSnap(
        [{ id: "seed", state: "staged_for_departure" },
         { id: "car", state: "charging_dcfc", stall_id: "twin-d2" }],
        [chargeDwell("car", "twin-d2", 4962, CLOCK0)],
        CLOCK0 + t * SPEED, SPEED,
      ));
      for (let k = 0; k < 500 / 16; k++) {
        vi.advanceTimersByTime(16);
        twinMotionDriver.tickMotion(0.016);
      }
      const pb = priv().entries.get("car")?.playback ?? "-";
      const p = armPredicate("car", "DCFC-02");
      if (pb === "enroute") {
        // WHILE STILL TAXIING: nothing may claim it is parked or mated.
        worstParked ||= p.parked;
        worstCharging ||= p.charging;
        if (p.phase !== "stowed") worstPhase = p.phase;
      } else if (pb === "docked" && dockedAt < 0) {
        dockedAt = t / 1000;
      }
      // one line per PHASE CHANGE after the dock, not one per sample
      if (dockedAt >= 0) {
        const line = `pb=${pb} phase=${p.phase}`;
        if (trail[trail.length - 1]?.split(" | ")[1] !== line) trail.push(`t=${t / 1000}s | ${line}`);
      }
    }
    for (const line of trail) console.log("[C after-dock] %s", line);
    console.log("[C] while ENROUTE: parked-ever=%s armCharging-ever=%s worstPhase=%s | first docked at t=%ss",
      worstParked, worstCharging, worstPhase, dockedAt);
    expect(worstParked).toBe(false);
    expect(worstCharging).toBe(false);
    expect(worstPhase).toBe("stowed");
    // …and once it HAS docked the mate does complete — otherwise "never mated"
    // would trivially satisfy the three assertions above.
    expect(dockedAt).toBeGreaterThan(0);
    expect(trail.some((l) => l.endsWith("phase=charging"))).toBe(true);
  });
});
