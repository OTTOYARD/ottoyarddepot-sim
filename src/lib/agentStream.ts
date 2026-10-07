// agentStream — the Agent tab's plain-English stream, from engine records. Pure: no React, no client.
//
// Chase, 2026-09-29: "the agent tab or the intelligence tab could just be more of that detailed plain English feed and
// live stream of agent decision-making and reading of all variables in real time and proposing and learning and looping."
//
// Sources:
//   an agent pass     one ottoq_activity_feed_v2 row with action 'orchestrator_agent' (the decision the pass wrote:
//                     the model's own summary, the directives it applied, its objective and why, the solver hand-off
//                     and the decide path's disposition of what came back)
//   an offer batch    ottoq_proposal_disposition_ledger rows (0364, evidence) grouped by the tick they were disposed on
//                     and the planner that made them
//
// Sentences only. A fact the record does not carry is left out of the sentence, never filled in; where a whole
// sentence depends on it, it says "not recorded".
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import { human, modelErrorText, num, solverPhrase } from "@/lib/decisionText";
import { sentenceCase } from "@/lib/publicNames";
import { proposerWord, type DispositionRow } from "@/lib/ottoqFunnel";
import type { AgentOrderEntry, AgentOrderUsage } from "@/lib/runLearning";

export type StreamTone = "ok" | "held" | "refused" | "idle";

export interface AgentPass {
  kind: "pass";
  key: string;
  at: string;
  tick: number | null;
  tone: StreamTone;
  /** One line: what happened, as a headline. */
  headline: string;
  /** What it read: the model's own summary of the depot, or null when the model did not answer. */
  read: string | null;
  /** What it asked for: the directives it applied, in its own words. */
  directives: string[];
  /** The objective it chose, and why, as a sentence. */
  chose: string;
  /** What the solver and the decide path did with it, as sentences. */
  outcome: string[];
  /** The charge-line order this pass sent (otto-q-core 0614), when the run takes one and the order is in the read. */
  order: AgentOrderEntry | null;
  /**
   * The pass's colour on the stack: green when its order seated cars, red when the decide path kept none of the cars it
   * named, amber when the agent gave no answer, the agent's own white otherwise.
   */
  hue: PassHue;
}

export type PassHue = "seated" | "refused" | "held" | "answered";

/** chain id -> the order that pass sent: how a pass, which carries its chain id, finds its order. */
export type OrderIndex = ReadonlyMap<string, AgentOrderEntry>;
export const NO_ORDERS: OrderIndex = new Map();

export function orderIndex(usage: AgentOrderUsage | null | undefined): OrderIndex {
  const m = new Map<string, AgentOrderEntry>();
  for (const o of usage?.by_order ?? []) if (o?.chain_id) m.set(o.chain_id, o);
  return m;
}

export interface OfferBatch {
  kind: "offers";
  key: string;
  at: string | null;
  tick: number | null;
  tone: StreamTone;
  /** Nothing enacted or refused on this tick: only offers replaced, expired or declined. */
  quiet: boolean;
  headline: string;
  /** One sentence per offer, newest first. */
  lines: { key: string; text: string; tone: StreamTone }[];
}

export type StreamItem = AgentPass | OfferBatch;

const OBJECTIVE_WORD: Record<string, string> = {
  readiness_first: "get cars ready first",
  throughput_first: "move the most cars through",
  energy_first: "keep the power bill down",
  cost_first: "keep costs down",
  balanced: "balance readiness, throughput and cost",
};
export const objectiveWord = (o: unknown): string =>
  (typeof o === "string" && OBJECTIVE_WORD[o]) || human(o) || "a goal not recorded";

