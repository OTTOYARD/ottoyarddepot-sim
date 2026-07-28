// ============================================================================
// OTTO-TWIN backend client — talks to the server-authoritative twin
// (Supabase edge function `otto-twin-control`). READS are public; CONTROL
// actions require an operator key stored in localStorage('otto_operator_key').
// ============================================================================

// The OTTO-Q / OTTO-TWIN backend (Supabase project gxdrcyphqjzjsuhxuqtg).
// The anon key is public by design (safe to ship in the client bundle) — it is
// the single source of truth for both the twin edge-function calls below and
// the supabase-js client in ottoQClient.ts (RPCs + the Black Box download).
export const OTTOQ_SUPABASE_URL = "https://gxdrcyphqjzjsuhxuqtg.supabase.co";
export const OTTOQ_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4ZHJjeXBocWp6anN1aHh1cXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjk3MDMsImV4cCI6MjA5MDkwNTcwM30.v7erbnrlciPknvx_EpUpewXrvR9-F3D-hH-jWmTW0zI";

const BASE = `${OTTOQ_SUPABASE_URL}/functions/v1/otto-twin-control`;
export const NASHVILLE_DEPOT = "11111111-1111-1111-1111-111111111111";

// ── Types (mirror ottoq_twin_snapshot / ottoq_twin_depot_layout) ──
export interface TwinStall {
  id: string; code: string; type: string; zone: string | null;
  canopy: string | null; covered: boolean | null;
  x: number; y: number; heading: number; connector_kw: number | null;
}
export interface TwinStructure {
  code: string; kind: string; title: string;
  x_ft: number; y_ft: number; width_ft: number; length_ft: number; rotation_deg: number;
}
export interface TwinLayout {
  depot: { id: string; name: string; origin_lat: number; origin_lng: number } | null;
  structures: TwinStructure[];
  stalls: TwinStall[];
}

export interface TwinVehicle {
  id: string; av_id: string; make: string; platform: string;
  state: string; soc: number; stall_id: string | null;
}
/**
 * One timed leg of a vehicle's itinerary — the twin's T3 RENDER CONTRACT.
 *
 * The backend has published these on every snapshot since the t3_* migrations
 * and the client ignored them entirely, inventing motion from stall state
 * instead. They are also the only per-visit SERVICE TIMING on the wire, which
 * is what `depot_ops.service_timers` is built from.
 *
 * `kind` records how the DURATION WAS DERIVED, not what the service is:
 *   charge_curve   a physical charge model
 *   distribution   sampled from a fitted real-world corpus
 *   flow_contract  a policy or contract
 *   travel         taxiing between places — the only non-service kind
 * `leg_type` is the actual service classifier.
 */
export interface TwinLeg {
  leg_id: string;
  vehicle_id: string;
  seq: number;
  leg_type: string;
  intent: string | null;
  kind: string;
  from_stall: string | null;
  to_stall: string | null;
  from_x: number | null; from_y: number | null;
  to_x: number | null; to_y: number | null;
  start_sim: string | null;
  end_sim: string | null;
  duration_s: number | null;
  status: string;
  geometry: string;
}

/** Server half of the render-contract coverage ratio. */
export interface TwinLegsMeta {
  open_travel_legs: number;
  vehicles_with_open_leg: number;
  closed_this_run: number;
  /** how far realized travel drifted from plan, seconds; negative = early */
  median_deviation_s: number | null;
}

export interface TwinSnapshot {
  run: {
    sim_run_id: string; scenario: string; status: string;
    sim_clock: string; tick_count: number; time_scale: number; seed: number;
  };
  /** timed itinerary legs, filtered server-side to the active window */
  legs?: TwinLeg[];
  legs_meta?: TwinLegsMeta;
  fleet: { counts: Record<string, number>; total: number; vehicles: TwinVehicle[] };
  stalls_status: { id: string; status: string; vehicle_id: string | null }[];
  energy: Record<string, number | string | null> | null;
  bess: Record<string, number | string | null> | null;
  weather: Record<string, number | string | null> | null;
  grid: Record<string, number | string | boolean | null> | null;
  counters: Record<string, number>;
  recent_events: { type: string; severity: string; at: string; entity: string; payload: unknown }[];
  variability: Record<string, unknown>;
  error?: string;
}

