// ============================================================================
// REGRESSION GUARDS FOR THE ADVERSARIAL AUDIT FINDINGS.
//
// Every defect below type-checked and passed a 176-test suite. Several were
// actively PINNED by tests written from the same wrong assumption. That is the
// lesson worth encoding: a green suite proves the code agrees with the tests,
// not that either agrees with reality.
//
// The recurring failure class here is a bug that LIES — reports success for
// work not done, or renders a number that is false. In an artifact whose whole
// purpose is "what did OTTO-Q decide, and did the world comply", those are
// worse than a crash. Each test below is named for the lie it prevents.
// ============================================================================
import { describe, it, expect } from "vitest";
import type { TwinEventsWindow, TwinLayout, TwinSnapshot } from "@/lib/ottoTwin";
import { packChannels } from "./channels";
import { auditCoverage, resolveObservable, VARIABLE_BINDINGS } from "./coverage";

const CLOCK = "2026-07-27T14:00:00.000Z";
const at = (s: number) => new Date(Date.parse(CLOCK) + s * 1000).toISOString();

const layout: TwinLayout = {
  depot: { id: "d1", name: "Nashville", origin_lat: 36.1, origin_lng: -86.7 },
  structures: [],
  stalls: [
    { id: "s0", code: "D-00", type: "dcfc", zone: "n", canopy: null, covered: null, x: 0, y: 0, heading: 0, connector_kw: 350 },
    { id: "s1", code: "L-00", type: "l2", zone: "s", canopy: null, covered: null, x: 1, y: 0, heading: 0, connector_kw: 19.2 },
  ],
};

function bundleWith(over: { dr?: boolean | undefined; dropGrid?: boolean; lmp?: number; solar?: number } = {}) {
  const snap = {
    run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
    fleet: {
      counts: {}, total: 1,
      vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "j", state: "arrived_at_gate", soc: 15, stall_id: null }],
    },
    stalls_status: [],
    energy: { grid_import_kw: 100, grid_export_kw: 0, solar_kw: over.solar ?? 10, bess_output_kw: 0, ev_charging_kw: 80, building_kw: 30, peak_15min_kw: 600, tariff: "GSA-3", rate_per_kwh: 0.08, at: CLOCK },
    bess: { soc_pct: 60, power_kw: 0, state: "idle", temp_c: 25, soh_pct: 98 },
    weather: { temp_c: 30, cloud_pct: 10, conditions: "clear", precip: "none", ghi_wm2: 700, wind_kmh: 8, solar_elev_deg: 55, at: CLOCK },
    grid: over.dropGrid ? null : {
      lmp_usd_mwh: over.lmp ?? 40, tariff: "GSA-3", carbon_gco2_kwh: 370,
      voltage_status: "nominal", frequency_hz: 60, reserve_margin_pct: 15,
      dr_active: over.dr, dr_cap_kw: over.dr ? 400 : null, at: CLOCK,
    },
    counters: { dispatches_active: 1, dispatches_total: 5, telemetry_packets: 10, charge_sessions: 1, events_total: 5, open_incidents: 0 },
    recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
  return packChannels(snap, layout, new Date(CLOCK));
}

/** A bare frame with no events window — the "we did not look" case. */
const SNAP = {
  run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
  fleet: {
    counts: {}, total: 1,
    vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "j", state: "arrived_at_gate", soc: 15, stall_id: null }],
  },
  stalls_status: [], energy: null, bess: null, weather: null, grid: null,
  counters: { dispatches_active: 1, dispatches_total: 5, telemetry_packets: 10, charge_sessions: 1, events_total: 5, open_incidents: 0 },
  recent_events: [], variability: {},
} as unknown as TwinSnapshot;

/**
 * Shape and values lifted verbatim from `ottoq_twin_events_window` on live run
 * 6256a99f (144 sessions, 2 faults, 21 delays over 1440 sim-minutes). Pinned to
 * REAL numbers on purpose: the last three defects in this file were all
 * assumptions about VALUES that passed every type check.
 */
