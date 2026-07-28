import { describe, it, expect } from "vitest";
import type { CatalogVar, Scenario, TwinEventsWindow, TwinFleetCondition, TwinLaborWindow, TwinLayout, TwinOffsiteWindow, TwinSnapshot } from "@/lib/ottoTwin";
import { bootWorld, type BootTransport } from "./worldBoot";

const CLOCK = "2026-07-27T14:00:00.000Z";

const layout: TwinLayout = {
  depot: { id: "depot-1", name: "Nashville", origin_lat: 36.1, origin_lng: -86.7 },
  structures: [],
  stalls: [
    { id: "s0", code: "A0", type: "dcfc", zone: "n", canopy: null, covered: null, x: 0, y: 0, heading: 0, connector_kw: 350 },
    { id: "s1", code: "A1", type: "l2", zone: "n", canopy: null, covered: null, x: 1, y: 0, heading: 0, connector_kw: 19.2 },
  ],
};

const catalog: CatalogVar[] = [
  {
    var_key: "ambient_temp_c", domain: "environment", label: "Ambient temperature",
    definition: "", unit: "C", kind: "continuous", knob_types: ["shift"],
    neutral_value: 0, min_value: -30, max_value: 40, step: 1,
    select_options: null, is_primary: true, wired: true, display_order: 1,
  },
];

const scenarios: Scenario[] = [{
  scenario_code: "normal_day", title: "Normal Day", description: "",
  default_duration_hours: 24, default_time_scale: 60, status: "available",
  fleet_overrides: {}, weather_overrides: {}, grid_overrides: {},
}];

function fullSnapshot(): TwinSnapshot {
  return {
    run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 5, time_scale: 60, seed: 7 },
    fleet: {
      counts: { charging_dcfc: 1 }, total: 1,
      vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "jag", state: "charging_dcfc", soc: 40, stall_id: "s0" }],
    },
    stalls_status: [{ id: "s0", status: "charging", vehicle_id: "v1" }],
    energy: { grid_import_kw: 100, grid_export_kw: 0, solar_kw: 10, bess_output_kw: 0, ev_charging_kw: 80, building_kw: 30, peak_15min_kw: 120, tariff: "GSA-3", rate_per_kwh: 0.08, at: CLOCK },
    bess: { soc_pct: 60, power_kw: 0, state: "idle", temp_c: 25, soh_pct: 98 },
    weather: { temp_c: 30, cloud_pct: 10, conditions: "clear", precip: "none", ghi_wm2: 700, wind_kmh: 8, solar_elev_deg: 55, at: CLOCK },
    grid: { lmp_usd_mwh: 40, tariff: "GSA-3", carbon_gco2_kwh: 370, voltage_status: "nominal", frequency_hz: 60, reserve_margin_pct: 15, dr_active: false, dr_cap_kw: null, at: CLOCK },
    counters: { dispatches_active: 2, dispatches_total: 9, telemetry_packets: 40, charge_sessions: 3, events_total: 20, open_incidents: 0 },
    recent_events: [],
    variability: {},
  } as unknown as TwinSnapshot;
}

/** A run that has logged nothing yet — present, so every count is a real 0. */
function emptyEventsWindow(): TwinEventsWindow {
  return {
    window: { basis: "run_to_date", signal_events: 0, first_at: null, last_at: null, sim_minutes_elapsed: null },
    by_type: {}, by_severity: {},
    reliability: {
      charge_sessions: 0, charge_faults: 0, charge_fault_rate: null, fault_reasons: {},
      repair_minutes_total: null, arrival_delays: 0, delay_min_p50: null, delay_causes: {},
      stranded_recharges: 0, tow_events: 0, exceptions_by_severity: {},
      faults_per_sim_hour: null, delays_per_sim_hour: null,
    },
    charging: {
      target_soc_p50: null, soc_start_p50: null, charge_curve_ratio_p50: null,
      battery_temp_c_p50: null, battery_soh_pct_p50: null, sessions_completed: 0,
      energy_kwh_total: null, avg_power_kw_p50: null, session_duration_s_p50: null,
      auto_rerouted: 0,
    },
    demand_forecast: null,
    throughput: { valve_holds: 0, held_total: null, released_total: null, cap_last: null },
  };
}

/** A fleet whose condition was never drawn — every attribute honestly absent. */
function emptyFleetCondition(): TwinFleetCondition {
  return {
    fleet_size: 1, with_condition: 0, drawn_for_this_run: null,
    drawn_run_ids: null, vehicles: [], spread: {},
  };
}

