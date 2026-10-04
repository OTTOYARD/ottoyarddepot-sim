// liveFeed — the Agent tab's live stream: every decision OTTO-Q writes, one plain-English line each, newest first.
//
// Chase, 2026-10-01: "I'm picturing more of a live stream or feed of single actions and decisions that rapidly comes
// through one at a time, and then for larger or multiple decisions, there can be a chunk or larger tile that has all of
// them in that one. … one line at a time still plain English and explains what happened and where, like vehicle 128
// finished charging, now approved for dispatch to washing bay, or temporarily staging until wash bay free."
//
// Every line is one record of ottoq_activity_feed_v2 (or one tick of the offer ledger, or one agent pass, or one command
// an owner's agent sent, otto-q-core 0608); nothing is inferred that the record does not carry. A place is named only
// when the record names it (its target stall code).
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import { describeDecision, human, num } from "@/lib/decisionText";
import { placeName, ruleWords } from "@/lib/plainWords";
import { agentPass, type AgentPass, type OfferBatch, type StreamTone } from "@/lib/agentStream";

export type FeedKind = "car" | "agent" | "offers" | "energy" | "owner";

/** What an owner's agent's command carries on its line (built by ownerBoard.ownerFeedLine). */
export interface OwnerFeed {
  /** OTTO-Q's confirmation code ("OQ-XXXX-XXXX"), on an applied command only. */
  code: string | null;
  /** Where it stands since it was sent: undone, or lifted with its run. */
  note: string | null;
  /** When it was sent, in real time ("11:11 PM CT"), and the sim clock then ("7:00 AM sim time"). */
  sent: string | null;
  sim: string | null;
  /** The rest of OTTO-Q's receipt, as the agent got it. */
  more: string[];
}

export interface FeedLine {
  key: string;
  kind: FeedKind;
  at: string | null;
  tick: number | null;
  tone: StreamTone;
  /** The car's name, when the line is about one car. */
  car: string | null;
  carId: string | null;
  /** The one line, in plain English. */
  text: string;
  /** A short class for grouping a burst: lines of one tick and one class become one tile. */
  verb: string;
  pass?: AgentPass;
  batch?: OfferBatch;
  owner?: OwnerFeed;
}

export interface FeedGroup {
  key: string;
  kind: "group";
  at: string | null;
  tick: number | null;
  tone: StreamTone;
  /** "Tick 96 · 5 cars dispatched" */
  title: string;
  lines: FeedLine[];
}

export type FeedItem = FeedLine | FeedGroup;

const pct = (x: unknown) => { const n = num(x); return n == null ? null : `${Math.round(n)}%`; };
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const TONE: Record<string, StreamTone> = { enacted: "ok", held: "held", warn: "refused", idle: "idle" };

/** Why a car goes to a charger, from what the record says it needs. */
function chargeWhy(v: Record<string, unknown>): string {
  const type = String(v.stall_type ?? "");
  if (type === "dcfc" || type === "l2") return "to charge";
  const p = human(v.purpose) || human(v.need);
  return p ? `for ${p}` : "";
}

