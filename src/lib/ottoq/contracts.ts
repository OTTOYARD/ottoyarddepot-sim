// ============================================================================
// OTTO-Q CHANNEL CONTRACT — the seam between the world twin and the
// orchestration engine.
//
// The twin publishes ONE snapshot blob (ottoq_twin_snapshot) that is shaped for
// the RENDERER: legs, stall colors, event ticker. OTTO-Q needs something else —
// a small number of self-describing CHANNELS, each one a coherent slice of the
// world, each one carrying enough metadata that the optimizer can decide how
// much to TRUST it before it acts on it.
//
// The five channels:
//   fleet_telemetry  — AV/EV state: SoC, state machine, service stage, dwell
//   energy_grid      — site power balance, BESS, tariff, LMP, DR, carbon
//   depot_ops        — stall occupancy, service stage/timing, queue pressure
//   charger_systems  — charger/EVSE health, session power, faults
//   environment      — weather, irradiance, and the exogenous forcing terms
//
// DESIGN RULES (why this file looks the way it does)
//   1. EVERY packet is an envelope. Payload alone is not shippable — OTTO-Q must
//      always be able to answer "which run, which tick, how old, how complete".
//   2. INTEGRITY IS FIRST CLASS. A missing weather row is not the same as a
//      clear day. `integrity.missing` names the fields that did not resolve, and
//      `completeness` is the fraction that did. An optimizer that cannot tell
//      "no data" from "zero" will happily optimize into a wall.
//   3. STALENESS IS IN SIM-SECONDS, not wall-clock. The world clock is the
//      authority; a packet 4 sim-hours old is stale even if it arrived 200ms ago.
//   4. PROVENANCE TRAVELS WITH THE DATA. `sources` names the backend tables the
//      values came from, so a decision can be traced back to its inputs.
//   5. NOTHING IS INVENTED. If the twin did not publish a field, the packer
//      leaves it null and records it in `missing`. There are no defaults here.
// ============================================================================

/** Bump the MINOR on additive fields, the MAJOR on any field removal/rename. */
export const CHANNEL_CONTRACT_VERSION = "1.0.0";

export type ChannelId =
  | "fleet_telemetry"
  | "energy_grid"
  | "depot_ops"
  | "charger_systems"
  | "environment";

export const CHANNEL_IDS: ChannelId[] = [
  "fleet_telemetry",
  "energy_grid",
  "depot_ops",
  "charger_systems",
  "environment",
];

export const CHANNEL_LABELS: Record<ChannelId, string> = {
  fleet_telemetry: "AV / EV Telemetry",
  energy_grid: "Energy & Grid",
  depot_ops: "Depot Availability & Service",
  charger_systems: "Charger Systems",
  environment: "Environment",
};

/**
 * Channels OTTO-Q cannot orchestrate without. A bundle missing any of these is
 * `not_ready` — the run may render fine, but any optimization it produces is
 * built on a world the engine cannot actually see.
 */
export const REQUIRED_CHANNELS: ChannelId[] = [
  "fleet_telemetry",
  "depot_ops",
  "energy_grid",
];

// ── integrity ───────────────────────────────────────────────────────────────

export type ChannelStatus =
  /** every required field resolved */
  | "ok"
  /** the channel exists but one or more required fields did not resolve */
  | "degraded"
  /** the underlying source produced nothing at all this frame */
  | "missing";

export interface ChannelIntegrity {
  status: ChannelStatus;
  /** required field paths that resolved to a non-null value */
  present: string[];
  /** required field paths that did NOT resolve — never silently defaulted */
  missing: string[];
  /** present / (present + missing), rounded to 3dp. 1 = fully populated. */
  completeness: number;
  /** backend tables / RPCs the values were read from */
  sources: string[];
  /** human-readable notes (e.g. "no run-scoped energy row yet at tick 0") */
  notes: string[];
}

// ── envelope ────────────────────────────────────────────────────────────────

export interface ChannelEnvelope<T> {
  channel: ChannelId;
  contract_version: string;
  /** run identity — a packet without a run is not replayable */
  sim_run_id: string;
  scenario: string;
  /** the run seed, so a packet can be tied back to its CRN stream */
  seed: number;
  /** twin tick this packet describes */
  tick: number;
  /** sim clock (ISO) at the tick — the authority for staleness */
  sim_clock: string | null;
  /** wall-clock instant the packet was assembled, for transport diagnostics */
  emitted_at: string;
  /**
   * Age of the newest underlying observation in SIM-seconds, relative to
   * sim_clock. null when either clock is unresolvable. Negative values are
   * clamped to 0 (a source stamped ahead of the clock is treated as current).
   */
  staleness_s: number | null;
  integrity: ChannelIntegrity;
  payload: T;
}