const EVENTS: TwinEventsWindow = {
  window: { basis: "run_to_date", signal_events: 1206, first_at: CLOCK, last_at: CLOCK, sim_minutes_elapsed: 1440 },
  by_type: { "charge.session_started": 144, "fleet.arrival_delayed": 21 },
  by_severity: { info: 1143, debug: 33, warning: 30 },
  reliability: {
    charge_sessions: 144, charge_faults: 2, charge_fault_rate: 0.0139,
    fault_reasons: { "fault.thermal_emergency": 1, "fault.session_aborted_other": 1 },
    repair_minutes_total: 242, arrival_delays: 21, delay_min_p50: 17,
    delay_causes: { accident: 2, congestion: 14, heavy_traffic: 5 },
    stranded_recharges: 4, tow_events: 1, exceptions_by_severity: { major: 2 },
    faults_per_sim_hour: 0.083, delays_per_sim_hour: 0.875,
  },
  charging: {
    target_soc_p50: 80, soc_start_p50: 30, charge_curve_ratio_p50: 0.844,
    battery_temp_c_p50: 28.6, battery_soh_pct_p50: null,
    sessions_completed: 119, energy_kwh_total: 6209.28, avg_power_kw_p50: 16.56,
    session_duration_s_p50: 5400, auto_rerouted: 0,
  },
  demand_forecast: {
    at: CLOCK, horizon_min: 60, incoming_count: 25, charge_needed_count: 25,
    predicted_charge_kw: 2873, predicted_charge_kwh: 1024,
  },
  throughput: { valve_holds: 20, held_total: 111, released_total: 120, cap_last: 6 },
};

// 2026-09-23: the regressions for the browser-side command pipeline (L1-L5, cross-tick
// preemption, no_actuation, the client shield's floors) left with the pipeline itself. That
// pipeline ran a second orchestrator in the browser — see App.tsx and WorldContractTab.tsx.
// What remains here guards the two modules the cockpit still uses: the channel packer and the
// coverage audit.

describe("L7 — unknown demand-response state must not read as 'no call'", () => {
  it("publishes null, not false, when the grid row is absent", () => {
    const b = bundleWith({ dropGrid: true });
    expect(b.channels.energy_grid.payload.demand_response.active).toBeNull();
    expect(b.channels.energy_grid.integrity.missing).toContain("demand_response.active");
  });

  it("still publishes a real false when the grid says so", () => {
    expect(bundleWith({ dr: false }).channels.energy_grid.payload.demand_response.active).toBe(false);
  });
});

// ── coverage: the number must not over-report ─────────────────────────────