/** One car decision as one line, or null for rows that are not about a car. */
export function carLine(r: ActivityFeedRow): FeedLine | null {
  if (!r.vehicle_id || r.action === "orchestrator_agent" || r.action === "bess_dispatch") return null;
  const v = (r.rationale ?? {}) as Record<string, unknown>;
  const verb = typeof v.verb === "string" ? v.verb : "";
  const reason = typeof v.reason === "string" ? v.reason : r.reason ?? "";
  const name = r.display_name || "A car";
  const at = r.occurred_at;
  const base = { key: `c${r.decision_seq ?? `${at}|${r.vehicle_id}|${r.action}`}`, kind: "car" as const, at, tick: r.tick_seq ?? null, car: name, carId: r.vehicle_id };
  const line = (text: string, tone: StreamTone, cls: string): FeedLine => ({ ...base, text, tone, verb: cls });

  if (r.outcome === "overridden_to_default") {
    const codes = Array.isArray(v.override_rule_codes) ? ruleWords(v.override_rule_codes as string[]) : "";
    return line(`Safety check stopped ${name}'s ${r.action === "stall_assignment" ? "stall choice" : "next step"}${codes ? ` to protect ${codes}` : ""}`, "refused", "blocked");
  }
  switch (`${r.action}:${verb}`) {
    case "stall_assignment:assign_stall": {
      const where = placeName(r.target, typeof v.stall_type === "string" ? v.stall_type : null) || "a stall";
      const soc = pct(v.soc);
      const wanted = typeof v.wanted_type === "string" && typeof v.stall_type === "string" && v.wanted_type !== v.stall_type
        ? ` (a ${placeName(null, v.wanted_type)} was wanted)` : "";
      return line(`${name} → ${where} ${chargeWhy(v)}${soc ? ` · ${soc} now` : ""}${wanted}`.replace(/\s+·/, " ·").replace(/\s+/g, " ").trim(), "ok", "assigned");
    }
    case "stall_assignment:gate_intake":
      return line(`${name} checked in at the gate`, "ok", "arrived");
    case "stall_assignment:hold_no_space":
      return line(`${name} waits in staging: no free ${human(v.purpose) || "space"} yet`, "held", "waiting");
    case "redeployment:deploy": {
      const soc = pct(v.soc), floor = pct(v.floor);
      return line(`${name} dispatched${soc ? ` at ${soc}` : ""}${floor ? ` (needs ${floor} to leave)` : ""}`, "ok", "dispatched");
    }
    case "task_start:promote_ready": {
      const step = String(v.step ?? "");
      const deferred = Array.isArray(v.deferred) ? (v.deferred as string[]).map(human) : [];
      if (step === "need_service") return line(`${name}: service bays full → service moved to its next visit${deferred.length ? ` (${deferred.join(", ")})` : ""}`, "held", "deferred");
      if (step === "ready") return line(`${name}: every task done → ready to depart`, "ok", "ready");
      if (step === "need_charge") return line(`${name}: no bay work needed → next: charge`, "idle", "next");
      if (step === "need_deploy") return line(`${name}: done here → waiting to deploy`, "idle", "next");
      if (step === "overnight_draining") return line(`${name}: parked for the night`, "idle", "next");
      return line(`${name}: no bay work needed${step ? ` → next: ${human(step)}` : ""}`, "idle", "next");
    }
    case "task_start:admit_wash":
      return line(`${name} → ${placeName(r.target, "wash") || "wash bay"}${v.purpose ? ` (${human(v.purpose)})` : ""}`, "ok", "bay");
    case "task_start:admit_service":
      return line(`${name} → ${placeName(r.target, "service") || "service bay"}${v.step ? ` for ${human(v.step)}` : ""}`, "ok", "bay");
    case "task_start:skip_wash":
      return line(`${name}: no wash needed → skipped`, "idle", "next");
    case "task_start:hold_no_bay":
      return line(`${name} waits: no ${human(v.purpose) || "bay"} bay free${v.must_do ? " (must-do work)" : ""}`, "held", "waiting");
    case "task_start:hold_in_queue": {
      const waited = num(v.waited_min), patience = num(v.patience_min);
      return line(`${name} waits for a service bay${waited != null && patience != null ? ` · ${waited} of ${patience} min` : ""}`, "held", "waiting");
    }
    case "triage_verdict:triage_confirm":
      return line(`${name}: ${human(v.svc) || "service"} confirmed as needed`, "ok", "triage");
    case "triage_verdict:triage_clear":
      return line(`${name}: ${human(v.svc) || "service"} not needed → cleared`, "ok", "triage");
    case "triage_verdict:triage_escalate":
      return line(`${name}: ${human(v.svc) || "service"} escalated for a closer look`, "held", "triage");
  }
  if (r.action === "stall_assignment" && (reason === "no_compatible_available_stall" || r.outcome === "noop_no_candidate")) {
    return line(`${name} waits: no compatible stall free yet`, "held", "waiting");
  }
  const d = describeDecision(r);
  return line(`${name}: ${d.title}${d.detail ? ` · ${d.detail}` : ""}`, TONE[d.tone] ?? "idle", r.action);
}

/** The depot battery and other rows that are not about one car. */
export function siteLine(r: ActivityFeedRow): FeedLine | null {
  if (r.action !== "bess_dispatch") return null;
  const v = (r.rationale ?? {}) as Record<string, unknown>;
  const soc = pct(v.soc_pct);
  const base = { key: `s${r.decision_seq ?? r.occurred_at}`, kind: "energy" as const, at: r.occurred_at, tick: r.tick_seq ?? null, car: null, carId: null, verb: "energy" };
  if (v.verb === "set_bess") return { ...base, tone: "ok", text: `Site battery: ${human(v.mode) || human(v.bess_action) || "set"}${soc ? ` · ${soc}` : ""}` };
  return { ...base, tone: "idle", text: "Site battery on standby: no energy plan running" };
}

const GROUP_TITLE: Record<string, (k: number) => string> = {
  assigned: (k) => `${plural(k, "car")} sent to stalls`,
  dispatched: (k) => `${plural(k, "car")} dispatched`,
  ready: (k) => `${plural(k, "car")} ready to depart`,
  waiting: (k) => `${plural(k, "car")} waiting for space`,
  next: (k) => `${plural(k, "car")} moved to their next step`,
  bay: (k) => `${plural(k, "car")} admitted to bays`,
  deferred: (k) => `${plural(k, "car")} had service deferred`,
  triage: (k) => `${plural(k, "car")} triaged`,
  blocked: (k) => `${plural(k, "choice")} stopped by the safety check`,
};
/** A burst of this many lines of one class in one tick becomes one tile. */
export const GROUP_AT = 3;

