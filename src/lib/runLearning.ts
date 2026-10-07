// ============================================================================
// runLearning — what the planners learned inside the run being watched, in words. Pure: no React, no client.
//
// Chase, 2026-10-07: "Maybe it should have a learning loop attached to the final dispatch so that it becomes aware of
// what has actually passed through all layers of OTTO-Q ... If it propose something that doesn't pass, there should
// either be a function where it finds an adjacent solution ... or it gets kicked back to the agent layer ... Either way,
// there's learning within each run."
//
// The engine side is otto-q-core 0613: public.ottoq_run_learning reads the run's own records (free chargers, the charge
// queue, every planner offer and where each refused charger went) and both the planners and the agent read it on each
// pass. This file draws the same object for a viewer. A missing number is "—", never 0. The charger and queue lines
// are the depot NOW, so they are drawn only while the run is live; an ended run shows its offer totals and nothing else.
// ============================================================================
import { publicPhrase, sentenceCase } from "./publicNames";

export interface ChargerCount {
  total?: number | null;
  free?: number | null;
  in_use?: number | null;
  reserved?: number | null;
  held_by_calendar?: number | null;
  faulted?: number | null;
  not_heartbeating?: number | null;
}

export interface PlannerTally {
  offered?: number | null;
  used?: number | null;
  moved?: number | null;
  refused?: number | null;
  refused_by_reason?: Record<string, number> | null;
}

export interface LearningRefusal {
  tick?: number | null;
  source?: string | null;
  vehicle_id?: string | null;
  vehicle?: string | null;
  stall_id?: string | null;
  stall?: string | null;
  kind?: string | null;
  reason?: string | null;
  went_to?: { vehicle_id?: string | null; vehicle?: string | null; tick?: number | null; same_car?: boolean | null; path?: string | null } | null;
}

export interface LearningDispatch {
  tick?: number | null;
  vehicle?: string | null;
  vehicle_id?: string | null;
  stall?: string | null;
  stall_id?: string | null;
  kind?: string | null;
  source?: string | null;
  moved_from_offer?: boolean | null;
  path?: string | null;
}

/** One order in public.ottoq_agent_charge_order_usage's by_order (otto-q-core 0614): what one agent pass's order did. */
export interface AgentOrderEntry {
  order_id?: number | null;
  /** The agent pass's chain id: the same id the pass's feed row carries (rationale.chain_id). */
  chain_id?: string | null;
  recorded_tick?: number | null;
  /** accepted | partial | rejected: whether the decide path kept the cars it named (rejected: none of them). */
  status?: string | null;
  offered?: number | null;
  accepted?: number | null;
  /** Seats made while this order stood. */
  seats?: number | null;
  /** Seats the order's ranking made (a car it named, not seated first for its wait). */
  seats_by_rank?: number | null;
  /** Of those, cars the decide path's own order had further back. */
  moved_ahead?: number | null;
}

/** public.ottoq_agent_charge_order_usage(run, limit): what the agent's charge-line orders did on one run. */
export interface AgentOrderUsage {
  orders?: number | null;
  orders_accepted?: number | null;
  /** 0616: the orders that seated at least one car by their rank. */
  orders_seating?: number | null;
  cars_ranked?: number | null;
  seats_under_order?: number | null;
  seats_by_rank?: number | null;
  seats_pinned?: number | null;
  seats_unranked?: number | null;
  moved_ahead?: number | null;
  kind_named?: number | null;
  kind_followed?: number | null;
  by_order?: AgentOrderEntry[] | null;
}

/** ottoq_run_learning's agent_order block (0614): present only on a run that takes the agent's charge order. */
export interface AgentOrderBlock {
  /** An order stands right now (younger than its ttl). */
  live?: boolean | null;
  /** The kinds of charger free right now: dcfc | l2 | both | none. */
  mode?: string | null;
  /** A car that has waited this long (sim minutes) goes ahead of any order. */
  pin_wait_min?: number | null;
  order?: {
    order_id?: number | null;
    chain_id?: string | null;
    recorded_tick?: number | null;
    age_ticks?: number | null;
    status?: string | null;
    offered?: number | null;
    accepted?: number | null;
    why?: string | null;
    head?: { rank?: number | null; vehicle_id?: string | null; vehicle?: string | null; kind?: string | null; why?: string | null; kernel_pos?: number | null }[] | null;
  } | null;
  usage?: AgentOrderUsage | null;
}

/** public.ottoq_run_learning(p_sim_run_id, p_lookback_ticks, p_detail => true), as the RPC returns it. */
export interface RunLearning {
  ok?: boolean;
  error?: string | null;
  live?: boolean | null;
  run?: { tick?: number | null; clock?: string | null; status?: string | null; sim_run_id?: string | null } | null;
  window_ticks?: number | null;
  chargers?: { dcfc?: ChargerCount | null; l2?: ChargerCount | null } | null;
  chargers_free?: number | null;
  chargers_down?: { stall_id?: string; name?: string; kind?: string; fault_code?: string | null; back_at?: string | null }[] | null;
  queue?: { waiting?: number | null; waiting_for_a_charger?: number | null; order?: string | null } | null;
  batch?: { max_assets?: number | null; priority?: string[] | null } | null;
  offers?: { planners_recent?: PlannerTally | null; planners_run?: PlannerTally | null } | null;
  refusals?: LearningRefusal[] | null;
  dispatched?: LearningDispatch[] | null;
  lesson?: { code?: string | null; text?: string | null } | null;
  /** 0614: the agent's charge-line order and what the orders did. Absent on a run that does not take one. */
  agent_order?: AgentOrderBlock | null;
}

