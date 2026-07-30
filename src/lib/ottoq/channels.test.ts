import { describe, it, expect } from "vitest";
import type { TwinLayout, TwinSnapshot } from "@/lib/ottoTwin";
import {
  packChannels,
  packDepotOps,
  packEnergyGrid,
  packEnvironment,
  packFleetTelemetry,
  normalizeStage,
} from "./channels";

const CLOCK = "2026-07-27T14:00:00.000Z";

function layout(stallCount = 4): TwinLayout {
  return {
    depot: { id: "depot-1", name: "Nashville", origin_lat: 36.1, origin_lng: -86.7 },
    structures: [],
    stalls: Array.from({ length: stallCount }, (_, i) => ({
      id: `s${i}`,
      code: `A${i}`,
      type: i < 2 ? "dcfc" : i < 3 ? "l2" : "wash",
      zone: "north",
      canopy: null,
      covered: null,
      x: i,
      y: 0,
      heading: 0,
      connector_kw: i < 2 ? 350 : i < 3 ? 19.2 : null,
    })),
  };
}

function snapshot(over: Partial<TwinSnapshot> = {}): TwinSnapshot {
  return {
    run: {
      sim_run_id: "run-1", scenario: "normal_day", status: "running",
      sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 990099,
    },
    fleet: {
      counts: { charging_dcfc: 1, arrived_at_gate: 1 },
      total: 2,
      vehicles: [
        { id: "v1", av_id: "AV-1", make: "waymo", platform: "jaguar", state: "charging_dcfc", soc: 41.5, stall_id: "s0" },
        { id: "v2", av_id: "AV-2", make: "tesla", platform: "model3", state: "arrived_at_gate", soc: 12, stall_id: null },
      ],
    },
    stalls_status: [{ id: "s0", status: "charging", vehicle_id: "v1" }],
    energy: {
      grid_import_kw: 400, grid_export_kw: 0, solar_kw: 120, bess_output_kw: 30,
      ev_charging_kw: 400, building_kw: 150, peak_15min_kw: 620,
      tariff: "GSA-3 peak", rate_per_kwh: 0.0875, at: "2026-07-27T13:59:00.000Z",
    },
    bess: { soc_pct: 62, power_kw: 30, state: "discharging", temp_c: 28, soh_pct: 97 },
    weather: {
      temp_c: 33.2, cloud_pct: 15, conditions: "clear", precip: "none",
      ghi_wm2: 780, wind_kmh: 9, solar_elev_deg: 62, at: "2026-07-27T13:55:00.000Z",
    },
    grid: {
      lmp_usd_mwh: 41.2, tariff: "GSA-3", carbon_gco2_kwh: 380,
      voltage_status: "nominal", frequency_hz: 60.01, reserve_margin_pct: 14,
      dr_active: false, dr_cap_kw: null, at: "2026-07-27T13:59:30.000Z",
    },
    counters: {
      dispatches_active: 3, dispatches_total: 40, telemetry_packets: 900,
      charge_sessions: 11, events_total: 210, open_incidents: 1,
    },
    recent_events: [],
    variability: {},
    ...over,
  } as TwinSnapshot;
}

