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
// 1.1.0 (2026-09-26): seed_text, the run seed exact. A 64-bit seed is not exact as a JSON number in a browser.
export const CHANNEL_CONTRACT_VERSION = "1.1.0";

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
  /** the run seed as a number: exact only below 2^53, so an operator run's 64-bit seed arrives rounded */
  seed: number;
  /** the run seed exact, as decimal text: the one to tie a packet back to its CRN stream */
  seed_text: string;
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
  /** physically present but NOT assignable — towed, awaiting tow, or withdrawn.
   *  Distinct from off_site: the vehicle occupies depot space and consumes
   *  attention, but must never be counted as available capacity. */
  | "out_of_service"
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
  /**
   * Per-vehicle condition dealt at run boot. NULL when the fleet-condition
   * feed was not fetched, or when this vehicle drew none — the fleet is NOT
   * uniform and must never be treated as uniform by omission.
   */
  condition: VehicleCondition | null;
}

/**
 * The eight `veh_*` catalog knobs, per vehicle. Every one is marked
 * `wired: true` in the registry and every one was invisible to OTTO-Q until
 * now: the twin draws them into `vehicles.config` at boot and the snapshot's
 * fleet rows drop that column.
 *
 * These do not change during a run (`lifespan = 'run'`), so they are fetched
 * once and joined onto each frame rather than re-shipped every tick.
 */
export interface VehicleCondition {
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

/** min / p50 / max / (max-min) for one attribute across the fleet. */
export interface SpreadStat {
  n: number;
  min: number | null;
  p50: number | null;
  max: number | null;
  spread: number | null;
}

/**
 * The off-site half of the fleet — trips, and why they end.
 *
 * The plan is not what happens: on measured runs the median trip runs ~3.6x its
 * planned duration, and the dominant return reason is the battery, not the
 * schedule. Reported BY RETURN TRIGGER because a single fleet-wide average
 * describes no vehicle — `low_soc_reserve` trips ran 356 min against a 58-min
 * plan while `sensor_soil` trips ran 75 against 71.
 */
export interface OffsitePayload {
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
    drift_min_p50: number | null;
    overran_plan: number;
    /** actual / planned; > 1 means trips run long */
    ratio_p50: number | null;
  };
  activity: {
    miles_p50: number | null;
    /** what `idle_fraction` moves: a vehicle that idles covers fewer miles/min */
    miles_per_trip_min_p50: number | null;
    soc_drop_pct_per_hour_p50: number | null;
    /** always "soc_delta_proxy" — the sim never writes metered trip energy */
    energy_basis: string;
  };
  soc: {
    at_dispatch_p50: number | null;
    /** the real SoC-on-arrival, measured per trip rather than over the yard */
    at_return_p50: number | null;
    at_return_p10: number | null;
    returned_below_20: number;
  };
  arrival_jitter_min_p50: number | null;
  /**
   * Arrival jitter is SPARSE — 282 of 11,274 trips carry any, but it reaches
   * 120 min when it fires. The p50 is 0 and that is true of a typical trip and
   * useless about the risk, so the count and the max travel with it. This is
   * also why `eta_delay` is NOT bound to that p50.
   */
  arrival_jitter_delayed_n: number;
  arrival_jitter_min_max: number | null;
  by_return_trigger: Record<string, {
    n: number; planned_min_p50: number | null; actual_min_p50: number | null;
    drift_min_p50: number | null; soc_at_return_p50: number | null;
  }>;
}

/**
 * Realized wear, and what it means for service due.
 *
 * Pairs with VehicleCondition: that carries the DRAWN intervals, this the
 * progress against them. "PM every 8,450 km" is inert until you know the
 * vehicle has driven 8,200 of them.
 */
