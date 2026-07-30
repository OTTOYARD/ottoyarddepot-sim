import { describe, it, expect } from "vitest";
import type { TwinLayout, TwinSnapshot } from "@/lib/ottoTwin";
import { packChannels } from "./channels";
import { auditCoverage, resolveObservable, VARIABLE_BINDINGS } from "./coverage";

const CLOCK = "2026-07-27T14:00:00.000Z";

const layout: TwinLayout = {
  depot: { id: "depot-1", name: "Nashville", origin_lat: 36.1, origin_lng: -86.7 },
  structures: [],
  stalls: [
    { id: "s0", code: "A0", type: "dcfc", zone: "n", canopy: null, covered: null, x: 0, y: 0, heading: 0, connector_kw: 350 },
    { id: "s1", code: "A1", type: "l2", zone: "n", canopy: null, covered: null, x: 1, y: 0, heading: 0, connector_kw: 19.2 },
  ],
};

const snap = {
  run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 12, time_scale: 60, seed: 7 },
  fleet: {
    counts: { charging_dcfc: 1 }, total: 1,
    vehicles: [{ id: "v1", av_id: "AV-1", make: "waymo", platform: "jaguar", state: "charging_dcfc", soc: 40, stall_id: "s0" }],
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

describe("resolveObservable", () => {
  const payload = {
    a: { b: 1 },
    zero: 0,
    flag: false,
    nil: null,
    list: [{ x: null }, { x: 5 }],
    empty: [],
  };

  it("resolves nested non-null values", () => {
    expect(resolveObservable(payload, "a.b")).toBe(true);
  });

  it("treats 0 and false as observations, not absence", () => {
    expect(resolveObservable(payload, "zero")).toBe(true);
    expect(resolveObservable(payload, "flag")).toBe(true);
  });

  it("treats null and unknown paths as unresolved", () => {
    expect(resolveObservable(payload, "nil")).toBe(false);
    expect(resolveObservable(payload, "a.missing")).toBe(false);
  });

  it("resolves array paths when ANY element carries the value", () => {
    expect(resolveObservable(payload, "list[].x")).toBe(true);
    expect(resolveObservable(payload, "empty[].x")).toBe(false);
  });
});

describe("auditCoverage", () => {
  const bundle = packChannels(snap, layout, new Date(CLOCK));

  it("covers every catalog variable exactly once", () => {
    const keys = VARIABLE_BINDINGS.map((b) => b.var_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(47);
  });

  it("reports a coverage ratio well below the console's registry count", () => {
    const r = auditCoverage(bundle);
    expect(r.total).toBe(47);
    expect(r.observed).toBeGreaterThan(0);
    // The whole point of the audit: the honest number is nothing like 47/47.
    expect(r.observed).toBeLessThan(r.total);
    expect(r.observed + r.dark + r.unobservable).toBe(r.total);
  });

  it("marks variables with no channel as unobservable", () => {
    const r = auditCoverage(bundle);
    // All five staffing knobs now BIND — charging_staff last, once
    // ottoq_decide_tick was taught to gate charge admission on it. With no
    // labor feed on this bundle they grade DARK (a feed we did not fetch),
    // which is the distinction that matters: dark means "unproven this frame",
    // unobservable means "nothing anywhere carries it".
    for (const k of ["staffing_level", "charging_staff", "cleaning_staff",
                     "service_staff", "deploy_staff"]) {
      expect(r.variables.find((v) => v.var_key === k)?.verdict).toBe("dark");
    }
    const vehicleDomain = r.by_domain.find((d) => d.domain === "vehicle");
    expect(vehicleDomain?.observed).toBe(0);
  });

  it("marks a bound variable dark when its observable does not resolve", () => {
    const dark = packChannels({ ...snap, grid: null } as TwinSnapshot, layout, new Date(CLOCK));
    const r = auditCoverage(dark);
    expect(r.variables.find((v) => v.var_key === "lmp_usd_mwh")?.verdict).toBe("dark");
  });

  it("detects registry drift in both directions", () => {
    const r = auditCoverage(bundle, ["ambient_temp_c", "charger_mtbf_days"]);
    expect(r.unbound_catalog_keys).toContain("charger_mtbf_days");
    expect(r.stale_bindings).toContain("staffing_level");
  });

  it("domain totals reconcile with the variable list", () => {
    const r = auditCoverage(bundle);
    const summed = r.by_domain.reduce((a, d) => a + d.total, 0);
    expect(summed).toBe(r.total);
  });
});
