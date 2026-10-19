// ============================================================================
// THE OTTO-CLEAN ARM, END TO END THROUGH THE MOTION DRIVER.
//
// One car charging on DCFC-01, and the twin's interior tidy of it in progress by the
// stall's cleaning arm (otto-q-core 0758: robot_stall_id, started_at, ends_at on the
// visit atom). Driven the way the live bridge drives it: a snapshot on an advancing
// sim clock, then motion ticks. Asserted on what the driver publishes — the cleaning
// session the renderer draws, the doors the fleet draws, the charge arm's phase, and
// whether the car moves — in Chase's order (2026-10-19):
//
//   the doors open -> the charge arm mates -> the cleaning arm cleans one side, then
//   the other, and comes out -> the doors close -> the charge completes -> the charge
//   arm retracts -> the car moves on.
//
// MEASURED on this harness (2026-10-19, 0.25 s polls): the doors were fully open at
// 3 s, the connector latched at 19 s, the cleaning arm left home at 19 s and was home
// with the doors shut at 347.75 s of the twin's 348. With the charge done at 60 s, the
// connector stayed in until the cleaning arm was home (348 s) and the car first moved
// at 360.25 s, after the charge arm's demate.
// ============================================================================
import { describe, it, expect, beforeEach } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { doorStore } from "./motion/doorStore";
import { useDepotStore } from "@/store/depotStore";
import { CLEAN_CHAIN } from "@/lib/ottoCleanArm/cleanArmSpec";
import type { TwinSnapshot } from "@/lib/ottoTwin";

type Internals = {
  entries: Map<string, {
    car: { x: number; y: number; heading: number; speed: number };
    tracker: unknown | null;
    reverse: unknown | null;
    lane: string | null;
    stallId: string | null;
    dwellStartMs: number | null;
  }>;
};

const VEHICLE = "veh-cabin-1";
const TWIN_STALL = "twin-dcfc-01";
const RENDER_STALL = "DCFC-01";
const T0 = Date.parse("2026-10-19T19:00:00.000Z");   // 2:00 PM CT
const CYCLE_S = 348;                                  // 2 x 2.5 min + 0.8 min (0758's defaults)

const entry = () => (twinMotionDriver as unknown as Internals).entries.get(VEHICLE);

interface World {
  state?: string;
  atom?: Record<string, unknown> | null;
}

