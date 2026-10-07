// ottoqFunnel — the OTTO-Q tab's funnel, shaped from engine records. Pure: no React, no client, no clock.
//
// Chase, 2026-09-29: "picturing more of like a flow funnel diagram, it's alive and shows movement and maybe nodes
// moving between each funnel with an overview within each one ... it has either decisions being made or nodes
// green-lit". Design note: docs/OTTO-Q-FUNNEL-AND-AGENT-TABS.md.
//
// Two kinds of node, and nothing else is ever drawn:
//   a CAR    one ottoq_depot_cards vehicle, in the layer its state maps to (stateLayer). It moves only when a poll
//            reports it somewhere else.
//   a SPARK  one engine record that arrived since the last poll: an ottoq_activity_feed_v2 row (sparkFromRow) or an
//            ottoq_proposal_disposition_ledger row (sparkFromDisposition). It travels the path its record names.
//
// Layer order is the engine's, verified in ottoq_shield_and_log: the decide path CHOOSES, then the shield probe CHECKS
// the choice at enactment (a block writes overridden_to_default). So Safety check sits after Decide.
//
// The one rule: a missing fact is null (drawn "—"), never 0, and only an ENACTED record is ever green.
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import { decisionKey, human, modelErrorText, num } from "@/lib/decisionText";
import { serviceWord } from "@/lib/plainWords";
import { PUBLIC_NAME } from "@/lib/publicNames";

export type LayerId = "arriving" | "needs" | "proposers" | "decide" | "shield" | "booked" | "service" | "ready";
export type NodeTone = "ok" | "held" | "refused" | "idle";

export interface LayerDef {
  id: LayerId;
  label: string;
  /** 'place': cars rest here. 'think': decisions pass through; cars never rest. */
  kind: "place" | "think";
  /** One sentence: what this layer is, for the drill-in. */
  does: string;
}

export const LAYERS: readonly LayerDef[] = [
  { id: "arriving", label: "Arriving", kind: "place", does: "Cars on their way back and cars at the gate." },
  { id: "needs", label: "Needs", kind: "place", does: "Cars in the depot that wait for OTTO-Q to plan what they need." },
  { id: "proposers", label: "Proposers", kind: "think", does: "The agent sets the objective. The planners optimize it and offer stalls. They propose and never decide." },
  { id: "decide", label: "Decide", kind: "think", does: "The decide path chooses for each car. It takes an offer or not, or holds the car when nothing fits." },
  { id: "shield", label: "Safety check", kind: "think", does: "The rules check each choice when it is carried out. If a choice fails an enforced rule, the shield changes it." },
  { id: "booked", label: "Booked", kind: "place", does: "Cars that hold their stall or bay and have not started yet." },
  { id: "service", label: "Service", kind: "place", does: "Chargers, wash, detail and service bays, and cars between steps." },
  { id: "ready", label: "Ready", kind: "place", does: "Cars ready to leave. No car leaves below its charge target or with a service still needed." },
] as const;

export const LAYER_INDEX: Record<LayerId, number> = Object.fromEntries(LAYERS.map((l, i) => [l.id, i])) as Record<LayerId, number>;

// ── cars ────────────────────────────────────────────────────────────────────
/** The slice of an ottoq_depot_cards vehicle (contract 1.4) the funnel reads. */
export interface FunnelCardVehicle {
  vehicle_id: string;
  display_name: string | null;
  state: string | null;
  soc: number | null;
  target_soc: number | null;
  stall?: { id?: string | null; code: string | null; kind: string | null } | null;
  reservations?: { purpose?: string | null; starts_at?: string | null }[] | null;
  card?: { needs?: { svc: string; status: string | null; must_do?: boolean | null }[] | null } | null;
}

const PLACE_OF_STATE: Record<string, LayerId> = {
  en_route_to_depot: "arriving",
  arrived_at_gate: "arriving",
  staged_awaiting_service: "needs",
  emergency_staged: "needs",
  charging_dcfc: "service",
  charging_l2: "service",
  charge_complete_holding: "service",
  in_wash_bay: "service",
  in_detail_bay: "service",
  in_service_bay: "service",
  service_complete_holding: "service",
  tow_requested: "service",
  out_of_service: "service",
  staged_for_departure: "ready",
  en_route_to_deployment: "ready",
};