// ── Events window (RPC `ottoq_twin_events_window`) ──
//
// `TwinSnapshot.recent_events` is a 15-row tail: a UI ticker. It cannot express
// a RATE, and rates are most of what a reliability model is. This aggregate is
// the same event log read as a SIGNAL: run-to-date counts, fault and delay
// rates, the observed charge curve, and the twin's own arrival forecast.
//
// Every derived statistic is `null` when its source set was empty. "We saw no
// faults" and "there were no sessions to fault" are different claims and must
// stay distinguishable — a 0 here would collapse them.

/** Latest `ottoq.arrival_forecast` — the twin's look-ahead, previously unread. */
export interface TwinDemandForecast {
  at: string | null;
  horizon_min: number | null;
  incoming_count: number | null;
  charge_needed_count: number | null;
  predicted_charge_kw: number | null;
  predicted_charge_kwh: number | null;
}

export interface TwinEventsWindow {
  window: {
    basis: string;
    signal_events: number;
    first_at: string | null;
    last_at: string | null;
    /** run's sim-time span; turns any count into a per-sim-hour rate */
    sim_minutes_elapsed: number | null;
  };
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  reliability: {
    charge_sessions: number;
    charge_faults: number;
    /** faults / sessions; null when nothing ever started */
    charge_fault_rate: number | null;
    fault_reasons: Record<string, number>;
    repair_minutes_total: number | null;
    arrival_delays: number;
    delay_min_p50: number | null;
    delay_causes: Record<string, number>;
    stranded_recharges: number;
    exceptions_by_severity: Record<string, number>;
    faults_per_sim_hour: number | null;
    delays_per_sim_hour: number | null;
  };
  charging: {
    target_soc_p50: number | null;
    soc_start_p50: number | null;
    /** initial_rate_kw / max_rate_kw — the charge curve OBSERVED, not declared */
    charge_curve_ratio_p50: number | null;
    battery_temp_c_p50: number | null;
    /** null today: the twin records the key and never fills it */
    battery_soh_pct_p50: number | null;
    sessions_completed: number;
    energy_kwh_total: number | null;
    avg_power_kw_p50: number | null;
    session_duration_s_p50: number | null;
    auto_rerouted: number;
  };
  demand_forecast: TwinDemandForecast | null;
  throughput: {
    valve_holds: number;
    held_total: number | null;
    released_total: number | null;
    cap_last: number | null;
  };
  error?: string;
}

/**
 * Which depot a run actually simulates (RPC `ottoq_twin_run_context`).
 *
 * `ottoq_twin_snapshot` publishes the run block WITHOUT depot_id, so the client
 * hardcoded NASHVILLE_DEPOT for the layout while the run could belong to
 * another depot. The backend has two seeded 150-stall depots that share no
 * stall ids — a run on the wrong one yields a fully coherent description of a
 * building nobody is simulating. Resolve the depot from the run, always.
 */
export interface TwinRunContext {
  sim_run_id: string;
  depot_id: string;
  depot_name: string | null;
  scenario: string;
  status: string;
  seed: number | null;
  stall_count: number;
  fleet_count: number;
  /** what the run was CONFIGURED to use — a setting, not evidence */
  policy_configured: string | null;
  /**
   * What actually made the decisions, from ottoq_deploy_log (every deploy
   * decision is stamped with the policy that made it). NULL when no decision
   * was logged — an unrun policy is not a policy in force.
   */
  policy_observed: string | null;
  policy_decisions: number;
  /** more than one entry means the run switched policy mid-flight */
  policy_variants: Record<string, number> | null;
  /** false means the benchmark is broken: it ran a policy it was not configured for */
  policy_matches_config: boolean | null;
  error?: string;
}

/**
 * Realized wear and service-due state (RPC `ottoq_twin_wear_window`).
 *
 * Pairs with TwinFleetCondition: that carries the DRAWN intervals, this carries
 * the progress against them. An interval alone is inert — "PM every 8,450 km"
 * means nothing until you know the vehicle has driven 8,200.
 */
