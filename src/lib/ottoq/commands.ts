// ============================================================================
// OTTO-Q OUTBOUND COMMAND CONTRACT — the single wire out of the orchestrator.
//
// contracts.ts defines what flows INTO OTTO-Q (five channels of world state).
// This file defines the one thing that flows OUT: orchestration directives.
//
// ── THE DOCTRINE ────────────────────────────────────────────────────────────
// OTTO-Q ORCHESTRATES. IT NEVER ACTUATES.
//
// It says "vehicle AV-14 is assigned stall D-07, arrive between 14:10 and
// 14:25". It does NOT say where the car is, how fast to drive, or which path to
// take. The twin's motion system owns all of that, exactly as a real AV's own
// autonomy stack would. Same for energy: OTTO-Q says "discharge the battery
// starting in 20 minutes, demand is peaking" — the site energy controller
// decides ramp rate, converter setpoints, and thermal limits.
//
// This is not a style preference. It is what makes the simulator a valid
// rehearsal for the real thing: on demo day the identical envelope goes to a
// real OEM fleet API and a real energy management system, both of which will
// accept an intent and reject an actuation.
//
// The doctrine is ENFORCED, not just documented. Every command is validated
// against FORBIDDEN_ACTUATION_KEYS before it can be issued (see shield.ts).
// A directive carrying a waypoint, a heading, a velocity or an instantaneous
// converter setpoint is rejected at the gate.
//
// ── WIRE REALISM ────────────────────────────────────────────────────────────
// Each command class is shaped after the protocol its real-world counterpart
// actually speaks, so the twin rehearses a real integration:
//
//   vehicle.*   fleet dispatch API — JSON command envelope, idempotency key,
//               issued/expires window, async ack then terminal status. This is
//               the shape OEM partner APIs use for remote task assignment.
//   energy.*    OpenADR 2.0b event semantics — an event has an id, a
//               modification number, a signal (what is being asked), and one
//               or more intervals (when, and at what level). Utilities and
//               energy management systems already speak this.
//   charger.*   OCPP 2.0.1 smart charging — a charging PROFILE (a ceiling over
//               a period), not a power setpoint. A charger is told the most it
//               may draw, and negotiates the rest itself.
//   depot.*     work-order semantics — an instruction to an operations queue.
//
// ── LIFECYCLE ───────────────────────────────────────────────────────────────
//   issued → delivered → accepted → executing → completed
//                     ↘ rejected
//                     ↘ expired          (window passed, never accepted)
//                     ↘ superseded       (a newer command replaced it)
//
// A command is never silently dropped. Every terminal state is recorded with a
// reason, because "what did OTTO-Q tell the fleet, and did the fleet do it" is
// the question an OEM will ask first.
// ============================================================================

/** Bump MINOR for additive fields, MAJOR for any removal or semantic change. */
export const COMMAND_CONTRACT_VERSION = "1.0.0";

export type CommandClass =
  | "vehicle.orchestration"
  | "energy.orchestration"
  | "charger.orchestration"
  | "depot.orchestration";

/**
 * `advisory`  — the executor may decline (a vehicle mid-manoeuvre, a battery
 *               at a thermal limit). This is the default and the honest one.
 * `directive` — the executor is expected to comply barring a safety fault.
 *
 * Neither authorizes actuation. Both are still statements of intent; the
 * difference is only how much latitude the executor has to say no.
 */
export type CommandAuthority = "advisory" | "directive";

export type CommandStatus =
  | "issued" | "delivered" | "accepted" | "executing"
  | "completed" | "rejected" | "expired" | "superseded";

export const TERMINAL_STATUSES: CommandStatus[] = [
  "completed", "rejected", "expired", "superseded",
];

// ── intents ─────────────────────────────────────────────────────────────────

export type VehicleIntent =
  /** this vehicle is assigned this stall; arrive within the window */
  | "assign_stall"
  /** stay where you are until the window opens */
  | "hold"
  /** your service is done; you are free to move to the next stage */
  | "release"
  /** leave the depot within the window */
  | "depart"
  /** return to the queue; your prior assignment is withdrawn */
  | "requeue"
  /** stop the current service early (charger fault, incident, DR event) */
  | "abort_service";

export type EnergyIntent =
  /** import to the battery — cheap power, surplus solar */
  | "charge_bess"
  /** export from the battery — expensive power, peak demand, DR call */
  | "discharge_bess"
  /** neither; hold state of charge */
  | "hold_bess"
  /** keep total site draw at or under a ceiling */
  | "curtail_site"
  /** the ceiling no longer applies */
  | "release_curtailment";

export type ChargerIntent =
  /** OCPP-style ceiling: draw no more than this over this period */
  | "set_power_ceiling"
  | "pause_session"
  | "resume_session"
  /** stop assigning new vehicles here; do NOT interrupt the live session */
  | "quarantine"
  | "release_quarantine";

export type DepotIntent =
  | "reprioritize_queue"
  | "open_lane"
  | "close_lane";

export type CommandIntent = VehicleIntent | EnergyIntent | ChargerIntent | DepotIntent;

