// ============================================================================
// THE CABIN STOP, END TO END THROUGH THE MOTION DRIVER (otto-q-core 0817, 0818).
//
// Chase, 2026-11-12: "any interior cleaning goes straight to the charging post for
// the vacuum overhead to swing down and clean inside of it." A parked car with an
// interior deep clean and no charge to do is sent to a free fast-charger post. It
// stands there, NOT plugged in, while the post's arm runs the deep program, and then
// goes on. The engine's state word for that car is charge_complete_holding, which is
// also every car that has just finished a charge. The mark on the deep-clean atom
// (cabin_stop_stall_id) is what says this car belongs on the post.
//
// Driven as the live bridge drives it: a snapshot on an advancing sim clock, then
// motion ticks. Asserted on what the driver publishes.
// ============================================================================
import { describe, it, expect, beforeEach } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { cabinStopOf } from "./motion/cleanGate";
import { useDepotStore } from "@/store/depotStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";

type Internals = {
  entries: Map<string, {
    tracker: unknown | null;
    reverse: unknown | null;
    lane: string | null;
    stallId: string | null;
    vstatus: string;
    dwellStartMs: number | null;
  }>;
};

const VEHICLE = "veh-stop-1";
const TWIN_POST = "twin-dcfc-01";
const RENDER_POST = "DCFC-01";
const T0 = Date.parse("2026-11-12T19:00:00.000Z");
const CYCLE_S = 648;   // 2 x 5.0 min + 0.8 min, the arm's deep program (0815)

const entry = () => (twinMotionDriver as unknown as Internals).entries.get(VEHICLE);

interface World { state: string; stall: string | null; atom: Record<string, unknown>; faulted?: boolean }

const pending = { svc: "interior_deep_clean", status: "pending", must_do: true, est_min: 16, cabin_stop_stall_id: TWIN_POST };
const working = (startMs: number) => ({
  svc: "interior_deep_clean", status: "in_progress", must_do: true, est_min: 16, cabin_stop_stall_id: TWIN_POST,
  performed_by: "stall_cabin_robot", robot_stall_id: TWIN_POST,
  started_at: new Date(startMs).toISOString(), ends_at: new Date(startMs + CYCLE_S * 1000).toISOString(), done_at: null,
});
const done = { svc: "interior_deep_clean", status: "done", must_do: true, est_min: 16, performed_by: "stall_cabin_robot", robot_stall_id: TWIN_POST };