export interface WearPayload {
  fleet_size: number;
  wear: {
    drive_km_p50: number | null;
    drive_hours_p50: number | null;
    soil_index_p50: number | null;
    soil_index_max: number | null;
    cabin_litter_total: number;
  };
  due: {
    /** >= 1 means overdue against that vehicle's own drawn interval */
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
    /**
     * NULL when the fleet is clean. The raw ottoq_vehicle_wear column uses 99
     * as a sentinel for "no open DTC" and runs 0 = WORST — publishing it raw
     * would read as severity 99 on a perfectly healthy fleet.
     */
    worst_rank: number | null;
    /** always "lower_is_worse"; stated because the raw scale is inverted */
    rank_scale: string;
    rank_sentinel_note: string;
    by_rank: Record<string, number>;
  };
  /** the worst-off vehicles, so the signal is actionable rather than a summary */
  attention: {
    av_id: string | null; vehicle_id: string;
    pm_due_ratio: number | null; calib_due_ratio: number | null;
    soil_index: number | null; open_dtc_count: number; worst_dtc_rank: number | null;
  }[];
}

export interface FleetTelemetryPayload {
  fleet_size: number;
  /** off-site trips; null when the feed was not fetched */
  offsite: OffsitePayload | null;
  /** realized wear and service-due state; null when the feed was not fetched */
  wear: WearPayload | null;
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
  /**
   * Fleet-wide DISPERSION of the per-vehicle condition attributes, keyed by
   * attribute. This is what the spread knobs actually move — a median alone
   * cannot show a distribution widening. NULL when condition was not fetched.
   */
  condition_spread: Record<string, SpreadStat> | null;
  /**
   * How many vehicles on this frame carry a condition, and whether it was
   * drawn for THIS run. `drawn_for_this_run === false` means the fleet is
   * wearing another run's condition — reproducibility is broken and any claim
   * about "this run's fleet" is wrong.
   */
  condition_provenance: {
    with_condition: number;
    drawn_for_this_run: boolean | null;
  } | null;
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
    /**
     * TRUE / FALSE / **NULL for "we cannot see"**.
     *
     * This was a plain boolean, and an absent grid row was published as
     * `false` — the positive assertion "no demand-response call in progress"
     * derived from no data at all. Every DR protection in the shield keys off
     * it, so a missing grid row silently disarmed all of them and the batch
     * reported zero suppressions. Unknown must be representable, or the
     * orchestrator cannot tell safety from ignorance.
     */
    active: boolean | null;
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
  /** OTTO-CHARGE ARM still mated to the car in this stall: the charge session has
   *  ENDED but the robot has not finished demating, so the vehicle may not move.
   *  Absent from the feed reads as false — never as unknown. */
  tethered: boolean;
  /** Sim-clock instant the arm finishes retracting, or null when not tethered. */
  tether_until: string | null;
}

export interface StallTypeCapacity {
  type: string;
  total: number;
  occupied: number;
  available: number;
  offline: number;
  utilization: number;
}

/**
 * The depot's LABOR constraint — concurrency limits that staffing imposes on
 * top of the physical stall count.
 *
 * `ottoq_sim_lane_capacity` turns the staffing knobs into hard limits
 * (physical x staffing_level x lane_staff) consumed by the tick, both L2
 * proposers and the itinerary planner. Understaffing does not slow a lane down,
 * it stops the lane from opening. Routing a vehicle to wash because "3 wash
 * stalls are free" is wrong when only 1 wash lane is staffed — the vehicle
 * takes the stall and waits.
 *
 * The caps here are READ from `twin.staging_overflow`, which stamps the caps
 * the sim actually used. They are therefore what the world DID, not what we
 * recomputed — and they are null until the first contention event, because an
 * uncontended lane never stamps them.
 */