/** Outside the depot: counted, never drawn. */
export const AWAY_STATES = new Set(["deployed", "offline"]);

const STATE_WORD: Record<string, string> = {
  en_route_to_depot: "on its way back",
  arrived_at_gate: "at the gate",
  staged_awaiting_service: "waiting for a plan",
  emergency_staged: "emergency, staged",
  charging_dcfc: "fast charging",
  charging_l2: "charging",
  charge_complete_holding: "charged, waiting for its next step",
  in_wash_bay: "in the wash bay",
  in_detail_bay: "in the detail bay",
  in_service_bay: "in a service bay",
  service_complete_holding: "service done, waiting for its next step",
  tow_requested: "tow requested",
  out_of_service: "out of service",
  staged_for_departure: "staged to leave",
  en_route_to_deployment: "leaving",
};

export const stateWord = (state: string | null | undefined): string =>
  (state && STATE_WORD[state]) || human(state ?? "") || "—";

/** A car waiting in Needs that already holds a stall or a booking is Booked. Anything unknown is not drawn. */
export function stateLayer(v: Pick<FunnelCardVehicle, "state" | "stall" | "reservations">): LayerId | null {
  const s = v.state ?? "";
  const place = PLACE_OF_STATE[s];
  if (!place) return null;
  if (place === "needs" && (v.stall || (v.reservations?.length ?? 0) > 0)) return "booked";
  return place;
}

/** Needs the card still shows open. Anything that is not 'done' counts as open: the conservative reading (rule 9). */
export function openNeeds(v: FunnelCardVehicle): string[] {
  return (v.card?.needs ?? []).filter((n) => n.status !== "done").map((n) => n.svc);
}

const verbOf = (r: ActivityFeedRow): string => (typeof r.rationale?.verb === "string" ? (r.rationale.verb as string) : "");
const HOLD_VERBS = new Set(["hold_in_queue", "hold_no_space", "hold_in_staging", "hold_no_bay"]);

/** The tone a decision row gives its car. */
export function rowTone(r: ActivityFeedRow): NodeTone {
  if (r.outcome === "overridden_to_default") return "refused";
  if (r.outcome === "noop_no_candidate" || HOLD_VERBS.has(verbOf(r))) return "held";
  if (r.outcome === "enacted") return "ok";
  return "idle";
}

export interface FunnelCar {
  id: string;
  name: string;
  layer: LayerId;
  tone: NodeTone;
  /** Why the car has its tone, in words, or null. */
  why: string | null;
  state: string | null;
  soc: number | null;
  targetSoc: number | null;
}

/** Newest row per car, by the feed's own time then sequence. Only rows about a car (an entity other than the depot). */
export function latestByCar(rows: readonly ActivityFeedRow[]): Map<string, ActivityFeedRow> {
  const m = new Map<string, ActivityFeedRow>();
  for (const r of rows) {
    if (!r.vehicle_id || !CAR_ACTIONS.has(r.action)) continue;
    const prev = m.get(r.vehicle_id);
    const t = Date.parse(r.last_at ?? r.occurred_at);
    const pt = prev ? Date.parse(prev.last_at ?? prev.occurred_at) : -Infinity;
    if (!prev || t > pt || (t === pt && (r.decision_seq ?? 0) > (prev.decision_seq ?? 0))) m.set(r.vehicle_id, r);
  }
  return m;
}