function transport(over: Partial<BootTransport> = {}): BootTransport {
  return {
    layout: async () => layout,
    catalog: async () => ({ catalog }),
    scenarios: async () => ({ scenarios }),
    snapshot: async () => fullSnapshot(),
    // Optional stage: several tests below deliberately drive a world with no
    // event history, so the default fixture is an EMPTY-but-present window.
    eventsWindow: async () => emptyEventsWindow(),
    runContext: async () => ({
      sim_run_id: "run-1", depot_id: "d1", depot_name: "Nashville",
      scenario: "normal_day", status: "running", seed: 7,
      stall_count: 2, fleet_count: 1,
    }),
    fleetCondition: async () => emptyFleetCondition(),
    offsite: async () => ({
      dispatches: { total: 0, completed: 0, active: 0 },
      off_site_now: { count: 0, elapsed_min_p50: null, return_eta_min_p50: null, soc_at_dispatch_p50: null },
      duration: { planned_min_p50: null, actual_min_p50: null, actual_min_p90: null,
                  drift_min_p50: null, overran_plan: 0, ratio_p50: null },
      activity: { miles_p50: null, miles_per_trip_min_p50: null,
                  soc_drop_pct_per_hour_p50: null, energy_basis: "soc_delta_proxy" },
      soc: { at_dispatch_p50: null, at_return_p50: null, at_return_p10: null, returned_below_20: 0 },
      arrival_jitter_min_p50: null, by_return_trigger: {},
    }),
    labor: async () => ({
      window: { basis: "run_to_date", sim_minutes_elapsed: 60 },
      staffing: { general_tech: 10 },
      knobs: { staffing_level: null, charging_staff: null, cleaning_staff: null,
               service_staff: null, deploy_staff: null, any_set: false },
      lanes: { wash_cap: null, service_cap: null, deploy_cap: null,
               patience_min: null, observed_at: null },
      overflow: { events: 0, vehicles_total: 0, vehicles_max: null, escalated: 0, per_sim_hour: null },
      backlog: { started: 0, completed: 0, open: 0, by_service: {},
                 bay_bound: 0, digital: 0, blocks_dispatch: 0 },
    }),
    ...over,
  };
}

const opts = { simRunId: "run-1", sleep: async () => {}, frameDelayMs: 0 };

describe("bootWorld", () => {
  it("runs every stage and reports each one", async () => {
    const { report } = await bootWorld({ ...opts, transport: transport() });
    expect(report.stages.map((s) => s.id)).toEqual([
      "run_context", "geometry", "registry", "scenarios", "first_frame",
      "variability_profile", "fleet_condition", "labor", "offsite", "events_window", "channels",
    ]);
    expect(report.sim_run_id).toBe("run-1");
    expect(report.scenario).toBe("normal_day");
    expect(report.seed).toBe(7);
  });

  it("is NOT ready while a required channel is only degraded", async () => {
    // depot_ops always reports service_timers as an unfed gap today, so a
    // fully-populated frame still blocks. That is the gate working, not a bug.
    const { report } = await bootWorld({ ...opts, transport: transport() });
    expect(report.ready).toBe(false);
    expect(report.blocked_by.join(" ")).toContain("depot_ops");
  });

  it("records a failed required stage without aborting the rest of the boot", async () => {
    const { report } = await bootWorld({
      ...opts,
      transport: transport({ layout: async () => { throw new Error("layout 503"); } }),
    });
    const geometry = report.stages.find((s) => s.id === "geometry")!;
    expect(geometry.status).toBe("failed");
    expect(geometry.detail).toContain("layout 503");
    // the boot still reached the channel stage
    expect(report.stages.find((s) => s.id === "channels")?.status).toBeDefined();
    expect(report.ready).toBe(false);
    expect(report.blocked_by.join(" ")).toContain("Depot geometry");
  });

  it("retries the first frame and succeeds once the twin has state", async () => {
    let calls = 0;
    const { report, snapshot } = await bootWorld({
      ...opts,
      frameAttempts: 4,
      transport: transport({
        snapshot: async () => {
          calls++;
          if (calls < 3) return { error: "sim_run not found" } as unknown as TwinSnapshot;
          return fullSnapshot();
        },
      }),
    });
    expect(calls).toBe(3);
    expect(snapshot).not.toBeNull();
    expect(report.stages.find((s) => s.id === "first_frame")?.status).toBe("ok");
  });

  it("fails the frame stage after exhausting attempts and still emits a report", async () => {
    const { report, bundle } = await bootWorld({
      ...opts,
      frameAttempts: 2,
      transport: transport({ snapshot: async () => ({ error: "no run" } as unknown as TwinSnapshot) }),
    });
    const frame = report.stages.find((s) => s.id === "first_frame")!;
    expect(frame.status).toBe("failed");
    expect(frame.detail).toContain("2 attempts");
    expect(bundle).toBeNull();
    expect(report.ready).toBe(false);
    // every channel is reported missing rather than silently absent
    expect(report.channels.every((c) => c.status === "missing")).toBe(true);
  });

  it("marks an empty variability profile as calibrated baseline, not a failure", async () => {
    const { report } = await bootWorld({ ...opts, transport: transport() });
    const profile = report.stages.find((s) => s.id === "variability_profile")!;
    expect(profile.status).toBe("empty");
    expect(profile.required).toBe(false);
    expect(profile.detail).toContain("calibrated baseline");
  });

  it("computes coverage against the loaded catalog and flags unbound keys", async () => {
    const { report } = await bootWorld({ ...opts, transport: transport() });
    expect(report.coverage).not.toBeNull();
    expect(report.coverage!.total).toBe(47);
    // the stub catalog has one key, so the other 46 bindings read as stale
    expect(report.coverage!.stale_bindings.length).toBe(46);
  });
});
