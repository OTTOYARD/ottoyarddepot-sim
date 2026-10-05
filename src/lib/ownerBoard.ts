// ============================================================================
// ownerBoard — what owners' agents have set at the twin depot, as the twin draws it.
// ============================================================================
// Chase wants an owner's personal agent to change what its own cars need here -- how full they charge, which services
// they get, when they may leave -- and the twin to SHOW it while it renders the depot: that an agent asked, which agent,
// and the confirmation code it got back. OTTO-Q acts on those settings at its next tick (otto-q-core 0605-0607); the
// twin only draws them.
//
// Source: otto-q-core 0608, public.ottoq_depot_owner_board(p_depot_id, p_limit), anon-executable and read-only:
//   run         the depot's live run, or null
//   in_force    each owner setting active on that run (a charge limit, a hold, a service order), with the agent that
//               set it, how it connected (passcode or key), its confirmation code, and whether OTTO-Q's tick has
//               applied it yet
//   by_vehicle  the same, per car
//   commands    the depot's last owner commands, newest first, each with OTTO-Q's receipt or its refusal
//   agents      connected agents, and passcode sessions that ended
//
// Pure: no React, no client, no clock. Every field comes from the board; nothing is filled in. The board answers for the
// depot's LIVE run: when the twin shows another run, the board's settings are about other cars and are drawn as nothing.
// ============================================================================
import type { StreamTone } from "@/lib/agentStream";
import type { FeedLine } from "@/lib/liveFeed";
import { clockCT, serviceWord } from "@/lib/plainWords";

// ── the board, in 0608's shape (only the keys the twin reads are typed) ──────────────────────────────────────────
export interface OwnerBoardRun {
  sim_run_id: string;
  status?: string | null;
  demo?: boolean | null;
  sim_clock?: string | null;
  /** "7:00 AM sim time": SIMULATION time, Nashville local. */
  sim_clock_local?: string | null;
}

export interface OwnerInForce {
  /** 'charge_limit' | 'hold' | 'service' */
  kind: string;
  vehicle_id: string;
  vehicle?: string | null;
  fleet_operator?: string | null;
  charge_limit_pct?: number | null;
  /** What the car charges to with no limit: its owner's contract ceiling. */
  full_pct?: number | null;
  hold_until_sim?: string | null;
  /** "9:00 AM on Sun Sep 27 sim time" */
  hold_until_local?: string | null;
  service?: string | null;
  /** The catalog's display name, e.g. "Exterior wash". */
  service_name?: string | null;
  /** 'now' | 'next_return' | 'every_return' */
  when?: string | null;
  set_at?: string | null;
  /** REAL time, Nashville local: "11:11 PM CT". */
  set_at_local?: string | null;
  command_id?: string | null;
  /** "OQ-XXXX-XXXX" */
  confirmation_code?: string | null;
  /** The agent's name. Never a token. */
  agent?: string | null;
  /** 'passcode' | 'key' */
  agent_via?: string | null;
  /** Set, and not yet applied by OTTO-Q's tick (it applies at the next one). */
  waiting_for_tick?: boolean | null;
}

export interface OwnerOrder {
  service: string;
  name?: string | null;
  when?: string | null;
}

export interface OwnerCarSettings {
  vehicle?: string | null;
  fleet_operator?: string | null;
  charge_limit_pct?: number | null;
  full_pct?: number | null;
  hold_until_sim?: string | null;
  hold_until_local?: string | null;
  orders?: OwnerOrder[] | null;
  agents?: string[] | null;
  confirmation_codes?: string[] | null;
  waiting_for_tick?: boolean | null;
}

export interface OwnerCommand {
  command_id: string;
  tool: string;
  /** 'applied' | 'no_change' | 'refused' */
  outcome: string;
  /** The receipt's first line. */
  head?: string | null;
  /** OTTO-Q's whole receipt, as the agent received it. */
  summary?: string | null;
  confirmation_code?: string | null;
  agent?: string | null;
  agent_via?: string | null;
  fleet_operator?: string | null;
  cars?: number | null;
  /** The cars' names. */
  vehicles?: string[] | null;
  vehicle_ids?: string[] | null;
  /** REAL time (ISO) it was sent. */
  created_at: string;
  created_at_local?: string | null;
  /** The run's SIM clock when it was sent. */
  sim_clock?: string | null;
  sim_clock_local?: string | null;
  sim_run_id?: string | null;
  live_run?: boolean | null;
  link?: string | null;
  /** Why OTTO-Q did not apply it, in plain English. */
  refusal?: string | null;
  undone_at?: string | null;
  lifted_at?: string | null;
  lifted_reason?: string | null;
}