export interface TwinWearWindow {
  fleet_size: number;
  wear: {
    drive_km_p50: number | null;
    drive_hours_p50: number | null;
    soil_index_p50: number | null;
    soil_index_max: number | null;
    cabin_litter_total: number;
  };
  due: {
    pm_due_ratio_p50: number | null;
    pm_overdue: number;
    pm_due_soon: number;
    calib_due_ratio_p50: number | null;
    calib_overdue: number;
    measurable: number;
  };
  dtc: {
    open_total: number;
    vehicles_with_open: number;
    /** NULL when the fleet is clean. The raw column uses 99 for "none". */
    worst_rank: number | null;
    /** always "lower_is_worse" — the raw scale is inverted and unlabelled */
    rank_scale: string;
    rank_sentinel_note: string;
    by_rank: Record<string, number>;
  };
  attention: {
    av_id: string | null; vehicle_id: string;
    pm_due_ratio: number | null; calib_due_ratio: number | null;
    soil_index: number | null; open_dtc_count: number; worst_dtc_rank: number | null;
  }[];
  error?: string;
}

/** min / p50 / max for one condition attribute across the fleet. */
export interface TwinSpreadStat {
  n: number;
  min: number | null;
  p50: number | null;
  max: number | null;
  spread: number | null;
}

/**
 * Per-vehicle condition dealt at run boot (RPC `ottoq_twin_fleet_condition`).
 *
 * The twin has drawn all eight of these per vehicle since `ottoq_run_boot_draw`
 * shipped — seeded and reproducible, into `vehicles.config`. The snapshot's
 * fleet rows publish seven scalars and drop `config`, so every one of those
 * knobs moved a world OTTO-Q could not see.
 *
 * `lifespan = 'run'`: dealt once at boot, constant after. Fetch ONCE, not per
 * tick.
 */
export interface TwinVehicleCondition {
  vehicle_id: string;
  av_id: string | null;
  battery_soh_pct: number | null;
  consumption_scalar: number | null;
  charge_curve_scalar: number | null;
  soil_rate: number | null;
  pm_interval_km: number | null;
  calib_interval_h: number | null;
  service_speed_scalar: number | null;
  wash_cadence_cycles: number | null;
  cycles_since_wash: number | null;
  /** cycles_since_wash / wash_cadence_cycles; >= 1 means a wash is due */
  wash_due_ratio: number | null;
}

export interface TwinFleetCondition {
  fleet_size: number;
  with_condition: number;
  /**
   * TRUE only when every vehicle drew its condition for THIS run.
   * `vehicles.config` is one mutable row per vehicle, overwritten by the next
   * run's draw, so it can legitimately belong to a different run. FALSE means
   * this fleet's condition is someone else's. NULL means nothing was drawn.
   */
  drawn_for_this_run: boolean | null;
  drawn_run_ids: string[] | null;
  vehicles: TwinVehicleCondition[];
  spread: Record<string, TwinSpreadStat>;
  error?: string;
}

/**
 * What the fleet does once it LEAVES (RPC `ottoq_twin_offsite_window`).
 *
 * Every other feed is depot-scoped, so a vehicle vanished the moment it drove
 * off and reappeared at the gate. `ottoq_vehicle_dispatches` has recorded
 * 17,619 dispatches with planned vs actual duration, miles, SoC out and back,
 * and a return-reason taxonomy — and nothing read it.
 *
 * NOTE `energy_consumed_kwh` exists on that table and is NEVER written (0 of
 * 17,619 rows), so it is not published. Drive energy here is a SoC-delta proxy,
 * labelled as such.
 */