describe("normalizeStage", () => {
  it("maps known backend states to the contract vocabulary", () => {
    // Real `vehicle_state` enum values, not plausible-sounding invented ones.
    expect(normalizeStage("arrived_at_gate")).toEqual({ stage: "at_gate", unmapped: false });
    expect(normalizeStage("CHARGING_DCFC")).toEqual({ stage: "charging", unmapped: false });
    expect(normalizeStage("charging_l2")).toEqual({ stage: "charging", unmapped: false });
    expect(normalizeStage("staged_awaiting_service")).toEqual({ stage: "queued", unmapped: false });
    expect(normalizeStage("in_wash_bay")).toEqual({ stage: "servicing", unmapped: false });
    // present but unassignable — must not read as available capacity
    expect(normalizeStage("tow_requested")).toEqual({ stage: "out_of_service", unmapped: false });
  });

  it("flags unknown states instead of silently bucketing them", () => {
    const r = normalizeStage("teleporting");
    expect(r.stage).toBe("unknown");
    expect(r.unmapped).toBe(true);
  });

  // REGRESSION GUARD. The first version of STATE_TO_STAGE was written from
  // guesswork and covered 4 of these 17. Both charging states fell through to
  // "unknown", so the fleet channel reported zero vehicles charging and zero
  // queued — for every frame, forever, while looking perfectly healthy.
  //
  // This is the full `vehicle_state` enum read from pg_enum on the live
  // backend. If the backend adds a value, add it here deliberately; do not
  // relax the assertion.
  const VEHICLE_STATE_ENUM = [
    "offline", "deployed", "en_route_to_depot", "arrived_at_gate",
    "staged_awaiting_service", "charging_dcfc", "charging_l2",
    "charge_complete_holding", "in_wash_bay", "in_detail_bay", "in_service_bay",
    "service_complete_holding", "staged_for_departure", "en_route_to_deployment",
    "emergency_staged", "tow_requested", "out_of_service",
  ];

  it("maps every value of the real vehicle_state enum", () => {
    const unmapped = VEHICLE_STATE_ENUM.filter((s) => normalizeStage(s).unmapped);
    expect(unmapped).toEqual([]);
  });

  it("never lets an unassignable vehicle read as available capacity", () => {
    for (const s of ["emergency_staged", "tow_requested", "out_of_service"]) {
      expect(normalizeStage(s).stage).toBe("out_of_service");
    }
  });
});

describe("packFleetTelemetry", () => {
  const meta = {
    sim_run_id: "run-1", scenario: "normal_day", seed: 1, tick: 12,
    sim_clock: CLOCK, emitted_at: CLOCK,
  };

  it("derives stage counts and SoC statistics from the frame", () => {
    const env = packFleetTelemetry(snapshot(), meta);
    expect(env.payload.counts_by_stage.charging).toBe(1);
    expect(env.payload.counts_by_stage.at_gate).toBe(1);
    expect(env.payload.soc.reporting).toBe(2);
    expect(env.payload.soc.min).toBe(12);
    expect(env.payload.soc.below_20).toBe(1);
    // DEGRADED, not ok: no fleet-condition feed was passed, so the eight
    // per-vehicle veh_* attributes are unseen on this frame. Same rule as
    // depot_ops' service_timers — an unfetched feed is a named gap, never a
    // healthy channel.
    expect(env.integrity.status).toBe("degraded");
    expect(env.integrity.missing).toContain("fleet.condition");
    expect(env.payload.condition_spread).toBeNull();
    expect(env.payload.vehicles.every((v) => v.condition === null)).toBe(true);
  });

  it("joins per-vehicle condition onto the fleet rows when the feed is present", () => {
    // The twin has drawn these per vehicle at every run boot since
    // ottoq_run_boot_draw shipped; the snapshot just never carried them.
    const snap = snapshot();
    const env = packFleetTelemetry(snap, meta, {
      fleet_size: 2, with_condition: 2, drawn_for_this_run: true, drawn_run_ids: ["run-1"],
      vehicles: [{
        vehicle_id: snap.fleet.vehicles[0].id, av_id: "AV-1",
        battery_soh_pct: 91.4, consumption_scalar: 1.07, charge_curve_scalar: 0.88,
        soil_rate: 1.74, pm_interval_km: 8450, calib_interval_h: 300,
        service_speed_scalar: 1.085, wash_cadence_cycles: 4, cycles_since_wash: 1,
        wash_due_ratio: 0.25,
      }],
      spread: { battery_soh_pct: { n: 2, min: 91.4, p50: 95, max: 100, spread: 8.6 } },
    });
    expect(env.payload.vehicles[0].condition?.battery_soh_pct).toBe(91.4);
    expect(env.payload.vehicles[0].condition?.charge_curve_scalar).toBe(0.88);
    expect(env.payload.condition_spread?.battery_soh_pct.spread).toBe(8.6);
    expect(env.payload.condition_provenance?.drawn_for_this_run).toBe(true);
    // the second vehicle drew none — that is per-vehicle absence, not uniformity
    expect(env.payload.vehicles[1].condition).toBeNull();
    expect(env.integrity.notes.join(" ")).toContain("carry no drawn condition");
  });

  it("says so when the fleet is wearing another run's condition", () => {
    // vehicles.config is one mutable row per vehicle, overwritten by the next
    // run's draw. A stale draw reads exactly like a fresh one unless we check.
    const snap = snapshot();
    const env = packFleetTelemetry(snap, meta, {
      fleet_size: 2, with_condition: 2, drawn_for_this_run: false,
      drawn_run_ids: ["some-other-run"], vehicles: [], spread: {},
    });
    expect(env.payload.condition_provenance?.drawn_for_this_run).toBe(false);
    expect(env.integrity.notes.join(" ")).toContain("BELONGS TO ANOTHER RUN");
  });

  it("counts vehicles with no SoC as missing rather than zero", () => {
    const snap = snapshot();
    snap.fleet.vehicles[1].soc = null as unknown as number;
    const env = packFleetTelemetry(snap, meta);
    expect(env.payload.soc.reporting).toBe(1);
    expect(env.payload.soc.missing).toBe(1);
    expect(env.payload.soc.min).toBe(41.5);
    expect(env.integrity.notes.join(" ")).toContain("no SoC");
  });

  it("reports missing when the fleet roster is empty", () => {
    const snap = snapshot({ fleet: { counts: {}, total: 0, vehicles: [] } });
    expect(packFleetTelemetry(snap, meta).integrity.status).toBe("missing");
  });
});