export interface OwnerAgentSession {
  agent: string;
  via?: string | null;
  /** 'connected' | 'ended_with_run' | 'expired' | 'closed' */
  state: string;
  fleet_operator?: string | null;
  connected_at_local?: string | null;
  expires_local?: string | null;
  ended_local?: string | null;
}

export interface DepotOwnerBoard {
  ok: true;
  run: OwnerBoardRun | null;
  depot?: { id: string; name?: string | null } | null;
  agents?: OwnerAgentSession[] | null;
  in_force?: OwnerInForce[] | null;
  by_vehicle?: Record<string, OwnerCarSettings> | null;
  commands?: OwnerCommand[] | null;
  counts?: { cars?: number; holds?: number; orders?: number; charge_limits?: number; agents_connected?: number } | null;
  /** The reset rule, in the engine's words. */
  resets?: string | null;
  clocks?: string | null;
}
export interface OwnerBoardRefusal {
  ok: false;
  error?: string | null;
  message?: string | null;
}
export type OwnerBoardReply = DepotOwnerBoard | OwnerBoardRefusal;

// ── small words ──────────────────────────────────────────────────────────────────────────────────────────────────
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const isBoard = (r: unknown): r is DepotOwnerBoard =>
  !!r && typeof r === "object" && (r as { ok?: unknown }).ok === true;

/** The board describes the run the twin is showing, so its settings are about the cars on screen. */
export function boardIsForRun(board: DepotOwnerBoard | null | undefined, runId: string | null | undefined): board is DepotOwnerBoard {
  return isBoard(board) && !!runId && !!board.run && board.run.sim_run_id === runId;
}

/** Why a read failed. The first two are the expected states before 0607/0608 are applied to the database. */
export type OwnerBoardProblem = "not_enabled" | "not_granted" | "error";

/** From a supabase-js error and the response's HTTP status. */
export function classifyBoardError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  status?: number | null,
): OwnerBoardProblem {
  const code = String(error?.code ?? "");
  const text = String(error?.message ?? "");
  if (status === 404 || code === "PGRST202" || code === "42883" || /could not find the function/i.test(text)) return "not_enabled";
  if (status === 401 || status === 403 || code === "42501" || /permission denied/i.test(text)) return "not_granted";
  return "error";
}

export const NOT_ENABLED_TEXT = "Owner agents are built but not on yet.";
export const NOT_GRANTED_TEXT = "Owner agents are on, but this cockpit cannot read them yet.";

/** What a panel says in place of owners' agents' lines, or null when there is nothing to say. */
export function boardStateText(status: string, message: string | null, hasData: boolean): string | null {
  switch (status) {
    case "not_enabled": return NOT_ENABLED_TEXT;
    case "not_granted": return NOT_GRANTED_TEXT;
    case "refused": return `Owner agents: ${message ?? "the board did not answer."}`;
    case "error": return `Could not read what owners' agents set: ${message ?? "unknown error"}.${hasData ? " This shows the last read." : ""}`;
    default: return null;
  }
}

/** The agent as the twin names it, with how it connected: "<agent> (passcode)", "<agent> (key)". */
export function agentLabel(agent: string | null | undefined, via: string | null | undefined): string {
  const a = str(agent) ?? "An owner's agent";
  const v = str(via);
  return v ? `${a} (${v})` : a;
}

export function whenLabel(when: string | null | undefined): string {
  switch (when) {
    case "now": return "this visit";
    case "next_return": return "next return";
    case "every_return": return "every return";
    default: return when ? when.replace(/_/g, " ") : "";
  }
}

export function toolLabel(tool: string | null | undefined): string {
  switch (tool) {
    case "set_charge_limit": return "Charge limit";
    case "clear_charge_limit": return "Charge limit cleared";
    case "request_service": return "Service ordered";
    case "cancel_service": return "Order withdrawn";
    case "hold_vehicle": return "Hold";
    case "release_hold": return "Hold released";
    case "undo_command": return "Undo";
    default: return tool ? cap(tool.replace(/_/g, " ")) : "Command";
  }
}

/** A receipt split into its first line, its "- " lines (without the dash), and its other lines (the OrchestrAV link
 *  left out: the twin is not where the owner reads it). */