export interface TwinOffsiteWindow {
  dispatches: { total: number; completed: number; active: number };
  off_site_now: {
    count: number;
    elapsed_min_p50: number | null;
    return_eta_min_p50: number | null;
    soc_at_dispatch_p50: number | null;
  };
  duration: {
    planned_min_p50: number | null;
    actual_min_p50: number | null;
    actual_min_p90: number | null;
    /** median of per-trip differences, not the difference of medians */
    drift_min_p50: number | null;
    overran_plan: number;
    ratio_p50: number | null;
  };
  activity: {
    miles_p50: number | null;
    miles_per_trip_min_p50: number | null;
    soc_drop_pct_per_hour_p50: number | null;
    energy_basis: string;
  };
  soc: {
    at_dispatch_p50: number | null;
    at_return_p50: number | null;
    at_return_p10: number | null;
    returned_below_20: number;
  };
  arrival_jitter_min_p50: number | null;
  /** trips with ANY jitter — 2.5% fleet-wide, so the p50 alone reads as "never late" */
  arrival_jitter_delayed_n: number;
  arrival_jitter_min_max: number | null;
  /** why vehicles came back, and the duration each reason implies */
  by_return_trigger: Record<string, {
    n: number; planned_min_p50: number | null; actual_min_p50: number | null;
    drift_min_p50: number | null; soc_at_return_p50: number | null;
  }>;
  error?: string;
}

export interface TwinLaborWindow {
  window: { basis: string; sim_minutes_elapsed: number | null };
  staffing: Record<string, number>;
  knobs: {
    staffing_level: number | null; charging_staff: number | null;
    cleaning_staff: number | null; service_staff: number | null;
    deploy_staff: number | null; any_set: boolean;
  };
  lanes: {
    wash_cap: number | null; service_cap: number | null;
    deploy_cap: number | null; patience_min: number | null; observed_at: string | null;
  };
  overflow: {
    events: number; vehicles_total: number; vehicles_max: number | null;
    escalated: number; per_sim_hour: number | null;
  };
  backlog: {
    started: number; completed: number; open: number;
    by_service: Record<string, { started: number; est_min_p50: number | null; requires_bay: string | null }>;
    bay_bound: number; digital: number; blocks_dispatch: number;
  };
  error?: string;
}

export interface Scenario {
  scenario_code: string; title: string; description: string;
  default_duration_hours: number; default_time_scale: number; status: string;
  fleet_overrides: Record<string, unknown>; weather_overrides: Record<string, unknown>;
  grid_overrides: Record<string, unknown>;
}

// ── Run-history ledger (mirrors ottoq_twin_run_list) ──
export interface TwinRunCounters {
  dispatches_total: number; dispatches_active: number; telemetry_packets: number;
  events_total: number; incidents_open: number; incidents_total: number;
  faults: number; charge_sessions: number;
}
export interface TwinRunSummary {
  sim_run_id: string; scenario: string; status: string;
  started_at: string | null; ended_at: string | null;
  sim_clock_start: string | null; sim_clock_current: string | null;
  tick_count: number; time_scale: number; seed: number; sim_minutes: number;
  counters: TwinRunCounters;
  variability: { spread_mult: number; rate_mult: number; tuned_knobs: number; notes: string | null } | null;
}

// ── Variability catalog (the registry the console renders from) ──
export type KnobType = "shift" | "spread" | "floor" | "ceiling" | "rate" | "select";
export interface CatalogVar {
  var_key: string; domain: string; label: string; definition: string;
  unit: string | null; kind: "continuous" | "rate" | "policy";
  knob_types: KnobType[];
  neutral_value: number | null; min_value: number | null; max_value: number | null; step: number | null;
  select_options: string[] | null; is_primary: boolean; wired: boolean; display_order: number;
}
export const DOMAIN_LABELS: Record<string, string> = {
  environment: "Environment & Weather",
  fleet_demand: "Fleet & Demand",
  energy_grid: "Energy & Grid",
  reliability: "Reliability & Faults",
  operations: "Operations & Service",
};

// ── Auth (demo: open on private link; key optional, not required) ──
export function getOperatorKey(): string | null {
  return localStorage.getItem("otto_operator_key");
}
export function setOperatorKey(key: string): void {
  if (key) localStorage.setItem("otto_operator_key", key);
  else localStorage.removeItem("otto_operator_key");
}

