// decisionTrail — one car's visit as a plain-English timeline, and the depot's funnel, from reads that already exist.
//
// Chase, 2026-09-28: "Like scenario requested by vehicle, scanned, found best solution, proposed, passed, dispatched.
// But then all variability and combinations that might coincide with the OTTO-Q funnel of thinking and orchestration."
//
// Sources (all read-only, all open to the cockpit's anon key; no new RPC):
//   ottoq_activity_feed_v2(p_vehicle_id)  the car's decisions, changes only, each with how long it stood (0452-0455, 0536)
//   ottoq_decisions                       the same decisions' safety-check results, joined on decision_seq
//   ottoq_external_proposals              the planners' offers for the car, compared at the tick the choice was made
//   ottoq_depot_cards                     what the car needs, when it is due, its plan steps (contract 1.4)
//
// Pure: no React, no client. Every sentence comes from plainWords' templates; a fact the reads do not carry prints as
// "not recorded" rather than being filled in.
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import {
  MISSING, STEP_LABEL, arrivedText, blockedText, checkedText, clockCT, doneText, minutesBetween, optionsText,
  ownerRequestText, pickedText, placeName, replannedText, safetyText, sentText, serviceAddedText, serviceWord,
  waitedText, type Sentence, type TrailStepKind,
} from "./plainWords";

// ── inputs ──────────────────────────────────────────────────────────────────
/** One ottoq_decisions row, slimmed to what the trail reads. */
export interface TrailDecision {
  decision_seq: number;
  tick_seq: number | null;
  sim_clock: string | null;
  overridden: boolean | null;
  override_rule_codes: string[] | null;
  rule_results: { rule_code?: string; passed?: boolean }[] | null;
  /** The stall the enacted action names, when it names one. */
  stall_id?: string | null;
}

/** One ottoq_external_proposals row, slimmed. `end_min` is minutes from the proposing tick to the plan's ready time. */
export interface TrailProposal {
  tick_seq: number | null;
  status: string | null;
  stall_id: string | null;
  abstain: boolean;
  end_min: number | null;
}

/** The slice of an ottoq_depot_cards vehicle the trail reads (the cockpits type the whole contract in cards.ts). */
export interface TrailCardStep {
  seq: number;
  leg_type: string;
  status: "done" | "current" | "upcoming";
  planned_end: string | null;
  progress_pct?: number | null;
  atom?: string | null;
}
export interface TrailCard {
  vehicle_id: string;
  display_name: string;
  state: string | null;
  soc: number | null;
  target_soc: number | null;
  stall: { id: string; code: string | null; kind: string | null } | null;
  reservations?: { purpose: string | null; booked_by: string | null; starts_at: string | null; need_atom?: string | null }[];
  card: {
    dispatch_due_at: string | null;
    needs: { svc: string; status: string }[];
    steps: TrailCardStep[];
    current_step: TrailCardStep | null;
    next_step: TrailCardStep | null;
  } | null;
}

// ── output ──────────────────────────────────────────────────────────────────
export type StepTone = "ok" | "branch" | "warn" | "missing";
export interface TrailStep extends Sentence {
  kind: TrailStepKind;
  at: string | null;
  tone: StepTone;
  /** Branch lines (re-planned, waited, service added, owner request, blocked) render indented, as asides. */
  branch: boolean;
}
export interface Trail {
  vehicleId: string;
  name: string;
  steps: TrailStep[];
  /** The step the car is on, in a few words, for the card at rest. */
  now: string;
  /** What comes after it, or null when nothing is planned. */
  next: string | null;
  /** 0..100, or null when the reads carry no progress. */
  progress: number | null;
  left: boolean;
}

// ── vocabulary of the feed ──────────────────────────────────────────────────
const verbOf = (r: ActivityFeedRow): string => (typeof r.rationale?.verb === "string" ? (r.rationale.verb as string) : "");
const reasonOf = (r: ActivityFeedRow): string =>
  typeof r.rationale?.reason === "string" ? (r.rationale.reason as string) : "";
const numOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Decisions that put the car somewhere. */
const SEND_VERBS = new Set(["assign_stall", "admit_service", "admit_wash"]);
/** Every verb that is OTTO-Q producing a plan for a car (a send, a gate intake, a departure). */
const PLAN_VERBS = new Set([...SEND_VERBS, "gate_intake", "deploy"]);
/** Actions about a car (the agent, the depot battery and the challenger are not cars). */
const CAR_ACTIONS = new Set([
  "stall_assignment", "task_start", "redeployment", "triage_verdict", "itinerary_amended",
  "gate_intake_no_charge", "bay_reconcile",
]);

export const isCarRow = (r: ActivityFeedRow): boolean => !!r.vehicle_id && CAR_ACTIONS.has(r.action);
const isSend = (r: ActivityFeedRow): boolean => SEND_VERBS.has(verbOf(r)) && r.outcome === "enacted";
const isDeploy = (r: ActivityFeedRow): boolean => r.action === "redeployment" && verbOf(r) === "deploy" && r.outcome === "enacted";
const isOverridden = (r: ActivityFeedRow): boolean => r.outcome === "overridden_to_default";
const isWait = (r: ActivityFeedRow): boolean =>
  !isOverridden(r) &&
  (r.outcome === "noop_no_candidate" || ["hold_in_queue", "hold_no_space", "hold_in_staging"].includes(verbOf(r)) ||
    reasonOf(r) === "wash_lane_full_hold");

const byTime = (a: ActivityFeedRow, b: ActivityFeedRow): number =>
  Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || (a.decision_seq ?? 0) - (b.decision_seq ?? 0);

/** A car's rows split into visits: each visit ends at the departure that closes it. Oldest first. */
export function splitVisits(rows: readonly ActivityFeedRow[]): ActivityFeedRow[][] {
  const visits: ActivityFeedRow[][] = [];
  let cur: ActivityFeedRow[] = [];
  for (const r of [...rows].filter(isCarRow).sort(byTime)) {
    cur.push(r);
    if (isDeploy(r)) { visits.push(cur); cur = []; }
  }
  if (cur.length) visits.push(cur);
  return visits;
}

/** Sim time of a tick, read from any of the car's decisions made on it. */
function tickClock(decisions: readonly TrailDecision[], tick: number | null | undefined): string | null {
  if (tick == null) return null;
  return decisions.find((d) => d.tick_seq === tick && d.sim_clock)?.sim_clock ?? null;
}
const addMin = (iso: string, min: number): string => new Date(Date.parse(iso) + min * 60_000).toISOString();

function safetyOf(d: TrailDecision | undefined): { passed: number | null; failed: string[] } {
  if (!d) return { passed: null, failed: [] };
  const results = Array.isArray(d.rule_results) ? d.rule_results : null;
  const failed = [
    ...(d.override_rule_codes ?? []),
    ...(results ?? []).filter((x) => x.passed === false && x.rule_code).map((x) => x.rule_code as string),
  ];
  return { passed: results ? results.filter((x) => x.passed === true).length : null, failed: [...new Set(failed)] };
}

const WAIT_WHY = (r: ActivityFeedRow): string => {
  const verb = verbOf(r);
  if (reasonOf(r) === "wash_lane_full_hold") return "Wash bay full";
  if (verb === "hold_in_queue") return "Service bays busy";
  if (verb === "hold_in_staging") return "Kept parked until it can leave";
  const wanted = typeof r.rationale?.wanted_type === "string" ? (r.rationale.wanted_type as string) : null;
  if (verb === "hold_no_space") return `No free ${placeName(null, (r.rationale?.purpose as string) ?? wanted) || "space"}`;
  return wanted ? `No free ${placeName(null, wanted)}` : "No compatible stall free";
};

