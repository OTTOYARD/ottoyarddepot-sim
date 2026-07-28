// ============================================================================
// coverage — the honest answer to "how much of the world can OTTO-Q actually
// see?"
//
// The Operator Console currently renders `wiredCount / catalog.length` and, at
// the time of writing, every row in ottoq_variability_catalog carries
// wired = true. So the console reads "47/47 live". That number describes the
// REGISTRY, not the FEED: a variable can be registered, sampled by the card
// engine, and still have its realized effect reach no channel the orchestrator
// consumes.
//
// This module answers a different question, per variable:
//
//     if this knob moves, does ANY field in the channel bundle move with it?
//
// Each catalog variable is bound to an OBSERVABLE — a concrete path into the
// packed bundle. Resolve the path against a live bundle and you get a coverage
// verdict grounded in the frame that was actually published, not in a flag.
//
// Three verdicts:
//   observed     — the observable resolved to a non-null value this frame
//   dark         — the variable has an observable, but it did not resolve
//   unobservable — no channel carries this variable's effect at all
//
// `unobservable` is the important one. Those variables shape the world and are
// invisible to the engine optimizing it. They are the build backlog.
// ============================================================================

import type { ChannelBundle, ChannelId } from "./contracts";

export type CoverageVerdict = "observed" | "dark" | "unobservable";

export interface VariableBinding {
  var_key: string;
  domain: string;
  label: string;
  /** channel that carries this variable's realized effect; null = nothing does */
  channel: ChannelId | null;
  /**
   * Dot-path into `bundle.channels[channel].payload` whose non-null presence
   * proves the effect reached OTTO-Q. Array segments use `[]` to mean "at least
   * one element has a non-null value at the remaining path".
   */
  observable: string | null;
  /** why this binding is what it is — kept next to the claim it justifies */
  note?: string;
}

/**
 * All 47 rows of ottoq_variability_catalog (verified against otto-q-core on the
 * audit date), bound to the channel field that would move if the knob moved.
 *
 * Keep this list in sync with the catalog. `auditCoverage` reports registry
 * drift in both directions, so a catalog change shows up as a failing count
 * rather than a silent omission.
 */