export function carsFromCards(
  vehicles: readonly FunnelCardVehicle[],
  latest: ReadonlyMap<string, ActivityFeedRow>,
  cap = MAX_CARS,
): FunnelCar[] {
  const out: FunnelCar[] = [];
  for (const v of vehicles) {
    const layer = stateLayer(v);
    if (!layer) continue;
    const soc = num(v.soc), target = num(v.target_soc);
    const row = latest.get(v.vehicle_id);
    let tone: NodeTone = row ? rowTone(row) : "idle";
    let why: string | null = null;
    if (layer === "ready") {
      // Rule 9: a car below its target, or with a need open, is not ready, whatever its last decision said.
      const open = openNeeds(v);
      if (soc != null && target != null && soc < target) {
        tone = "held";
        why = `battery ${Math.round(soc)}% of its ${Math.round(target)}% target`;
      } else if (open.length) {
        tone = "held";
        why = `still needs ${open.map(serviceWord).join(", ")}`;
      } else if (soc == null || target == null) {
        // The battery is not on the card: not provably ready, so not green.
        tone = "idle";
        why = "battery not reported";
      } else {
        tone = "ok";
      }
    } else if (row && tone !== "ok") {
      why = tone === "refused" ? "a safety check overrode its last choice" : "waiting: its last decision was a hold";
    }
    out.push({ id: v.vehicle_id, name: v.display_name ?? "—", layer, tone, why, state: v.state ?? null, soc, targetSoc: target });
    if (out.length >= cap) break;
  }
  return out;
}

// ── sparks ──────────────────────────────────────────────────────────────────
export interface Spark {
  key: string;
  from: LayerId;
  to: LayerId;
  tone: NodeTone;
  /** When the engine recorded it: sim time for a decision, wall time for a disposition. */
  at: string | null;
  /** The car it was about, when it was about one. */
  carId: string | null;
  /** A few words: what happened. */
  label: string;
}

/** Actions about a car. The agent, the site battery and the challenger are not cars. */
export const CAR_ACTIONS = new Set([
  "stall_assignment", "task_start", "redeployment", "triage_verdict", "itinerary_amended",
  "gate_intake_no_charge", "bay_reconcile",
]);

/** Where an enacted, car-placing decision sends the car. */
function destinationOf(r: ActivityFeedRow): LayerId | null {
  const verb = verbOf(r);
  if (verb === "assign_stall") return "booked";
  if (verb === "admit_service" || verb === "admit_wash") return "service";
  if (verb === "promote_ready") return "ready";
  return null;
}

export function sparkFromRow(r: ActivityFeedRow): Spark | null {
  const key = decisionKey(r);
  const at = r.occurred_at ?? null;
  const verb = verbOf(r);
  if (r.action === "orchestrator_agent") {
    const fellBack = !!modelErrorText(r.rationale?.model_error) || r.outcome !== "enacted";
    return {
      key, from: "proposers", to: "proposers", tone: fellBack ? "held" : "ok", at, carId: null,
      label: fellBack ? "Agent pass fell back to the deterministic path" : `Agent chose ${human(r.rationale?.objective ?? "an objective")}`,
    };
  }
  if (!CAR_ACTIONS.has(r.action)) return null;
  const car = r.vehicle_id || null;
  const name = r.display_name || "a car";
  if (r.outcome === "overridden_to_default") {
    return { key, from: "decide", to: "shield", tone: "refused", at, carId: car, label: `Safety check overrode the choice for ${name}` };
  }
  if (r.action === "triage_verdict" || r.action === "gate_intake_no_charge" || verb === "gate_intake") {
    const escalate = verb === "triage_escalate";
    return {
      key, from: r.action === "triage_verdict" ? "needs" : "arriving", to: "needs", tone: escalate ? "held" : "ok", at, carId: car,
      label: r.action === "triage_verdict" ? `${name}: ${serviceWord(r.rationale?.svc as string)} ${escalate ? "escalated" : "confirmed"}` : `${name} taken in at the gate`,
    };
  }
  if (r.action === "redeployment" && verb === "deploy" && r.outcome === "enacted") {
    return { key, from: "ready", to: "ready", tone: "ok", at, carId: car, label: `${name} left ready` };
  }
  const tone = rowTone(r);
  if (tone === "held") {
    return { key, from: "decide", to: "decide", tone, at, carId: car, label: `${name} held` };
  }
  if (tone === "ok") {
    const dest = destinationOf(r);
    if (dest) return { key, from: "decide", to: dest, tone, at, carId: car, label: `${name} ${dest === "booked" ? "booked" : dest === "service" ? "admitted" : "ready"}` };
    return { key, from: "decide", to: "decide", tone: "idle", at, carId: car, label: `${name}: ${human(verb || r.action)}` };
  }
  return null;
}

