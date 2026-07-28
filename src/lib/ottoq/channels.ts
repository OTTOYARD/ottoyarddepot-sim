// ============================================================================
// channels — pack the twin's single render-shaped snapshot into the five
// OTTO-Q channel packets defined in contracts.ts.
//
// Pure functions, no I/O, no store reads: snapshot in, packets out. That makes
// the contract testable frame-by-frame and lets the same packer run in the
// browser, in an edge function, or in a replay harness over a Black Box bundle.
//
// TWO STRUCTURAL FACTS ABOUT THE SNAPSHOT DRIVE THIS FILE:
//
//   1. `stalls_status` is a PARTIAL feed. ottoq_twin_snapshot filters it to
//      `status <> 'available'` to keep the payload light. So stall inventory
//      MUST come from the layout, with anything absent from the status feed
//      marked `assumed_available` — an inference, flagged as one, never
//      laundered into an observation.
//
//   2. `energy`, `weather` and `grid` are single LATEST rows, not per-tick
//      values. They can lag the world clock (or be absent entirely at tick 0).
//      Every one of them therefore carries its own staleness, computed against
//      the sim clock rather than wall time.
// ============================================================================

import type { TwinEventsWindow, TwinFleetCondition, TwinLaborWindow, TwinLayout, TwinOffsiteWindow, TwinRunContext, TwinSnapshot, TwinStall, TwinWearWindow } from "@/lib/ottoTwin";
import {
  buildIntegrity,
  stalenessSeconds,
  CHANNEL_CONTRACT_VERSION,
  REQUIRED_CHANNELS,
  type ChannelBundle,
  type ChannelBundleStatus,
  type ChannelEnvelope,
  type ChannelId,
  type ChargerReliability,
  type ChargerSignal,
  type ChargerSystemsPayload,
  type DemandForecast,
  type DepotOpsPayload,
  type LaborPayload,
  type DepotReliability,
  type ObservedCharging,
  type EnergyGridPayload,
  type EnvironmentPayload,
  type FleetTelemetryPayload,
  type FleetVehicleSignal,
  type OffsitePayload,
  type PolicyPayload,
  type WearPayload,
  type ServiceStage,
  type ServiceTimer,
  type StallSignal,
  type StallTypeCapacity,
} from "./contracts";

// ── state → stage vocabulary ────────────────────────────────────────────────
// THIS MAP IS THE `vehicle_state` ENUM, VERBATIM. All 17 values, read from
// pg_enum on the live backend. Do not add speculative aliases here.
//
// The first version of this file was written from guesswork — plausible names
// like "charging", "queued", "departing". Only FOUR of them existed. Both real
// charging states (`charging_dcfc`, `charging_l2`) fell through to "unknown",
// so `counts_by_stage.charging` was permanently 0, `queue.waiting` was
// permanently 0, and the charge advisor — which filters on at_gate/queued —
// could never propose anything at all. The channel looked healthy and reported
// a fleet that was doing nothing.
//
// That is the same failure as the `dwell` filter in the proposed migration:
// a guess about VALUES sails through every type check and quietly returns
// nothing. When this enum gains a value, the new state lands in "unknown" and
// is reported via `stage_unmapped` + a channel note — visible, not silent.
const STATE_TO_STAGE: Record<string, ServiceStage> = {
  // not at the depot / not usable
  offline: "off_site",
  deployed: "off_site",
  en_route_to_deployment: "departing",
  en_route_to_depot: "inbound",
  // at the depot, awaiting disposition
  arrived_at_gate: "at_gate",
  staged_awaiting_service: "queued",
  // receiving energy
  charging_dcfc: "charging",
  charging_l2: "charging",
  // receiving a service
  in_wash_bay: "servicing",
  in_detail_bay: "servicing",
  in_service_bay: "servicing",
  // done, holding a stall, ready to move on
  charge_complete_holding: "staged",
  service_complete_holding: "staged",
  staged_for_departure: "staged",
  // present but NOT assignable — must never be counted as available capacity
  emergency_staged: "out_of_service",
  tow_requested: "out_of_service",
  out_of_service: "out_of_service",
};

const ALL_STAGES: ServiceStage[] = [
  "off_site", "inbound", "at_gate", "queued", "moving",
  "charging", "servicing", "staged", "departing", "out_of_service", "unknown",
];

// ── stall status vocabulary ─────────────────────────────────────────────────
// The backend `stalls.status` only ever holds 'available' or 'occupied'
// (verified against the live table). It carries NO charging or fault state.
//
// The renderer's own store uses a richer set (charging / servicing / offline /
// reserved), and the first version of this file matched on THOSE — so
// `counts.charging` and `counts.faulted` were structurally always 0.
// Both are now derived instead: charging from the vehicle occupying the stall,
// faults not at all (see packChargerSystems).
const OCCUPIED_STATUSES = new Set(["occupied", "reserved", "charging", "servicing"]);
/** Statuses meaning "cannot accept a vehicle". The backend emits none of these
 *  today; kept so a renderer-sourced status is still classified correctly. */
const OFFLINE_STATUSES = new Set(["offline", "faulted", "fault", "out_of_service", "maintenance"]);
/** Vehicle stages that mean the vehicle is drawing power at its stall. */
const CHARGING_STAGES = new Set<ServiceStage>(["charging"]);