export function receiptText(summary: string | null | undefined): { head: string; bullets: string[]; notes: string[] } {
  const lines = (summary ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const [head = "", ...rest] = lines;
  return {
    head,
    bullets: rest.filter((l) => l.startsWith("- ")).map((l) => l.slice(2)),
    notes: rest.filter((l) => !l.startsWith("- ") && !/^See it in OrchestrAV:/i.test(l)),
  };
}

// ── the Q card: one car's settings ───────────────────────────────────────────────────────────────────────────────
export interface OwnerChip {
  key: string;
  kind: "charge_limit" | "service" | "hold";
  /** "Max 90% · <agent> (key)", "Exterior wash · every return", "Held until 9:00 AM" */
  label: string;
  /** Who set it and when, what it means, and its confirmation code. */
  title: string;
  code: string | null;
  agent: string;
}

export interface OwnerCarView {
  chips: OwnerChip[];
  /** Each agent that set something on the car, with the confirmation codes OTTO-Q gave it, in chip order. */
  receipts: { agent: string; codes: { code: string; title: string }[] }[];
  /** A setting OTTO-Q's tick has not applied yet. */
  waitingForTick: boolean;
  /** The reset rule, in the engine's words. */
  resets: string | null;
}

const KIND_ORDER: Record<string, number> = { charge_limit: 0, service: 1, hold: 2 };

function chipFor(s: OwnerInForce): OwnerChip | null {
  const agent = agentLabel(s.agent, s.agent_via);
  const code = str(s.confirmation_code);
  const by = `Set by ${agent}${str(s.set_at_local) ? ` at ${str(s.set_at_local)}` : ""}`;
  const ref = code ? ` Confirmation ${code}.` : "";
  if (s.kind === "charge_limit") {
    const pct = num(s.charge_limit_pct);
    if (pct === null) return null;
    const full = num(s.full_pct);
    return {
      key: "limit", kind: "charge_limit", code, agent,
      label: `Max ${Math.round(pct)}% · ${agent}`,
      title: `${by}: this car charges to at most ${Math.round(pct)}%${full !== null ? ` instead of ${Math.round(full)}%` : ""}, and OTTO-Q stops its charge there.${ref}`,
    };
  }
  if (s.kind === "hold") {
    const until = s.hold_until_sim && Number.isFinite(Date.parse(s.hold_until_sim))
      ? clockCT(s.hold_until_sim)
      : str(s.hold_until_local)?.replace(/ sim time$/, "") ?? null;
    if (!until) return null;
    return {
      key: "hold", kind: "hold", code, agent,
      label: `Held until ${until}`,
      title: `${by}: OTTO-Q does not let this car leave before ${str(s.hold_until_local) ?? until}. A hold only delays a departure. It never moves the car.${ref}`,
    };
  }
  if (s.kind === "service") {
    const name = str(s.service_name) ?? (str(s.service) ? cap(serviceWord(s.service)) : null);
    if (!name) return null;
    const when = whenLabel(s.when);
    return {
      key: `service:${s.service ?? name}:${s.when ?? ""}`, kind: "service", code, agent,
      label: when ? `${name} · ${when}` : name,
      title: `${by}. OTTO-Q decides when and where, and the car does not leave with it undone.${ref}`,
    };
  }
  return null;
}

/** One car's owner settings on the run the twin shows, or null when its owner's agent set nothing (or the board is
 *  about another run). */
export function carOwnerView(board: DepotOwnerBoard | null | undefined, vehicleId: string | null | undefined, runId: string | null | undefined): OwnerCarView | null {
  if (!vehicleId || !boardIsForRun(board, runId)) return null;
  const rows = (board.in_force ?? []).filter((s) => s && s.vehicle_id === vehicleId);
  const chips: OwnerChip[] = [];
  for (const s of [...rows].sort((a, b) => (KIND_ORDER[a.kind] ?? 3) - (KIND_ORDER[b.kind] ?? 3))) {
    const c = chipFor(s);
    if (c && !chips.some((x) => x.key === c.key)) chips.push(c);
  }
  if (!chips.length) return null;
  const receipts: OwnerCarView["receipts"] = [];
  for (const c of chips) {
    let r = receipts.find((x) => x.agent === c.agent);
    if (!r) receipts.push((r = { agent: c.agent, codes: [] }));
    if (!c.code) continue;
    const have = r.codes.find((x) => x.code === c.code);
    if (have) have.title += `; ${c.label}`;
    else r.codes.push({ code: c.code, title: `OTTO-Q's confirmation to ${c.agent}: ${c.label}` });
  }
  return { chips, receipts, waitingForTick: rows.some((s) => s.waiting_for_tick === true), resets: str(board.resets) };
}

// ── the 3D scene and the 2D map: which cars carry a setting ──────────────────────────────────────────────────────
/** The cars an owner's agent has a setting in force on, on the run the twin shows. Empty for another run's board. */
export function markedVehicleIds(board: DepotOwnerBoard | null | undefined, runId: string | null | undefined): Set<string> {
  if (!boardIsForRun(board, runId)) return new Set();
  const ids = new Set<string>(Object.keys(board.by_vehicle ?? {}).filter(Boolean));
  for (const s of board.in_force ?? []) if (s?.vehicle_id) ids.add(s.vehicle_id);
  return ids;
}

export function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ── the commands: accumulated across polls, one per command_id ───────────────────────────────────────────────────
/** Commands kept per run: the board returns its newest 30 each poll; older ones stay until the run changes. */
export const COMMAND_CAP = 200;

/** The fields of a command that can change after it was sent (it is undone, or lifted with its run). */
const sameCommand = (a: OwnerCommand, b: OwnerCommand): boolean =>
  a.outcome === b.outcome && a.undone_at === b.undone_at && a.lifted_at === b.lifted_at && a.live_run === b.live_run
  && a.summary === b.summary && a.confirmation_code === b.confirmation_code;

const sentAt = (c: OwnerCommand): number => Date.parse(c.created_at) || 0;

/**
 * Merge a poll's commands into those already read: one per command_id (a re-delivered command that changed replaces
 * itself), newest sent first. Idempotent: a poll with nothing new returns the SAME array, so nothing re-renders.
 */
export function mergeCommands(prev: readonly OwnerCommand[], incoming: readonly OwnerCommand[] | null | undefined, capAt = COMMAND_CAP): OwnerCommand[] {
  const fresh = (incoming ?? []).filter((c) => c && typeof c.command_id === "string" && c.command_id);
  if (!fresh.length) return prev as OwnerCommand[];
  const byId = new Map(prev.map((c) => [c.command_id, c] as const));
  let changed = false;
  for (const c of fresh) {
    const have = byId.get(c.command_id);
    if (!have || !sameCommand(have, c)) { byId.set(c.command_id, c); changed = true; }
  }
  if (!changed) return prev as OwnerCommand[];
  return [...byId.values()]
    .sort((a, b) => sentAt(b) - sentAt(a) || (a.command_id < b.command_id ? 1 : a.command_id > b.command_id ? -1 : 0))
    .slice(0, capAt);
}

// ── the Agent tab: one line per command ──────────────────────────────────────────────────────────────────────────
/** One command as one line of the live stream, at the sim clock it was sent at. */
export function ownerFeedLine(c: OwnerCommand): FeedLine {
  const who = agentLabel(c.agent, c.agent_via);
  const r = receiptText(c.summary);
  const head = str(c.head) ?? (r.head || toolLabel(c.tool));
  const refused = c.outcome === "refused";
  const text = refused
    ? `${who} · Refused: ${str(c.refusal) ?? head.replace(/^Not done:\s*/i, "")}`
    : `${who} · ${toolLabel(c.tool)} · ${head}`;
  const tone: StreamTone = refused ? "refused" : c.outcome === "applied" ? "ok" : "idle";
  const note = c.undone_at ? "undone since"
    : c.lifted_at ? (str(c.lifted_reason) ? `lifted: ${str(c.lifted_reason)}` : "lifted since")
    : null;
  const one = (xs: string[] | null | undefined) => (Array.isArray(xs) && xs.length === 1 ? xs[0] : null);
  return {
    key: `u${c.command_id}`,
    kind: "owner",
    at: str(c.sim_clock),
    tick: null,
    tone,
    car: one(c.vehicles),
    carId: one(c.vehicle_ids),
    text,
    verb: "owner",
    owner: {
      code: c.outcome === "applied" ? str(c.confirmation_code) : null,
      note,
      sent: str(c.created_at_local),
      sim: str(c.sim_clock_local),
      more: [...r.bullets, ...r.notes],
    },
  };
}

/** The commands sent on the run the twin shows, as lines, newest sent first. */
export function ownerFeedLines(commands: readonly OwnerCommand[], runId: string | null | undefined): FeedLine[] {
  if (!runId) return [];
  return commands.filter((c) => c && c.command_id && c.sim_run_id === runId).map(ownerFeedLine);
}

// ── the bottom bar: connected agents ────────────────────────────────────────────────────────────────────────────────
export function connectedAgents(board: DepotOwnerBoard | null | undefined): OwnerAgentSession[] {
  return isBoard(board) ? (board.agents ?? []).filter((a) => a && a.state === "connected") : [];
}

/** How many agents are connected to the depot: the board's own count, else its connected sessions. */
export function connectedCount(board: DepotOwnerBoard | null | undefined): number {
  if (!isBoard(board)) return 0;
  return num(board.counts?.agents_connected) ?? connectedAgents(board).length;
}
