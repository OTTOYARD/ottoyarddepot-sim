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
  // NOTE: depot_ops.demand_forecast.incoming_count is a second, forward-looking
  // witness for this same knob. `arrival` stays bound to the realized count —
  // a forecast is a claim about the future, not an observation of the world.
  // UNLOCKED earlier from legs_meta.median_deviation_s, which the twin has
  // always published and the client discarded. It STAYS on the leg deviation,
  // deliberately. ottoq_vehicle_dispatches has an
  // arrival_jitter_min column that looks like a perfect fit — and it is 0 on
  // 97.5% of trips (282 of 11,274 carry any). Binding to its p50 would grade
  // this "observed" on every run while telling OTTO-Q nothing. The count and
  // max are published on fleet_telemetry.offsite instead, where the sparsity
  // is legible.
  { var_key: "eta_delay", domain: "fleet_demand", label: "Arrival ETA delay", channel: "depot_ops", observable: "plan_deviation_s", note: "leg plan-vs-realized drift; the dispatch arrival_jitter p50 is 0 on 97.5% of trips and would be a false positive" },
  // REBOUND to the per-trip measurement. `soc.p50` is the SoC of every vehicle
  // in the yard — mostly vehicles that have been charging for hours — which is
  // not "SoC on arrival" in any useful sense. The dispatch record has the real
  // thing: the SoC each vehicle actually came back with.
  { var_key: "soc_on_arrival", domain: "fleet_demand", label: "SoC on arrival", channel: "fleet_telemetry", observable: "offsite.soc.at_return_p50", note: "measured per returning trip; the yard-wide soc.p50 it replaced was dominated by vehicles mid-charge" },
  // UNLOCKED. Not from the fleet rows — which still carry no target — but from
  // the charge-session event log, which records soc_target on every session.
  { var_key: "target_soc", domain: "fleet_demand", label: "Target SoC", channel: "charger_systems", observable: "observed_charging.target_soc_p50", note: "population median from charge.session_started; per-vehicle target is still absent from the fleet rows" },
  // UNLOCKED. Not from the depot frame — from ottoq_vehicle_dispatches, which
  // has recorded planned vs actual duration for 17,619 trips and was never read.
  { var_key: "trip_duration", domain: "fleet_demand", label: "Trip duration", channel: "fleet_telemetry", observable: "offsite.duration.actual_min_p50" },
  { var_key: "oem_mix_tesla", domain: "fleet_demand", label: "Tesla share", channel: "fleet_telemetry", observable: "vehicles[].oem" },
  // UNLOCKED via the realized activity rate. idle_fraction multiplies the
  // active-driving fraction, so a vehicle that idles covers fewer miles per
  // minute away — that ratio is the effect, and it is measured per trip.
  // NOT bound to energy_consumed_kwh: that column is never written (0 of
  // 17,619 rows), so it would report a fleet that used no energy.
  { var_key: "idle_fraction", domain: "fleet_demand", label: "Drive-activity level", channel: "fleet_telemetry", observable: "offsite.activity.miles_per_trip_min_p50" },

  // ── operations ────────────────────────────────────────────────────────────
  // UNLOCKED. depot_ops.service_timers is now built from the twin's timed-leg
  // feed, which the snapshot has published all along and the client discarded.
  { var_key: "charge_time", domain: "operations", label: "Charge duration", channel: "depot_ops", observable: "service_timers[].planned_s" },
  { var_key: "wash_time", domain: "operations", label: "Wash duration", channel: "depot_ops", observable: "service_timers[].planned_s" },
  { var_key: "detail_time", domain: "operations", label: "Detail duration", channel: "depot_ops", observable: "service_timers[].planned_s" },
  { var_key: "maintenance_time", domain: "operations", label: "Maintenance duration", channel: "depot_ops", observable: "service_timers[].planned_s" },
  // STAFFING UNLOCKED (4 of 5). `ottoq_sim_lane_capacity` turns these knobs into
  // hard concurrency limits — physical x staffing_level x lane_staff — consumed
  // by the FIFO tick, both L2 proposers and the itinerary planner. The sim
  // stamps the EFFECTIVE caps it used onto every `twin.staging_overflow` event,
  // so these bind to what the world did, not to a recomputation.
  //
  // The master multiplier is not separable from a lane knob by the cap alone
  // (the cap is their product), so it binds to the same observable. That is the
  // honest limit of what one frame can prove.
  { var_key: "staffing_level", domain: "operations", label: "Staffing level", channel: "depot_ops", observable: "labor.lanes.service_cap", note: "master multiplier; the cap is staffing_level x service_staff x physical, so the two are not separable from the cap alone" },
  // NOT UNLOCKED, and not for want of a channel. `charging_staff` is read by NO
  // function in the database — verified by scanning every pg_proc body. It is a
  // registered, operator-adjustable knob that the simulation ignores entirely,
  // so there is no realized effect for any channel to carry. Publishing the
  // slider's own value would be reporting the setting as though it were an
  // outcome. Fix belongs in the sim, not here.
  { var_key: "charging_staff", domain: "operations", label: "Charging-assist staff", channel: null, observable: null, note: "INERT: no sim function reads this knob — moving it changes nothing in the world" },
  { var_key: "cleaning_staff", domain: "operations", label: "Cleaning staff", channel: "depot_ops", observable: "labor.lanes.wash_cap", note: "ottoq_sim_lane_capacity('cleaning_staff', 3) — gates concurrent wash/detail lanes" },
  { var_key: "service_staff", domain: "operations", label: "Service/maint staff", channel: "depot_ops", observable: "labor.lanes.service_cap", note: "ottoq_sim_lane_capacity('service_staff', 2)" },
  { var_key: "deploy_staff", domain: "operations", label: "Deploy-prep staff", channel: "depot_ops", observable: "labor.lanes.deploy_cap", note: "ottoq_sim_lane_capacity('deploy_staff', 20)" },
  { var_key: "queue_patience", domain: "operations", label: "Queue patience", channel: "depot_ops", observable: "queue.waiting", note: "patience is only visible through the queue length it produces" },
  { var_key: "scheduling_algorithm", domain: "operations", label: "OTTO-Q scheduling policy", channel: null, observable: null, note: "the policy in force is not echoed back on any frame — OTTO-Q cannot confirm which policy the world believes it is running" },

  // ── reliability ───────────────────────────────────────────────────────────
  // UNOBSERVABLE, not dark. counts.faulted is hardcoded null because charger
  // fault state lives in ottoq_ocpp_chargers.station_state, which the twin
  // snapshot does not publish at all. Grading it "dark" implied a transient
  // gap that might resolve on the next frame and kept it out of the structural
  // backlog it actually belongs in. Re-bind to ocpp[].station_state the moment
  // charger health reaches the frame and this flips to observed on its own.
  // UNLOCKED as a RATE. Per-charger health is still dark — ottoq_ocpp_chargers
  // remains unpublished and counts.faulted is still null — but the variable is
  // "Charger fault rate", and the fault rate is now measured from the session
  // log. These are different claims: the population rate says nothing about
  // whether charger B-NASH-L2-27 is alive right now.
  { var_key: "charger_fault", domain: "reliability", label: "Charger fault rate", channel: "charger_systems", observable: "reliability.fault_rate", note: "population fault rate from charge.session_faulted; PER-CHARGER station_state is still unpublished" },
  { var_key: "dtc", domain: "reliability", label: "DTC / fault-code rate", channel: null, observable: null, note: "DTC codes are emitted into telemetry packets but never reach a frame" },
  { var_key: "incident", domain: "reliability", label: "Incident rate", channel: "depot_ops", observable: "incidents_open" },
  // UNLOCKED. vehicle.exception_* events carry a severity classifier.
  { var_key: "incident_severity", domain: "reliability", label: "Incident severity", channel: "depot_ops", observable: "reliability.exceptions_by_severity", note: "severity histogram from vehicle.exception_* events; ottoq_vehicle_incidents still publishes only a count" },
  { var_key: "telemetry_dropout", domain: "reliability", label: "Telemetry dropout", channel: "fleet_telemetry", observable: "soc.missing", note: "dropout shows up as vehicles reporting no SoC" },
  // UNLOCKED. This is a DISPERSION knob, so it binds to the dispersion stat,
  // not a median — a widening distribution is invisible in a p50.
  { var_key: "soh_spread", domain: "reliability", label: "Battery-health spread", channel: "fleet_telemetry", observable: "condition_spread.battery_soh_pct.spread" },
  // UNLOCKED. A vehicle towed in did not drive in — vehicle.tow_* is the only
  // breakdown signal anywhere in the world model.
  { var_key: "breakdown_rate", domain: "reliability", label: "Breakdown / tow rate", channel: "depot_ops", observable: "reliability.tow_events" },

  // ── vehicle ───────────────────────────────────────────────────────────────
  // ALL EIGHT UNLOCKED, and the earlier note on this domain was WRONG.
  //
  // It said the vehicle domain "is dealt per-run and never published
  // per-vehicle". The first half is right, the second was a conclusion drawn
  // from searching information_schema for columns named `soh`/`consumption` and
  // finding none. The attributes are not columns — they live in the
  // `vehicles.config` jsonb, drawn per vehicle at every run boot by
  // `ottoq_run_boot_draw` (928 cards = 8 vars x 116 vehicles, seeded and
  // reproducible). The fleet was never uniform: SoH spans 88.2-100.0 and soil
  // rate varies four-fold.
  //
  // What was actually missing was the PIPE — ottoq_twin_snapshot publishes
  // seven scalar fields per vehicle and drops `config`. These now bind to the
  // fleet-condition feed, which carries the real per-vehicle values.
  { var_key: "veh_battery_soh_pct", domain: "vehicle", label: "Battery health (SoH)", channel: "fleet_telemetry", observable: "vehicles[].condition.battery_soh_pct" },
  { var_key: "veh_consumption_scalar", domain: "vehicle", label: "Energy consumption scalar", channel: "fleet_telemetry", observable: "vehicles[].condition.consumption_scalar" },
  // Per-VEHICLE now, superseding the charger-population median. A median cannot
  // tell the scheduler which car will accept power slowly; this can.
  { var_key: "veh_charge_curve_scalar", domain: "vehicle", label: "Charge-curve scalar", channel: "fleet_telemetry", observable: "vehicles[].condition.charge_curve_scalar" },
  { var_key: "veh_soil_rate", domain: "vehicle", label: "Soiling rate", channel: "fleet_telemetry", observable: "vehicles[].condition.soil_rate" },
  { var_key: "veh_pm_interval_km", domain: "vehicle", label: "PM interval", channel: "fleet_telemetry", observable: "vehicles[].condition.pm_interval_km" },
  { var_key: "veh_calib_interval_h", domain: "vehicle", label: "Sensor calibration interval", channel: "fleet_telemetry", observable: "vehicles[].condition.calib_interval_h" },
  { var_key: "veh_service_speed_scalar", domain: "vehicle", label: "Service duration scalar", channel: "fleet_telemetry", observable: "vehicles[].condition.service_speed_scalar" },
  { var_key: "veh_wash_cadence_cycles", domain: "vehicle", label: "Wash cadence", channel: "fleet_telemetry", observable: "vehicles[].condition.wash_cadence_cycles" },
];

// ── path resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a dot-path against a payload. `[]` means "descend into an array and
 * succeed if ANY element resolves the rest of the path to a non-null value".
 * Booleans count as resolved (false is an observation); null/undefined do not.
 *
 * AN EMPTY CONTAINER IS NOT EVIDENCE. A path landing on `{}` or `[]` resolves
 * FALSE. This matters for the histogram observables (`delay_causes`,
 * `exceptions_by_severity`): the packer emits `{}` both for "we aggregated and
 * found none" and — before nullability was tightened — for "we never looked".
 * Since an empty histogram cannot demonstrate that a knob moved anything, it
 * must not be allowed to score as coverage. Scalar `0` still resolves true: a
 * measured zero is a measurement, an empty bag is not.
 */
export function resolveObservable(payload: unknown, path: string): boolean {
  const isEmptyContainer = (v: unknown): boolean =>
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

  const segments = path.split(".");
  const walk = (node: unknown, i: number): boolean => {
    if (node === null || node === undefined) return false;
    if (i >= segments.length) return !isEmptyContainer(node);
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