// ── fleet_telemetry ─────────────────────────────────────────────────────────

/** Where a vehicle is in its depot visit — the "stage of service" OTTO-Q sorts on. */
export type ServiceStage =
  | "off_site"
  | "inbound"
  | "at_gate"
  | "queued"
  | "moving"
  | "charging"
  | "servicing"
  | "staged"
  | "departing"
  | "unknown";

export interface FleetVehicleSignal {
  id: string;
  av_id: string | null;
  oem: string | null;
  platform: string | null;
  /** raw backend state string, preserved verbatim for traceability */
  state: string;
  /** normalized stage — the contract's own vocabulary, stable across backends */
  stage: ServiceStage;
  soc_pct: number | null;
  stall_id: string | null;
  /** true when the backend state string did not map to a known stage */
  stage_unmapped: boolean;
}

export interface FleetTelemetryPayload {
  fleet_size: number;
  /** counts keyed by raw backend state (what the twin reports) */
  counts_by_state: Record<string, number>;
  /** counts keyed by normalized stage (what OTTO-Q reasons over) */
  counts_by_stage: Record<ServiceStage, number>;
  vehicles: FleetVehicleSignal[];
  /** SoC distribution over vehicles that reported one */
  soc: {
    reporting: number;
    missing: number;
    min: number | null;
    p50: number | null;
    mean: number | null;
    max: number | null;
    /** vehicles under 20% SoC — the pressure term for charge scheduling */
    below_20: number;
  };
  /** packets the twin has emitted this run — a liveness signal, not a rate */
  telemetry_packets_total: number | null;
}

// ── energy_grid ─────────────────────────────────────────────────────────────

export interface EnergyGridPayload {
  site: {
    grid_import_kw: number | null;
    grid_export_kw: number | null;
    solar_kw: number | null;
    bess_output_kw: number | null;
    ev_charging_kw: number | null;
    building_kw: number | null;
    peak_15min_kw: number | null;
    /** import - export; null when either side is unknown */
    net_grid_kw: number | null;
    /** solar + bess + import - export - ev - building; a conservation residual.
     *  A large |residual| means the site model does not balance — surface it,
     *  do not hide it. */
    balance_residual_kw: number | null;
    observed_at: string | null;
  };
  bess: {
    soc_pct: number | null;
    power_kw: number | null;
    state: string | null;
    temp_c: number | null;
    soh_pct: number | null;
  };
  tariff: {
    label: string | null;
    rate_per_kwh: number | null;
  };
  grid: {
    lmp_usd_mwh: number | null;
    carbon_gco2_kwh: number | null;
    voltage_status: string | null;
    frequency_hz: number | null;
    reserve_margin_pct: number | null;
    observed_at: string | null;
  };
  demand_response: {
    active: boolean;
    /** required load cap while a DR call is live */
    cap_kw: number | null;
    /** headroom under the cap: cap - (ev + building). null when either unknown. */
    headroom_kw: number | null;
  };
}

// ── depot_ops ───────────────────────────────────────────────────────────────

export interface StallSignal {
  id: string;
  code: string | null;
  type: string | null;
  zone: string | null;
  status: string;
  vehicle_id: string | null;
  connector_kw: number | null;
  /** true when the stall is in the layout but absent from the status feed */
  assumed_available: boolean;
}

export interface StallTypeCapacity {
  type: string;
  total: number;
  occupied: number;
  available: number;
  offline: number;
  utilization: number;
}

export interface DepotOpsPayload {
  depot_id: string | null;
  stalls: StallSignal[];
  capacity: {
    total: number;
    occupied: number;
    available: number;
    offline: number;
    utilization: number;
    by_type: StallTypeCapacity[];
  };
  queue: {
    /** vehicles at the gate or queued — the demand pressure on the depot */
    waiting: number;
    /** vehicles mid-service across all stall types */
    in_service: number;
    /** waiting / available stalls; null when no stalls are available (unbounded) */
    pressure_ratio: number | null;
  };
  incidents_open: number | null;
  dispatches_active: number | null;
  dispatches_total: number | null;
  /**
   * Per-vehicle service timing. EMPTY in contract 1.0 — the twin does not yet
   * publish per-visit service start/expected-end on the snapshot. Declared here
   * so the shape is fixed and the gap is visible rather than silently absent.
   * See docs/OTTO-Q-WORLD-CONTRACT.md → "Service timing is not observable".
   */
  service_timers: ServiceTimer[];
}