const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function agentPass(r: ActivityFeedRow, orders: OrderIndex = NO_ORDERS): AgentPass {
  const v = (r.rationale ?? {}) as Record<string, unknown>;
  // `.map(agentPass)` would hand the index in here: only a Map is an order index
  const index = orders instanceof Map ? orders : NO_ORDERS;
  const chain = typeof v.chain_id === "string" ? v.chain_id : null;
  const order = chain ? index.get(chain) ?? null : null;
  const modelError = modelErrorText(v.model_error);
  const summary = typeof v.summary === "string" && v.summary.trim() ? v.summary.trim() : null;
  const applied = Array.isArray(v.applied) ? (v.applied as { text?: unknown }[]) : [];
  const directives = applied.map((a) => (typeof a?.text === "string" ? a.text.trim() : "")).filter(Boolean);
  const queued = Array.isArray(v.queued) ? v.queued.length : 0;
  const rejected = Array.isArray(v.rejected) ? v.rejected.length : 0;
  const why = typeof v.objective_why === "string" ? v.objective_why.trim() : "";

  const chose = modelError
    ? `The agent did not answer (${modelError}). The decide path kept the goal: ${objectiveWord(v.objective)}.`
    : `It chose to ${objectiveWord(v.objective)}${why ? `, because ${why.replace(/\.$/, "")}` : ""}.`;

  const outcome: string[] = [];
  const handoff = String(v.handoff_status ?? v.solver_status ?? "");
  const solver = solverPhrase(v);
  const returned = num(v.proposals_returned);
  if (handoff === "completed") {
    outcome.push(`${solver ? sentenceCase(solver) : "The solver"} took the hand-off and returned ${returned == null ? "an unrecorded number of" : plural(returned, "offer")}.`);
  } else if (handoff === "skipped") {
    outcome.push("No solver was asked this pass.");
  } else if (handoff === "fallback") {
    outcome.push("The solver hand-off did not complete. The decide path used its own answer.");
  } else if (handoff) {
    outcome.push(`The solver hand-off is ${human(handoff)}.`);
  }
  const k = (key: string) => num(v[key]) ?? 0;
  const parts = [
    k("kernel_enacted") ? `carried out ${k("kernel_enacted")}` : null,
    k("kernel_refused") ? `refused ${k("kernel_refused")}` : null,
    k("kernel_superseded") ? `replaced ${k("kernel_superseded")}` : null,
    k("kernel_expired") ? `let ${k("kernel_expired")} expire` : null,
  ].filter(Boolean);
  if (parts.length) outcome.push(`The decide path ${parts.join(", ")}.`);
  else if (handoff === "completed" && returned === 0) outcome.push("The decide path had nothing to decide.");
  if (directives.length) outcome.push(`${plural(directives.length, "directive")} applied${queued ? `, ${queued} waiting for a person to approve` : ""}${rejected ? `, ${rejected} rejected` : ""}.`);
  else if (queued || rejected) outcome.push(`${queued ? `${queued} waiting for a person to approve` : ""}${queued && rejected ? ", " : ""}${rejected ? `${rejected} rejected` : ""}.`);
  // 0614: the charge-line order, and what the decide path did with it
  if (order && !modelError) {
    const accepted = order.accepted ?? 0, offered = order.offered ?? 0;
    const byRank = order.seats_by_rank ?? 0, ahead = order.moved_ahead ?? 0;
    if (order.status === "rejected") {
      outcome.push(`It ordered the charge line, and the decide path kept none of the ${plural(offered, "car")} it named: none was waiting for a charger.`);
    } else {
      outcome.push(`It ordered the charge line: ${plural(accepted, "car")}${accepted < offered ? ` (${offered - accepted} not waiting, left out)` : ""}.`);
      outcome.push(byRank > 0
        ? `The decide path seated ${plural(byRank, "car")} in its order${ahead ? `, ${ahead} of them ahead of where its own order had them` : ""}.`
        : "No car has been seated by its order.");
    }
  }
  const late = num(v.advice_ticks_late);
  if (late != null) outcome.push(late === 0 ? "Its advice was applied on the tick it read." : `Its advice was applied ${plural(late, "tick")} after the tick it read. The tick never waits for it.`);

  const tone: StreamTone = modelError || r.outcome !== "enacted" ? "held" : "ok";
  const seated = !modelError && (order?.seats_by_rank ?? 0) > 0;
  const hue: PassHue = modelError || r.outcome !== "enacted" ? "held"
    : order?.status === "rejected" ? "refused"
    : seated ? "seated" : "answered";
  const headline = modelError
    ? "The agent gave no answer, so the decide path kept the goal"
    : seated
      ? `The agent ordered the charge line and the decide path seated ${plural(order!.seats_by_rank ?? 0, "car")} by it`
      : order && order.status !== "rejected"
        ? `The agent read the depot and ordered the charge line: ${plural(order.accepted ?? 0, "car")}`
        : `The agent read the depot and chose to ${objectiveWord(v.objective)}`;

  return {
    kind: "pass",
    key: r.decision_seq != null ? `d${r.decision_seq}` : `a${r.occurred_at}`,
    at: r.occurred_at,
    tick: r.tick_seq ?? null,
    tone,
    headline,
    read: modelError ? null : summary,
    directives: modelError ? [] : directives,
    chose,
    outcome,
    order,
    hue,
  };
}