function snap(atMs: number, w: World): TwinSnapshot {
  return {
    run: {
      sim_run_id: "cabin-stop", scenario: "busy_day", status: "running",
      sim_clock: new Date(atMs).toISOString(), tick_count: 1, time_scale: 1, seed: 1, speed_x: 1,
    },
    legs: [],
    fleet: {
      counts: {}, total: 1,
      vehicles: [{
        id: VEHICLE, av_id: "AV-1", make: "Zoox", platform: "robotaxi",
        state: w.state, soc: 100, stall_id: w.stall,
        visit: {
          visit_id: "visit-1", visit_status: "open", archetype: "C_cabin_stop", urgency: "standard",
          arrived_at: new Date(T0).toISOString(), target_soc: 100, soc_at_arrival: 100, est_charge_min: 0,
          atoms: [w.atom],
        },
      }],
    },
    stalls_status: w.faulted ? [{ id: TWIN_POST, status: "available", charger_state: "Faulted", fault_code: "fault.station_hardware" }] : [],
    energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

/** Poll on a sim clock advancing `stepMs` per poll for `seconds`, as the live bridge does. */
function run(fromMs: number, seconds: number, stepMs: number, world: (ms: number) => World): number {
  let t = fromMs;
  const end = fromMs + seconds * 1000;
  while (t < end) {
    t += stepMs;
    const e = entry();
    if (e && e.dwellStartMs != null) e.dwellStartMs -= 13_000;   // the dwell floor is real seconds; this runs in ms
    twinMotionDriver.reconcile(snap(t, world(t)));
    for (let k = 0; k < 4; k++) twinMotionDriver.tickMotion(0.05);
  }
  return t;
}

describe("reading the cabin stop off the snapshot", () => {
  const map = (id: string) => (id === TWIN_POST ? RENDER_POST : undefined);
  const veh = (atom: Record<string, unknown>, stall: string | null = TWIN_POST) =>
    ({ stall_id: stall, visit: { atoms: [atom] } as never });

  it("names the post while the stop is open and the twin places the car on it", () => {
    expect(cabinStopOf(veh(pending), map)).toBe(RENDER_POST);
    expect(cabinStopOf(veh(working(T0)), map)).toBe(RENDER_POST);
  });

  it("reads no stop for a done clean, a car not on the post, an unmarked atom or an unknown stall", () => {
    expect(cabinStopOf(veh(done), map)).toBeNull();
    expect(cabinStopOf(veh(pending, null), map)).toBeNull();
    expect(cabinStopOf(veh(pending, "twin-stg-09"), map)).toBeNull();
    expect(cabinStopOf(veh({ svc: "interior_deep_clean", status: "pending" }), map)).toBeNull();
    expect(cabinStopOf(veh({ ...pending, cabin_stop_stall_id: "twin-unknown" }, "twin-unknown"), map)).toBeNull();
    expect(cabinStopOf({ stall_id: TWIN_POST, visit: null as never }, map)).toBeNull();
  });
});

describe("a car on a cabin stop", () => {
  beforeEach(() => {
    twinMotionDriver.clear();
    useDepotStore.setState({
      stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
    });
    twinMotionDriver.setTwinStallMap([{ id: TWIN_POST, code: "NASH-DCFC-STALL-01", type: "dcfc" }]);
  });

  it("is drawn on its post, not charging, and never in staging while the stop is open", () => {
    run(T0, 5, 250, () => ({ state: "charge_complete_holding", stall: TWIN_POST, atom: pending }));
    expect(entry()?.lane).toBe("dcfc");
    expect(entry()?.stallId).toBe(RENDER_POST);
    expect(entry()?.vstatus).toBe("staging");
  });

  it("has the post's cleaning arm work in the cabin, with no charge arm on the car", () => {
    const start = T0 + 60_000;
    const phases = new Set<string>();
    const arms = new Set<string | null>();
    let t = run(T0, 60, 250, () => ({ state: "charge_complete_holding", stall: TWIN_POST, atom: pending }));
    while (t < start + 200_000) {
      t = run(t, 5, 250, () => ({ state: "charge_complete_holding", stall: TWIN_POST, atom: working(start) }));
      phases.add(twinMotionDriver.cleanSessionAt(RENDER_POST)?.phase ?? "none");
      arms.add(twinMotionDriver.armPhaseAt(RENDER_POST));
    }
    // the cleaning arm left home and worked
    expect([...phases].some((p) => p !== "home" && p !== "none")).toBe(true);
    // the charge arm never mated: the car is not plugged in on a cabin stop
    expect(arms.has("charging")).toBe(false);
    expect(entry()?.stallId).toBe(RENDER_POST);
  });

  it("is drawn on its post when the post's charger is faulted, with the cleaning arm at work (otto-q-core 0820)", () => {
    // Chase, 2026-11-12: "they can use faulted charging bays for cleaning, as long as they do not ALSO need a charge."
    const start = T0 + 60_000;
    const phases = new Set<string>();
    let t = run(T0, 60, 250, () => ({ state: "charge_complete_holding", stall: TWIN_POST, atom: pending, faulted: true }));
    expect(entry()?.lane).toBe("dcfc");
    expect(entry()?.stallId).toBe(RENDER_POST);
    expect(twinMotionDriver.stallChargerFaulted(RENDER_POST)).toBe(true);
    while (t < start + 200_000) {
      t = run(t, 5, 250, () => ({ state: "charge_complete_holding", stall: TWIN_POST, atom: working(start), faulted: true }));
      phases.add(twinMotionDriver.cleanSessionAt(RENDER_POST)?.phase ?? "none");
      expect(twinMotionDriver.armPhaseAt(RENDER_POST)).not.toBe("charging");
    }
    expect([...phases].some((p) => p !== "home" && p !== "none")).toBe(true);
    expect(entry()?.stallId).toBe(RENDER_POST);
  });

  it("leaves the post for staging once the clean is done and the engine has freed the post", () => {
    const start = T0 + 20_000;
    let t = run(T0, 20, 250, () => ({ state: "charge_complete_holding", stall: TWIN_POST, atom: pending }));
    t = run(t, CYCLE_S + 5, 500, () => ({ state: "charge_complete_holding", stall: TWIN_POST, atom: working(start) }));
    expect(entry()?.lane).toBe("dcfc");
    run(t, 120, 500, () => ({ state: "charge_complete_holding", stall: null, atom: done }));
    expect(entry()?.lane).toBe("staging");
    expect(entry()?.stallId).not.toBe(RENDER_POST);
  });

  it("changes nothing for a car that only finished a charge (no mark on its atom)", () => {
    run(T0, 5, 250, () => ({ state: "charge_complete_holding", stall: null, atom: { svc: "interior_deep_clean", status: "pending" } }));
    expect(entry()?.lane).toBe("staging");
  });
});