/** One ottoq_proposal_disposition_ledger row, slimmed to what the tabs read. */
export interface DispositionRow {
  disposition_id: number;
  entity_id: string | null;
  source: string;
  status: string;
  disposition_reason: string | null;
  abstained: boolean;
  stall_id: string | null;
  disposed_at: string | null;
  disposed_tick: number | null;
}

/** Each proposal source by the name a sentence uses for it ("the lexicographic planner"), from src/lib/publicNames.ts. */
export const PROPOSER_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(PUBLIC_NAME).map(([k, v]) => [k, v.phrase]),
);
export const proposerWord = (source: string | null | undefined): string =>
  (source && PROPOSER_WORD[source]) || human(source ?? "") || "a planner";

export function sparkFromDisposition(d: DispositionRow): Spark {
  const key = `p${d.disposition_id}`;
  const who = proposerWord(d.source);
  if (d.status === "enacted" && !d.abstained) {
    return { key, from: "proposers", to: "shield", tone: "ok", at: d.disposed_at, carId: d.entity_id, label: `An offer from ${who} was enacted` };
  }
  if (d.status === "refused" && !d.abstained) {
    return { key, from: "proposers", to: "decide", tone: "refused", at: d.disposed_at, carId: d.entity_id, label: `An offer from ${who} was refused` };
  }
  return {
    key, from: "proposers", to: "proposers", tone: "idle", at: d.disposed_at, carId: d.entity_id,
    label: d.abstained ? `${who} declined to offer` : `An offer from ${who} was ${human(d.status)}`,
  };
}

// ── one-line overviews ──────────────────────────────────────────────────────
export interface DispositionTally { enacted: number; refused: number; superseded: number; expired: number; abstained: number; total: number }

export function tallyDispositions(rows: readonly DispositionRow[]): DispositionTally {
  const t: DispositionTally = { enacted: 0, refused: 0, superseded: 0, expired: 0, abstained: 0, total: rows.length };
  for (const d of rows) {
    if (d.abstained) t.abstained++;
    else if (d.status === "enacted") t.enacted++;
    else if (d.status === "refused") t.refused++;
    else if (d.status === "superseded") t.superseded++;
    else if (d.status === "expired") t.expired++;
  }
  return t;
}

/** The stack fields the overviews read (ottoq_intelligence_stack, 0351/0451/0456). */
export interface StackSlice {
  agent: { objective: string | null; chains: number | null; fallbacks: number | null } | null;
  shield: { evaluations: number | null; refused: number | null; recordedOnly: number | null } | null;
}

export interface OverviewInputs {
  vehicles: readonly FunnelCardVehicle[] | null;
  rows: readonly ActivityFeedRow[];
  dispositions: readonly DispositionRow[] | null;
  stack: StackSlice | null;
  /** False until the cards have answered once for this run. */
  cardsRead: boolean;
}

const n = (x: number | null | undefined): string => (x == null ? "—" : x.toLocaleString("en-US"));
const plural = (k: number, one: string, many = `${one}s`) => (k === 1 ? one : many);

function countStates(vehicles: readonly FunnelCardVehicle[], states: string[]): number {
  return vehicles.filter((v) => states.includes(v.state ?? "")).length;
}