// ── the proposers' offers ────────────────────────────────────────────────────
const REASON_WORD: Record<string, string> = {
  stall_occupied: "the stall was already taken",
  stall_reserved: "the stall was held for another car",
  newer_proposal_same_entity: "a newer offer for the same car replaced it",
  entity_decided_by_other_proposal: "the car was placed by another offer",
  run_finalized: "the run ended first",
  "bridge:not_due": "the car was not due yet",
};
export function reasonWord(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const r = reason.trim();
  return REASON_WORD[r] ?? r.replace(/_/g, " ").replace(/\s+$/, "");
}

export function offerLine(d: DispositionRow, names: ReadonlyMap<string, string>): { key: string; text: string; tone: StreamTone } {
  const car = (d.entity_id && names.get(d.entity_id)) || "a car";
  const who = proposerWord(d.source);
  const why = reasonWord(d.disposition_reason);
  const key = `p${d.disposition_id}`;
  const Who = sentenceCase(who);
  if (d.abstained) return { key, text: `${Who} made no offer for ${car}${why ? `: ${why}` : ""}.`, tone: "idle" };
  switch (d.status) {
    case "enacted":
      return {
        key,
        text: (d.promotion_count ?? 0) > 0
          ? `The decide path chose ${who}'s offer for ${car}. The offer moved to another free charger first.`
          : `The decide path chose ${who}'s offer for ${car}.`,
        tone: "ok",
      };
    case "refused":
      return { key, text: `The decide path refused ${who}'s offer for ${car}${why ? `: ${why}` : ""}.`, tone: "refused" };
    case "superseded":
      return { key, text: `${Who}'s offer for ${car} was replaced${why ? `: ${why}` : ""}.`, tone: "idle" };
    case "expired":
      return { key, text: `${Who}'s offer for ${car} expired${why ? `: ${why}` : ""}.`, tone: "idle" };
    default:
      return { key, text: `${Who}'s offer for ${car} is ${human(d.status)}.`, tone: "idle" };
  }
}

/** Sim time of each tick, read from the engine's own decisions on it (the ledger's disposed_at is wall time). */
export function tickClocks(rows: readonly ActivityFeedRow[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of rows) if (r.tick_seq != null && r.occurred_at && !m.has(r.tick_seq)) m.set(r.tick_seq, r.occurred_at);
  return m;
}

/** Offers grouped by the tick they were disposed on, every planner together. Newest first. A tick where no offer was
 *  enacted or refused (all replaced, expired or declined) is `quiet`: the tab folds those away by default. */
