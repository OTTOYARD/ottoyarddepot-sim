// ============================================================================
// A CHARGER THAT FAULTS MID-CLEAN LETS GO OF ITS CAR, THROUGH THE MOTION DRIVER.
//
// Chase, 2026-11-02, from the twin: "Looks like a faulted charger station was given a vehicle to charge/clean. Major
// issue." Demo run 8c0b2e04: NASH-DCFC-STALL-22 faulted (thermal_emergency) at sim 14:04:15 with car 2cd2cbf3 on it,
// 22 s into the stall's OTTO-CLEAN ARM cycle. The twin ended the session and published the robot's demate tether
// (11.5 s), and the 3D view kept the connector in the car's port for the whole cycle, because its interlock keeps a
// latched connector in while the cleaning arm is out "whatever the charge or the tether says". (The engine also held
// the car on the dead post until the clean was done: otto-q-core 0792.)
//
// Played the way the live bridge plays it, on the layout as the twin served it on 2026-11-02 (DCFC-22 is canopy C's
// west column): the car charges and its cabin clean starts; then a frame carries the fault (the stall 'faulted',
// charger_state 'Faulted', the demate tether) with the clean still in progress. The charge arm must leave 'charging'
// within a poll of that frame and be clear by the end of the tether, while the cleaning arm is still out. The same
// frames WITHOUT the fault are the order for a charge that ends, and keep the connector in until the cleaning arm is
// home, as before.
// ============================================================================
import { describe, it, expect, afterAll } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { useDepotStore } from "@/store/depotStore";
import { setChargerBuild } from "@/lib/chargerBuild";
import { DEMATE_CHAIN } from "@/lib/ottoChargeArm/roboticService";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import served from "./__fixtures__/twinLayout.served1102.json";

type Internals = { entries: Map<string, { dwellStartMs: number | null }> };

const VEHICLE = "2cd2cbf3-0000-4000-8000-000000000022";
const T0 = Date.parse("2026-11-02T20:00:00.000Z");   // 2:00 PM CT
const CYCLE_S = 348;                                  // the arm's 5.8-minute cycle (0758's defaults)
const FAULT_S = 30;                                   // the charger faults this far into the clean
const TWIN_STALL = served.stalls.find((s) => s.code === "NASH-DCFC-STALL-22")!.id;

afterAll(() => {
  twinMotionDriver.clear();
  setChargerBuild("as_built");
  useDepotStore.getState().regenerateStalls(10, 30, 3, 115, 2);
});

const entry = () => (twinMotionDriver as unknown as Internals).entries.get(VEHICLE);

/** The twin's frame at `atMs`. From the fault on (when `fault`), the stall is down, the session is over and the arm's
 *  demate tether runs; the car's cabin clean stays in progress, as the twin left it on run 8c0b2e04. */
function snap(atMs: number, fault: boolean): TwinSnapshot {
  const after = fault && atMs >= T0 + FAULT_S * 1000;
  const faultAt = T0 + FAULT_S * 1000;
  return {
    run: {
      sim_run_id: "fault-clean", scenario: "busy_day", status: "running",
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
        id: VEHICLE, av_id: "AV-22", make: "Zoox", platform: "robotaxi",
        state: after ? "staged_awaiting_service" : "charging_dcfc", soc: 96, stall_id: TWIN_STALL,
        visit: {
          visit_id: "visit-22", visit_status: "in_progress", archetype: null, urgency: null,
          arrived_at: new Date(T0).toISOString(), target_soc: 100, soc_at_arrival: 95, est_charge_min: 6,
          atoms: [
            { svc: "charge", status: after ? "pending" : "in_progress", must_do: true, est_min: 6 },
            {
              svc: "interior_tidy", status: "in_progress", must_do: true, est_min: 5.8,
              started_at: new Date(T0).toISOString(), ends_at: new Date(T0 + CYCLE_S * 1000).toISOString(),
              done_at: null, robot_stall_id: TWIN_STALL,
            },
          ],
        },
      }],
    },
    stalls_status: after ? [{
      id: TWIN_STALL, status: "faulted", vehicle_id: VEHICLE, reserved_by: null, reserved_until: null,
      tethered: atMs < faultAt + 11_500, tether_until: new Date(faultAt + 11_500).toISOString(),
      tether_direction: "demate", tether_phase: "unlatch",
      charger_state: "Faulted", fault_code: "fault.thermal_emergency",
      fault_until: new Date(faultAt + 40 * 60_000).toISOString(),
    }] : [],
    energy: null, bess: null, weather: null, grid: null, counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

interface Sample { t: number; arm: string | null; clean: string }

function play(fault: boolean, seconds: number): Sample[] {
  twinMotionDriver.clear();
  twinMotionDriver.setTwinStallMap(served.stalls);
  useDepotStore.setState({
    stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const, down: null })),
  });
  const renderStall = twinMotionDriver.rendererStallFor(TWIN_STALL)!;
  expect(renderStall).toBe("DCFC-22");
  twinMotionDriver.reconcile(snap(T0, fault));
  for (let k = 0; k < 2; k++) twinMotionDriver.tickMotion(0.05);
  const trace: Sample[] = [];
  for (let t = T0 + 250; t <= T0 + seconds * 1000; t += 250) {
    const e = entry();
    if (e && e.dwellStartMs != null) e.dwellStartMs -= 13_000;   // the 12 REAL-second dwell floor, as cleanarm.test does
    twinMotionDriver.reconcile(snap(t, fault));
    for (let k = 0; k < 2; k++) twinMotionDriver.tickMotion(0.05);
    trace.push({
      t: (t - T0) / 1000,
      arm: twinMotionDriver.armPhaseAt(renderStall),
      clean: twinMotionDriver.cleanSessionAt(renderStall)?.phase ?? "none",
    });
  }
  return trace;
}

const firstAt = (trace: Sample[], pred: (s: Sample) => boolean) => trace.find(pred)?.t ?? Infinity;

describe("a charger that faults while its cleaning arm is in the cabin (run 8c0b2e04, DCFC-22)", () => {
  it("SETUP IS REAL: before the fault the connector is latched and the cleaning arm is out over the car", () => {
    const trace = play(true, FAULT_S - 1);
    expect(firstAt(trace, (s) => s.arm === "charging")).toBeLessThan(FAULT_S);
    const last = trace[trace.length - 1];
    expect(last.arm).toBe("charging");
    expect(last.clean).not.toBe("home");
    expect(last.clean).not.toBe("none");
  });

  it("the connector comes out within a poll of the fault and is clear by the tether's end, with the cleaning arm still out", () => {
    const trace = play(true, FAULT_S + 20);
    const letGo = firstAt(trace, (s) => s.t >= FAULT_S && s.arm !== "charging");
    expect(letGo).toBeLessThanOrEqual(FAULT_S + 0.5);
    const atLetGo = trace.find((s) => s.t === letGo)!;
    expect([...DEMATE_CHAIN, "clear", "stowed"]).toContain(atLetGo.arm);
    // the cleaning arm was not home when it let go: the fault, not the cabin, released the connector
    expect(atLetGo.clean).not.toBe("home");
    const clear = firstAt(trace, (s) => s.t > FAULT_S && (s.arm === "clear" || s.arm === "stowed"));
    expect(clear).toBeLessThanOrEqual(FAULT_S + 11.5 + 0.5);
  });

  it("CONTROL: the same frames with no fault keep the connector in while the cleaning arm works (a charge that ends)", () => {
    const trace = play(false, FAULT_S + 20);
    for (const s of trace) if (s.t > FAULT_S - 5) expect(s.arm, `${s.t}s`).toBe("charging");
  });
});