describe("packDepotOps", () => {
  const meta = {
    sim_run_id: "run-1", scenario: "normal_day", seed: 1, tick: 12,
    sim_clock: CLOCK, emitted_at: CLOCK,
  };

  it("reconstructs full stall inventory from the layout, flagging inferred availability", () => {
    const env = packDepotOps(snapshot(), layout(4), meta);
    expect(env.payload.capacity.total).toBe(4);
    expect(env.payload.capacity.occupied).toBe(1);
    expect(env.payload.capacity.available).toBe(3);
    // only s0 is in the status feed; the other three are inferred available
    expect(env.payload.stalls.filter((s) => s.assumed_available)).toHaveLength(3);
  });

  it("marks the inventory PARTIAL when the layout has not loaded", () => {
    const env = packDepotOps(snapshot(), null, meta);
    expect(env.payload.capacity.total).toBe(1);
    expect(env.integrity.notes.join(" ")).toContain("PARTIAL");
  });

  it("computes queue pressure from normalized stages", () => {
    const env = packDepotOps(snapshot(), layout(4), meta);
    expect(env.payload.queue.waiting).toBe(1);
    expect(env.payload.queue.in_service).toBe(1);
    expect(env.payload.queue.pressure_ratio).toBeCloseTo(1 / 3, 3);
  });

  it("reports pressure_ratio null (not Infinity) when no stall is available", () => {
    const snap = snapshot();
    const l = layout(1); // single stall, and it is occupied
    const env = packDepotOps(snap, l, meta);
    expect(env.payload.capacity.available).toBe(0);
    expect(env.payload.queue.pressure_ratio).toBeNull();
  });

  it("always reports service_timers as an unfed gap", () => {
    const env = packDepotOps(snapshot(), layout(4), meta);
    expect(env.payload.service_timers).toEqual([]);
    expect(env.integrity.missing).toContain("service_timers");
    expect(env.integrity.status).toBe("degraded");
  });
});