export function offerBatches(
  rows: readonly DispositionRow[],
  names: ReadonlyMap<string, string>,
  clocks: ReadonlyMap<number, string> = new Map(),
): OfferBatch[] {
  const groups = new Map<string, DispositionRow[]>();
  for (const d of rows) {
    const k = d.disposed_tick == null ? `w${d.disposed_at ?? d.disposition_id}` : `t${d.disposed_tick}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
  }
  const out: OfferBatch[] = [];
  for (const [k, list] of groups) {
    list.sort((a, b) => b.disposition_id - a.disposition_id);
    const bySource = new Map<string, DispositionRow[]>();
    for (const d of list) (bySource.get(d.source) ?? bySource.set(d.source, []).get(d.source)!).push(d);
    const parts: string[] = [];
    for (const [src, ds] of bySource) {
      const enacted = ds.filter((d) => !d.abstained && d.status === "enacted").length;
      const refused = ds.filter((d) => !d.abstained && d.status === "refused").length;
      const replaced = ds.filter((d) => !d.abstained && (d.status === "superseded" || d.status === "expired")).length;
      const declined = ds.filter((d) => d.abstained).length;
      const bits = [
        enacted ? `${enacted} enacted` : null,
        refused ? `${refused} refused` : null,
        replaced ? `${replaced} replaced` : null,
        declined ? `no offer for ${plural(declined, "car")}` : null,
      ].filter(Boolean);
      parts.push(`${proposerWord(src)} ${bits.join(", ")}`);
    }
    const enacted = list.some((d) => !d.abstained && d.status === "enacted");
    const refused = list.some((d) => !d.abstained && d.status === "refused");
    const tick = list[0].disposed_tick ?? null;
    out.push({
      kind: "offers",
      key: `o${k}`,
      at: tick != null ? clocks.get(tick) ?? null : null,
      tick,
      tone: enacted ? "ok" : refused ? "refused" : "idle",
      quiet: !enacted && !refused,
      headline: `The planners' offers: ${parts.join("; ")}`,
      lines: list.map((d) => offerLine(d, names)),
    });
  }
  return out.sort((a, b) => (b.tick ?? -1) - (a.tick ?? -1));
}

/** Car names from the feed: the disposition ledger carries only ids. */
export function namesFromRows(rows: readonly ActivityFeedRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (r.vehicle_id && r.display_name && !m.has(r.vehicle_id)) m.set(r.vehicle_id, r.display_name);
  return m;
}

/** A run whose world is live, by the cockpit's own rule (useTwinFeed): running, active or paused. */
export const isLiveStatus = (s: string | null | undefined): boolean => ["running", "active", "paused"].includes(String(s ?? "").toLowerCase());

// ── what the agent reads ────────────────────────────────────────────────────
// The frame is the per-asset board the agent reads before it picks an objective (ottoq_intelligence_stack with
// p_include_frame, built by ottoq_agent_asset_depth over every car in the depot). These are its own numbers, in words.
const BLOCK_WORD: Record<string, string> = {
  cell_balance_overdue: "cell balance overdue",
  soh_derate: "battery health derate",
  pack_temp_high: "pack too hot",
};
const fmtN = (x: number) => x.toLocaleString("en-US");

export interface FrameRead {
  lines: { key: string; text: string }[];
  attention: { name: string; line: string }[];
}