const THEN_AFTER_BLOCK: Record<string, string> = {
  hold_in_queue: "Kept it in line instead.",
  hold_in_staging: "Kept it parked instead.",
  hold_no_space: "Kept it waiting instead.",
};

/** Minutes a standing verdict held, from the feed's own first/last times (0455), or null. */
const heldMin = (r: ActivityFeedRow): number | null => minutesBetween(r.occurred_at, r.last_at ?? null);

const OWNER_BOOKER = /owner|operator|fleet|customer|manual/i;

export interface TrailInputs {
  vehicleId: string;
  name: string;
  rows: readonly ActivityFeedRow[];
  decisions?: readonly TrailDecision[];
  proposals?: readonly TrailProposal[];
  /** The car's depot card now, or the last one seen this session (a card goes null once the car has left). */
  card?: TrailCard | null;
}

/** The car's latest visit as a trail. */
export function buildTrail(inp: TrailInputs): Trail {
  const decisions = inp.decisions ?? [];
  const proposals = inp.proposals ?? [];
  const decisionBySeq = new Map(decisions.map((d) => [d.decision_seq, d]));
  const visits = splitVisits(inp.rows);
  const visit = visits[visits.length - 1] ?? [];
  const card = inp.card ?? null;
  const work = card?.card ?? null;
  const steps: TrailStep[] = [];
  const push = (kind: TrailStepKind, s: Sentence, at: string | null, tone: StepTone = "ok") =>
    steps.push({ kind, ...s, at, tone, branch: !["arrived", "checked", "options", "picked", "safety", "sent", "done"].includes(kind) });

  // 1. Arrived
  const arrivedAt = visit[0]?.occurred_at ?? null;
  const needs = (work?.needs ?? []).map((n) => n.svc);
  push("arrived", arrivedText({ needs, targetBattery: card?.target_soc ?? null, readyBy: work?.dispatch_due_at ?? null }),
    arrivedAt, work ? "ok" : "missing");

  // Owner requests (bookings a person made) sit right after arrival.
  for (const b of card?.reservations ?? []) {
    if (b.booked_by && OWNER_BOOKER.test(b.booked_by)) {
      push("owner_request", ownerRequestText({ what: serviceWord(b.need_atom ?? null) || serviceWord(b.purpose) || null, at: b.starts_at }), b.starts_at, "branch");
    }
  }

  // 2..6. Walk the visit in time order. The first send carries the full funnel (checked, options, picked, safety);
  // later sends (a service bay after the charger, parking after both) are one line each.
  let firstSendDone = false;
  /** Why the car is waiting, while its latest line is a wait; the card at rest says so rather than just "Waited". */
  let waitingFor: string | null = null;
  let checked = false;
  for (const r of visit) {
    const verb = verbOf(r);
    const at = r.occurred_at;
    const d = r.decision_seq != null ? decisionBySeq.get(r.decision_seq) : undefined;
    if (!isWait(r) && verb !== "promote_ready") waitingFor = null;

    if (!checked && (r.action === "stall_assignment" || isSend(r))) {
      checked = true;
      const wanted =
        (typeof r.rationale?.wanted_type === "string" ? (r.rationale.wanted_type as string) : null) ??
        (typeof r.rationale?.stall_type === "string" ? (r.rationale.stall_type as string) : null);
      push("checked", checkedText({ wanted, free: r.outcome === "noop_no_candidate" ? 0 : null, waiting: null }), at);
    }

    if (isOverridden(r)) {
      const s = safetyOf(d);
      const failed = s.failed.length ? s.failed : ((r.rationale?.override_rule_codes as string[] | undefined) ?? []);
      push("blocked", blockedText({ failed, then: THEN_AFTER_BLOCK[verb] ?? "Took the safe default instead." }), at, "warn");
      continue;
    }
    if (isWait(r)) {
      push("waited", waitedText({ why: WAIT_WHY(r), minutes: heldMin(r) }), at, "branch");
      waitingFor = WAIT_WHY(r);
      continue;
    }
    if (r.action === "itinerary_amended") {
      const s = numOf(r.rationale?.shift_s);
      push("replanned", replannedText({ minutes: s == null ? null : Math.round(s / 60), cause: "Plan re-timed" }), at, "branch");
      continue;
    }
    if (r.action === "bay_reconcile" && verb === "displace_and_bind") {
      push("replanned", replannedText({ minutes: null, cause: "Moved to another bay" }), at, "branch");
      continue;
    }
    if (r.action === "triage_verdict") {
      const v = verb.replace(/^triage_/, "") as "confirm" | "escalate" | "clear";
      push("service_added", serviceAddedText({ service: (r.rationale?.svc as string) ?? null, verdict: v }), at, "branch");
      continue;
    }
    if (verb === "promote_ready" && Array.isArray(r.rationale?.deferred) && (r.rationale!.deferred as unknown[]).length) {
      const deferred = (r.rationale!.deferred as string[]).map(serviceWord);
      push("replanned", { title: "Service moved to next visit", detail: `${deferred.join(", ")}: bays full, and it can wait.` }, at, "branch");
      continue;
    }
    if (isSend(r)) {
      const place = placeName(r.target, (r.rationale?.stall_type as string) ?? (r.rationale?.purpose as string) ?? null) || null;
      const s = safetyOf(d);
      if (!firstSendDone) {
        firstSendDone = true;
        // Options: the planners' offers on the tick the choice was made.
        const tick = d?.tick_seq ?? r.tick_seq ?? null;
        const offers = proposals.filter((p) => !p.abstain && p.tick_seq != null && p.tick_seq === tick);
        const chosenStall = d?.stall_id ?? null;
        const ids = new Set(offers.map((p) => p.stall_id ?? "?"));
        const n = offers.length ? ids.size + (chosenStall && !ids.has(chosenStall) ? 1 : 0) : null;
        push("options", optionsText(n), at, n == null ? "missing" : "ok");
        const clock = tickClock(decisions, tick);
        const readyOf = (p: TrailProposal) => (clock && p.end_min != null ? addMin(clock, p.end_min) : null);
        const chosen =
          offers.find((p) => p.status === "enacted") ?? offers.find((p) => !!chosenStall && p.stall_id === chosenStall) ?? null;
        const others = offers.filter((p) => p !== chosen).map(readyOf).filter((x): x is string => !!x).sort();
        const why = r.rationale?.power_downgrade === true ? "The fast chargers were taken, so a slower one" : null;
        // With no planner offer to read it from, the chosen plan's ready time is the car's own plan: when its last
        // work step is planned to end (driving, parking and leaving are not work).
        const planReady = (work?.steps ?? [])
          .filter((st) => !["taxi", "stage", "depart"].includes(st.leg_type) && st.planned_end)
          .map((st) => st.planned_end as string).sort().pop() ?? null;
        const ready = chosen ? readyOf(chosen) : planReady;
        push("picked", pickedText({ place: place ?? MISSING, ready, nextBest: chosen ? others[0] ?? null : null, why }),
          at, ready ? "ok" : "missing");
        push("safety", safetyText(s), at, s.passed == null ? "missing" : "ok");
        push("sent", sentText({ place, at }), at);
      } else {
        const sent = sentText({ place, at });
        const checks = s.passed != null ? `${s.passed} safety ${s.passed === 1 ? "check" : "checks"} passed` : null;
        push("sent", { title: sent.title, detail: [sent.detail, checks].filter(Boolean).join(" · ") }, at);
      }
      continue;
    }
    if (isDeploy(r)) {
      const done = (work?.needs ?? []).filter((n) => n.status === "done").map((n) => n.svc);
      const carried = (work?.needs ?? []).filter((n) => n.status === "deferred").map((n) => n.svc);
      push("done", doneText({
        battery: numOf(r.rationale?.soc), servicesDone: done, servicesCarried: carried,
        leftAt: at, due: work?.dispatch_due_at ?? null,
      }), at);
    }
  }

  const left = visit.length > 0 && isDeploy(visit[visit.length - 1]);
  const cur = work?.current_step ?? null;
  const nxt = work?.next_step ?? null;
  const allSteps = work?.steps ?? [];
  const doneSteps = allSteps.filter((s) => s.status === "done").length;
  const now = left
    ? "Left the depot"
    : cur ? stepWords(cur)
    : waitingFor ? `Waiting: ${waitingFor.charAt(0).toLowerCase()}${waitingFor.slice(1)}`
    : steps.length ? steps[steps.length - 1].title : "No decisions yet";
  const progress = left ? 100
    : allSteps.length ? Math.round(((doneSteps + (numOf(cur?.progress_pct) ?? 0) / 100) / allSteps.length) * 100)
    : null;
  return {
    vehicleId: inp.vehicleId, name: inp.name, steps, now,
    next: left ? null : nxt ? stepWords(nxt) : null,
    progress, left,
  };
}