export interface LaborPayload {
  /** rostered headcount by role, from ottoq_depot_staffing */
  staffing: Record<string, number>;
  /**
   * Staffing knobs in force this run. NULL means the knob was never set, which
   * `ottoq_sim_lane_capacity` treats as neutral 1.0 — `any_set` distinguishes
   * "nobody touched staffing" from "staffing is deliberately at 1.0".
   */
  knobs: {
    staffing_level: number | null;
    charging_staff: number | null;
    cleaning_staff: number | null;
    service_staff: number | null;
    deploy_staff: number | null;
    any_set: boolean;
  };
  /** effective concurrent lanes, as the sim computed them */
  lanes: {
    wash_cap: number | null;
    service_cap: number | null;
    deploy_cap: number | null;
    /**
     * Charge admission cap from `charging_staff`.
     *
     * PROVENANCE DIFFERS from the three above: those are READ from
     * twin.staging_overflow, i.e. values the sim stamped under contention.
     * There is no stamped event for charging, so this is RECOMPUTED by calling
     * ottoq_sim_lane_capacity with the arguments the tick uses. Same function,
     * same inputs — but a recomputation, not an observation, and
     * `charge_cap_basis` says so rather than letting a reader assume.
     *
     * Equal to `charge_stalls_physical` means staffing is neutral and the gate
     * is not binding.
     */
    charge_cap: number | null;
    charge_stalls_physical: number | null;
    charge_cap_basis: string | null;
    /** minutes a vehicle waits in staging before escalating */
    patience_min: number | null;
    observed_at: string | null;
  };
  /** how often labor actually bound, and how hard */
  overflow: {
    events: number;
    vehicles_total: number;
    vehicles_max: number | null;
    escalated: number;
    per_sim_hour: number | null;
  };
  /** work the depot owes, split by whether labor gates it */
  backlog: {
    started: number;
    completed: number;
    open: number;
    by_service: Record<string, { started: number; est_min_p50: number | null; requires_bay: string | null }>;
    /** bay-bound work is what labor gates; digital work runs regardless */
    bay_bound: number;
    digital: number;
    blocks_dispatch: number;
  };
}

/**
 * Which scheduling policy the world ACTUALLY ran.
 *
 * `ottoq_sim_runs.policy` is a setting; publishing it alone would let OTTO-Q
 * report a policy the world may not have used. `ottoq_deploy_log` stamps every
 * deploy decision with the policy that made it, which is evidence. Both travel,
 * plus whether they agree — a run configured `otto_q` whose decisions were all
 * stamped `greedy` is a broken benchmark, and silence would make an A/B
 * comparison meaningless.
 */
export interface PolicyPayload {
  configured: string | null;
  observed: string | null;
  decisions: number;
  variants: Record<string, number> | null;
  matches_config: boolean | null;
}

export interface DepotOpsPayload {
  depot_id: string | null;
  /** scheduling policy in force; null when run context was not fetched */
  policy: PolicyPayload | null;
  /** labor-side concurrency limits; null when the feed was not fetched */
  labor: LaborPayload | null;
  /**
   * Do the run's stall IDs resolve against the layout we were handed?
   *
   * FALSE means the layout belongs to a DIFFERENT depot than the run, and every
   * capacity/utilization/charging number on this frame is describing the wrong
   * building. NULL means there was nothing to cross-check (no layout, or no
   * occupied stalls yet). TRUE means at least one occupied stall resolved.
   *
   * This exists because the failure is otherwise invisible: an unresolvable
   * status feed silently yields a depot that looks completely empty and
   * perfectly healthy.
   */
  layout_matches_run: boolean | null;
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
   * Per-vehicle service timing, built from the twin's timed-leg feed. Was empty
   * in contract 1.0 on the mistaken belief that the snapshot carried no
   * per-visit timing — it has published `legs` all along.
   */
  service_timers: ServiceTimer[];
  /**
   * Median drift between planned and realized travel, seconds; negative = early.
   * The twin computes this itself (legs_meta.median_deviation_s) and it is the
   * only ETA-quality signal on the frame.
   */
  plan_deviation_s: number | null;
  /**
   * The twin's own look-ahead, from `ottoq.arrival_forecast`. NULL when the run
   * has not emitted one. This is the only forward-looking signal on any frame —
   * everything else describes the world as it already is, which is too late to
   * pre-position against.
   */
  demand_forecast: DemandForecast | null;
  /**
   * Depot-level reliability, aggregated run-to-date from the event log.
   *
   * NULL — not a zeroed record — when the events window was not fetched. The
   * counts inside are honest zeros only once we have actually looked; a record
   * of zeros on an unfetched window would assert a calm depot on no evidence,
   * which is the exact failure this contract exists to prevent.
   */
  reliability: DepotReliability | null;
  /** the rush valve: how hard the depot throttles its own intake. NULL = not fetched. */
  throughput: {
    holds: number;
    held_total: number | null;
    released_total: number | null;
    /** last observed concurrent-intake cap */
    cap: number | null;
  } | null;
}