function snap(atMs: number, w: World = {}): TwinSnapshot {
  const atom = w.atom === undefined
    ? {
        svc: "interior_tidy", status: "in_progress", must_do: true, est_min: 5,
        started_at: new Date(T0).toISOString(), ends_at: new Date(T0 + CYCLE_S * 1000).toISOString(),
        done_at: null, robot_stall_id: TWIN_STALL,
      }
    : w.atom;
  return {
    run: {
      sim_run_id: "cabin-arm", scenario: "busy_day", status: "running",
      sim_clock: new Date(atMs).toISOString(), tick_count: 1, time_scale: 1, seed: 1, speed_x: 1,
    },
    legs: [{
      leg_id: "L1", vehicle_id: VEHICLE, seq: 1, leg_type: "charge_dcfc", intent: null, kind: "charge_curve",
      from_stall: null, to_stall: TWIN_STALL, from_x: null, from_y: null, to_x: null, to_y: null,
      start_sim: new Date(T0).toISOString(), end_sim: new Date(T0 + 1_800_000).toISOString(),
      duration_s: 1800, status: "active", geometry: "measured",
    }],
    fleet: {
      counts: {}, total: 1,
      vehicles: [{
        id: VEHICLE, av_id: "AV-1", make: "Zoox", platform: "robotaxi",
        state: w.state ?? "charging_dcfc", soc: 42, stall_id: TWIN_STALL,
        visit: {
          visit_id: "visit-1", visit_status: "in_progress", archetype: null, urgency: null,
          arrived_at: new Date(T0).toISOString(), target_soc: 100, soc_at_arrival: 38, est_charge_min: 24,
          atoms: [
            { svc: "charge", status: "in_progress", must_do: true, est_min: 24 },
            ...(atom ? [atom] : []),
          ],
        },
      }],
    },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

interface Sample { t: number; clean: string; arm: string | null; doors: number; moving: boolean }

/** Poll on a sim clock advancing `stepMs` per poll, as the live bridge does, for `seconds`. */
function run(fromMs: number, seconds: number, stepMs: number, world: (t: number) => World): { t: number; trace: Sample[] } {
  const trace: Sample[] = [];
  let t = fromMs;
  const end = fromMs + seconds * 1000;
  while (t < end) {
    t += stepMs;
    const e = entry();
    // the commit-and-hold dwell floor is 12 REAL seconds; this test runs in
    // milliseconds (the device TwinMotionDriver.residuegate.test.ts uses, same reason)
    if (e && e.dwellStartMs != null) e.dwellStartMs -= 13_000;
    twinMotionDriver.reconcile(snap(t, world((t - T0) / 1000)));
    for (let k = 0; k < 2; k++) twinMotionDriver.tickMotion(0.05);
    const s = twinMotionDriver.cleanSessionAt(RENDER_STALL);
    const d = doorStore.get(VEHICLE);
    const now = entry();
    trace.push({
      t: (t - T0) / 1000,
      clean: s?.phase ?? "none",
      arm: twinMotionDriver.armPhaseAt(RENDER_STALL),
      doors: d ? Math.min(d.right, d.left) : 0,
      moving: !!now && (now.tracker !== null || now.reverse !== null),
    });
  }
  return { t, trace };
}

const firstAt = (trace: Sample[], pred: (s: Sample) => boolean) => trace.find(pred)?.t ?? Infinity;
const cleanPhases = (trace: Sample[]) => {
  const out: string[] = [];
  for (const s of trace) if (out[out.length - 1] !== s.clean) out.push(s.clean);
  return out;
};

function setup() {
  twinMotionDriver.clear();
  useDepotStore.setState({
    stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
  });
  twinMotionDriver.setTwinStallMap([{ id: TWIN_STALL, code: "NASH-DCFC-STALL-01", type: "dcfc" }]);
  twinMotionDriver.reconcile(snap(T0));
  for (let k = 0; k < 2; k++) twinMotionDriver.tickMotion(0.05);
}

describe("the cabin clean during a fast charge, in Chase's order", () => {
  beforeEach(setup);

  it("SETUP IS REAL: the car is parked on DCFC-01 and the twin's clean is read", () => {
    expect(entry()?.stallId).toBe(RENDER_STALL);
    expect(twinMotionDriver.cabinCleanFor(VEHICLE)).toEqual({
      stall: RENDER_STALL, placedHere: true, startMs: T0, endsMs: T0 + CYCLE_S * 1000,
    });
  });

  it("opens the doors as the charge arm mates, goes in once it is latched, and is home with the doors shut by the twin's end", () => {
    const { trace } = run(T0, CYCLE_S + 20, 250, () => ({}));
    expect(cleanPhases(trace)).toEqual([...CLEAN_CHAIN, "home"]);

    const doorsOpen = firstAt(trace, (s) => s.doors === 1);
    const latched = firstAt(trace, (s) => s.arm === "charging");
    const leftHome = firstAt(trace, (s) => s.clean === "swing_a");
    const home = firstAt(trace, (s) => s.clean === "home" && s.t > 10);
    // the doors are open before the connector is latched, and the arm leaves home after it
    expect(doorsOpen).toBeLessThan(latched);
    expect(leftHome).toBeGreaterThanOrEqual(latched);
    // home by the end the twin published, within a poll and the frames the transitions drop
    expect(home).toBeLessThanOrEqual(CYCLE_S + 1);
    expect(home).toBeGreaterThan(CYCLE_S - 6);
    // the doors stood open for the whole time the arm was out, and are shut after
    for (const s of trace) if (s.clean !== "home" && s.clean !== "doors_open" && s.clean !== "doors_close") expect(s.doors).toBe(1);
    expect(trace[trace.length - 1].doors).toBe(0);
    expect(doorStore.get(VEHICLE)).toBeUndefined();
    // and the car never moved while any of it happened
    expect(trace.some((s) => s.moving)).toBe(false);
  });

  it("keeps the connector in while the arm cleans, though the charge is done, and lets the car go only after both robots are home", () => {
    // the charge completes 60 s in; the twin keeps the car on its charger (0758's hold)
    const { trace } = run(T0, CYCLE_S + 60, 250, (t) => ({ state: t < 60 ? "charging_dcfc" : "charge_complete_holding" }));
    const home = firstAt(trace, (s) => s.clean === "home" && s.t > 10);
    expect(home).toBeLessThanOrEqual(CYCLE_S + 1);
    // the charge arm held 'charging' until the cleaning arm was home…
    for (const s of trace) if (s.t > 61 && s.t < home) expect(s.arm).toBe("charging");
    // …then let go, and the car moved only after that
    const armLetGo = firstAt(trace, (s) => s.t >= home && s.arm !== "charging");
    const carMoved = firstAt(trace, (s) => s.moving);
    expect(armLetGo).toBeLessThan(home + 2);
    expect(carMoved).toBeGreaterThan(armLetGo);
    expect(Number.isFinite(carMoved)).toBe(true);
  });

  it("comes out and shuts the doors in seconds when the twin ends the step early", () => {
    const { trace } = run(T0, 140, 250, (t) => (t < 100
      ? {}
      : { atom: { svc: "interior_tidy", status: "done", must_do: true, est_min: 5, robot_stall_id: TWIN_STALL,
          started_at: new Date(T0).toISOString(), ends_at: new Date(T0 + 100_000).toISOString(),
          done_at: new Date(T0 + 100_000).toISOString() } }));
    const seen = cleanPhases(trace);
    expect(seen).toContain("clean_a");
    expect(seen).not.toContain("swing_b");
    const home = firstAt(trace, (s) => s.clean === "home" && s.t > 100);
    expect(home - 100).toBeLessThan(8);
    expect(trace[trace.length - 1].doors).toBe(0);
  });
});

describe("what the cleaning arm does not do", () => {
  beforeEach(setup);

  it("does not play a technician's tidy: no robot_stall_id, no arm, no doors", () => {
    const { trace } = run(T0, 60, 500, () => ({
      atom: { svc: "interior_tidy", status: "in_progress", must_do: true, est_min: 5,
        started_at: new Date(T0).toISOString(), ends_at: new Date(T0 + 300_000).toISOString(), robot_stall_id: null },
    }));
    expect(new Set(trace.map((s) => s.clean))).toEqual(new Set(["home"]));
    expect(trace.every((s) => s.doors === 0)).toBe(true);
    expect(twinMotionDriver.cabinCleanFor(VEHICLE)).toBeNull();
  });

  it("does not reach into a car that is not exactly on its stall pose", () => {
    const e = entry()!;
    const st = useDepotStore.getState().stalls.find((s) => s.id === RENDER_STALL)!;
    e.car.x = st.position.x + 0.2;   // 9.6 cm: parked for the charge arm, not for the wand
    const { trace } = run(T0, 30, 500, () => ({}));
    expect(new Set(trace.map((s) => s.clean))).toEqual(new Set(["home"]));
    expect(trace.every((s) => s.doors === 0)).toBe(true);
  });
});