export function frameSentences(frame: Record<string, unknown> | null | undefined): FrameRead {
  const out: FrameRead = { lines: [], attention: [] };
  if (!frame || typeof frame !== "object") return out;
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const a = obj(frame.assets), soc = obj(a?.soc), hc = obj(a?.hard_constraints), h = obj(a?.health), dl = obj(a?.deadlines), tel = obj(frame.telemetry);
  const cars = num(a?.n);
  if (soc && [soc.p10, soc.p50, soc.p90].every((v) => num(v) != null)) {
    const below = num(soc.below_min_ready);
    out.lines.push({
      key: "soc",
      text: `Battery${cars != null ? ` across ${fmtN(cars)} cars` : ""}: a tenth at or below ${num(soc.p10)}%, half at or below ${num(soc.p50)}%, nine in ten at or below ${num(soc.p90)}%.${below != null ? ` ${fmtN(below)} ${below === 1 ? "is" : "are"} below the ready floor.` : ""}`,
    });
  }
  if (hc) {
    const blocked = num(hc.dcfc_blocked), derated = num(hc.charge_derated);
    const reasons = obj(hc.dcfc_block_reasons);
    const why = reasons ? Object.entries(reasons).filter(([, v]) => num(v)).sort((x, y) => (num(y[1]) ?? 0) - (num(x[1]) ?? 0)).map(([k, v]) => `${fmtN(num(v)!)} ${BLOCK_WORD[k] ?? human(k)}`) : [];
    const parts = [
      blocked != null ? `${fmtN(blocked)} ${blocked === 1 ? "car cannot" : "cars cannot"} use a fast charger right now${why.length ? ` (${why.join(", ")})` : ""}` : null,
      derated != null ? `${fmtN(derated)} charge at a reduced rate` : null,
    ].filter(Boolean);
    if (parts.length) out.lines.push({ key: "hc", text: `${parts.join("; ")}.` });
  }
  if (h) {
    const f = num(h.open_faults), sev = num(h.severe_faults), pm = num(h.pm_overdue), sw = num(h.sw_behind);
    const sensor = num(h.sensor_below_90), tread = num(h.tread_below_3mm), brake = num(h.brake_above_80pct);
    const parts = [
      f != null ? `${fmtN(f)} open ${f === 1 ? "fault" : "faults"}${sev ? `, ${fmtN(sev)} severe` : ""}` : null,
      pm != null ? `${fmtN(pm)} overdue for maintenance` : null,
      sw != null ? `${fmtN(sw)} behind on software` : null,
      sensor ? `${fmtN(sensor)} with sensors below 90%` : null,
      tread ? `${fmtN(tread)} with tread under 3 mm` : null,
      brake ? `${fmtN(brake)} with brakes past 80% wear` : null,
    ].filter(Boolean);
    if (parts.length) out.lines.push({ key: "health", text: `Health: ${parts.join("; ")}.` });
  }
  if (dl) {
    const over = num(dl.overdue), soon = num(dl.due_60m), tight = num(dl.tightest_min);
    const parts = [
      over != null ? `${fmtN(over)} past their deploy time` : null,
      soon != null ? (soon === 0 ? "none due in the next hour" : `${fmtN(soon)} due in the next hour`) : null,
      tight != null ? `the tightest in ${fmtN(tight)} min` : null,
    ].filter(Boolean);
    if (parts.length) out.lines.push({ key: "deadlines", text: `Deadlines: ${parts.join("; ")}.` });
  }
  if (tel) {
    const win = num(tel.window_min), pk = num(tel.packets), rep = num(tel.vehicles_reporting), silent = num(tel.silent_vehicles), temp = num(tel.max_battery_temp_c);
    const integ = obj(tel.integrity), dropped = num(integ?.dropped);
    const parts = [
      pk != null ? `${fmtN(pk)} packets${rep != null ? ` from ${fmtN(rep)} cars` : ""}` : null,
      silent != null ? `${fmtN(silent)} silent` : null,
      dropped ? `${fmtN(dropped)} dropped` : null,
      temp != null ? `hottest battery ${temp} °C` : null,
    ].filter(Boolean);
    if (parts.length) out.lines.push({ key: "telemetry", text: `Telemetry${win != null ? ` over the last ${fmtN(win)} min` : ""}: ${parts.join("; ")}.` });
  }
  const att = Array.isArray(a?.attention) ? (a!.attention as Record<string, unknown>[]) : [];
  for (const x of att) {
    const name = typeof x.asset === "string" ? x.asset : "—";
    const bits = [num(x.soc) != null ? `${num(x.soc)}%` : null, typeof x.priority === "string" ? `${human(x.priority)} priority` : null].filter(Boolean);
    const why = Array.isArray(x.why) ? (x.why as unknown[]).map(String) : [];
    out.attention.push({ name, line: `${bits.length ? `(${bits.join(", ")}) ` : ""}${why.join("; ")}` });
  }
  return out;
}

/** The loop, counted: read (agent passes), proposed (offers), disposed (enacted / refused), learned (graded questions). */
export interface LoopCounts {
  reads: number | null;
  offers: number | null;
  enacted: number | null;
  refused: number | null;
  graded: number | null;
}