export type LearningTone = "ok" | "held" | "idle";

export interface LearningView {
  tone: LearningTone;
  /** One or two sentences: the lesson the planners and the agent read on their next pass. */
  headline: string;
  /** Short fact lines. Chargers and queue only while the run is live. */
  facts: string[];
  /** Offers the decide path refused, each with where the charger went. Newest first. */
  refusals: { key: string; text: string }[];
  /** Offers that moved to an equal free charger when theirs was taken, and were used. Newest first. */
  moved: { key: string; text: string }[];
  /** Where the numbers stand: the run's tick and the window they cover. */
  basis: string;
}

const n = (x: number | null | undefined): string => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("en-US"));
const count = (x: number | null | undefined, one: string, many = `${one}s`): string => `${n(x)} ${x === 1 ? one : many}`;
/** A tick is an ordinal, not a quantity: no thousands separator. */
const tk = (x: number | null | undefined): string => (x == null || !Number.isFinite(x) ? "—" : String(x));

/** Why an offer was refused, in two or three words for a tally. */
const REASON_SHORT: Record<string, string> = {
  stall_occupied: "charger taken",
  stall_reserved: "held for another car",
  newer_proposal_same_entity: "newer offer",
  entity_decided_by_other_proposal: "car placed by another offer",
  run_finalized: "run ended",
};
export const reasonShort = (r: string): string => REASON_SHORT[r] ?? r.replace(/_/g, " ");