// ── targets ─────────────────────────────────────────────────────────────────

export type TargetKind = "vehicle" | "bess" | "site" | "charger" | "stall" | "lane" | "queue";

export interface CommandTarget {
  kind: TargetKind;
  id: string;
  /** human label for the audit trail (av_id, stall code) — never used for routing */
  label?: string | null;
}

// ── timing ──────────────────────────────────────────────────────────────────

/**
 * WHEN the intent applies, in SIM time (ISO). This is how "discharge in 20
 * minutes" is expressed: `not_before_sim` = now + 20min.
 *
 * The executor owns everything inside the window. OTTO-Q states the window and
 * stops talking.
 */
export interface CommandWindow {
  /** do not begin before this instant; null = may begin immediately */
  not_before_sim: string | null;
  /** intent is void after this instant; null = no deadline */
  not_after_sim: string | null;
  /** the command is dead after this even if never acted on */
  expires_sim: string;
}

// ── per-intent parameters ───────────────────────────────────────────────────
// Deliberately thin. Every field answers WHAT outcome is wanted, never HOW to
// achieve it. If a field would tell an executor how to move or how to switch,
// it does not belong here.

export interface VehicleParams {
  /** for assign_stall: which stall this vehicle is being given */
  stall_id?: string;
  stall_code?: string | null;
  /** the service this assignment is for — charge, wash, detail, maintenance */
  service?: string | null;
  /** SoC the charge should reach; the charger and vehicle negotiate the curve */
  target_soc_pct?: number | null;
  /** for requeue/abort: why the prior assignment was withdrawn */
  supersedes_command_id?: string | null;
}

export interface EnergyParams {
  /**
   * Requested average power over the window, kW. Positive = the site wants the
   * battery to CHARGE, negative = DISCHARGE. An average over a window, never
   * an instantaneous setpoint — the energy controller owns the ramp.
   */
  power_kw?: number | null;
  /** ceiling for curtail_site: total site draw must stay at or under this */
  site_cap_kw?: number | null;
  /** SoC bound the action must respect (floor for discharge, ceiling for charge) */
  soc_bound_pct?: number | null;
  /** OpenADR-style: what triggered this signal. Drives operator explanation. */
  signal_reason?: "price_low" | "price_high" | "peak_demand" | "dr_call" | "solar_surplus" | "reserve_build" | null;
  /** the price that justified it, carried for the audit trail */
  lmp_usd_mwh?: number | null;
}

export interface ChargerParams {
  /** OCPP SetChargingProfile analogue: the most this charger may draw */
  power_ceiling_kw?: number | null;
  /** reason a charger is being quarantined — fault code, health score */
  reason_code?: string | null;
}

export interface DepotParams {
  /** for reprioritize_queue: vehicle ids in the order OTTO-Q wants them served */
  vehicle_order?: string[];
  lane_id?: string | null;
}

export type CommandParams = VehicleParams | EnergyParams | ChargerParams | DepotParams;

// ── provenance ──────────────────────────────────────────────────────────────

/**
 * Which layers produced this command, and from what world state. This is the
 * chain of custody: given a command, you can name the advisor that proposed it,
 * the arbiter that selected it, the shield that admitted it, and the exact tick
 * of world state all three were looking at.
 */
export interface CommandProvenance {
  /** L3 advisor that originated the proposal: "cuopt" | "nemotron" | "heuristic" | … */
  advisor: string;
  /** the ordered layers this passed through, e.g. ["L3:cuopt","L2:arbiter","L1:shield"] */
  layers: string[];
  /** tick of the channel bundle the decision was computed from */
  input_tick: number;
  /** channel contract version of that bundle */
  input_contract_version: string;
  /** bundle readiness at decision time — a command from a degraded world says so */
  input_bundle_status: string;
  /** plain-language justification, shown to operators and kept for audit */
  rationale: string;
  /** advisor confidence 0..1 where the advisor reports one */
  confidence?: number | null;
}

// ── the envelope ────────────────────────────────────────────────────────────

export interface OttoQCommand<P extends CommandParams = CommandParams> {
  /** stable idempotency key — re-delivery of the same id must not double-apply */
  command_id: string;
  contract_version: string;
  command_class: CommandClass;
  intent: CommandIntent;
  authority: CommandAuthority;

  sim_run_id: string;
  /** tick at which the command was issued */
  tick: number;
  issued_sim: string;
  /** wall clock, for transport diagnostics only */
  issued_at: string;
  /** monotonic per-run sequence — gaps mean lost commands */
  sequence: number;

  target: CommandTarget;
  window: CommandWindow;
  params: P;

  /**
   * Ordering hint for the executor when several commands compete. Higher wins.
   * NOT a safety mechanism — the shield already removed anything unsafe.
   */
  priority: number;

  /** groups commands that must be understood together (a whole plan) */
  correlation_id: string;
  provenance: CommandProvenance;

  /** whether the executor must acknowledge before OTTO-Q considers it delivered */
  ack_required: boolean;
}

// ── lifecycle records ───────────────────────────────────────────────────────