/**
 * The stream: agent passes, offer ticks and every car and site decision, newest first, a burst folded into a tile.
 * A car decision written over and over (a held car re-checked each tick) shows once, at its newest. `owners` (the
 * commands owners' agents sent, as ownerBoard.ownerFeedLines builds them) join it by time (withOwnerLines).
 */
export function liveFeed(rows: readonly ActivityFeedRow[], batches: readonly OfferBatch[], owners: readonly FeedLine[] = []): FeedItem[] {
  const lines: FeedLine[] = [];
  for (const r of rows) {
    if (r.action === "orchestrator_agent") {
      const p = agentPass(r);
      // the row carries an AGENT badge, so the line drops "The agent": "read the depot and chose to get cars ready first"
      lines.push({ key: `a${p.key}`, kind: "agent", at: p.at, tick: p.tick, tone: p.tone, car: null, carId: null, text: p.headline.replace(/^The agent /, ""), verb: "agent", pass: p });
      continue;
    }
    const l = siteLine(r) ?? carLine(r);
    if (l) lines.push(l);
  }
  for (const b of batches) lines.push({ key: `o${b.key}`, kind: "offers", at: b.at, tick: b.tick, tone: b.tone, car: null, carId: null, text: b.headline.replace(/^The planners' offers: /, ""), verb: "offers", batch: b });
  const t = (l: FeedLine) => Date.parse(l.at ?? "") || 0;
  lines.sort((a, b) => (b.tick ?? -1) - (a.tick ?? -1) || t(b) - t(a) || (a.kind === "agent" ? -1 : 1));
  // a held car re-checked tick after tick: its newest line only
  const seen = new Set<string>();
  const dedup = lines.filter((l) => {
    if (l.kind !== "car" || l.tone !== "held") return true;
    const k = `${l.carId}|${l.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // fold bursts: within one tick, a class with GROUP_AT or more car lines becomes one tile, where its first line was
  const out: FeedItem[] = [];
  let i = 0;
  while (i < dedup.length) {
    const tick = dedup[i].tick;
    let j = i + 1;
    while (j < dedup.length && tick != null && dedup[j].tick === tick) j++;
    const block = dedup.slice(i, j);
    const byVerb = new Map<string, FeedLine[]>();
    for (const l of block) if (l.kind === "car" && tick != null) (byVerb.get(l.verb) ?? byVerb.set(l.verb, []).get(l.verb)!).push(l);
    const placed = new Set<string>();
    for (const l of block) {
      const run = l.kind === "car" ? byVerb.get(l.verb) : undefined;
      if (run && run.length >= GROUP_AT && GROUP_TITLE[l.verb]) {
        if (placed.has(l.verb)) continue;
        placed.add(l.verb);
        out.push({ key: `g${tick}:${l.verb}:${run[0].key}`, kind: "group", at: run[0].at, tick, tone: run[0].tone, title: GROUP_TITLE[l.verb](run.length), lines: run });
      } else out.push(l);
    }
    i = j;
  }
  return withOwnerLines(out, owners);
}

/**
 * Owners' agents' commands, placed in the stream by the SIM clock they were sent at (the feed's `at` is sim time too).
 * That clock is the run's, which stands at its last tick until the next one, so a command goes above every decision
 * written at or before it and below the next tick's: the order it really happened in. Commands sent at the same sim
 * clock keep the order they are given in (newest sent first). One without a sim clock goes last. Never folded into a
 * tile: each is one person's agent asking for something.
 */
export function withOwnerLines(items: readonly FeedItem[], owners: readonly FeedLine[]): FeedItem[] {
  if (!owners.length) return items as FeedItem[];
  const time = (x: { at: string | null }): number | null => {
    const t = Date.parse(x.at ?? "");
    return Number.isFinite(t) ? t : null;
  };
  const queue = owners
    .map((l, i) => ({ l, t: time(l), i }))
    .sort((a, b) => (b.t ?? -Infinity) - (a.t ?? -Infinity) || a.i - b.i);
  const out: FeedItem[] = [];
  let q = 0;
  for (const it of items) {
    const t = time(it);
    // an item with no clock stays where the stream put it; the commands wait for the next one that has one
    while (t !== null && q < queue.length && queue[q].t !== null && queue[q].t! >= t) out.push(queue[q++].l);
    out.push(it);
  }
  while (q < queue.length) out.push(queue[q++].l);
  return out;
}