/**
 * One in-flight service leg. Shape verified against `ottoq_itinerary_legs` on
 * the live backend — see supabase/proposed/001_decision_frame_channels.sql.
 *
 * `service` is the real classifier (charge_l2, charge_dcfc, detail, service,
 * inspect, interior_tidy, sensor_clean, …). `duration_basis` is separate and
 * says how the estimate was DERIVED, which is what tells OTTO-Q how much to
 * trust it:
 *   charge_curve   a physical charge model — `charge` below is populated
 *   distribution   sampled from a fitted real-world corpus
 *   flow_contract  a policy or contract, not a measurement
 */
export interface ServiceTimer {
  vehicle_id: string;
  stall_id: string | null;
  service: string;
  /** service atom or hold reason: interior_deep_clean, fault_repair, … */
  detail: string | null;
  duration_basis: "charge_curve" | "distribution" | "flow_contract" | string | null;
  status: string;
  started_sim: string | null;
  expected_end_sim: string | null;
  planned_s: number | null;
  elapsed_s: number | null;
  remaining_s: number | null;
  /** populated only on charge legs; null on every other service */
  charge: {
    start_soc: number | null;
    target_soc: number | null;
    charger_kw: number | null;
    vehicle_kw: number | null;
    pack_kwh: number | null;
    battery_temp_c: number | null;
  } | null;
}

// ── charger_systems ─────────────────────────────────────────────────────────

export interface ChargerSignal {
  stall_id: string;
  code: string | null;
  type: string | null;
  rated_kw: number | null;
  status: string;
  vehicle_id: string | null;
  /** true when the stall's status indicates a fault/offline condition */
  faulted: boolean;
}

export interface ChargerSystemsPayload {
  chargers: ChargerSignal[];
  fleet_capacity_kw: number | null;
  /** rated kW of chargers currently delivering (status = charging) */
  committed_kw: number | null;
  counts: {
    total: number;
    charging: number;
    available: number;
    faulted: number;
  };
  sessions_total: number | null;
  /**
   * Per-charger OCPP health (state, error code, boot/heartbeat age). EMPTY in
   * contract 1.0 — ottoq_ocpp_chargers is not on the snapshot. Declared so the
   * gap is legible to OTTO-Q rather than looking like "all chargers healthy".
   */
  ocpp: ChargerOcppHealth[];
}

export interface ChargerOcppHealth {
  charger_id: string;
  station_state: string | null;
  error_code: string | null;
  last_heartbeat_sim: string | null;
  health_score: number | null;
}

// ── environment ─────────────────────────────────────────────────────────────

export interface EnvironmentPayload {
  temp_c: number | null;
  cloud_pct: number | null;
  conditions: string | null;
  precip_state: string | null;
  ghi_wm2: number | null;
  wind_kmh: number | null;
  solar_elevation_deg: number | null;
  observed_at: string | null;
  /** derived: is the sun above the horizon at this frame */
  daylight: boolean | null;
}

// ── bundle ──────────────────────────────────────────────────────────────────

export type ChannelBundleStatus = "ready" | "degraded" | "not_ready";

export interface ChannelBundle {
  contract_version: string;
  sim_run_id: string;
  tick: number;
  sim_clock: string | null;
  emitted_at: string;
  /**
   * ready     — every REQUIRED channel is `ok`
   * degraded  — every REQUIRED channel is present but at least one is `degraded`
   * not_ready — a REQUIRED channel is `missing`; do not orchestrate on this frame
   */
  status: ChannelBundleStatus;
  channels: {
    fleet_telemetry: ChannelEnvelope<FleetTelemetryPayload>;
    energy_grid: ChannelEnvelope<EnergyGridPayload>;
    depot_ops: ChannelEnvelope<DepotOpsPayload>;
    charger_systems: ChannelEnvelope<ChargerSystemsPayload>;
    environment: ChannelEnvelope<EnvironmentPayload>;
  };
}

// ── helpers shared by the packer and its tests ──────────────────────────────

/** present/missing → an integrity record. Keeps the arithmetic in one place. */
export function buildIntegrity(
  present: string[],
  missing: string[],
  sources: string[],
  notes: string[] = [],
): ChannelIntegrity {
  const total = present.length + missing.length;
  const completeness = total === 0 ? 0 : Math.round((present.length / total) * 1000) / 1000;
  const status: ChannelStatus =
    present.length === 0 ? "missing" : missing.length === 0 ? "ok" : "degraded";
  return { status, present, missing, completeness, sources, notes };
}

/**
 * Sim-seconds between an observation stamp and the world clock. Returns null if
 * either is unparseable — an unknown age must never read as "fresh".
 */
export function stalenessSeconds(
  observedAt: string | null | undefined,
  simClock: string | null | undefined,
): number | null {
  if (!observedAt || !simClock) return null;
  const o = Date.parse(observedAt);
  const c = Date.parse(simClock);
  if (!Number.isFinite(o) || !Number.isFinite(c)) return null;
  return Math.max(0, Math.round((c - o) / 1000));
}