export function normalizeStage(state: string | null | undefined): {
  stage: ServiceStage;
  unmapped: boolean;
} {
  if (!state) return { stage: "unknown", unmapped: true };
  const key = String(state).trim().toLowerCase();
  const hit = STATE_TO_STAGE[key];
  return hit ? { stage: hit, unmapped: false } : { stage: "unknown", unmapped: true };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

/** Track which required fields resolved, so integrity is derived not asserted. */
class FieldTracker {
  readonly present: string[] = [];
  readonly missing: string[] = [];
  /** Records `path` as present when `value` is non-null, missing otherwise. */
  take<T>(path: string, value: T | null): T | null {
    if (value === null || value === undefined) this.missing.push(path);
    else this.present.push(path);
    return value ?? null;
  }
}

interface EnvelopeMeta {
  sim_run_id: string;
  scenario: string;
  seed: number;
  tick: number;
  sim_clock: string | null;
  emitted_at: string;
}

function envelope<T>(
  channel: ChannelId,
  meta: EnvelopeMeta,
  staleness_s: number | null,
  tracker: FieldTracker,
  sources: string[],
  notes: string[],
  payload: T,
): ChannelEnvelope<T> {
  return {
    channel,
    contract_version: CHANNEL_CONTRACT_VERSION,
    sim_run_id: meta.sim_run_id,
    scenario: meta.scenario,
    seed: meta.seed,
    tick: meta.tick,
    sim_clock: meta.sim_clock,
    emitted_at: meta.emitted_at,
    staleness_s,
    integrity: buildIntegrity(tracker.present, tracker.missing, sources, notes),
    payload,
  };
}

// ── fleet_telemetry ─────────────────────────────────────────────────────────

export function packFleetTelemetry(
  snap: TwinSnapshot,
  meta: EnvelopeMeta,
  condition?: TwinFleetCondition | null,
  offsite?: TwinOffsiteWindow | null,
  wear?: TwinWearWindow | null,
): ChannelEnvelope<FleetTelemetryPayload> {
  const t = new FieldTracker();
  const notes: string[] = [];
  const raw = snap.fleet?.vehicles ?? [];

  // Per-vehicle condition is dealt ONCE at run boot and constant thereafter, so
  // it arrives on its own feed and is joined on here rather than re-shipped
  // every tick. Key on vehicle_id; the fleet rows and the condition rows come
  // from the same `vehicles` table so the ids are the same ids.
  const condById = new Map(
    (condition?.vehicles ?? []).map((c) => [String(c.vehicle_id), c]),
  );

  const vehicles: FleetVehicleSignal[] = raw.map((v) => {
    const { stage, unmapped } = normalizeStage(v.state);
    const c = condById.get(String(v.id));
    return {
      id: String(v.id),
      av_id: str(v.av_id),
      oem: str(v.make),
      platform: str(v.platform),
      state: String(v.state ?? ""),
      stage,
      soc_pct: num(v.soc),
      stall_id: str(v.stall_id),
      stage_unmapped: unmapped,
      condition: c
        ? {
            battery_soh_pct: num(c.battery_soh_pct),
            consumption_scalar: num(c.consumption_scalar),
            charge_curve_scalar: num(c.charge_curve_scalar),
            soil_rate: num(c.soil_rate),
            pm_interval_km: num(c.pm_interval_km),
            calib_interval_h: num(c.calib_interval_h),
            service_speed_scalar: num(c.service_speed_scalar),
            wash_cadence_cycles: num(c.wash_cadence_cycles),
            cycles_since_wash: num(c.cycles_since_wash),
            wash_due_ratio: num(c.wash_due_ratio),
          }
        : null,
    };
  });

  const matchedCondition = vehicles.filter((v) => v.condition !== null).length;
  t.take("fleet.condition", condition ? matchedCondition || null : null);
  if (!condition) {
    notes.push("fleet condition not fetched — the 8 per-vehicle veh_* attributes are unobservable on this frame");
  } else if (matchedCondition === 0 && raw.length > 0) {
    notes.push(
      `fleet condition fetched but NONE of the ${raw.length} vehicles matched — ` +
      `the condition feed describes a different fleet (depot mismatch?)`,
    );
  } else if (matchedCondition < raw.length) {
    notes.push(`${raw.length - matchedCondition} of ${raw.length} vehicles carry no drawn condition`);
  }
  if (condition?.drawn_for_this_run === false) {
    notes.push(
      "FLEET CONDITION BELONGS TO ANOTHER RUN: vehicles.config was drawn for " +
      `${(condition.drawn_run_ids ?? []).join(", ") || "an unknown run"}. ` +
      "This run is not reproducible from its seed.",
    );
  }

  const unmapped = [...new Set(vehicles.filter((v) => v.stage_unmapped).map((v) => v.state))];
  if (unmapped.length) {
    notes.push(`unmapped vehicle states (add to STATE_TO_STAGE): ${unmapped.join(", ")}`);
  }

  const counts_by_stage = Object.fromEntries(ALL_STAGES.map((s) => [s, 0])) as Record<
    ServiceStage,
    number
  >;
  for (const v of vehicles) counts_by_stage[v.stage]++;

  const socs = vehicles.map((v) => v.soc_pct).filter((s): s is number => s !== null).sort((a, b) => a - b);
  const soc = {
    reporting: socs.length,
    missing: vehicles.length - socs.length,
    min: socs.length ? socs[0] : null,
    p50: socs.length ? socs[Math.floor((socs.length - 1) / 2)] : null,
    mean: socs.length ? Math.round((socs.reduce((a, b) => a + b, 0) / socs.length) * 10) / 10 : null,
    max: socs.length ? socs[socs.length - 1] : null,
    below_20: socs.filter((s) => s < 20).length,
  };

  // Required fields: the engine cannot schedule without a fleet roster and SoC.
  t.take("fleet.vehicles", vehicles.length > 0 ? vehicles.length : null);
  t.take("fleet.counts", Object.keys(snap.fleet?.counts ?? {}).length > 0 ? 1 : null);
  t.take("fleet.soc", socs.length > 0 ? socs.length : null);
  t.take("fleet.stall_binding", vehicles.some((v) => v.stall_id !== null) ? 1 : null);

  if (soc.missing > 0) notes.push(`${soc.missing} vehicle(s) reported no SoC`);

  // ── OFF-SITE ─────────────────────────────────────────────────────────────
  // The depot-scoped feeds go blind the moment a vehicle leaves. This is the
  // other half of the fleet, and the headline is that the PLAN IS NOT WHAT
  // HAPPENS — trips run ~3.6x their planned duration and most vehicles return
  // because the battery forces them to, not because a schedule said so.
  const offsitePayload: OffsitePayload | null = offsite
    ? {
        dispatches: offsite.dispatches,
        off_site_now: offsite.off_site_now,
        duration: offsite.duration,
        activity: offsite.activity,
        soc: offsite.soc,
        arrival_jitter_min_p50: offsite.arrival_jitter_min_p50,
        arrival_jitter_delayed_n: offsite.arrival_jitter_delayed_n ?? 0,
        arrival_jitter_min_max: offsite.arrival_jitter_min_max ?? null,
        by_return_trigger: offsite.by_return_trigger ?? {},
      }
    : null;
  t.take("fleet.offsite", offsite ? offsite.dispatches?.total ?? null : null);
  if (!offsite) {
    notes.push("off-site feed not fetched — trip duration and drive activity are unobservable on this frame");
  } else if ((offsite.dispatches?.completed ?? 0) === 0) {
    notes.push("no completed trips yet — trip statistics describe nothing until a vehicle returns");
  }
  // A plan that is wrong by more than half is worth saying out loud: an
  // orchestrator that pre-stages for the planned return will staff for a fleet
  // that is not coming.
  if (offsite?.duration?.ratio_p50 != null && offsite.duration.ratio_p50 > 1.5) {
    notes.push(
      `trips run ${offsite.duration.ratio_p50}x their planned duration ` +
      `(${offsite.duration.overran_plan} of ${offsite.dispatches.completed} overran) — ` +
      "planned_duration_min is not a usable predictor",
    );
  }
  if (offsite?.arrival_jitter_delayed_n) {
    notes.push(
      `${offsite.arrival_jitter_delayed_n} of ${offsite.dispatches.completed} arrivals carried jitter ` +
      `(max ${offsite.arrival_jitter_min_max} min) — the p50 of ${offsite.arrival_jitter_min_p50} hides the tail`,
    );
  }

  // ── WEAR / SERVICE DUE ───────────────────────────────────────────────────
  // The drawn intervals are already on each vehicle's condition; this is the
  // progress against them, plus open DTCs. Note the DTC rank is republished
  // with its sentinel removed — see WearPayload.
  const wearPayload: WearPayload | null = wear
    ? { fleet_size: wear.fleet_size, wear: wear.wear, due: wear.due,
        dtc: wear.dtc, attention: wear.attention ?? [] }
    : null;
  t.take("fleet.wear", wear ? wear.fleet_size || null : null);
  if (!wear) {
    notes.push("wear feed not fetched — DTCs and service-due state are unobservable on this frame");
  } else {
    if (wear.due?.pm_overdue) notes.push(`${wear.due.pm_overdue} vehicle(s) past their drawn PM interval`);
    if (wear.dtc?.open_total) {
      notes.push(
        `${wear.dtc.open_total} open DTC(s) on ${wear.dtc.vehicles_with_open} vehicle(s), ` +
        `worst rank ${wear.dtc.worst_rank} (lower is worse)`,
      );
    }
  }

  const payload: FleetTelemetryPayload = {
    offsite: offsitePayload,
    wear: wearPayload,
    fleet_size: Number(snap.fleet?.total ?? vehicles.length),
    counts_by_state: (snap.fleet?.counts ?? {}) as Record<string, number>,
    counts_by_stage,
    vehicles,
    soc,
    telemetry_packets_total: num(snap.counters?.telemetry_packets),
    condition_spread: condition?.spread ?? null,
    condition_provenance: condition
      ? {
          with_condition: condition.with_condition,
          drawn_for_this_run: condition.drawn_for_this_run,
        }
      : null,
  };

  // Vehicle rows are read live off the depot, not stamped per observation, so
  // the whole channel is exactly as fresh as the tick that produced it.
  return envelope("fleet_telemetry", meta, 0, t, ["vehicles", "ottoq_telemetry_packets"], notes, payload);
}

// ── energy_grid ─────────────────────────────────────────────────────────────

export function packEnergyGrid(
  snap: TwinSnapshot,
  meta: EnvelopeMeta,
): ChannelEnvelope<EnergyGridPayload> {
  const t = new FieldTracker();
  const notes: string[] = [];
  const e = (snap.energy ?? {}) as Record<string, unknown>;
  const b = (snap.bess ?? {}) as Record<string, unknown>;
  const g = (snap.grid ?? {}) as Record<string, unknown>;

  if (!snap.energy) notes.push("no site_energy_snapshots row within this run's sim window");
  if (!snap.grid) notes.push("no ottoq_grid_snapshots row for this run");

  const grid_import_kw = t.take("site.grid_import_kw", num(e.grid_import_kw));
  const grid_export_kw = t.take("site.grid_export_kw", num(e.grid_export_kw));
  const solar_kw = t.take("site.solar_kw", num(e.solar_kw));
  const bess_output_kw = t.take("site.bess_output_kw", num(e.bess_output_kw));
  const ev_charging_kw = t.take("site.ev_charging_kw", num(e.ev_charging_kw));
  const building_kw = t.take("site.building_kw", num(e.building_kw));
  const peak_15min_kw = num(e.peak_15min_kw);
  const energyAt = str(e.at);

  const net_grid_kw =
    grid_import_kw === null || grid_export_kw === null ? null : grid_import_kw - grid_export_kw;

  // Conservation check: supply - draw should be ~0. Publishing the residual
  // makes an unbalanced site model visible instead of quietly wrong.
  const supplyKnown = [grid_import_kw, solar_kw, bess_output_kw].every((v) => v !== null);
  const drawKnown = [grid_export_kw, ev_charging_kw, building_kw].every((v) => v !== null);
  const balance_residual_kw =
    supplyKnown && drawKnown
      ? Math.round(
          ((grid_import_kw! + solar_kw! + bess_output_kw!) -
            (grid_export_kw! + ev_charging_kw! + building_kw!)) * 10,
        ) / 10
      : null;
  if (balance_residual_kw !== null && Math.abs(balance_residual_kw) > 25) {
    notes.push(`site power balance residual ${balance_residual_kw} kW — model does not close`);
  }

  const bess_soc = t.take("bess.soc_pct", num(b.soc_pct));
  const lmp = t.take("grid.lmp_usd_mwh", num(g.lmp_usd_mwh));
  const tariff_label = t.take("tariff.label", str(e.tariff) ?? str(g.tariff));
  const rate_per_kwh = t.take("tariff.rate_per_kwh", num(e.rate_per_kwh));

  // Unknown is not false. With no grid row there is no DR observation, and
  // asserting "no call in progress" from absent data disarms every downstream
  // protection. Tracked as a required field so the integrity record shows it.
  const dr_active = t.take<boolean>(
    "demand_response.active",
    snap.grid == null || g.dr_active === undefined || g.dr_active === null
      ? null
      : Boolean(g.dr_active),
  );
  const cap_kw = num(g.dr_cap_kw);
  const load_kw =
    ev_charging_kw === null || building_kw === null ? null : ev_charging_kw + building_kw;
  const headroom_kw = cap_kw === null || load_kw === null ? null : Math.round((cap_kw - load_kw) * 10) / 10;
  if (dr_active && cap_kw === null) notes.push("DR call active but no cap_kw published — cannot shed to a target");

  const gridAt = str(g.at);
  // The channel is only as fresh as its OLDEST constituent observation.
  const staleness = maxStaleness([
    stalenessSeconds(energyAt, meta.sim_clock),
    stalenessSeconds(gridAt, meta.sim_clock),
  ]);

  const payload: EnergyGridPayload = {
    site: {
      grid_import_kw, grid_export_kw, solar_kw, bess_output_kw,
      ev_charging_kw, building_kw, peak_15min_kw, net_grid_kw,
      balance_residual_kw, observed_at: energyAt,
    },
    bess: {
      soc_pct: bess_soc,
      power_kw: num(b.power_kw),
      state: str(b.state),
      temp_c: num(b.temp_c),
      soh_pct: num(b.soh_pct),
    },
    tariff: { label: tariff_label, rate_per_kwh },
    grid: {
      lmp_usd_mwh: lmp,
      carbon_gco2_kwh: num(g.carbon_gco2_kwh),
      voltage_status: str(g.voltage_status),
      frequency_hz: num(g.frequency_hz),
      reserve_margin_pct: num(g.reserve_margin_pct),
      observed_at: gridAt,
    },
    demand_response: { active: dr_active, cap_kw, headroom_kw },
  };

  return envelope(
    "energy_grid", meta, staleness, t,
    ["site_energy_snapshots", "ottoq_bess_units", "ottoq_grid_snapshots", "ottoq_dr_calls"],
    notes, payload,
  );
}

// ── depot_ops ───────────────────────────────────────────────────────────────

export function packDepotOps(
  snap: TwinSnapshot,
  layout: TwinLayout | null,
  meta: EnvelopeMeta,
  events?: TwinEventsWindow | null,
  labor?: TwinLaborWindow | null,
  runContext?: TwinRunContext | null,
): ChannelEnvelope<DepotOpsPayload> {
  const t = new FieldTracker();
  const notes: string[] = [];

  const layoutStalls: TwinStall[] = layout?.stalls ?? [];
  const statusById = new Map(
    (snap.stalls_status ?? []).map((s) => [String(s.id), s]),
  );

  // Reconstruct the FULL inventory from the layout. The status feed only carries
  // non-available stalls, so anything not in it is available BY INFERENCE.
  let stalls: StallSignal[];
  if (layoutStalls.length > 0) {
    stalls = layoutStalls.map((ls) => {
      const st = statusById.get(String(ls.id));
      return {
        id: String(ls.id),
        code: str(ls.code),
        type: str(ls.type),
        zone: str(ls.zone),
        status: st ? String(st.status) : "available",
        vehicle_id: st ? str(st.vehicle_id) : null,
        connector_kw: num(ls.connector_kw),
        assumed_available: !st,
      };
    });
  } else {
    // No layout yet: we can only see the non-available stalls. Report exactly
    // that — a partial inventory — rather than pretending the depot is tiny.
    stalls = (snap.stalls_status ?? []).map((s) => ({
      id: String(s.id),
      code: null, type: null, zone: null,
      status: String(s.status),
      vehicle_id: str(s.vehicle_id),
      connector_kw: null,
      assumed_available: false,
    }));
    notes.push("layout not loaded — stall inventory is PARTIAL (occupied stalls only)");
  }

  // ── LAYOUT/FLEET IDENTITY GUARD ─────────────────────────────────────────
  //
  // The stall IDs the run reports MUST resolve against the layout we were
  // handed. When they do not, every status row is silently dropped: the
  // reconstruction above marks all 150 stalls `assumed_available`, capacity
  // reads 150/150 free, `counts.charging` reads 0, and the renderer draws the
  // occupied cars nowhere. Every tracked field still resolves, so integrity
  // reports "ok" on a frame describing a depot that does not exist.
  //
  // This is exactly how it failed in practice: the client fetches the layout
  // for a HARDCODED depot while a run may belong to another one (there are two
  // seeded depots with 150 stalls each and ZERO id overlap). 25 of 25 occupied
  // stalls resolved to nothing and the frame looked healthy.
  //
  // A mismatch is now a first-class, named failure. Note the asymmetry: a
  // status feed that resolves NOTHING while claiming occupancy is a wrong
  // layout; a partial miss is a stall added or removed mid-run, which is worth
  // a note but not a channel failure.
  const statusRows = snap.stalls_status ?? [];
  const layoutIds = new Set(layoutStalls.map((s) => String(s.id)));
  const resolvedStatus = statusRows.filter((s) => layoutIds.has(String(s.id))).length;
  const layoutMatchesRun =
    layoutStalls.length === 0 || statusRows.length === 0
      ? null                                   // nothing to cross-check yet
      : resolvedStatus > 0;
  t.take("layout.matches_run", layoutMatchesRun === true ? 1 : null);
  if (layoutMatchesRun === false) {
    notes.push(
      `LAYOUT DOES NOT BELONG TO THIS RUN: 0 of ${statusRows.length} occupied stall(s) ` +
      `resolve against the ${layoutStalls.length}-stall layout for depot ` +
      `${layout?.depot?.id ?? "unknown"}. Capacity, utilization and charging counts ` +
      `on this frame describe a different depot and must not be acted on.`,
    );
  } else if (layoutMatchesRun === true && resolvedStatus < statusRows.length) {
    notes.push(
      `${statusRows.length - resolvedStatus} of ${statusRows.length} occupied stall(s) ` +
      `are absent from the layout — layout may be stale`,
    );
  }

  const isOffline = (s: StallSignal) => OFFLINE_STATUSES.has(s.status.toLowerCase());
  const isOccupied = (s: StallSignal) => OCCUPIED_STATUSES.has(s.status.toLowerCase());

  const occupied = stalls.filter(isOccupied).length;
  const offline = stalls.filter(isOffline).length;
  const available = stalls.filter((s) => !isOccupied(s) && !isOffline(s)).length;
  const usable = occupied + available;

  const byTypeMap = new Map<string, StallTypeCapacity>();
  for (const s of stalls) {
    const type = s.type ?? "unknown";
    const row = byTypeMap.get(type) ?? { type, total: 0, occupied: 0, available: 0, offline: 0, utilization: 0 };
    row.total++;
    if (isOffline(s)) row.offline++;
    else if (isOccupied(s)) row.occupied++;
    else row.available++;
    byTypeMap.set(type, row);
  }
  const by_type = [...byTypeMap.values()].map((r) => ({
    ...r,
    utilization: r.occupied + r.available > 0
      ? Math.round((r.occupied / (r.occupied + r.available)) * 1000) / 1000
      : 0,
  })).sort((a, b) => a.type.localeCompare(b.type));

  // Queue pressure comes from the fleet's normalized stages, not from stalls.
  const fleet = snap.fleet?.vehicles ?? [];
  const stages = fleet.map((v) => normalizeStage(v.state).stage);
  const waiting = stages.filter((s) => s === "at_gate" || s === "queued").length;
  const in_service = stages.filter((s) => s === "charging" || s === "servicing").length;
  const pressure_ratio = available > 0 ? Math.round((waiting / available) * 1000) / 1000 : null;
  if (available === 0 && waiting > 0) notes.push(`${waiting} vehicle(s) waiting with zero available stalls`);

  // ── SERVICE TIMERS, from the twin's timed-leg feed ────────────────────────
  //
  // This was declared-but-unfed for the whole life of the contract, on the
  // belief that the snapshot carried no per-visit timing. It does — the T3
  // render contract has published `legs` on every frame since the t3_*
  // migrations, and the client discarded them. A measured run carries ~73 legs
  // per frame.
  //
  // Filter by EXCLUDING travel rather than enumerating services: `kind` records
  // how the duration was derived (charge_curve / distribution / flow_contract /
  // travel), not what the service is. Listing services is what produced the
  // `dwell` bug that matched zero rows — a new service kind must arrive
  // included, not vanish.
  const clockMs = meta.sim_clock ? Date.parse(meta.sim_clock) : NaN;
  const legs = snap.legs ?? [];
  const serviceLegs = legs.filter(
    (l) => String(l.kind ?? "") !== "travel" && !["done", "amended", "skipped"].includes(String(l.status)),
  );
  const secondsBetween = (a: string | null, b: number) => {
    if (!a || !Number.isFinite(b)) return null;
    const t0 = Date.parse(a);
    return Number.isFinite(t0) ? Math.round((b - t0) / 1000) : null;
  };
  const service_timers: ServiceTimer[] = serviceLegs.map((l) => {
    const elapsed = secondsBetween(l.start_sim, clockMs);
    const endMs = l.end_sim ? Date.parse(l.end_sim) : NaN;
    return {
      vehicle_id: String(l.vehicle_id),
      stall_id: str(l.to_stall) ?? str(l.from_stall),
      service: String(l.leg_type ?? "unknown"),
      detail: str(l.intent),
      duration_basis: str(l.kind),
      status: String(l.status),
      started_sim: str(l.start_sim),
      expected_end_sim: str(l.end_sim),
      planned_s: num(l.duration_s),
      elapsed_s: elapsed === null ? null : Math.max(0, elapsed),
      remaining_s: Number.isFinite(endMs) && Number.isFinite(clockMs)
        ? Math.max(0, Math.round((endMs - clockMs) / 1000))
        : null,
      // charge-curve inputs are not on the snapshot's leg projection; the
      // decision-frame migration carries them. Declared null rather than
      // fabricated so the gap stays visible.
      charge: null,
    };
  });

  t.take("stalls.inventory", stalls.length > 0 ? stalls.length : null);
  t.take("stalls.types", by_type.some((r) => r.type !== "unknown") ? 1 : null);
  t.take("capacity.available", stalls.length > 0 ? available : null);
  t.take("queue.waiting", fleet.length > 0 ? waiting : null);
  t.take("service_timers", snap.legs === undefined ? null : service_timers.length);
  if (snap.legs === undefined) {
    notes.push("snapshot carried no legs array — service timing unavailable on this frame");
  } else if (service_timers.length === 0) {
    notes.push(`no service legs in flight (${legs.length} leg(s) on frame, all travel or closed)`);
  }

  // The events window is a SEPARATE fetch from the snapshot, so it can be
  // absent while everything else is fine. When it is, forecast and reliability
  // report the honest shape of "we did not look" — nulls and zero-length
  // records — and the integrity record names them, rather than the frame
  // quietly asserting a calm depot.
  const er = events?.reliability;
  const th = events?.throughput;
  t.take("events.window", events ? 1 : null);
  if (!events) notes.push("events window not fetched — reliability rates and demand forecast unavailable");
  else if (!events.demand_forecast) notes.push("run has emitted no arrival forecast yet");

  const demand_forecast: DemandForecast | null = events?.demand_forecast
    ? {
        at: str(events.demand_forecast.at),
        horizon_min: num(events.demand_forecast.horizon_min),
        incoming_count: num(events.demand_forecast.incoming_count),
        charge_needed_count: num(events.demand_forecast.charge_needed_count),
        predicted_charge_kw: num(events.demand_forecast.predicted_charge_kw),
        predicted_charge_kwh: num(events.demand_forecast.predicted_charge_kwh),
      }
    : null;

  const reliability: DepotReliability | null = er
    ? {
        arrival_delays: er.arrival_delays,
        delay_min_p50: num(er.delay_min_p50),
        delay_causes: er.delay_causes ?? {},
        delays_per_sim_hour: num(er.delays_per_sim_hour),
        stranded_recharges: er.stranded_recharges,
        tow_events: er.tow_events,
        exceptions_by_severity: er.exceptions_by_severity ?? {},
      }
    : null;

  const throughput = th
    ? {
        holds: th.valve_holds,
        held_total: num(th.held_total),
        released_total: num(th.released_total),
        cap: num(th.cap_last),
      }
    : null;

  // ── LABOR ────────────────────────────────────────────────────────────────
  // Staffing imposes concurrency limits ON TOP OF the physical stall count, and
  // OTTO-Q could not see them. The caps come from `twin.staging_overflow`,
  // which stamps what the sim actually used — so they are null until a lane is
  // first contended. That is a real distinction: "no cap observed" means the
  // lane never filled, NOT that it is unlimited.
  const laborPayload: LaborPayload | null = labor
    ? {
        staffing: labor.staffing ?? {},
        knobs: labor.knobs,
        lanes: labor.lanes,
        overflow: labor.overflow,
        backlog: labor.backlog,
      }
    : null;
  t.take("labor.staffing", labor && Object.keys(labor.staffing ?? {}).length > 0 ? 1 : null);
  t.take("labor.lane_caps", labor?.lanes?.wash_cap ?? null);
  if (!labor) {
    notes.push("labor feed not fetched — staffing-imposed lane limits are unobservable on this frame");
  } else if (labor.lanes.charge_cap != null
             && labor.lanes.charge_stalls_physical != null
             && labor.lanes.charge_cap < labor.lanes.charge_stalls_physical) {
    notes.push(
      `charge admission is staffing-capped at ${labor.lanes.charge_cap} of ` +
      `${labor.lanes.charge_stalls_physical} charge stalls — free stalls overstate ` +
      "how many vehicles can actually be put on charge",
    );
  } else if (labor.lanes.wash_cap === null) {
    notes.push(
      "no lane cap observed yet: the sim stamps effective capacity only when a lane is contended. " +
      "Absence means no contention, NOT unlimited capacity.",
    );
  }
  if (labor && labor.overflow.events > 0) {
    notes.push(
      `labor bound ${labor.overflow.events}x (${labor.overflow.vehicles_total} vehicle-waits, ` +
      `peak ${labor.overflow.vehicles_max}) — stall availability overstates real throughput`,
    );
  }

  // Which scheduling policy actually ran. `configured` is a setting; `observed`
  // comes from the policy stamped on every logged deploy decision.
  const policyPayload: PolicyPayload | null = runContext
    ? {
        configured: runContext.policy_configured ?? null,
        observed: runContext.policy_observed ?? null,
        decisions: runContext.policy_decisions ?? 0,
        variants: runContext.policy_variants ?? null,
        matches_config: runContext.policy_matches_config ?? null,
      }
    : null;
  t.take("policy.observed", policyPayload?.observed ?? null);
  if (policyPayload?.matches_config === false) {
    notes.push(
      `POLICY MISMATCH: run configured '${policyPayload.configured}' but ` +
      `${JSON.stringify(policyPayload.variants)} made the decisions — this run is not a valid ` +
      "benchmark of the configured policy",
    );
  } else if (runContext && !policyPayload?.observed) {
    notes.push("no deploy decision has been logged yet — the policy in force is unproven");
  }

  const payload: DepotOpsPayload = {
    depot_id: layout?.depot?.id ?? null,
    policy: policyPayload,
    labor: laborPayload,
    layout_matches_run: layoutMatchesRun,
    stalls,
    capacity: {
      total: stalls.length,
      occupied, available, offline,
      utilization: usable > 0 ? Math.round((occupied / usable) * 1000) / 1000 : 0,
      by_type,
    },
    queue: { waiting, in_service, pressure_ratio },
    incidents_open: num(snap.counters?.open_incidents),
    dispatches_active: num(snap.counters?.dispatches_active),
    dispatches_total: num(snap.counters?.dispatches_total),
    service_timers,
    // Server half of the render-contract coverage ratio. The twin measures how
    // far realized travel drifts from plan; that IS the observable for arrival
    // ETA delay, and it was being discarded with the rest of the leg feed.
    plan_deviation_s: num(snap.legs_meta?.median_deviation_s),
    demand_forecast,
    reliability,
    throughput,
  };

  return envelope(
    "depot_ops", meta, 0, t,
    ["stalls", "ottoq_twin_depot_layout", "vehicles", "ottoq_vehicle_dispatches",
    "ottoq_vehicle_wear",
     "ottoq_vehicle_incidents", "ottoq_itinerary_legs", "ottoq_events"],
    notes, payload,
  );
}

// ── charger_systems ─────────────────────────────────────────────────────────

/** The two `stall_type` enum values that are electrical assets. Verified
 *  against pg_enum: dcfc, l2, wash_bay, detail_bay, service_bay, staging,
 *  parking, safety. Only the first two deliver power. */
const CHARGER_TYPES = new Set(["dcfc", "l2"]);

export function packChargerSystems(
  snap: TwinSnapshot,
  layout: TwinLayout | null,
  meta: EnvelopeMeta,
  events?: TwinEventsWindow | null,
): ChannelEnvelope<ChargerSystemsPayload> {
  const t = new FieldTracker();
  const notes: string[] = [];

  const statusById = new Map((snap.stalls_status ?? []).map((s) => [String(s.id), s]));
  const layoutStalls = (layout?.stalls ?? []).filter((s) =>
    CHARGER_TYPES.has(String(s.type ?? "").toLowerCase()),
  );

  // A stall's status cannot tell us whether power is flowing — the backend only
  // says available/occupied. Derive it from the VEHICLE in the stall instead:
  // a charger is delivering when its occupant is in a charging state.
  const stageByVehicle = new Map(
    (snap.fleet?.vehicles ?? []).map((v) => [String(v.id), normalizeStage(v.state).stage]),
  );

  const chargers: ChargerSignal[] = layoutStalls.map((ls) => {
    const st = statusById.get(String(ls.id));
    const status = st ? String(st.status) : "available";
    const vehicle_id = st ? str(st.vehicle_id) : null;
    return {
      stall_id: String(ls.id),
      code: str(ls.code),
      type: str(ls.type),
      rated_kw: num(ls.connector_kw),
      status,
      vehicle_id,
      // Fault state is NOT observable on this frame — the backend keeps it in
      // ottoq_ocpp_chargers.station_state, which the snapshot does not publish.
      // Reporting `false` here would assert every charger is healthy on no
      // evidence, which is precisely the "absent rendered as zero" failure this
      // contract exists to prevent. It stays false only when a renderer-sourced
      // status positively says so; the honest unknown is carried by
      // `counts.faulted === null` and the ocpp integrity gap below.
      faulted: OFFLINE_STATUSES.has(status.toLowerCase()),
    };
  });

  const charging = chargers.filter(
    (c) => c.vehicle_id !== null && CHARGING_STAGES.has(stageByVehicle.get(c.vehicle_id) ?? "unknown"),
  );
  const ratedKnown = chargers.filter((c) => c.rated_kw !== null);

  const fleet_capacity_kw = ratedKnown.length
    ? Math.round(ratedKnown.reduce((a, c) => a + (c.rated_kw ?? 0), 0) * 10) / 10
    : null;
  const committed_kw = charging.every((c) => c.rated_kw !== null)
    ? Math.round(charging.reduce((a, c) => a + (c.rated_kw ?? 0), 0) * 10) / 10
    : null;

  if (chargers.length === 0) notes.push("no charger stalls resolved — layout missing or has no dcfc/l2 stalls");
  if (ratedKnown.length !== chargers.length) {
    notes.push(`${chargers.length - ratedKnown.length} charger(s) have no connector_kw in the layout`);
  }

  t.take("chargers.inventory", chargers.length > 0 ? chargers.length : null);
  t.take("chargers.rated_kw", ratedKnown.length > 0 ? ratedKnown.length : null);
  t.take("chargers.status", snap.stalls_status ? 1 : null);

  // Same identity guard as depot_ops — this channel performs the same join and
  // fails the same silent way, reporting every charger free and none charging.
  const statusRows = snap.stalls_status ?? [];
  const allLayoutIds = new Set((layout?.stalls ?? []).map((s) => String(s.id)));
  const layoutMatchesRun =
    allLayoutIds.size === 0 || statusRows.length === 0
      ? null
      : statusRows.some((s) => allLayoutIds.has(String(s.id)));
  t.take("layout.matches_run", layoutMatchesRun === true ? 1 : null);
  if (layoutMatchesRun === false) {
    notes.push(
      `LAYOUT DOES NOT BELONG TO THIS RUN: none of the ${statusRows.length} occupied ` +
      `stall(s) exist in depot ${layout?.depot?.id ?? "unknown"}'s layout. ` +
      `Charger occupancy and committed kW on this frame are meaningless.`,
    );
  }
  // Declared-but-unfed — see contracts.ts ChargerSystemsPayload.ocpp.
  t.take("ocpp.health", null);
  notes.push("ocpp health unavailable: ottoq_ocpp_chargers is not published on the twin snapshot");

  // PER-CHARGER health is still dark (above). POPULATION charging behaviour is
  // not: the charge-session event log carries the observed curve, the fault
  // rate and the repair burden. These are different claims and the frame now
  // makes both, separately — a healthy population statistic must never be read
  // as evidence that a particular charger is alive.
  const ec = events?.charging;
  const erel = events?.reliability;
  t.take("charging.observed", ec ? 1 : null);
  if (!events) notes.push("events window not fetched — charge curve and fault rate unavailable");
  if (ec && ec.battery_soh_pct_p50 === null && ec.sessions_started > 0) {
    notes.push("battery SoH absent from every charge session — the twin models no fleet battery health");
  }

  const observed_charging: ObservedCharging | null = ec
    ? {
        target_soc_p50: num(ec.target_soc_p50),
        soc_start_p50: num(ec.soc_start_p50),
        charge_curve_ratio_p50: num(ec.charge_curve_ratio_p50),
        battery_temp_c_p50: num(ec.battery_temp_c_p50),
        battery_soh_pct_p50: num(ec.battery_soh_pct_p50),
        sessions_started: erel?.charge_sessions ?? 0,
        sessions_completed: ec.sessions_completed,
        energy_kwh_total: num(ec.energy_kwh_total),
        avg_power_kw_p50: num(ec.avg_power_kw_p50),
        session_duration_s_p50: num(ec.session_duration_s_p50),
        auto_rerouted: ec.auto_rerouted,
      }
    : null;

  const chargerReliability: ChargerReliability | null = erel
    ? {
        sessions: erel.charge_sessions,
        faults: erel.charge_faults,
        fault_rate: num(erel.charge_fault_rate),
        fault_reasons: erel.fault_reasons ?? {},
        repair_minutes_total: num(erel.repair_minutes_total),
        faults_per_sim_hour: num(erel.faults_per_sim_hour),
      }
    : null;

  const payload: ChargerSystemsPayload = {
    chargers,
    fleet_capacity_kw,
    committed_kw,
    counts: {
      total: chargers.length,
      charging: charging.length,
      available: chargers.filter((c) => !c.faulted && !OCCUPIED_STATUSES.has(c.status.toLowerCase())).length,
      // NULL, not 0. Charger faults live in ottoq_ocpp_chargers.station_state,
      // which this frame does not carry — so the true answer is "we cannot
      // see". A 0 here would read as "no chargers are faulted" and let the
      // orchestrator keep assigning vehicles to dead hardware.
      faulted: null,
    },
    sessions_total: num(snap.counters?.charge_sessions),
    ocpp: [],
    observed_charging,
    reliability: chargerReliability,
  };

  return envelope(
    "charger_systems", meta, 0, t,
    ["stalls", "ottoq_twin_depot_layout", "ocpp_sessions", "ottoq_events"],
    notes, payload,
  );
}

// ── environment ─────────────────────────────────────────────────────────────

export function packEnvironment(
  snap: TwinSnapshot,
  meta: EnvelopeMeta,
): ChannelEnvelope<EnvironmentPayload> {
  const t = new FieldTracker();
  const notes: string[] = [];
  const w = (snap.weather ?? {}) as Record<string, unknown>;
  if (!snap.weather) notes.push("no ottoq_weather_snapshots row for this run");

  const temp_c = t.take("temp_c", num(w.temp_c));
  const cloud_pct = t.take("cloud_pct", num(w.cloud_pct));
  // Humidity: the twin recorded it on this very row all along and the snapshot
  // selected every other column. Now published (see the snapshot migration).
  const humidity_pct = t.take("humidity_pct", num(w.humidity_pct));
  const ghi_wm2 = t.take("ghi_wm2", num(w.ghi_wm2));
  const wind_kmh = t.take("wind_kmh", num(w.wind_kmh));
  const solar_elevation_deg = t.take("solar_elev_deg", num(w.solar_elev_deg));
  const observed_at = str(w.at);

  const payload: EnvironmentPayload = {
    temp_c, cloud_pct, humidity_pct,
    conditions: str(w.conditions),
    precip_state: str(w.precip),
    ghi_wm2, wind_kmh, solar_elevation_deg,
    observed_at,
    daylight: solar_elevation_deg === null ? null : solar_elevation_deg > 0,
  };

  return envelope(
    "environment", meta, stalenessSeconds(observed_at, meta.sim_clock), t,
    ["ottoq_weather_snapshots", "ottoq_solar_output"], notes, payload,
  );
}

// ── bundle ──────────────────────────────────────────────────────────────────

function maxStaleness(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? Math.max(...known) : null;
}

/**
 * Pack a twin frame into the full channel bundle.
 *
 * `now` is injectable so tests are deterministic; it is only ever used for
 * `emitted_at` (transport diagnostics), never for staleness.
 *
 * `events` comes from a second, parallel fetch (RPC `ottoq_twin_events_window`)
 * and is optional on purpose: a frame packed without it is still a valid frame,
 * it just reports its reliability and forecast blocks as NULL. Callers that
 * have it get rates; callers that do not are never told the depot is quiet.
 */
export function packChannels(
  snap: TwinSnapshot,
  layout: TwinLayout | null,
  now: Date = new Date(),
  events?: TwinEventsWindow | null,
  condition?: TwinFleetCondition | null,
  labor?: TwinLaborWindow | null,
  offsite?: TwinOffsiteWindow | null,
  wear?: TwinWearWindow | null,
  runContext?: TwinRunContext | null,
): ChannelBundle {
  const meta: EnvelopeMeta = {
    sim_run_id: String(snap.run?.sim_run_id ?? ""),
    scenario: String(snap.run?.scenario ?? ""),
    seed: Number(snap.run?.seed ?? 0),
    tick: Number(snap.run?.tick_count ?? 0),
    sim_clock: snap.run?.sim_clock ? String(snap.run.sim_clock) : null,
    emitted_at: now.toISOString(),
  };

  const channels = {
    fleet_telemetry: packFleetTelemetry(snap, meta, condition, offsite, wear),
    energy_grid: packEnergyGrid(snap, meta),
    depot_ops: packDepotOps(snap, layout, meta, events, labor, runContext),
    charger_systems: packChargerSystems(snap, layout, meta, events),
    environment: packEnvironment(snap, meta),
  };

  // Bundle status is decided by the REQUIRED channels only. A missing weather
  // row degrades realism; a missing fleet roster makes orchestration invalid.
  const requiredStatuses = REQUIRED_CHANNELS.map((id) => channels[id].integrity.status);
  const status: ChannelBundleStatus = requiredStatuses.includes("missing")
    ? "not_ready"
    : requiredStatuses.includes("degraded")
      ? "degraded"
      : "ready";

  return {
    contract_version: CHANNEL_CONTRACT_VERSION,
    sim_run_id: meta.sim_run_id,
    tick: meta.tick,
    sim_clock: meta.sim_clock,
    emitted_at: meta.emitted_at,
    status,
    channels,
  };
}