export const VARIABLE_BINDINGS: VariableBinding[] = [
  // ── energy_grid ───────────────────────────────────────────────────────────
  { var_key: "lmp_usd_mwh", domain: "energy_grid", label: "Electricity price", channel: "energy_grid", observable: "grid.lmp_usd_mwh" },
  { var_key: "grid_demand_mw", domain: "energy_grid", label: "Grid demand", channel: "energy_grid", observable: "grid.reserve_margin_pct", note: "grid demand is only visible through the reserve margin it drives" },
  { var_key: "bess_aggressiveness", domain: "energy_grid", label: "BESS aggressiveness", channel: "energy_grid", observable: "bess.power_kw" },
  { var_key: "dr_ignition", domain: "energy_grid", label: "DR call likelihood", channel: "energy_grid", observable: "demand_response.active" },
  { var_key: "brownout_rate", domain: "energy_grid", label: "Brownout rate", channel: "energy_grid", observable: "grid.voltage_status" },
  { var_key: "freq_excursion_rate", domain: "energy_grid", label: "Frequency excursion", channel: "energy_grid", observable: "grid.frequency_hz" },
  { var_key: "carbon_intensity", domain: "energy_grid", label: "Carbon intensity", channel: "energy_grid", observable: "grid.carbon_gco2_kwh" },

  // ── environment ───────────────────────────────────────────────────────────
  { var_key: "ambient_temp_c", domain: "environment", label: "Ambient temperature", channel: "environment", observable: "temp_c" },
  { var_key: "precip_mm", domain: "environment", label: "Precipitation (daily)", channel: "environment", observable: "precip_state" },
  { var_key: "cloud_cover_pct", domain: "environment", label: "Cloud cover", channel: "environment", observable: "cloud_pct" },
  { var_key: "wind_speed_kmh", domain: "environment", label: "Wind speed", channel: "environment", observable: "wind_kmh" },
  { var_key: "humidity_pct", domain: "environment", label: "Humidity", channel: null, observable: null, note: "humidity is sampled but never published on any frame" },
  { var_key: "precip_rate", domain: "environment", label: "Precipitation rate", channel: "environment", observable: "precip_state" },
  { var_key: "solar_soiling", domain: "environment", label: "Solar soiling", channel: "energy_grid", observable: "site.solar_kw", note: "soiling only shows as a solar-output deficit; the soiling factor itself is not published" },

  // ── fleet_demand ──────────────────────────────────────────────────────────
  { var_key: "arrival", domain: "fleet_demand", label: "Arrival / dispatch rate", channel: "depot_ops", observable: "dispatches_active" },
  // UNLOCKED. The twin measures plan-vs-realized travel drift itself
  // (legs_meta.median_deviation_s) and it was being discarded with the legs.
  { var_key: "eta_delay", domain: "fleet_demand", label: "Arrival ETA delay", channel: "depot_ops", observable: "plan_deviation_s" },
  { var_key: "soc_on_arrival", domain: "fleet_demand", label: "SoC on arrival", channel: "fleet_telemetry", observable: "soc.p50" },
  { var_key: "target_soc", domain: "fleet_demand", label: "Target SoC", channel: null, observable: null, note: "target_soc exists on the vehicles table and on the decision frame, but is absent from the twin snapshot's fleet rows" },
  { var_key: "trip_duration", domain: "fleet_demand", label: "Trip duration", channel: null, observable: null, note: "off-site trip time never surfaces on a depot-scoped frame" },
  { var_key: "oem_mix_tesla", domain: "fleet_demand", label: "Tesla share", channel: "fleet_telemetry", observable: "vehicles[].oem" },
  { var_key: "idle_fraction", domain: "fleet_demand", label: "Drive-activity level", channel: null, observable: null, note: "drive activity shapes arrival SoC but is not itself observable" },

  // ── operations ────────────────────────────────────────────────────────────
  // UNLOCKED. depot_ops.service_timers is now built from the twin's timed-leg
  // feed, which the snapshot has published all along and the client discarded.
  { var_key: "charge_time", domain: "operations", label: "Charge duration", channel: "depot_ops", observable: "service_timers[].planned_s" },
  { var_key: "wash_time", domain: "operations", label: "Wash duration", channel: "depot_ops", observable: "service_timers[].planned_s" },
  { var_key: "detail_time", domain: "operations", label: "Detail duration", channel: "depot_ops", observable: "service_timers[].planned_s" },
  { var_key: "maintenance_time", domain: "operations", label: "Maintenance duration", channel: "depot_ops", observable: "service_timers[].planned_s" },
  { var_key: "staffing_level", domain: "operations", label: "Staffing level", channel: null, observable: null, note: "ottoq_depot_staffing is on neither the snapshot nor the decision frame" },
  { var_key: "charging_staff", domain: "operations", label: "Charging-assist staff", channel: null, observable: null },
  { var_key: "cleaning_staff", domain: "operations", label: "Cleaning staff", channel: null, observable: null },
  { var_key: "service_staff", domain: "operations", label: "Service/maint staff", channel: null, observable: null },
  { var_key: "deploy_staff", domain: "operations", label: "Deploy-prep staff", channel: null, observable: null },
  { var_key: "queue_patience", domain: "operations", label: "Queue patience", channel: "depot_ops", observable: "queue.waiting", note: "patience is only visible through the queue length it produces" },
  { var_key: "scheduling_algorithm", domain: "operations", label: "OTTO-Q scheduling policy", channel: null, observable: null, note: "the policy in force is not echoed back on any frame — OTTO-Q cannot confirm which policy the world believes it is running" },

  // ── reliability ───────────────────────────────────────────────────────────
  // UNOBSERVABLE, not dark. counts.faulted is hardcoded null because charger
  // fault state lives in ottoq_ocpp_chargers.station_state, which the twin
  // snapshot does not publish at all. Grading it "dark" implied a transient
  // gap that might resolve on the next frame and kept it out of the structural
  // backlog it actually belongs in. Re-bind to ocpp[].station_state the moment
  // charger health reaches the frame and this flips to observed on its own.
  { var_key: "charger_fault", domain: "reliability", label: "Charger fault rate", channel: null, observable: null, note: "no source on this frame — ottoq_ocpp_chargers.station_state is not published by ottoq_twin_snapshot" },
  { var_key: "dtc", domain: "reliability", label: "DTC / fault-code rate", channel: null, observable: null, note: "DTC codes are emitted into telemetry packets but never reach a frame" },
  { var_key: "incident", domain: "reliability", label: "Incident rate", channel: "depot_ops", observable: "incidents_open" },
  { var_key: "incident_severity", domain: "reliability", label: "Incident severity", channel: null, observable: null, note: "only the open-incident COUNT is published, never severity" },
  { var_key: "telemetry_dropout", domain: "reliability", label: "Telemetry dropout", channel: "fleet_telemetry", observable: "soc.missing", note: "dropout shows up as vehicles reporting no SoC" },
  { var_key: "soh_spread", domain: "reliability", label: "Battery-health spread", channel: null, observable: null, note: "per-vehicle SoH is not on the fleet rows" },
  { var_key: "breakdown_rate", domain: "reliability", label: "Breakdown / tow rate", channel: null, observable: null },

  // ── vehicle ───────────────────────────────────────────────────────────────
  { var_key: "veh_battery_soh_pct", domain: "vehicle", label: "Battery health (SoH)", channel: null, observable: null, note: "the whole vehicle domain is dealt per-run and never published per-vehicle" },
  { var_key: "veh_consumption_scalar", domain: "vehicle", label: "Energy consumption scalar", channel: null, observable: null },
  { var_key: "veh_charge_curve_scalar", domain: "vehicle", label: "Charge-curve scalar", channel: null, observable: null },
  { var_key: "veh_soil_rate", domain: "vehicle", label: "Soiling rate", channel: null, observable: null },
  { var_key: "veh_pm_interval_km", domain: "vehicle", label: "PM interval", channel: null, observable: null },
  { var_key: "veh_calib_interval_h", domain: "vehicle", label: "Sensor calibration interval", channel: null, observable: null },
  { var_key: "veh_service_speed_scalar", domain: "vehicle", label: "Service duration scalar", channel: null, observable: null },
  { var_key: "veh_wash_cadence_cycles", domain: "vehicle", label: "Wash cadence", channel: null, observable: null },
];