// ── Transport ──
async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: { "content-type": "application/json" } });
  const j = await r.json();
  if (!j.ok) throw new Error([j.error, j.details].filter(Boolean).join(": ") || `GET ${path} failed`);
  return j.data as T;
}
async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = getOperatorKey();
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!j.ok) throw new Error([j.error, j.details].filter(Boolean).join(": ") || `${method} ${path} failed`);
  return j.data as T;
}

/**
 * PostgREST RPC, not the twin edge function.
 *
 * Deliberate: folding this into `ottoq_twin_snapshot` would mean a
 * CREATE OR REPLACE of a 200-line function that every renderer surface depends
 * on, to add one key. The RPC is granted to `anon` and fetches in parallel with
 * the snapshot, so the aggregate carries none of that blast radius.
 */
async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${OTTOQ_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: OTTOQ_ANON_KEY,
      authorization: `Bearer ${OTTOQ_ANON_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`rpc ${fn} failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

// ── API ──
export const twin = {
  // reads (public)
  layout:    (depotId = NASHVILLE_DEPOT) => get<TwinLayout>(`/depot/${depotId}/layout`),
  snapshot:  (simRunId: string)          => get<TwinSnapshot>(`/sim_runs/${simRunId}/snapshot`),
  scenarios: ()                          => get<{ scenarios: Scenario[] }>(`/scenarios`),
  runs:      (limit = 25)                => get<{ runs: TwinRunSummary[] }>(`/sim_runs?limit=${limit}`),
  templates: ()                          => get<{ templates: { name: string; knobs: Record<string, unknown>; notes: string }[] }>(`/variability/templates`),
  catalog:   ()                          => get<{ catalog: CatalogVar[] }>(`/variability/catalog`),
  eventsWindow: (simRunId: string)       => rpc<TwinEventsWindow>("ottoq_twin_events_window", { p_sim_run_id: simRunId }),
  runContext: (simRunId: string)         => rpc<TwinRunContext>("ottoq_twin_run_context", { p_sim_run_id: simRunId }),
  labor: (simRunId: string)              => rpc<TwinLaborWindow>("ottoq_twin_labor_window", { p_sim_run_id: simRunId }),
  offsite: (simRunId: string)            => rpc<TwinOffsiteWindow>("ottoq_twin_offsite_window", { p_sim_run_id: simRunId }),
  wear: (simRunId: string)               => rpc<TwinWearWindow>("ottoq_twin_wear_window", { p_sim_run_id: simRunId }),
  fleetCondition: (simRunId: string)     => rpc<TwinFleetCondition>("ottoq_twin_fleet_condition", { p_sim_run_id: simRunId }),
  health:    ()                          => get<{ service: string; version: string; time: string }>(`/health`),

  // controls (operator key) — used in Phase 2+
  start:          (scenario_code: string, seed?: number) => send<{ sim_run_id: string; scenario_code: string }>("POST", `/scenarios/start`, { scenario_code, seed }),
  stop:           (sim_run_id: string)        => send("POST", `/scenarios/stop`, { sim_run_id }),
  tick:           (simRunId: string)          => send("POST", `/sim_runs/${simRunId}/tick`),
  pause:          (simRunId: string)          => send("POST", `/sim_runs/${simRunId}/pause`),
  resume:         (simRunId: string)          => send("POST", `/sim_runs/${simRunId}/resume`),
  /** honest speed: sim-minutes per tick (60 = 1×). The server metronome keeps
   *  the tick RATE steady; this changes how much sim-time each tick covers. */
  setTimeScale:   (simRunId: string, ts: number) => send("PUT", `/sim_runs/${simRunId}/time_scale`, { time_scale: ts }),
  status:         (simRunId: string)          => send("GET", `/sim_runs/${simRunId}/status`),
  getVariability: (simRunId: string)          => send("GET", `/sim_runs/${simRunId}/variability`),
  setVariability: (simRunId: string, body: object) => send("PUT", `/sim_runs/${simRunId}/variability`, body),
  injectFault:    (simRunId: string, body: object) => send("POST", `/sim_runs/${simRunId}/inject_fault`, body),
  injectDrCall:   (simRunId: string, body: object) => send("POST", `/sim_runs/${simRunId}/inject_dr_call`, body),
};