/** A plan step in words: "fast charge", "inspection", "leave". */
export function stepWords(s: TrailCardStep): string {
  const w = serviceWord(s.atom || s.leg_type);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

// ── the depot funnel ────────────────────────────────────────────────────────
export interface FunnelCounts {
  asked: number;
  planned: number;
  passed: number;
  sent: number;
  /** Cars that left ready. Throughput is OTTO-Q's main objective, so this is the headline. */
  done: number;
  branches: { replanned: number; waited: number; blocked: number; serviceAdded: number };
}

/** Cars through each stage, counted as distinct cars from the changes-only feed, from `since` on (null = whole run). */
export function depotFunnel(rows: readonly ActivityFeedRow[], since: string | null = null): FunnelCounts {
  const t0 = since ? Date.parse(since) : -Infinity;
  const sets = {
    asked: new Set<string>(), planned: new Set<string>(), passed: new Set<string>(), sent: new Set<string>(), done: new Set<string>(),
    replanned: new Set<string>(), waited: new Set<string>(), blocked: new Set<string>(), serviceAdded: new Set<string>(),
  };
  for (const r of rows) {
    if (!isCarRow(r) || Date.parse(r.occurred_at) < t0) continue;
    const id = r.vehicle_id;
    const verb = verbOf(r);
    sets.asked.add(id);
    if (PLAN_VERBS.has(verb) || isOverridden(r)) sets.planned.add(id);
    if (PLAN_VERBS.has(verb) && r.outcome === "enacted") sets.passed.add(id);
    if (isSend(r)) sets.sent.add(id);
    if (isDeploy(r)) sets.done.add(id);
    if (r.action === "itinerary_amended" || verb === "displace_and_bind") sets.replanned.add(id);
    if (isWait(r)) sets.waited.add(id);
    if (isOverridden(r)) sets.blocked.add(id);
    if (verb === "triage_confirm" || verb === "triage_escalate") sets.serviceAdded.add(id);
  }
  return {
    asked: sets.asked.size, planned: sets.planned.size, passed: sets.passed.size, sent: sets.sent.size, done: sets.done.size,
    branches: {
      replanned: sets.replanned.size, waited: sets.waited.size, blocked: sets.blocked.size, serviceAdded: sets.serviceAdded.size,
    },
  };
}

export const FUNNEL_LABEL: Record<"asked" | "planned" | "passed" | "sent" | "done", string> = {
  asked: "Asked",
  planned: "Planned",
  passed: "Passed safety",
  sent: "Sent",
  done: "Done",
};

export const BRANCH_LABEL: Record<keyof FunnelCounts["branches"], string> = {
  replanned: STEP_LABEL.replanned,
  waited: STEP_LABEL.waited,
  blocked: "Stopped by safety",
  serviceAdded: STEP_LABEL.service_added,
};

/** "since 1:05 PM" for a window that starts at `since`. */
export const windowLabel = (since: string | null): string => (since ? `since ${clockCT(since)}` : "whole run");