// ── path resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a dot-path against a payload. `[]` means "descend into an array and
 * succeed if ANY element resolves the rest of the path to a non-null value".
 * Booleans count as resolved (false is an observation); null/undefined do not.
 */
export function resolveObservable(payload: unknown, path: string): boolean {
  const segments = path.split(".");
  const walk = (node: unknown, i: number): boolean => {
    if (node === null || node === undefined) return false;
    if (i >= segments.length) return true;
    const seg = segments[i];
    if (seg.endsWith("[]")) {
      const key = seg.slice(0, -2);
      const arr = (node as Record<string, unknown>)[key];
      if (!Array.isArray(arr) || arr.length === 0) return false;
      return arr.some((el) => walk(el, i + 1));
    }
    const next = (node as Record<string, unknown>)[seg];
    if (next === null || next === undefined) return false;
    return walk(next, i + 1);
  };
  return walk(payload, 0);
}

// ── audit ───────────────────────────────────────────────────────────────────

export interface VariableCoverage extends VariableBinding {
  verdict: CoverageVerdict;
}

export interface DomainCoverage {
  domain: string;
  total: number;
  observed: number;
  dark: number;
  unobservable: number;
  /** observed / total, 0..1 */
  ratio: number;
}

export interface CoverageReport {
  contract_version: string;
  sim_run_id: string;
  tick: number;
  total: number;
  observed: number;
  dark: number;
  unobservable: number;
  /** the honest headline number: observed / total */
  ratio: number;
  by_domain: DomainCoverage[];
  variables: VariableCoverage[];
  /** catalog var_keys the backend reports that this file does not bind.
   *  NULL when the catalog could not be read — unknown is not "none". */
  unbound_catalog_keys: string[] | null;
  /** var_keys bound here that the backend catalog no longer lists. NULL when
   *  the catalog could not be read. */
  stale_bindings: string[] | null;
}