export interface DemandForecast {
  at: string | null;
  horizon_min: number | null;
  incoming_count: number | null;
  charge_needed_count: number | null;
  predicted_charge_kw: number | null;
  predicted_charge_kwh: number | null;
}

/**
 * Counts are run-to-date; `*_per_sim_hour` normalizes them so a 2-hour run and
 * a 24-hour run are comparable. Rates are NULL when the sim clock never
 * advanced — a rate over zero elapsed time is not zero, it is undefined.
 */
export interface DepotReliability {
  arrival_delays: number;
  delay_min_p50: number | null;
  delay_causes: Record<string, number>;
  delays_per_sim_hour: number | null;
  stranded_recharges: number;
  /** vehicles towed in rather than driven in — the breakdown signal */
  tow_events: number;
  exceptions_by_severity: Record<string, number>;
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
    /** derived from the occupying vehicle's state, not the stall status —
     *  the backend's stall status carries no power information */
    charging: number;
    available: number;
    /** NULL when fault state is not observable on this frame. Never 0-as-unknown. */
    faulted: number | null;
  };
  sessions_total: number | null;
  /**
   * Per-charger OCPP health (state, error code, boot/heartbeat age). EMPTY in
   * contract 1.0 — ottoq_ocpp_chargers is not on the snapshot. Declared so the
   * gap is legible to OTTO-Q rather than looking like "all chargers healthy".
   */
  ocpp: ChargerOcppHealth[];
  /**
   * What charging ACTUALLY did this run, aggregated from the charge-session
   * event log. `ocpp` above is per-charger health and is still empty; this is
   * the population-level behaviour, and it is the only place a charge curve or
   * a fault rate reaches OTTO-Q.
   *
   * NULL when the events window was not fetched, for the same reason
   * `DepotOpsPayload.reliability` is nullable: a record of zeros would claim we
   * looked and saw nothing.
   */
  observed_charging: ObservedCharging | null;
  /** charger fault rate and repair burden, run-to-date. NULL = not fetched. */
  reliability: ChargerReliability | null;
}

export interface ObservedCharging {
  /** median SoC the fleet is actually charging TO — not the policy target */
  target_soc_p50: number | null;
  soc_start_p50: number | null;
  /**
   * initial_rate_kw / max_rate_kw. How far off nameplate vehicles actually
   * pull: the charge-curve scalar OBSERVED rather than declared. 1.0 means the
   * fleet hits rated power; 0.84 means it does not.
   */
  charge_curve_ratio_p50: number | null;
  battery_temp_c_p50: number | null;
  /**
   * NULL, always, on contract 1.1. The twin emits the key on every session and
   * never populates it, so there is no fleet battery health anywhere in the
   * world model. Published as NULL so the absence is a fact OTTO-Q can read
   * instead of a field nobody notices is missing.
   */
  battery_soh_pct_p50: number | null;
  sessions_started: number;
  sessions_completed: number;
  energy_kwh_total: number | null;
  avg_power_kw_p50: number | null;
  session_duration_s_p50: number | null;
  /** sessions the twin moved to a different charger mid-flight */
  auto_rerouted: number;
}

export interface ChargerReliability {
  sessions: number;
  faults: number;
  /** faults / sessions; NULL when no session ever started — no denominator */
  fault_rate: number | null;
  fault_reasons: Record<string, number>;
  /** total charger downtime the depot is carrying, minutes */
  repair_minutes_total: number | null;
  faults_per_sim_hour: number | null;
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
  /**
   * Relative humidity. The twin recorded this for 8,553 rows (30.7-99.3%) while
   * ottoq_twin_snapshot selected every other column of that same row — so it
   * shaped fog/visibility and perception faults while being unobservable for
   * want of one line.
   */
  humidity_pct: number | null;
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