describe("packEnergyGrid", () => {
  const meta = {
    sim_run_id: "run-1", scenario: "normal_day", seed: 1, tick: 12,
    sim_clock: CLOCK, emitted_at: CLOCK,
  };

  it("computes net grid draw and the site balance residual", () => {
    const env = packEnergyGrid(snapshot(), meta);
    expect(env.payload.site.net_grid_kw).toBe(400);
    // (400 + 120 + 30) - (0 + 400 + 150) = 0
    expect(env.payload.site.balance_residual_kw).toBe(0);
  });

  it("flags a site model that does not close", () => {
    const snap = snapshot();
    (snap.energy as Record<string, number>).building_kw = 400;
    const env = packEnergyGrid(snap, meta);
    expect(env.payload.site.balance_residual_kw).toBe(-250);
    expect(env.integrity.notes.join(" ")).toContain("does not close");
  });

  it("computes DR headroom and flags a capless DR call", () => {
    const snap = snapshot();
    Object.assign(snap.grid as Record<string, unknown>, { dr_active: true, dr_cap_kw: 500 });
    const env = packEnergyGrid(snap, meta);
    expect(env.payload.demand_response.headroom_kw).toBe(-50);

    const snap2 = snapshot();
    Object.assign(snap2.grid as Record<string, unknown>, { dr_active: true, dr_cap_kw: null });
    const env2 = packEnergyGrid(snap2, meta);
    expect(env2.payload.demand_response.headroom_kw).toBeNull();
    expect(env2.integrity.notes.join(" ")).toContain("cannot shed to a target");
  });

  it("takes staleness from the OLDEST constituent observation", () => {
    // energy at 13:59:00 is 60s behind the 14:00 clock; grid at 13:59:30 is 30s
    expect(packEnergyGrid(snapshot(), meta).staleness_s).toBe(60);
  });

  it("reports missing when neither energy nor grid resolved", () => {
    const env = packEnergyGrid(snapshot({ energy: null, grid: null, bess: null }), meta);
    expect(env.integrity.status).toBe("missing");
    expect(env.integrity.notes.join(" ")).toContain("no site_energy_snapshots");
  });
});

describe("packEnvironment", () => {
  const meta = {
    sim_run_id: "run-1", scenario: "normal_day", seed: 1, tick: 12,
    sim_clock: CLOCK, emitted_at: CLOCK,
  };

  it("derives daylight from solar elevation", () => {
    expect(packEnvironment(snapshot(), meta).payload.daylight).toBe(true);
    const night = snapshot();
    (night.weather as Record<string, number>).solar_elev_deg = -12;
    expect(packEnvironment(night, meta).payload.daylight).toBe(false);
  });

  it("leaves daylight null rather than guessing when elevation is absent", () => {
    const snap = snapshot({ weather: null });
    const env = packEnvironment(snap, meta);
    expect(env.payload.daylight).toBeNull();
    expect(env.integrity.status).toBe("missing");
  });
});

describe("packChannels", () => {
  it("produces all five channels with a shared tick and run identity", () => {
    const b = packChannels(snapshot(), layout(4), new Date(CLOCK));
    expect(Object.keys(b.channels)).toHaveLength(5);
    for (const env of Object.values(b.channels)) {
      expect(env.sim_run_id).toBe("run-1");
      expect(env.tick).toBe(12);
      expect(env.contract_version).toBe(b.contract_version);
    }
  });

  it("is degraded (not ready) while depot_ops has no service timers", () => {
    expect(packChannels(snapshot(), layout(4), new Date(CLOCK)).status).toBe("degraded");
  });

  it("is not_ready when a REQUIRED channel is missing entirely", () => {
    const b = packChannels(snapshot({ energy: null, grid: null, bess: null }), layout(4), new Date(CLOCK));
    expect(b.channels.energy_grid.integrity.status).toBe("missing");
    expect(b.status).toBe("not_ready");
  });

  it("stays ready-or-degraded when only a NON-required channel is missing", () => {
    const b = packChannels(snapshot({ weather: null }), layout(4), new Date(CLOCK));
    expect(b.channels.environment.integrity.status).toBe("missing");
    expect(b.status).not.toBe("not_ready");
  });
});
