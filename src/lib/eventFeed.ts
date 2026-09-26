// eventFeed — the Events tab's vocabulary, kept pure so it can be tested without a run.
//
// The feed is `ottoq_run_event_feed` (otto-q-core 0462): the run's events in SIM time, without the row-diff
// audit trail and the rule evaluations, with a per-tick summary collapsed into one row that says how many times
// it fired and since when. This file turns each row into words an operator reads at a glance, puts it in one of
// four domains, and says how its severity should look.

export interface RunEventRow {
  row_key: string;
  sim_at: string;
  first_sim_at: string;
  occurred_at: string | null;
  event_type: string;
  severity: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  payload: Record<string, unknown> | null;
  repeats: number;
  standing: boolean;
  clipped: boolean;
}

export type EventDomain = "charging" | "vehicles" | "depot" | "records";

export const DOMAIN_META: Record<EventDomain, { label: string; color: string }> = {
  charging: { label: "Charging", color: "#00B4A6" },
  vehicles: { label: "Vehicles", color: "#7C9CFF" },
  depot: { label: "Depot", color: "#E0B341" },
  records: { label: "Records", color: "#8A8F98" },
};

/** Records are one row per settled operation or OEM hand-off: the ledger, not the story. Off by default. */
export const DEFAULT_DOMAINS: EventDomain[] = ["charging", "vehicles", "depot"];

const VEHICLE_TYPES = new Set([
  "twin.vehicle_arrived", "ottoq.booking_interrupted", "ottoq.replan_escalated", "ottoq.visit_reopened",
  "twin.deferred_service_started", "twin.deferred_service_completed", "twin.deploy_gate_override",
  "ottoq.refusal_escalated", "twin.auto_dispatch_emit",
]);

export function eventDomain(type: string): EventDomain {
  if (type === "sdr_issued" || type === "twin.oem_webhook_emitted") return "records";
  if (type.startsWith("charge.") || type.startsWith("arm.") || type === "ottoq.charge_start_refused") return "charging";
  if (VEHICLE_TYPES.has(type) || type.startsWith("fleet.") || type.startsWith("vehicle.")) return "vehicles";
  return "depot";
}

export type EventTone = "problem" | "critical" | "normal";

/** How a row should look. Severity is the emitter's own; the feed has already dropped rule evaluations, which
 *  carried the RULE's severity and painted passing checks red. */
export function eventTone(severity: string | null | undefined): EventTone {
  const s = (severity ?? "").toLowerCase();
  if (s === "critical" || s === "error" || s === "safety_critical") return "critical";
  if (s === "warning") return "problem";
  return "normal";
}

const n = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};
const r0 = (v: unknown): string => { const x = n(v); return x === null ? "?" : String(Math.round(x)); };
const r1 = (v: unknown): string => { const x = n(v); return x === null ? "?" : (Math.round(x * 10) / 10).toString(); };
const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const words = (v: unknown): string => s(v).replace(/^fault\./, "").replace(/_/g, " ");
const join = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" · ");

export interface EventText { title: string; detail?: string }

/** One event in words. Every branch reads only the payload keys its emitter writes; anything else falls back to
 *  the event type, humanised, with the payload's first few scalars. */