describe("coverage must not over-report on a world that published nothing", () => {
  it("grades variables dark when their channel resolved nothing", () => {
    // queue.waiting and soc.missing are array-length counters — 0, not absent,
    // on an empty world. They used to grade "observed" while the channel's own
    // integrity record listed the field as missing, in the very number built
    // to replace an inflated "47/47 live".
    const empty = {
      run: { sim_run_id: "r", scenario: "s", status: "running", sim_clock: CLOCK, tick_count: 1, time_scale: 60, seed: 1 },
      fleet: { counts: {}, total: 0, vehicles: [] },
      stalls_status: [], energy: null, bess: null, weather: null, grid: null,
      counters: {}, recent_events: [], variability: {},
    } as unknown as TwinSnapshot;
    const b = packChannels(empty, null, new Date(CLOCK));
    const r = auditCoverage(b);
    expect(b.channels.fleet_telemetry.integrity.status).toBe("missing");
    expect(r.variables.find((v) => v.var_key === "telemetry_dropout")?.verdict).toBe("dark");
    expect(r.variables.find((v) => v.var_key === "queue_patience")?.verdict).toBe("dark");
    expect(r.observed).toBe(0);
  });

  it("keeps the charger fault RATE separate from per-charger health", () => {
    // charger_fault used to be structurally unobservable: nothing on any frame
    // carried it. The events window changed that — but only for the POPULATION
    // rate. Per-charger station_state is still unpublished, so counts.faulted
    // must stay null no matter how healthy the rate looks. A frame that says
    // "fault rate 1.4%" and "0 chargers faulted" would let the orchestrator
    // keep assigning vehicles to dead hardware, which is the failure the null
    // exists to prevent.
    const b = bundleWith({ dr: false });
    expect(b.channels.charger_systems.payload.counts.faulted).toBeNull();
    expect(b.channels.charger_systems.payload.ocpp).toEqual([]);
    // No events window was fetched for this bundle, so the rate is dark —
    // absent, not zero. The two blocks disagree about nothing.
    expect(b.channels.charger_systems.payload.reliability).toBeNull();
    expect(b.channels.charger_systems.payload.observed_charging).toBeNull();
    const r = auditCoverage(b);
    expect(r.variables.find((v) => v.var_key === "charger_fault")?.verdict).toBe("dark");
  });

  it("never reports a quiet depot on an events window that was never fetched", () => {
    // THE ZERO-AS-ABSENT TRAP, one level up. Every count in these blocks is a
    // natural 0 on a calm run, so a zeroed record is indistinguishable from no
    // record — and a zeroed record asserts "we looked and the depot is fine".
    // The blocks are therefore NULL until the window is actually fetched.
    const b = packChannels(SNAP, null, new Date(CLOCK));   // no events argument
    expect(b.channels.depot_ops.payload.reliability).toBeNull();
    expect(b.channels.depot_ops.payload.throughput).toBeNull();
    expect(b.channels.depot_ops.payload.demand_forecast).toBeNull();
    expect(b.channels.depot_ops.integrity.missing).toContain("events.window");

    const r = auditCoverage(b);
    for (const key of ["breakdown_rate", "incident_severity", "charger_fault", "target_soc"]) {
      expect(r.variables.find((v) => v.var_key === key)?.verdict).toBe("dark");
    }
  });

  it("counts a measured zero as evidence but an empty histogram as none", () => {
    // `tow_events: 0` means we counted and found none — a measurement.
    // `delay_causes: {}` is an empty bag: it cannot demonstrate that the knob
    // driving delay causes moved anything, so it must not score as coverage.
    expect(resolveObservable({ tow_events: 0 }, "tow_events")).toBe(true);
    expect(resolveObservable({ causes: {} }, "causes")).toBe(false);
    expect(resolveObservable({ causes: { congestion: 3 } }, "causes")).toBe(true);
    expect(resolveObservable({ list: [] }, "list")).toBe(false);
    // false is still an observation
    expect(resolveObservable({ active: false }, "active")).toBe(true);
  });

  it("publishes the charge curve the fleet actually pulled, not its nameplate", () => {
    // initial_rate_kw / max_rate_kw. If this ever reads exactly 1.0 across a
    // whole run, the twin has stopped modelling ramp and is echoing nameplate.
    const b = packChannels(SNAP, null, new Date(CLOCK), EVENTS);
    const oc = b.channels.charger_systems.payload.observed_charging;
    expect(oc?.charge_curve_ratio_p50).toBeCloseTo(0.844, 3);
    expect(b.channels.charger_systems.payload.reliability?.fault_rate).toBeCloseTo(0.0139, 4);
    // SoH is absent from every charge SESSION and must not become a number
    // there. It is not absent from the world — it lives on the fleet-condition
    // feed — so the variable grades dark (a feed we did not fetch), not
    // unobservable (nothing anywhere carries it).
    expect(oc?.battery_soh_pct_p50).toBeNull();
    expect(auditCoverage(b).variables.find((v) => v.var_key === "veh_battery_soh_pct")?.verdict)
      .toBe("dark");
  });

  it("refuses to describe a depot the run does not belong to", () => {
    // THE WORST ONE FOUND SO FAR, and it was live.
    //
    // The cockpit fetches the layout for a HARDCODED depot while a run may
    // belong to a different one. The backend has two seeded depots with 150
    // stalls each and ZERO id overlap ("OTTOYARD Nashville Flagship" and
    // "OTTOYARD Benchmark (CRN A/B)"), and the majority of runs are on the
    // second. On the reference run, 25 of 25 occupied stalls and 25 of 25
    // vehicle stall-bindings resolved to NOTHING.
    //
    // Nothing threw. Every stall fell back to `assumed_available`, so the
    // frame reported a pristine 150-stall depot with nobody in it, zero
    // chargers delivering, and integrity "ok" — a completely coherent
    // description of a building that was not being simulated.
    const mismatched = {
      run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
      fleet: {
        counts: {}, total: 1,
        vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "j", state: "charging_dcfc", soc: 40, stall_id: "OTHER-DEPOT-STALL" }],
      },
      // occupied stalls from a depot whose ids the layout has never heard of
      stalls_status: [
        { id: "OTHER-DEPOT-STALL", status: "occupied", vehicle_id: "v1" },
        { id: "OTHER-DEPOT-STALL-2", status: "occupied", vehicle_id: "v2" },
      ],
      energy: null, bess: null, weather: null, grid: null,
      counters: {}, recent_events: [], variability: {},
    } as unknown as TwinSnapshot;

    const b = packChannels(mismatched, layout, new Date(CLOCK));
    const dep = b.channels.depot_ops;

    // The lie the old code told: a perfectly healthy, perfectly empty depot.
    expect(dep.payload.capacity.occupied).toBe(0);   // still structurally true...
    // ...but it must NEVER be presentable as fact.
    expect(dep.payload.layout_matches_run).toBe(false);
    expect(dep.integrity.status).not.toBe("ok");
    expect(dep.integrity.missing).toContain("layout.matches_run");
    expect(dep.integrity.notes.join(" ")).toContain("LAYOUT DOES NOT BELONG TO THIS RUN");

    // The charger channel performs the same join and must fail the same way,
    // rather than reporting every charger free.
    const cs = b.channels.charger_systems;
    expect(cs.integrity.missing).toContain("layout.matches_run");
    expect(cs.integrity.notes.join(" ")).toContain("LAYOUT DOES NOT BELONG TO THIS RUN");
  });

  it("does not cry mismatch when the layout genuinely matches", () => {
    // The guard must stay silent on a healthy frame, and stay NULL rather than
    // false when there is simply nothing occupied yet to cross-check.
    const b = bundleWith({ dr: false });   // stalls_status: [] — nothing to check
    expect(b.channels.depot_ops.payload.layout_matches_run).toBeNull();
    expect(b.channels.depot_ops.integrity.notes.join(" "))
      .not.toContain("LAYOUT DOES NOT BELONG");

    const matched = {
      run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
      fleet: { counts: {}, total: 1, vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "j", state: "charging_dcfc", soc: 40, stall_id: "s0" }] },
      stalls_status: [{ id: "s0", status: "occupied", vehicle_id: "v1" }],
      energy: null, bess: null, weather: null, grid: null,
      counters: {}, recent_events: [], variability: {},
    } as unknown as TwinSnapshot;
    const ok = packChannels(matched, layout, new Date(CLOCK));
    expect(ok.channels.depot_ops.payload.layout_matches_run).toBe(true);
    expect(ok.channels.depot_ops.payload.capacity.occupied).toBe(1);
    // and the vehicle in it is seen to be charging
    expect(ok.channels.charger_systems.payload.counts.charging).toBe(1);
  });

  it("does not let stall availability speak for real throughput", () => {
    // Staffing is a HARD concurrency limit, not a slowdown: ottoq_sim_lane_capacity
    // gates how many wash/service/deploy lanes can be open at all. A depot with 3
    // free wash stalls and 1 staffed wash lane will accept one vehicle and park
    // the rest. OTTO-Q saw only the stalls.
    const snap = {
      run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
      fleet: { counts: {}, total: 1, vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "j", state: "staged_awaiting_service", soc: 55, stall_id: null }] },
      stalls_status: [], energy: null, bess: null, weather: null, grid: null,
      counters: {}, recent_events: [], variability: {},
    } as unknown as TwinSnapshot;

    const labor = {
      window: { basis: "run_to_date", sim_minutes_elapsed: 1440 },
      staffing: { general_tech: 10, service_tech: 3, wash_supervisor: 2 },
      knobs: { staffing_level: null, charging_staff: null, cleaning_staff: null,
               service_staff: null, deploy_staff: null, any_set: false },
      // real values lifted from twin.staging_overflow on run 89439eb8
      lanes: { wash_cap: 3, service_cap: 2, deploy_cap: 20, patience_min: 10, observed_at: CLOCK },
      overflow: { events: 8, vehicles_total: 31, vehicles_max: 7, escalated: 0, per_sim_hour: 0.333 },
      backlog: { started: 20, completed: 20, open: 0,
                 by_service: { exterior_wash: { started: 12, est_min_p50: 9.5, requires_bay: "wash_bay" } },
                 bay_bound: 17, digital: 3, blocks_dispatch: 0 },
    };

    const b = packChannels(snap, layout, new Date(CLOCK), null, null, labor as never);
    const dep = b.channels.depot_ops;
    expect(dep.payload.labor?.lanes.wash_cap).toBe(3);
    expect(dep.payload.labor?.lanes.service_cap).toBe(2);
    // the pressure must be stated, not left for the reader to infer
    expect(dep.integrity.notes.join(" ")).toContain("labor bound 8x");
    expect(dep.integrity.notes.join(" ")).toContain("overstates real throughput");

    const r = auditCoverage(b);
    for (const k of ["staffing_level", "cleaning_staff", "service_staff", "deploy_staff"])
      expect(r.variables.find((v) => v.var_key === k)?.verdict).toBe("observed");
  });

  it("binds a staffing knob to its realized cap, never to its own setting", () => {
    // HISTORY: `charging_staff` was registered wired=true and read by NO
    // function in the database. It was left `unobservable` on purpose, because
    // the tempting fix — publishing the knob's own value — reports a SETTING as
    // an OUTCOME, which is the failure this whole audit exists to catch.
    //
    // It is now wired in the SIMULATION (ottoq_decide_tick gates charge
    // admission on it), so it binds to the resulting CAP. The doctrine is
    // unchanged: the witness is the cap the world computes, not the slider.
    const binding = VARIABLE_BINDINGS.find((v) => v.var_key === "charging_staff");
    expect(binding?.observable).toBe("labor.lanes.charge_cap");
    expect(binding?.observable).not.toContain("knobs.");   // never the setting

    // and with no labor feed it is DARK (unproven), not observed
    expect(auditCoverage(bundleWith({})).variables
      .find((v) => v.var_key === "charging_staff")?.verdict).toBe("dark");
  });

  it("says so when charge admission is staffing-capped below the stall count", () => {
    // The point of the knob: free stalls stop meaning available throughput.
    const capped = {
      window: { basis: "run_to_date", sim_minutes_elapsed: 60 },
      staffing: { general_tech: 10 },
      knobs: { staffing_level: null, charging_staff: 0.2, cleaning_staff: null,
               service_staff: null, deploy_staff: null, any_set: true },
      lanes: { wash_cap: 3, service_cap: 2, deploy_cap: 20,
               charge_cap: 9, charge_stalls_physical: 45,
               charge_cap_basis: "computed_from_knob",
               patience_min: 10, observed_at: CLOCK },
      overflow: { events: 0, vehicles_total: 0, vehicles_max: null, escalated: 0, per_sim_hour: 0 },
      backlog: { started: 0, completed: 0, open: 0, by_service: {}, bay_bound: 0, digital: 0, blocks_dispatch: 0 },
    };
    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, capped as never);
    expect(b.channels.depot_ops.payload.labor?.lanes.charge_cap).toBe(9);
    expect(b.channels.depot_ops.integrity.notes.join(" "))
      .toContain("charge admission is staffing-capped at 9 of 45");
    expect(auditCoverage(b).variables
      .find((v) => v.var_key === "charging_staff")?.verdict).toBe("observed");
  });

  it("keeps the recomputed charge cap distinguishable from a stamped one", () => {
    // wash/service/deploy caps are READ from twin.staging_overflow — values the
    // sim stamped under contention. There is no charge equivalent, so charge_cap
    // is RECOMPUTED from the knob. That is weaker evidence and the payload must
    // keep saying so rather than letting a reader assume it was measured.
    const neutral = {
      window: { basis: "run_to_date", sim_minutes_elapsed: 60 },
      staffing: { general_tech: 10 },
      knobs: { staffing_level: null, charging_staff: null, cleaning_staff: null,
               service_staff: null, deploy_staff: null, any_set: false },
      lanes: { wash_cap: 3, service_cap: 2, deploy_cap: 20,
               charge_cap: 45, charge_stalls_physical: 45,
               charge_cap_basis: "computed_from_knob",
               patience_min: 10, observed_at: CLOCK },
      overflow: { events: 0, vehicles_total: 0, vehicles_max: null, escalated: 0, per_sim_hour: 0 },
      backlog: { started: 0, completed: 0, open: 0, by_service: {}, bay_bound: 0, digital: 0, blocks_dispatch: 0 },
    };
    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, neutral as never);
    expect(b.channels.depot_ops.payload.labor?.lanes.charge_cap_basis).toBe("computed_from_knob");
    // cap == physical means neutral staffing: the gate is NOT binding, so no alarm
    expect(b.channels.depot_ops.integrity.notes.join(" "))
      .not.toContain("staffing-capped");
  });

  it("does not read an unstamped lane cap as unlimited capacity", () => {
    // The sim stamps effective caps only when a lane is CONTENDED. A run with
    // no contention yet has null caps — which means "not yet observed", not
    // "unbounded". Defaulting that to a large number would invite OTTO-Q to
    // flood a lane it has never seen fill.
    const quiet = {
      window: { basis: "run_to_date", sim_minutes_elapsed: 60 },
      staffing: { general_tech: 10 },
      knobs: { staffing_level: null, charging_staff: null, cleaning_staff: null,
               service_staff: null, deploy_staff: null, any_set: false },
      lanes: { wash_cap: null, service_cap: null, deploy_cap: null, patience_min: null, observed_at: null },
      overflow: { events: 0, vehicles_total: 0, vehicles_max: null, escalated: 0, per_sim_hour: 0 },
      backlog: { started: 0, completed: 0, open: 0, by_service: {}, bay_bound: 0, digital: 0, blocks_dispatch: 0 },
    };
    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, quiet as never);
    expect(b.channels.depot_ops.payload.labor?.lanes.wash_cap).toBeNull();
    expect(b.channels.depot_ops.integrity.missing).toContain("labor.lane_caps");
    expect(b.channels.depot_ops.integrity.notes.join(" "))
      .toContain("Absence means no contention, NOT unlimited capacity");
  });

  it("does not let a plan stand in for what the fleet actually did", () => {
    // Values lifted verbatim from ottoq_twin_offsite_window on run a044dab4.
    // The finding they encode: trips run 3.6x their planned duration, and the
    // dominant return reason is the BATTERY, not the schedule. An orchestrator
    // that pre-stages for planned_duration_min staffs for a fleet that is not
    // coming — so the frame has to say the plan is not usable.
    const offsite = {
      dispatches: { total: 270, completed: 239, active: 0 },
      off_site_now: { count: 0, elapsed_min_p50: null, return_eta_min_p50: null, soc_at_dispatch_p50: null },
      duration: { planned_min_p50: 66.4, actual_min_p50: 270, actual_min_p90: 480,
                  drift_min_p50: 206.1, overran_plan: 195, ratio_p50: 3.638 },
      activity: { miles_p50: 3.17, miles_per_trip_min_p50: 0.0112,
                  soc_drop_pct_per_hour_p50: 9.23, energy_basis: "soc_delta_proxy" },
      soc: { at_dispatch_p50: 90, at_return_p50: 41.8, at_return_p10: 33.6, returned_below_20: 0 },
      arrival_jitter_min_p50: 0,
      by_return_trigger: {
        low_soc_reserve: { n: 122, planned_min_p50: 58.4, actual_min_p50: 355.7, drift_min_p50: 279.9, soc_at_return_p50: 37.1 },
        sensor_soil:     { n: 70,  planned_min_p50: 71.3, actual_min_p50: 75,    drift_min_p50: 28.6,  soc_at_return_p50: 76.8 },
      },
    };

    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, null, offsite as never);
    const ft = b.channels.fleet_telemetry;
    expect(ft.payload.offsite?.duration.ratio_p50).toBe(3.638);
    expect(ft.integrity.notes.join(" ")).toContain("3.638x their planned duration");
    expect(ft.integrity.notes.join(" ")).toContain("not a usable predictor");

    // The per-trigger breakdown must survive: a fleet-wide average would hide
    // that low_soc trips run 356 min while soil trips run 75.
    expect(ft.payload.offsite?.by_return_trigger.low_soc_reserve.actual_min_p50).toBe(355.7);

    const r = auditCoverage(b);
    expect(r.variables.find((v) => v.var_key === "trip_duration")?.verdict).toBe("observed");
    expect(r.variables.find((v) => v.var_key === "idle_fraction")?.verdict).toBe("observed");
    // soc_on_arrival now reads the RETURNING trip, not the whole yard
    expect(r.variables.find((v) => v.var_key === "soc_on_arrival")?.verdict).toBe("observed");
    expect(ft.payload.offsite?.soc.at_return_p50).toBe(41.8);
    expect(resolveObservable(ft.payload, "offsite.soc.at_return_p50")).toBe(true);
  });

  it("never sources trip energy from a column the sim does not write", () => {
    // ottoq_vehicle_dispatches.energy_consumed_kwh is NULL in all 17,619 rows.
    // Publishing it would report a fleet that drove 17,000 trips on no energy —
    // and unlike a missing field, a plausible 0 invites arithmetic. The payload
    // carries a SoC-delta proxy and says so in the data itself.
    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, null, {
      dispatches: { total: 1, completed: 1, active: 0 },
      off_site_now: { count: 0, elapsed_min_p50: null, return_eta_min_p50: null, soc_at_dispatch_p50: null },
      duration: { planned_min_p50: 60, actual_min_p50: 62, actual_min_p90: 70, drift_min_p50: 2, overran_plan: 1, ratio_p50: 1.03 },
      activity: { miles_p50: 3, miles_per_trip_min_p50: 0.05, soc_drop_pct_per_hour_p50: 9, energy_basis: "soc_delta_proxy" },
      soc: { at_dispatch_p50: 90, at_return_p50: 80, at_return_p10: 75, returned_below_20: 0 },
      arrival_jitter_min_p50: 0, by_return_trigger: {},
    } as never);
    const act = b.channels.fleet_telemetry.payload.offsite?.activity as Record<string, unknown>;
    expect(act.energy_basis).toBe("soc_delta_proxy");
    expect(act).not.toHaveProperty("energy_kwh_p50");
    // and the plan is close enough here that no warning should fire
    expect(b.channels.fleet_telemetry.integrity.notes.join(" ")).not.toContain("not a usable predictor");
  });

  it("never republishes the DTC sentinel as a severity", () => {
    // ottoq_vehicle_wear.worst_open_dtc_rank uses 99 to mean "NO open DTC" —
    // confirmed in ottoq_wear_mark_serviced, which sets it to 99 when a repair
    // clears the codes, and by the data (all 11,085 rows at rank 99 have
    // open_dtc_count = 0). The scale is also INVERTED: 0 is worst, 4 mildest.
    //
    // Passed through raw, a perfectly healthy fleet reports "severity 99" to
    // any consumer that assumes higher-is-worse — the most alarming possible
    // reading of the least alarming possible state.
    const clean = {
      fleet_size: 91,
      wear: { drive_km_p50: 198.5, drive_hours_p50: 5.5, soil_index_p50: 0.22, soil_index_max: 0.507, cabin_litter_total: 138 },
      due: { pm_due_ratio_p50: 0.026, pm_overdue: 0, pm_due_soon: 0, calib_due_ratio_p50: 0.025, calib_overdue: 0, measurable: 91 },
      dtc: { open_total: 0, vehicles_with_open: 0, worst_rank: null, rank_scale: "lower_is_worse",
             rank_sentinel_note: "99 means none", by_rank: {} },
      attention: [],
    };
    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, null, null, clean as never);
    const w = b.channels.fleet_telemetry.payload.wear;
    expect(w?.dtc.worst_rank).toBeNull();       // NOT 99
    expect(w?.dtc.rank_scale).toBe("lower_is_worse");
    // and a clean fleet raises no alarm note
    expect(b.channels.fleet_telemetry.integrity.notes.join(" ")).not.toContain("open DTC");

    // a genuinely faulted fleet reports the real rank and says which way it runs
    const faulted = { ...clean, dtc: { open_total: 1, vehicles_with_open: 1, worst_rank: 2,
      rank_scale: "lower_is_worse", rank_sentinel_note: "99 means none", by_rank: { "2": 1 } } };
    const b2 = packChannels(SNAP, layout, new Date(CLOCK), null, null, null, null, faulted as never);
    expect(b2.channels.fleet_telemetry.payload.wear?.dtc.worst_rank).toBe(2);
    expect(b2.channels.fleet_telemetry.integrity.notes.join(" ")).toContain("lower is worse");
    expect(auditCoverage(b2).variables.find((v) => v.var_key === "dtc")?.verdict).toBe("observed");
  });

  it("proves the scheduling policy from decisions, not from configuration", () => {
    // ottoq_sim_runs.policy is what the run was CONFIGURED with. Binding to it
    // would let OTTO-Q report a policy the world may never have run — the same
    // failure as reporting a slider's value as an outcome. The witness is the
    // policy stamped on each logged deploy decision.
    const ctx = {
      sim_run_id: "run-1", depot_id: "d1", depot_name: "Nashville", scenario: "normal_day",
      status: "running", seed: 7, stall_count: 2, fleet_count: 1,
      policy_configured: "otto_q", policy_observed: "greedy", policy_decisions: 322,
      policy_variants: { greedy: 322 }, policy_matches_config: false,
    };
    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, null, null, null, ctx as never);
    const dep = b.channels.depot_ops;
    expect(dep.payload.policy?.observed).toBe("greedy");
    expect(dep.payload.policy?.configured).toBe("otto_q");
    // A benchmark that ran a policy it was not configured for is not a
    // benchmark. Saying nothing would make an A/B comparison meaningless.
    expect(dep.integrity.notes.join(" ")).toContain("POLICY MISMATCH");
    expect(dep.integrity.notes.join(" ")).toContain("not a valid benchmark");
    // the variable binds to the OBSERVED value, never the configured one
    expect(auditCoverage(b).variables.find((v) => v.var_key === "scheduling_algorithm")?.verdict).toBe("observed");
  });

  it("treats a configured-but-never-run policy as unproven, not as fact", () => {
    const ctx = {
      sim_run_id: "run-1", depot_id: "d1", depot_name: "N", scenario: "normal_day",
      status: "running", seed: 7, stall_count: 2, fleet_count: 1,
      policy_configured: "otto_q", policy_observed: null, policy_decisions: 0,
      policy_variants: null, policy_matches_config: null,
    };
    const b = packChannels(SNAP, layout, new Date(CLOCK), null, null, null, null, null, ctx as never);
    expect(b.channels.depot_ops.payload.policy?.configured).toBe("otto_q");
    expect(b.channels.depot_ops.payload.policy?.observed).toBeNull();
    expect(b.channels.depot_ops.integrity.missing).toContain("policy.observed");
    expect(b.channels.depot_ops.integrity.notes.join(" ")).toContain("policy in force is unproven");
    // configured alone must NOT satisfy the variable
    expect(auditCoverage(b).variables.find((v) => v.var_key === "scheduling_algorithm")?.verdict).toBe("dark");
  });

  it("keeps the headline honest: registry count is not coverage", () => {
    // THE NUMBER THAT STARTED THIS AUDIT. The Operator Console rendered
    // `wiredCount / catalog.length`, and every catalog row carries wired=true,
    // so it read "47/47 live" while a third of those knobs moved a world
    // OTTO-Q could not observe. The two numbers answer different questions and
    // must never be interchangeable.
    const b = bundleWith({});                 // snapshot only: no extra feeds
    const r = auditCoverage(b);

    // the registry would say "all of them"; the measurement must not
    expect(r.total).toBe(47);
    expect(r.observed).toBeLessThan(r.total);
    expect(r.observed + r.dark + r.unobservable).toBe(r.total);
    // ratio is observed/total — the honest headline, never wired/total.
    // (rounded to 3dp by the report, so compare at that precision)
    expect(r.ratio).toBeCloseTo(r.observed / r.total, 3);

    // and every variable carries a verdict the UI can render per-slider, so a
    // knob that does nothing can say so at the point of use
    for (const v of r.variables)
      expect(["observed", "dark", "unobservable"]).toContain(v.verdict);
  });

  it("reports drift as UNKNOWN when the catalog could not be read", () => {
    const r = auditCoverage(bundleWith({ dr: false }));       // no catalog passed
    expect(r.unbound_catalog_keys).toBeNull();
    expect(r.stale_bindings).toBeNull();
    const empty = auditCoverage(bundleWith({ dr: false }), []); // failed fetch
    expect(empty.stale_bindings).toBeNull();
  });
});