function reasonTally(by: Record<string, number> | null | undefined): string {
  const parts = Object.entries(by ?? {})
    .filter(([, k]) => Number(k) > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([r, k]) => `${n(k)} ${reasonShort(r)}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function headlineOf(l: RunLearning): { tone: LearningTone; text: string } {
  const code = l.lesson?.code ?? "";
  const run = l.offers?.planners_run ?? {};
  const recent = l.offers?.planners_recent ?? {};
  const need = l.queue?.waiting_for_a_charger;
  const free = l.chargers_free;
  const batch = l.batch?.max_assets;
  const window = l.window_ticks;
  const by = recent.refused_by_reason ?? {};
  const lost = (by.stall_occupied ?? 0) + (by.stall_reserved ?? 0);
  switch (code) {
    case "run_ended":
      return {
        tone: "idle",
        text: run.offered === 0
          ? "The run ended. The planners made no offer in this run."
          : `The run ended. The planners made ${count(run.offered, "offer")}: ${n(run.used)} used, ${n(run.moved)} moved to an equal charger, ${n(run.refused)} refused.`,
      };
    case "no_one_waiting":
      return { tone: "idle", text: "No car waits for a charger." };
    case "more_cars_than_chargers":
      return {
        tone: "held",
        text: `${count(need, "car")} wait for ${count(free, "free charger")}. The planners plan only the next ${n(batch)}. `
          + "When an offered charger is taken first, a car ahead in line got it.",
      };
    case "offers_lost_their_charger":
      return {
        tone: "held",
        text: `${n(lost)} of the last ${count(recent.offered, "offer")} lost their charger before use. ${n(recent.moved)} moved to an equal free charger.`,
      };
    case "chargers_free":
      return {
        tone: "ok",
        text: `${count(free, "free charger")} for ${count(need, "waiting car")}. In the last ${count(window, "tick")}, the planners made ${count(recent.offered, "offer")}. The decide path used ${n(recent.used)}.`,
      };
    default:
      return { tone: "idle", text: "The run's learning has no lesson yet." };
  }
}

function refusalText(r: LearningRefusal): string {
  const who = sentenceCase(publicPhrase(r.source) ?? "a planner");
  const offer = `Tick ${tk(r.tick)}: ${who} offered ${r.stall ?? "a charger"} to ${r.vehicle ?? "a car"}.`;
  const w = r.went_to;
  if (!w) return `${offer} The decide path refused it${r.reason ? `: ${reasonShort(r.reason)}` : ""}.`;
  if (w.same_car) return `${offer} That car already had it.`;
  return `${offer} ${w.vehicle ?? "Another car"} got it at tick ${tk(w.tick)}.`;
}

/** The strip's words, or null when there is nothing to draw (no read yet, or a read that failed: see `learningError`). */
export function learningView(l: RunLearning | null | undefined): LearningView | null {
  if (!l || l.ok !== true) return null;
  const { tone, text } = headlineOf(l);
  const facts: string[] = [];
  const recent = l.offers?.planners_recent ?? {};
  if (l.live) {
    const dc = l.chargers?.dcfc ?? {};
    const l2 = l.chargers?.l2 ?? {};
    const down = (dc.faulted ?? 0) + (l2.faulted ?? 0);
    facts.push(`Free chargers: DCFC ${n(dc.free)} of ${n(dc.total)} · L2 ${n(l2.free)} of ${n(l2.total)}${down ? ` · ${count(down, "charger")} down` : ""}`);
    facts.push(`Waiting for a charger: ${n(l.queue?.waiting_for_a_charger)} · the planners plan the next ${n(l.batch?.max_assets)}`);
    facts.push(`Last ${count(l.window_ticks, "tick")}: ${count(recent.offered, "offer")} · ${n(recent.used)} used · ${n(recent.moved)} moved · ${n(recent.refused)} refused${reasonTally(recent.refused_by_reason)}`);
  }
  const refusals = (l.refusals ?? []).slice(0, 4).map((r, i) => ({ key: `r${r.tick ?? ""}:${r.vehicle_id ?? i}:${r.stall_id ?? ""}`, text: refusalText(r) }));
  const moved = (l.dispatched ?? [])
    .filter((d) => d.moved_from_offer)
    .slice(0, 3)
    .map((d, i) => ({
      key: `m${d.tick ?? ""}:${d.vehicle_id ?? i}`,
      text: `Tick ${tk(d.tick)}: the offer for ${d.vehicle ?? "a car"} moved to ${d.stall ?? "an equal charger"} when its first charger was taken.`,
    }));
  const basis = l.live
    ? `Tick ${tk(l.run?.tick)} · last ${count(l.window_ticks, "tick")} · the planners and the agent read this on each pass`
    : `Run ended at tick ${tk(l.run?.tick)}`;
  return { tone, headline: text, facts, refusals, moved, basis };
}

// ── the agent's charge-line order (otto-q-core 0614) ─────────────────────────────────────────────────────────────
export interface AgentOrderView {
  tone: LearningTone;
  /** One sentence: the order standing now, or the last one, and what the orders did over the run. */
  headline: string;
  /** Short fact lines: seats, cars moved ahead, kinds followed, the pin. */
  facts: string[];
  /** The order's head, rank by rank, in the agent's own words. */
  head: { key: string; text: string }[];
}

const KIND_WORD: Record<string, string> = { dcfc: "fast charger", l2: "L2", either: "either charger" };

/**
 * The agent's order, in words, or null when the run does not take one (the key is absent: the dial is off). Green when
 * an order has seated cars, amber while orders stand and no charger has freed for them yet, grey with no order at all.
 */
export function agentOrderView(l: RunLearning | null | undefined): AgentOrderView | null {
  const a = l?.ok === true ? l.agent_order : null;
  if (!a) return null;
  const u = a.usage ?? {};
  const o = a.order ?? null;
  const seated = u.seats_by_rank ?? 0;
  const tone: LearningTone = seated > 0 ? "ok" : (u.orders ?? 0) > 0 ? "held" : "idle";
  const fast = (o?.head ?? []).filter((c) => c.kind === "dcfc").length;
  let headline: string;
  if (!o) headline = "The agent has not ordered the charge line yet. The decide path seats cars in its own order.";
  else {
    const named = `${count(o.accepted, "car")}${fast ? `, ${n(fast)} of the first ${n(Math.min(8, o.head?.length ?? 0))} for a fast charger` : ""}`;
    headline = a.live
      ? `The agent's order stands: ${named}.`
      : `The agent's last order (${count(o.accepted, "car")}) has expired. The decide path seats cars in its own order until the next one.`;
    if (a.live && o.why) headline += ` ${sentenceCase(o.why.replace(/\.$/, ""))}.`;
  }
  const facts: string[] = [];
  facts.push(`Orders: ${n(u.orders)}, ${n(u.orders_seating)} of them seated cars · ${count(u.seats_by_rank, "car")} seated in the agent's order`);
  if ((u.seats_by_rank ?? 0) > 0) facts.push(`Moved ahead of the decide path's own order: ${n(u.moved_ahead)} · kind taken as named: ${n(u.kind_followed)} of ${n(u.kind_named)}`);
  facts.push(`Waited ${n(a.pin_wait_min)} sim-min or longer and went first anyway: ${count(u.seats_pinned, "car")}`);
  const head = a.live && o
    ? (o.head ?? []).map((c, i) => ({
        key: `h${o.order_id ?? ""}:${c.vehicle_id ?? i}`,
        text: `${n(c.rank)}. ${c.vehicle ?? "a car"} · ${KIND_WORD[c.kind ?? ""] ?? "either charger"}${c.why ? ` · ${c.why}` : ""}`,
      }))
    : [];
  return { tone, headline, facts, head };
}

/** The reason a read failed, for a strip that says so instead of drawing zeros. */
export function learningError(l: RunLearning | null | undefined, transport: string | null): string | null {
  if (transport) return transport;
  if (l && l.ok === false) return l.error ?? "the learning read failed";
  return null;
}