/**
 * Audit a live bundle. Pass `catalogKeys` (from GET /variability/catalog) to
 * also detect registry drift between the backend and these bindings.
 */
export function auditCoverage(
  bundle: ChannelBundle,
  catalogKeys?: string[],
): CoverageReport {
  const variables: VariableCoverage[] = VARIABLE_BINDINGS.map((b) => {
    if (!b.channel || !b.observable) return { ...b, verdict: "unobservable" as const };
    const env = bundle.channels[b.channel];

    // A CHANNEL THAT PUBLISHED NOTHING CANNOT EVIDENCE ANYTHING.
    //
    // Several observables point at fields the packer derives from array
    // lengths — `queue.waiting`, `soc.missing` — which are `0`, not absent,
    // on an empty world. `resolveObservable` correctly treats 0 as a real
    // observation, so those variables graded "observed" on a frame that
    // published no fleet at all, while the channel's own integrity record two
    // sections above said the field was missing. The honest-coverage number,
    // built specifically to replace an inflated "47/47 live", was itself
    // inflated.
    //
    // The channel's integrity is the authority on whether there was anything
    // to see. If it resolved nothing, every variable riding on it is dark.
    if (env?.integrity.status === "missing") {
      return { ...b, verdict: "dark" as const };
    }

    const hit = resolveObservable(env?.payload, b.observable);
    return { ...b, verdict: hit ? ("observed" as const) : ("dark" as const) };
  });

  const domains = [...new Set(variables.map((v) => v.domain))].sort();
  const by_domain: DomainCoverage[] = domains.map((domain) => {
    const rows = variables.filter((v) => v.domain === domain);
    const observed = rows.filter((v) => v.verdict === "observed").length;
    return {
      domain,
      total: rows.length,
      observed,
      dark: rows.filter((v) => v.verdict === "dark").length,
      unobservable: rows.filter((v) => v.verdict === "unobservable").length,
      ratio: rows.length ? Math.round((observed / rows.length) * 1000) / 1000 : 0,
    };
  });

  const observed = variables.filter((v) => v.verdict === "observed").length;
  const bound = new Set(VARIABLE_BINDINGS.map((b) => b.var_key));
  const hasCatalog = Array.isArray(catalogKeys) && catalogKeys.length > 0;

  return {
    contract_version: bundle.contract_version,
    sim_run_id: bundle.sim_run_id,
    tick: bundle.tick,
    total: variables.length,
    observed,
    dark: variables.filter((v) => v.verdict === "dark").length,
    unobservable: variables.filter((v) => v.verdict === "unobservable").length,
    ratio: variables.length ? Math.round((observed / variables.length) * 1000) / 1000 : 0,
    by_domain,
    variables,
    // An EMPTY array is truthy, so a failed registry fetch used to report all
    // 47 bindings as "stale" — the boot report announcing total registry drift
    // because a network call failed. Drift is only computable against a
    // catalog we actually have.
    unbound_catalog_keys: hasCatalog ? catalogKeys!.filter((k) => !bound.has(k)).sort() : null,
    stale_bindings: hasCatalog
      ? VARIABLE_BINDINGS.map((b) => b.var_key).filter((k) => !catalogKeys!.includes(k)).sort()
      : null,
  };
}

/** One-line summary for logs and the console header. */
export function coverageHeadline(r: CoverageReport): string {
  return `${r.observed}/${r.total} variables observable by OTTO-Q · ${r.dark} dark · ${r.unobservable} unobservable`;
}