export interface CommandAck {
  command_id: string;
  status: Extract<CommandStatus, "accepted" | "rejected">;
  /** executor identity — "twin.motion", "twin.energy", later a real fleet API */
  executor: string;
  at_sim: string;
  /** required on reject; the reason the executor declined */
  reason?: string | null;
}

export interface CommandOutcome {
  command_id: string;
  status: Extract<CommandStatus, "completed" | "expired" | "superseded" | "rejected">;
  executor: string;
  at_sim: string;
  reason?: string | null;
  /** how far the executor's actual result drifted from the requested window, s */
  deviation_s?: number | null;
}

export interface CommandRecord {
  command: OttoQCommand;
  status: CommandStatus;
  history: { status: CommandStatus; at_sim: string; note?: string | null }[];
  ack: CommandAck | null;
  outcome: CommandOutcome | null;
}

// ── the batch that crosses the wire ─────────────────────────────────────────

/**
 * One tick's worth of orchestration, as a single transmission. Batching is
 * deliberate: a plan is coherent only as a set (assigning four vehicles to four
 * stalls is one decision, not four), and an executor that receives them
 * together can reject the batch atomically.
 */
export interface CommandBatch {
  batch_id: string;
  contract_version: string;
  sim_run_id: string;
  tick: number;
  issued_sim: string;
  issued_at: string;
  /** first sequence number in this batch; commands are contiguous from here */
  sequence_start: number;
  commands: OttoQCommand[];
  /** what the shield removed on the way here, and why — never silently dropped */
  suppressed: SuppressedCommand[];
  /** the world frame this batch was computed from */
  input: {
    tick: number;
    contract_version: string;
    bundle_status: string;
    sim_clock: string | null;
  };
}

export interface SuppressedCommand {
  intent: CommandIntent;
  target: CommandTarget;
  advisor: string;
  /** the shield rule that removed it */
  rule: string;
  detail: string;
}

// ── doctrine enforcement ────────────────────────────────────────────────────

/**
 * Field names that would turn a directive into an actuation. Any of these
 * appearing anywhere in a command's params is a contract violation, not a
 * warning: it means someone tried to drive the vehicle from the orchestrator.
 *
 * Checked recursively by the shield (rule: `no_actuation`).
 */
export const FORBIDDEN_ACTUATION_KEYS: string[] = [
  // motion
  "x", "y", "z", "position", "waypoint", "waypoints", "path", "route_points",
  "heading", "yaw", "steering", "steer_angle", "velocity", "speed", "speed_kmh",
  "throttle", "brake", "acceleration", "gear",
  // direct electrical actuation
  "setpoint_kw", "instantaneous_kw", "contactor", "relay", "breaker",
  "converter_setpoint", "duty_cycle", "pwm",
];

/** Depth-first scan for any forbidden key. Returns the offending paths. */
export function findActuationFields(value: unknown, path = "params"): string[] {
  if (value === null || typeof value !== "object") return [];
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((el, i) => hits.push(...findActuationFields(el, `${path}[${i}]`)));
    return hits;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_ACTUATION_KEYS.includes(k)) hits.push(`${path}.${k}`);
    hits.push(...findActuationFields(v, `${path}.${k}`));
  }
  return hits;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Deterministic command id. Same run + tick + target + intent always yields the
 * same id, which is what makes redelivery idempotent and replay exact. No
 * randomness, so a replayed run produces byte-identical command ids.
 */
export function commandId(
  simRunId: string, tick: number, target: CommandTarget, intent: CommandIntent, salt = 0,
): string {
  const basis = `${simRunId}|${tick}|${target.kind}:${target.id}|${intent}|${salt}`;
  // FNV-1a, 32-bit — small, dependency-free, stable across engines.
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `cmd_${h.toString(16).padStart(8, "0")}_${tick}`;
}

export const CLASS_FOR_INTENT: Record<CommandIntent, CommandClass> = {
  assign_stall: "vehicle.orchestration",
  hold: "vehicle.orchestration",
  release: "vehicle.orchestration",
  depart: "vehicle.orchestration",
  requeue: "vehicle.orchestration",
  abort_service: "vehicle.orchestration",
  charge_bess: "energy.orchestration",
  discharge_bess: "energy.orchestration",
  hold_bess: "energy.orchestration",
  curtail_site: "energy.orchestration",
  release_curtailment: "energy.orchestration",
  set_power_ceiling: "charger.orchestration",
  pause_session: "charger.orchestration",
  resume_session: "charger.orchestration",
  quarantine: "charger.orchestration",
  release_quarantine: "charger.orchestration",
  reprioritize_queue: "depot.orchestration",
  open_lane: "depot.orchestration",
  close_lane: "depot.orchestration",
};

/** Add seconds to an ISO sim instant. Returns null if the input is unusable. */
export function simPlus(simClock: string | null, seconds: number): string | null {
  if (!simClock) return null;
  const t = Date.parse(simClock);
  if (!Number.isFinite(t)) return null;
  return new Date(t + seconds * 1000).toISOString();
}