export function describeEvent(type: string, payload: Record<string, unknown> | null | undefined): EventText {
  const p = payload ?? {};
  switch (type) {
    // ── charging ──
    case "charge.session_started":
      return { title: "Charging started", detail: join(s(p.charger), `${r0(p.soc_start)}% → ${r0(p.soc_target)}%`, n(p.initial_rate_kw) !== null && `${r0(p.initial_rate_kw)} kW`) };
    case "charge.session_completed":
      return { title: "Charge complete", detail: join(`${r0(p.soc_start)}% → ${r0(p.soc_end)}%`, n(p.energy_kwh) !== null && `${r1(p.energy_kwh)} kWh`, n(p.duration_s) !== null && `${r0((n(p.duration_s) ?? 0) / 60)} min`) };
    case "charge.session_faulted":
      return { title: "Charger fault ended the session", detail: join(words(p.reason), n(p.repair_minutes) !== null && `repair ${r0(p.repair_minutes)} min`, p.auto_rerouted === true && "rerouted") };
    case "ottoq.charge_start_refused":
      return { title: "Charge start refused by the shield", detail: join(Array.isArray(p.blocking_rules) ? (p.blocking_rules as unknown[]).map(String).join(", ") : "", n(p.requested_kw) !== null && `${r0(p.requested_kw)} kW asked`) };
    case "arm.mate_started": return { title: "Arm connecting" };
    case "arm.mate_latched": return { title: "Arm connected", detail: n(p.retries) ? `after ${r0(p.retries)} retries` : undefined };
    case "arm.demate_started": return { title: "Arm disconnecting" };
    case "arm.demate_cleared": return { title: "Arm clear" };
    case "arm.emergency_release": return { title: "Arm emergency release", detail: s(p.reason) || undefined };
    case "arm.move_refused": return { title: "Move refused: the arm is attached", detail: words(p.mover) || undefined };
    // ── vehicles ──
    case "twin.vehicle_arrived": return { title: "Arrived at the depot", detail: words(p.mode) || undefined };
    case "fleet.arrival_delayed": return { title: "Arrival delayed", detail: join(`+${r0(p.delay_min)} min`, words(p.cause)) };
    case "ottoq.booking_interrupted":
      return { title: "Bay visit cut short", detail: join(words(p.purpose), `${r1(p.actual_min)} of ${r0(p.planned_min)} min`, words(p.release_reason)) };
    case "ottoq.replan_escalated":
      return { title: "Re-plan escalated", detail: join(`attempt ${r0(p.attempts)} of ${r0(p.max_attempts)}`, words(p.reason)) };
    case "ottoq.visit_reopened": return { title: "Visit reopened", detail: words(p.reopen_reason) || undefined };
    case "twin.deferred_service_started": return { title: "Deferred service started", detail: words((p.item as Record<string, unknown> | undefined)?.svc) || undefined };
    case "twin.deferred_service_completed": return { title: "Deferred service done", detail: words((p.item as Record<string, unknown> | undefined)?.svc) || undefined };
    case "twin.deploy_gate_override":
      return { title: "Released past the readiness gate", detail: join(words(p.reason), n(p.held_min) !== null && `held ${r0(p.held_min)} min`) };
    case "vehicle.exception_proposed": return { title: "Exception proposed", detail: join(words(p.fault_class), words(p.disposition)) };
    case "vehicle.technician_approved": return { title: "Technician approved", detail: words(p.action) || undefined };
    case "vehicle.tow_retrieved_staged": return { title: "Towed back to staging" };
    case "ottoq.refusal_escalated":
      return { title: "Command refused", detail: join(words(p.original_refusal ?? p.reason_code), p.wanted_stall_type ? `wanted ${words(p.wanted_stall_type)}` : "") };
    case "twin.auto_dispatch_emit":
      return { title: "Sent out to work", detail: join(`${r0(p.count)} vehicle${n(p.count) === 1 ? "" : "s"}`, `${r0(p.deployed)} of ${r0(p.desired)} out`) };
    // ── depot ──
    case "twin.staging_overflow":
      return { title: "Staging over capacity", detail: join(`${r0(p.overflow)} waiting`, `wash ${r0(p.wash_cap)} · service ${r0(p.svc_cap)} bays`, n(p.escalated) ? `${r0(p.escalated)} escalated` : "") };
    case "twin.recharge_stranded": return { title: "Recharging below-floor vehicles", detail: `${r0(p.recharged)} under the ${r0(p.floor)}% floor` };
    case "ottoq.arrival_forecast":
      return { title: "Arrival forecast", detail: join(`${r0(p.incoming_count)} due in ${r0(p.horizon_min)} min`, `${r0(p.charge_needed_count)} need charge`, n(p.predicted_charge_kw) !== null && `${r0(p.predicted_charge_kw)} kW`) };
    case "twin.bay_credit_none": return { title: "Bay exit credited nothing", detail: `${r0(p.exits_crediting_nothing)} exit(s) with no work found` };
    case "ottoq.bay_reservation_replanned":
      return { title: "Bay reservations re-planned", detail: join(`released ${r0(p.released)}`, `relocated ${r0(p.relocated)}`, `deferred ${r0(p.deferred)}`) };
    case "ottoq.bay_reservation_activated_early":
      return { title: "Bay seat offered early", detail: join(`${r0(p.seated_early)} seated`, `${r0(p.declined_would_displace)} declined`) };
    case "twin.deploy_pressure_fasttrack": return { title: "Fast-tracked to deploy", detail: join(`${r0(p.fasttracked)} vehicle(s)`, `${r0(p.deployed)} of ${r0(p.target)} out`) };
    case "ottoq.indepot_approvals_decided": return { title: "In-depot approvals decided", detail: join(`${r0(p.approved)} approved`, `${r0(p.declined)} declined`) };
    case "twin.deploy_gate_summary":
      return { title: "Readiness gate", detail: join(`${r0(p.held)} held`, `${r0(p.released)} released`, n(p.escalated) ? `${r0(p.escalated)} escalated` : "", n(p.overridden) ? `${r0(p.overridden)} overridden` : "") };
    case "ottoq.rider_flag_serviced_in_depot": return { title: "Rider flag handled in the depot", detail: `${r0(p.flags_actioned)} flag(s)` };
    case "twin.solar_inverter_blip": return { title: "Solar inverter dropout", detail: join(s(p.canopy_code), `lost ${r0(p.lost_ac_kw)} kW`) };
    case "twin.grid_frequency_excursion": return { title: "Grid frequency excursion", detail: `${r1(p.frequency_hz)} Hz` };
    // The weather generator raises this for a storm, or ambient above 38 °C or below -10 °C, every tick it holds.
    case "twin.weather_anomaly": {
      const t = n(p.temp_c);
      const title = p.label === "storm" ? "Storm" : t !== null && t > 38 ? "Extreme heat" : t !== null && t < -10 ? "Extreme cold" : "Weather anomaly";
      return { title, detail: join(t !== null && `${r1(t)} °C`, words(p.label), (n(p.precip_mm_hr) ?? 0) > 0 && `${r1(p.precip_mm_hr)} mm/h`, n(p.wind_kmh) !== null && `wind ${r0(p.wind_kmh)} km/h`) };
    }
    case "sim_tick_failed": return { title: "Tick failed", detail: join(s(p.half), s(p.error)) };
    case "twin.scenario_started": return { title: "Run started", detail: words(p.scenario_code) || undefined };
    case "twin.scenario_overrides_applied": return { title: "Scenario settings applied" };
    case "twin.deployment_primed": return { title: "Fleet primed", detail: `${r0(p.count)} sent out at the start` };
    case "twin.sim_stopped_and_reset": return { title: "Run stopped" };
    // ── records ──
    case "sdr_issued": return { title: "Service record issued", detail: words(p.operation_code) || undefined };
    case "twin.oem_webhook_emitted": return { title: "OEM notified", detail: join(s(p.oem), words(p.delivery_status)) };
    default: {
      const title = type.replace(/^(twin|ottoq|charge|arm|fleet|vehicle)\./, "").replace(/[._]/g, " ");
      const scalars = Object.entries(p)
        .filter(([, v]) => typeof v === "number" || (typeof v === "string" && v.length <= 32))
        .slice(0, 3)
        .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`);
      return { title: title.charAt(0).toUpperCase() + title.slice(1), detail: scalars.join(" · ") || undefined };
    }
  }
}

/** "×408 since 02:14" for a collapsed repeat; "×408 in view" when it began before the window. */
export function repeatText(row: Pick<RunEventRow, "repeats" | "clipped" | "first_sim_at">, clock: (iso: string) => string): string | null {
  if (!row.repeats || row.repeats <= 1) return null;
  return row.clipped ? `×${row.repeats} in view` : `×${row.repeats} since ${clock(row.first_sim_at)}`;
}