/** One line per layer. A layer whose source has not answered says so, never "0". */
export function layerOverviews(i: OverviewInputs): Record<LayerId, string> {
  const vs = i.cardsRead ? i.vehicles ?? [] : null;
  const inLayer = (id: LayerId) => (vs ? vs.filter((v) => stateLayer(v) === id) : null);

  const arriving = vs
    ? `${n(countStates(vs, ["en_route_to_depot"]))} on the way · ${n(countStates(vs, ["arrived_at_gate"]))} at the gate`
    : "Waiting for the depot cards";

  const needCars = inLayer("needs");
  let needs = "Waiting for the depot cards";
  if (needCars) {
    const tally = new Map<string, number>();
    for (const v of needCars) for (const s of openNeeds(v)) tally.set(s, (tally.get(s) ?? 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1])[0];
    needs = `${n(needCars.length)} waiting for a plan${top ? ` · most need ${serviceWord(top[0])}` : ""}`;
  }

  const agent = i.stack?.agent;
  const agentPart = agent && agent.chains != null
    ? agent.chains === 0
      ? "Agent: no passes this run"
      : `Agent: ${human(agent.objective ?? "") || "—"}, ${n(agent.chains)} ${plural(agent.chains, "pass", "passes")}${agent.fallbacks ? `, ${n(agent.fallbacks)} fell back` : ""}`
    : "Agent: —";
  const t = i.dispositions ? tallyDispositions(i.dispositions) : null;
  const offerPart = t
    ? t.total === 0
      ? "no offers yet"
      : `offers ${n(t.enacted)} enacted, ${n(t.refused)} refused`
    : "offers —";

  const carRows = i.rows.filter((r) => CAR_ACTIONS.has(r.action));
  const placed = carRows.filter((r) => r.outcome === "enacted" && destinationOf(r) != null).length;
  const held = carRows.filter((r) => rowTone(r) === "held").length;
  const decide = carRows.length ? `${n(placed)} moves decided · ${n(held)} holds, last two sim-hours` : "No car decisions in the last two sim-hours";

  const sh = i.stack?.shield;
  const shield = sh && sh.evaluations != null
    ? `${n(sh.evaluations)} checks · ${n(sh.refused)} refused${sh.recordedOnly ? ` · ${n(sh.recordedOnly)} advisory notes` : ""}`
    : "Checks: —";

  const booked = inLayer("booked");
  const svc = vs;
  const service = svc
    ? `${n(countStates(svc, ["charging_dcfc", "charging_l2"]))} charging · ${n(countStates(svc, ["in_wash_bay", "in_detail_bay"]))} in wash or detail · ${n(countStates(svc, ["in_service_bay"]))} in service bays`
    : "Waiting for the depot cards";

  const left = i.rows.filter((r) => r.action === "redeployment" && verbOf(r) === "deploy" && r.outcome === "enacted").length;
  const readyCars = inLayer("ready");
  const ready = readyCars ? `${n(readyCars.length)} staged · ${n(left)} left in the last two sim-hours` : "Waiting for the depot cards";

  return {
    arriving,
    needs,
    proposers: `${agentPart} · ${offerPart}`,
    decide,
    shield,
    booked: booked ? `${n(booked.length)} holding their place` : "Waiting for the depot cards",
    service,
    ready,
  };
}

/** Pull the two stack layers the overviews read. Absent fields stay null. */
export function stackSlice(stack: { layers?: { layer: string; live: Record<string, unknown> | null }[] | null } | null): StackSlice | null {
  const layers = Array.isArray(stack?.layers) ? stack!.layers! : null;
  if (!layers) return null;
  const live = (id: string) => layers.find((l) => l.layer === id)?.live ?? null;
  const a = live("L2_AGENT"), s = live("L1_SHIELD");
  return {
    agent: a ? { objective: typeof a.objective === "string" ? a.objective : null, chains: num(a.chains), fallbacks: num(a.model_fallbacks) } : null,
    shield: s ? { evaluations: num(s.evaluations), refused: num(s.refused), recordedOnly: num(s.recorded_only) } : null,
  };
}

/** Rows that arrived since the last poll: new keys only, oldest first, at most `cap` (the newest kept). */
export function newSparks(prevKeys: ReadonlySet<string>, sparks: readonly Spark[], cap = MAX_SPARKS): Spark[] {
  const fresh = sparks.filter((s) => !prevKeys.has(s.key));
  fresh.sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""));
  return fresh.slice(-cap);
}

export const MAX_CARS = 160;
export const MAX_SPARKS = 60;
