// stackModel — the OTTO-Q stack as a scene: four plates and everything on them, placed from engine records. Pure: no
// React, no three.js, so every position and colour here is tested without a GPU.
//
// Chase, 2026-09-30 ~1 AM CT: "majorly upgrade the visual depiction of the Otto-q funnel. Not just 2D, but More 3D and
// moving nodes/scaffolding etc." His two references are exploded stacks of plates (agentic / solver / deterministic /
// dispatch). This is that stack, in the engine's own order, and every object on it is one record:
//
//   AGENT      red glass    one chrome sphere per agent pass (ottoq_activity_feed_v2, action orchestrator_agent),
//                           joined to a pearl for the objective it chose. Amber: the pass fell back.
//   PLANNERS   dark metal   one bar per offer (ottoq_proposal_disposition_ledger), one lane per planner, coloured by
//                           what the decide path did with it.
//   DECIDE     tile grid    one tile per car decision (the feed, changes only), newest at the front. Red: the safety
//   + SAFETY                check overrode it. The shield is this plate's rim.
//   DEPOT      base         one puck per car in the depot (ottoq_depot_cards), in the zone its state puts it. Charger
//                           rows and bays are the site plan's real counts (sitePlan.generateStallsV2).
//
// Nothing is placed that no record carries, and a count past a zone's slots is reported, never dropped silently.
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import { generateStallsV2 } from "@/lib/sitePlan";
import { decisionKey, human } from "@/lib/decisionText";
import {
  CAR_ACTIONS, proposerWord, rowTone, stateLayer,
  type DispositionRow, type FunnelCardVehicle, type NodeTone,
} from "@/lib/ottoqFunnel";
import { agentPass } from "@/lib/agentStream";
import { hash01 } from "../funnelGeometry";

export type PlateId = "agent" | "planners" | "decide" | "safety" | "depot";

export interface PlateDef {
  id: PlateId;
  label: string;
  /** Two or three words, in the references' manner ("Predict & propose"), and true to the engine. */
  tagline: string;
  /** World height of the plate's top surface. */
  y: number;
}

/** Top to bottom: the order a decision falls through the engine. */
export const PLATES: readonly PlateDef[] = [
  { id: "agent", label: "Agent", tagline: "Read & propose", y: 17.6 },
  { id: "planners", label: "Planners", tagline: "Optimize & offer", y: 13.2 },
  { id: "decide", label: "Decide", tagline: "Choose one plan", y: 8.8 },
  { id: "safety", label: "Safety", tagline: "Check & enforce", y: 4.4 },
  { id: "depot", label: "Depot", tagline: "Dispatch & serve", y: 0 },
] as const;
export const PLATE_Y: Record<PlateId, number> = Object.fromEntries(PLATES.map((p) => [p.id, p.y])) as Record<PlateId, number>;

/** Plate footprint, in scene units (x across, z toward the viewer). */
export const PLATE_W = 10;
export const PLATE_D = 6.6;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ── agent ───────────────────────────────────────────────────────────────────
export interface PassNode {
  key: string;
  tone: "ok" | "held";
  objective: string;
  handoff: boolean;
  at: string;
  x: number;
  z: number;
  r: number;
  newest: boolean;
}
export interface HubNode { key: string; label: string; x: number; z: number; passes: number }
export interface AgentModel {
  passes: PassNode[];
  hubs: HubNode[];
  /** [x0, z0, x1, z1] pairs: pass → its objective, and each pass → the pass before it. */
  hubEdges: number[][];
  chainEdges: number[][];
}

const HUB_SPOTS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-2.1, -0.3], [2.3, 0.5]],
  3: [[-2.6, 0.7], [0.3, -1.2], [2.8, 0.9]],
};
export const MAX_PASSES = 30;

export function agentModel(rows: readonly ActivityFeedRow[]): AgentModel {
  const passRows = rows
    .filter((r) => r.action === "orchestrator_agent")
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || (b.decision_seq ?? 0) - (a.decision_seq ?? 0))
    .slice(0, MAX_PASSES);
  const objectives: string[] = [];
  for (const r of passRows) {
    const o = typeof r.rationale?.objective === "string" ? (r.rationale.objective as string) : "—";
    if (!objectives.includes(o) && objectives.length < 3) objectives.push(o);
  }
  const spots = HUB_SPOTS[Math.max(1, objectives.length)];
  const hubs: HubNode[] = objectives.map((o, i) => ({
    key: o, label: o === "—" ? "objective not recorded" : human(o), x: spots[i][0], z: spots[i][1], passes: 0,
  }));
  const n = passRows.length;
  const passes: PassNode[] = passRows.map((r, i) => {
    const p = agentPass(r);
    const o = typeof r.rationale?.objective === "string" ? (r.rationale.objective as string) : "—";
    const hub = hubs.find((h) => h.key === o) ?? hubs[hubs.length - 1];
    hub.passes++;
    const theta = 2 * Math.PI * hash01(p.key);
    // spread over the glass: wide across, shallower in depth, never on top of the objective's pearl
    const rho = 1.1 + (hubs.length === 1 ? 2.6 : 1.7) * Math.sqrt(hash01(`${p.key}:r`));
    return {
      key: p.key,
      tone: p.tone === "ok" ? "ok" : "held",
      objective: o,
      handoff: String(r.rationale?.handoff_status ?? "") === "completed",
      at: r.occurred_at,
      x: clamp(hub.x + rho * Math.cos(theta) * 1.35, -4.5, 4.5),
      z: clamp(hub.z + rho * Math.sin(theta) * 0.9, -2.8, 2.8),
      r: i === 0 ? 0.3 : 0.14 + 0.08 * (1 - i / Math.max(1, n)),
      newest: i === 0,
    };
  });
  const hubEdges = passes.map((p) => {
    const h = hubs.find((x) => x.key === p.objective) ?? hubs[hubs.length - 1];
    return [p.x, p.z, h.x, h.z];
  });
  const chainEdges: number[][] = [];
  for (let i = 0; i + 1 < passes.length; i++) chainEdges.push([passes[i].x, passes[i].z, passes[i + 1].x, passes[i + 1].z]);
  return { passes, hubs, hubEdges, chainEdges };
}

// ── planners ────────────────────────────────────────────────────────────────
export type BarTone = "ok" | "refused" | "replaced" | "declined";
export interface Bar { key: string; tone: BarTone; x: number; len: number; carId: string | null }
export interface Lane { word: string; z: number; bars: Bar[]; total: number }

export function barTone(d: DispositionRow): BarTone {
  if (d.abstained) return "declined";
  if (d.status === "enacted") return "ok";
  if (d.status === "refused") return "refused";
  return "replaced";
}

/** The order lanes are laid front to back when present. Two engine sources that are one planner share a lane. */
const LANE_ORDER = ["CP-SAT", "cuOpt", "the greedy planner", "the service-priority planner"];
export const BARS_PER_LANE = 11;
export const MAX_LANES = 4;

export function plannerModel(rows: readonly DispositionRow[]): Lane[] {
  const byWord = new Map<string, DispositionRow[]>();
  for (const d of rows) {
    const w = proposerWord(d.source);
    (byWord.get(w) ?? byWord.set(w, []).get(w)!).push(d);
  }
  let words = [...byWord.keys()].sort((a, b) => {
    const ia = LANE_ORDER.indexOf(a), ib = LANE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  if (words.length > MAX_LANES) {
    // Fold the rest into one lane rather than drop them.
    const rest = words.slice(MAX_LANES - 1);
    const merged = rest.flatMap((w) => byWord.get(w)!);
    words = [...words.slice(0, MAX_LANES - 1), "other planners"];
    byWord.set("other planners", merged);
  }
  const nL = words.length;
  return words.map((w, i) => {
    const list = [...byWord.get(w)!].sort((a, b) => b.disposition_id - a.disposition_id);
    return {
      word: w,
      z: nL === 1 ? 0 : -2.3 + (i * 4.6) / (nL - 1),
      total: list.length,
      bars: list.slice(0, BARS_PER_LANE).map((d, j) => ({
        key: `p${d.disposition_id}`, tone: barTone(d), x: -4.15 + j * 0.78, len: 0.62, carId: d.entity_id,
      })),
    };
  });
}

// ── decide + safety ─────────────────────────────────────────────────────────
export interface Tile { key: string; tone: NodeTone; x: number; z: number; carId: string | null; dest: DepotZone | "exit" | null }
export const TILE_COLS = 12;
export const TILE_ROWS = 6;

const newestFirst = (a: ActivityFeedRow, b: ActivityFeedRow) =>
  Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || (b.decision_seq ?? 0) - (a.decision_seq ?? 0);

/** Where an enacted decision sends its car, in depot zones. */
export function decisionDest(r: ActivityFeedRow): DepotZone | "exit" | null {
  if (r.outcome !== "enacted") return null;
  const v = (r.rationale ?? {}) as Record<string, unknown>;
  const verb = typeof v.verb === "string" ? v.verb : "";
  if (r.action === "redeployment" && verb === "deploy") return "exit";
  if (verb === "promote_ready") return "ready";
  if (verb === "admit_wash") return "wash";
  if (verb === "admit_service") return "service";
  if (verb === "assign_stall") {
    const kind = String(v.stall_type ?? v.wanted_type ?? "");
    if (kind === "dcfc") return "dcfc";
    if (kind === "l2") return "l2";
    return "booked";
  }
  return null;
}

export function decideModel(rows: readonly ActivityFeedRow[]): Tile[] {
  return rows
    .filter((r) => r.vehicle_id && CAR_ACTIONS.has(r.action))
    .sort(newestFirst)
    .slice(0, TILE_COLS * TILE_ROWS)
    .map((r, i) => ({
      key: decisionKey(r),
      tone: rowTone(r),
      x: -4.4 + (i % TILE_COLS) * 0.8,
      z: 2.15 - Math.floor(i / TILE_COLS) * 0.8,
      carId: r.vehicle_id || null,
      dest: decisionDest(r),
    }));
}

// ── depot ───────────────────────────────────────────────────────────────────
export type DepotZone = "road" | "gate" | "waiting" | "booked" | "dcfc" | "l2" | "hold" | "wash" | "service" | "repair" | "ready";

export interface ZoneDef {
  id: DepotZone;
  label: string;
  x0: number; z0: number;
  cols: number; rows: number;
  px: number; pz: number;
  /** A bay or charger zone: its slots are the site's real stalls, and a car's stall code picks its slot. */
  fixed: boolean;
}

const SITE = (() => {
  const c: Record<string, number> = {};
  for (const s of generateStallsV2()) c[s.type] = (c[s.type] ?? 0) + 1;
  return { dcfc: c.dcfc ?? 0, l2: c.l2 ?? 0, wash: c.wash ?? 0, service: c.service ?? 0 };
})();
export const SITE_COUNTS = SITE;

// The zones sit where their stalls sit on the real site (src/lib/sitePlan.ts), squeezed onto the plate: west is -x,
// north (the building and the wash) is -z, the gates are on the south (+z) edge and a car ENTERS AT THE EAST GATE and
// LEAVES BY THE WEST GATE, as the founder locked the site. Charger and bay zones hold the site's real stall counts.
const DC_ROWS = Math.max(1, Math.ceil(SITE.dcfc / 2));
const L2_ROWS = 5;
export const ZONES: readonly ZoneDef[] = [
  // the approach lane runs down the plate's east edge to the east gate in its south-east corner
  { id: "road", label: "On the way in", x0: 4.2, z0: -2.1, cols: 2, rows: 10, px: 0.4, pz: 0.4, fixed: false },
  { id: "gate", label: "East gate", x0: 1.3, z0: 2.3, cols: 7, rows: 2, px: 0.4, pz: 0.42, fixed: false },
  { id: "waiting", label: "Waiting for a plan", x0: 1.3, z0: -2.0, cols: 7, rows: 5, px: 0.4, pz: 0.4, fixed: false },
  { id: "booked", label: "Booked", x0: 1.3, z0: 0.3, cols: 7, rows: 3, px: 0.4, pz: 0.4, fixed: false },
  { id: "dcfc", label: "DCFC", x0: -3.15, z0: -1.75, cols: 2, rows: DC_ROWS, px: 0.5, pz: 0.45, fixed: true },
  { id: "l2", label: "L2", x0: -2.0, z0: -1.75, cols: Math.max(1, Math.ceil(SITE.l2 / L2_ROWS)), rows: L2_ROWS, px: 0.44, pz: 0.45, fixed: true },
  { id: "hold", label: "Between steps", x0: -2.0, z0: 0.75, cols: 7, rows: 2, px: 0.42, pz: 0.42, fixed: false },
  { id: "wash", label: "Wash / detail", x0: -0.75, z0: -2.7, cols: Math.max(1, SITE.wash), rows: 1, px: 0.7, pz: 0.7, fixed: true },
  { id: "service", label: "Service", x0: -2.55, z0: -2.7, cols: Math.max(1, SITE.service), rows: 1, px: 0.7, pz: 0.7, fixed: true },
  { id: "repair", label: "Repair", x0: -4.55, z0: -2.85, cols: 3, rows: 2, px: 0.38, pz: 0.36, fixed: false },
  { id: "ready", label: "Ready", x0: -4.55, z0: -1.75, cols: 3, rows: 9, px: 0.38, pz: 0.4, fixed: false },
];
/** Where a car that leaves goes: out through the west gate, in the plate's south-west corner (then it fades). */
export const EXIT_POINT = { x: -4.4, z: 2.75 };
/** Where a car on its way back comes from: the far (north) end of the approach lane. */
export const ENTRY_POINT = { x: 4.4, z: -2.95 };
/** How far inside the plate's edge every car must sit (a puck's radius, and a little air). */
export const PLATE_MARGIN = 0.22;
export const ZONE: Record<DepotZone, ZoneDef> = Object.fromEntries(ZONES.map((z) => [z.id, z])) as Record<DepotZone, ZoneDef>;
/** Capacity of the charger and bay zones is the site's real count, not the grid's. */
export const zoneCapacity = (z: ZoneDef): number =>
  z.id === "dcfc" ? SITE.dcfc : z.id === "l2" ? SITE.l2 : z.id === "wash" ? SITE.wash : z.id === "service" ? SITE.service : z.cols * z.rows;

export function zoneCenter(id: DepotZone): { x: number; z: number } {
  const z = ZONE[id];
  return { x: z.x0 + ((z.cols - 1) * z.px) / 2, z: z.z0 + ((z.rows - 1) * z.pz) / 2 };
}

const STATE_ZONE: Record<string, DepotZone> = {
  en_route_to_depot: "road",
  arrived_at_gate: "gate",
  staged_awaiting_service: "waiting",
  emergency_staged: "waiting",
  charging_dcfc: "dcfc",
  charging_l2: "l2",
  charge_complete_holding: "hold",
  service_complete_holding: "hold",
  in_wash_bay: "wash",
  in_detail_bay: "wash",
  in_service_bay: "service",
  tow_requested: "repair",
  out_of_service: "repair",
  staged_for_departure: "ready",
  en_route_to_deployment: "ready",
};

export function carZone(v: Pick<FunnelCardVehicle, "state" | "stall" | "reservations">): DepotZone | null {
  const z = STATE_ZONE[v.state ?? ""];
  if (!z) return null;
  if (z === "waiting" && stateLayer(v) === "booked") return "booked";
  return z;
}

/** A stall's number from its code ("NASH-L2-STALL-12" → 12), or null. */
export function stallNumber(code: string | null | undefined): number | null {
  const m = code ? /(\d+)\s*$/.exec(code) : null;
  return m ? Number(m[1]) : null;
}

export interface Puck { id: string; name: string; tone: NodeTone; zone: DepotZone; x: number; z: number }
export interface DepotModel {
  pucks: Puck[];
  overflow: Partial<Record<DepotZone, number>>;
  counts: Record<DepotZone, number>;
  /** Cars the engine reports deployed: the only ones a vanished puck may be shown driving out. */
  deployed: Set<string>;
  /** False when the cards have not answered for this run: then no car is shown arriving or leaving. */
  read: boolean;
}

export function depotModel(vehicles: readonly FunnelCardVehicle[], tones: ReadonlyMap<string, NodeTone>, read = true): DepotModel {
  const byZone = new Map<DepotZone, FunnelCardVehicle[]>();
  for (const v of vehicles) {
    const z = carZone(v);
    if (z) (byZone.get(z) ?? byZone.set(z, []).get(z)!).push(v);
  }
  const pucks: Puck[] = [];
  const overflow: Partial<Record<DepotZone, number>> = {};
  const counts = Object.fromEntries(ZONES.map((z) => [z.id, 0])) as Record<DepotZone, number>;
  for (const def of ZONES) {
    const list = byZone.get(def.id) ?? [];
    counts[def.id] = list.length;
    const cap = zoneCapacity(def);
    const taken = new Set<number>();
    const slotOf = new Map<string, number>();
    // A charger or bay car takes the slot its own stall number names, when that slot exists and is free.
    if (def.fixed) {
      for (const v of list) {
        const n = stallNumber(v.stall?.code);
        if (n != null && n >= 1 && n <= cap && !taken.has(n - 1)) { taken.add(n - 1); slotOf.set(v.vehicle_id, n - 1); }
      }
    }
    // Everyone else fills the free slots in a stable order (by id hash), so a car keeps its place between polls.
    const rest = list.filter((v) => !slotOf.has(v.vehicle_id)).sort((a, b) => hash01(a.vehicle_id) - hash01(b.vehicle_id) || (a.vehicle_id < b.vehicle_id ? -1 : 1));
    let s = 0;
    for (const v of rest) {
      while (taken.has(s)) s++;
      if (s >= cap) break;
      taken.add(s);
      slotOf.set(v.vehicle_id, s);
    }
    if (list.length > slotOf.size) overflow[def.id] = list.length - slotOf.size;
    for (const v of list) {
      const i = slotOf.get(v.vehicle_id);
      if (i == null) continue;
      pucks.push({
        id: v.vehicle_id,
        name: v.display_name ?? "—",
        tone: tones.get(v.vehicle_id) ?? "idle",
        zone: def.id,
        x: def.x0 + (i % def.cols) * def.px,
        z: def.z0 + Math.floor(i / def.cols) * def.pz,
      });
    }
  }
  const deployed = new Set(vehicles.filter((v) => v.state === "deployed").map((v) => v.vehicle_id));
  return { pucks, overflow, counts, deployed, read };
}

// ── events: records that arrived while watching ─────────────────────────────
export type StackEvent =
  | { kind: "pass"; key: string; tone: "ok" | "held"; handoff: boolean; at: string | null }
  | { kind: "offer"; key: string; tone: BarTone; lane: string; carId: string | null; at: string | null }
  | { kind: "decision"; key: string; tone: NodeTone; carId: string | null; dest: DepotZone | "exit" | null; at: string | null };

/** The keys every record in the reads carries; seeding the seen set with them makes the backlog silent. */
export function recordKeys(rows: readonly ActivityFeedRow[], dispositions: readonly DispositionRow[] | null): string[] {
  const keys: string[] = [];
  for (const r of rows) if (r.action === "orchestrator_agent" || (r.vehicle_id && CAR_ACTIONS.has(r.action))) keys.push(decisionKey(r));
  for (const d of dispositions ?? []) keys.push(`p${d.disposition_id}`);
  return keys;
}

function passEvent(r: ActivityFeedRow): StackEvent {
  const p = agentPass(r);
  return { kind: "pass", key: decisionKey(r), tone: p.tone === "ok" ? "ok" : "held", handoff: String(r.rationale?.handoff_status ?? "") === "completed", at: r.occurred_at };
}
function decisionEvent(r: ActivityFeedRow): StackEvent {
  return { kind: "decision", key: decisionKey(r), tone: rowTone(r), carId: r.vehicle_id, dest: decisionDest(r), at: r.occurred_at };
}
function offerEvent(d: DispositionRow): StackEvent {
  return { kind: "offer", key: `p${d.disposition_id}`, tone: barTone(d), lane: proposerWord(d.source), carId: d.entity_id, at: d.disposed_at };
}
const isPass = (r: ActivityFeedRow) => r.action === "orchestrator_agent";
const isCarDecision = (r: ActivityFeedRow) => !!r.vehicle_id && CAR_ACTIONS.has(r.action);
const feedTime = (r: ActivityFeedRow) => Date.parse(r.occurred_at) || 0;

/** Records not seen before, oldest first. Marks them seen. */
export function takeNewEvents(seen: Set<string>, rows: readonly ActivityFeedRow[], dispositions: readonly DispositionRow[] | null, cap = 48): StackEvent[] {
  const out: { e: StackEvent; t: number }[] = [];
  for (const r of rows) {
    const key = decisionKey(r);
    if (seen.has(key) || !(isPass(r) || isCarDecision(r))) continue;
    seen.add(key);
    out.push({ e: isPass(r) ? passEvent(r) : decisionEvent(r), t: feedTime(r) });
  }
  const offers: { e: StackEvent; t: number }[] = [];
  for (const d of dispositions ?? []) {
    const key = `p${d.disposition_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Offers carry wall time; they are ordered among themselves by id and interleaved after the decisions of their poll.
    offers.push({ e: offerEvent(d), t: d.disposition_id });
  }
  out.sort((a, b) => a.t - b.t);
  offers.sort((a, b) => a.t - b.t);
  // Interleave so a burst of offers does not wait behind every decision (and vice versa).
  const merged: StackEvent[] = [];
  const n = Math.max(out.length, offers.length);
  for (let i = 0; i < n; i++) {
    if (out[i]) merged.push(out[i].e);
    if (offers[i]) merged.push(offers[i].e);
  }
  return merged.slice(-cap);
}

// ── replay ──────────────────────────────────────────────────────────────────
/** Seconds between two replayed records. */
export const REPLAY_STEP_S = 0.6;
/** How many of the newest records of each kind a replay plays: 30 in all, about 18 seconds. */
export const REPLAY_PER = { pass: 6, offer: 10, decision: 14 } as const;

/**
 * A replay: the newest records on the plates, played through the stack again in the order they were written, for
 * someone watching a run that is writing none (ended, paused or quiet). It is asked for, never automatic, and the tab
 * says REPLAY for as long as it plays, so it can never pass for live. Only records whose object is on a plate are
 * played, so every bead starts and lands on something real. Passes and decisions share the feed's clock and play in
 * time order; offers carry the ledger's clock, so they keep their id order and are spread evenly among the rest (the
 * live stream's own compromise).
 */
export function replayEvents(
  model: StackModel,
  rows: readonly ActivityFeedRow[],
  dispositions: readonly DispositionRow[] | null,
  per: { pass: number; offer: number; decision: number } = REPLAY_PER,
): StackEvent[] {
  const passKeys = new Set(model.agent.passes.map((p) => p.key));
  const tileKeys = new Set(model.tiles.map((t) => t.key));
  const barKeys = new Set(model.planners.flatMap((l) => l.bars.map((b) => b.key)));
  const once = new Set<string>();
  const feed = rows
    .filter((r) => {
      const k = decisionKey(r);
      const on = isPass(r) ? passKeys.has(k) : isCarDecision(r) && tileKeys.has(k);
      if (!on || once.has(k)) return false;
      once.add(k);
      return true;
    })
    .sort((a, b) => feedTime(a) - feedTime(b) || (a.decision_seq ?? 0) - (b.decision_seq ?? 0));
  const passes = feed.filter(isPass).slice(-per.pass);
  const decisions = feed.filter((r) => !isPass(r)).slice(-per.decision);
  const timed = [...passes, ...decisions]
    .sort((a, b) => feedTime(a) - feedTime(b) || (a.decision_seq ?? 0) - (b.decision_seq ?? 0))
    .map((r) => (isPass(r) ? passEvent(r) : decisionEvent(r)));
  const offers = (dispositions ?? [])
    .filter((d) => barKeys.has(`p${d.disposition_id}`))
    .sort((a, b) => a.disposition_id - b.disposition_id)
    .slice(-per.offer)
    .map(offerEvent);
  const out: StackEvent[] = [];
  let i = 0, j = 0;
  while (i < timed.length || j < offers.length) {
    const fi = i < timed.length ? (i + 0.5) / timed.length : Infinity;
    const fj = j < offers.length ? (j + 0.5) / offers.length : Infinity;
    if (fi <= fj) out.push(timed[i++]);
    else out.push(offers[j++]);
  }
  return out;
}

// ── the plates' labels ──────────────────────────────────────────────────────
export interface PlateLabel { title: string; tagline: string; line: string }

/** One line per plate, beside it in the stack. A source that has not answered reads "—", never 0. */
export function plateLabels(i: {
  rows: readonly ActivityFeedRow[];
  dispositions: readonly DispositionRow[] | null;
  stack: { agent: { objective: string | null; chains: number | null; fallbacks: number | null } | null; shield: { evaluations: number | null; refused: number | null } | null } | null;
  /** The cars in the depot (ottoq_depot_cards), or null until the cards have answered for this run. */
  cars: readonly { layer: string }[] | null;
}): Record<PlateId, PlateLabel> {
  const n = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("en-US"));
  const byTitle = Object.fromEntries(PLATES.map((p) => [p.id, p])) as Record<PlateId, PlateDef>;
  const a = i.stack?.agent ?? null;
  const sh = i.stack?.shield ?? null;
  let offered = 0, enacted = 0, refused = 0;
  for (const d of i.dispositions ?? []) {
    if (d.abstained) continue;
    offered++;
    if (d.status === "enacted") enacted++;
    else if (d.status === "refused") refused++;
  }
  const carRows = i.rows.filter((r) => r.vehicle_id && CAR_ACTIONS.has(r.action));
  const ok = carRows.filter((r) => rowTone(r) === "ok").length;
  const holds = carRows.filter((r) => rowTone(r) === "held").length;
  const c = (l: string) => (i.cars ? i.cars.filter((x) => x.layer === l).length : null);
  const safety = sh && sh.evaluations != null ? `${n(sh.evaluations)} checks · ${n(sh.refused)} blocked` : "Checks: —";
  return {
    agent: {
      title: byTitle.agent.label, tagline: byTitle.agent.tagline,
      line: a && a.chains != null
        ? a.chains === 0 ? "No passes this run" : `${n(a.chains)} passes${a.fallbacks ? ` · ${n(a.fallbacks)} fell back` : ""}`
        : "Passes: —",
    },
    planners: {
      title: byTitle.planners.label, tagline: byTitle.planners.tagline,
      line: i.dispositions ? (i.dispositions.length === 0 ? "No offers yet" : `${n(offered)} offers · ${n(enacted)} used · ${n(refused)} refused`) : "Offers: —",
    },
    decide: {
      title: byTitle.decide.label, tagline: byTitle.decide.tagline,
      line: carRows.length ? `${n(ok)} enacted · ${n(holds)} held` : "No decisions yet",
    },
    safety: {
      title: byTitle.safety.label, tagline: byTitle.safety.tagline,
      line: safety,
    },
    depot: {
      title: byTitle.depot.label, tagline: byTitle.depot.tagline,
      line: i.cars == null ? "Waiting for the depot cards" : `${n(i.cars.length)} cars · ${n(c("service"))} in service · ${n(c("ready"))} ready`,
    },
  };
}

// ── tags: crisp words pinned to a zoomed plate (the plate's own silkscreen is too small to read) ──
export interface PlateTag { key: string; x: number; z: number; text: string; sub?: string; tone?: "ok" | "held" | "refused" | "dim" }

/** What each plate says about its own parts when it is zoomed, from the same records its objects are drawn from. */
export function plateTags(m: StackModel, shield: { evaluations: number | null; refused: number | null } | null): Record<PlateId, PlateTag[]> {
  const n = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("en-US"));
  const depot: PlateTag[] = [];
  for (const z of ZONES) {
    const count = m.depot.read ? m.depot.counts[z.id] : null;
    const cap = zoneCapacity(z);
    // over the zone's top edge, centred on it
    const x = z.x0 + ((z.cols - 1) * z.px) / 2;
    const zz = z.z0 - z.pz / 2 - 0.02;
    depot.push({
      key: z.id, x, z: zz, text: z.label,
      sub: count == null ? "—" : z.fixed ? `${n(count)} of ${n(cap)}` : n(count),
      tone: count && z.id === "ready" ? "ok" : count && (z.id === "repair") ? "refused" : count && (z.id === "waiting" || z.id === "gate") ? "held" : "dim",
    });
  }
  depot.push({ key: "in", x: 4.4, z: 3.02, text: "In ▲", tone: "dim" }, { key: "out", x: -4.4, z: 3.02, text: "◀ Out", tone: "dim" });
  const planners: PlateTag[] = m.planners.map((l) => ({
    key: l.word, x: -4.55, z: l.z - 0.42, text: l.word.replace(/^the /, ""),
    sub: ((k) => `${k} ${k === 1 ? "offer" : "offers"}`)(l.bars.filter((b) => b.tone !== "declined").length),
  }));
  if (m.planners.length) planners.push({ key: "newest", x: -4.55, z: 3.0, text: "newest ◀ ▶ older", tone: "dim" });
  const agent: PlateTag[] = m.agent.hubs.map((h) => ({ key: h.key, x: h.x, z: h.z + 0.5, text: h.label, sub: `${h.passes} ${h.passes === 1 ? "pass" : "passes"}` }));
  const decide: PlateTag[] = m.tiles.length
    ? [{ key: "front", x: -4.4, z: 2.75, text: "newest ▶", tone: "dim" }, { key: "back", x: 3.6, z: -2.55, text: "older", tone: "dim" }]
    : [{ key: "none", x: 0, z: 0, text: "No decisions yet", tone: "dim" }];
  const blocked = m.tiles.filter((t) => t.tone === "refused").length;
  const safety: PlateTag[] = [
    { key: "checks", x: 0, z: -0.1, text: shield?.evaluations != null ? `${n(shield.evaluations)} checks` : "Checks: —", sub: shield?.refused != null ? `${n(shield.refused)} blocked this run` : undefined, tone: shield?.refused ? "refused" : "ok" },
  ];
  if (blocked) safety.push({ key: "recent", x: 0, z: 1.2, text: `${blocked} of the newest decisions blocked`, tone: "refused" });
  return { agent, planners, decide, safety, depot };
}

export interface StackModel { agent: AgentModel; planners: Lane[]; tiles: Tile[]; depot: DepotModel }

export function stackModel(
  vehicles: readonly FunnelCardVehicle[],
  tones: ReadonlyMap<string, NodeTone>,
  rows: readonly ActivityFeedRow[],
  dispositions: readonly DispositionRow[] | null,
  read = true,
): StackModel {
  return { agent: agentModel(rows), planners: plannerModel(dispositions ?? []), tiles: decideModel(rows), depot: depotModel(vehicles, tones, read) };
}

// ── the tick sweep ──────────────────────────────────────────────────────────
/** The least time between two tick sweeps, in seconds: a fast run does not strobe. */
export const SWEEP_MIN_GAP_S = 5;

/**
 * Whether a new engine tick sweeps the stack. Every engine tick the engine goes over the whole depot, so a sweep per
 * tick is true even when nothing changes. None while the run is not running (tick null), on the first tick seen (no
 * change yet), on a repeated tick, in a hidden page, with reduced motion, or within SWEEP_MIN_GAP_S of the last.
 */
export function shouldSweep(i: { prevTick: number | null; tick: number | null; now: number; lastSweep: number; reduced: boolean; hidden: boolean }): boolean {
  if (i.tick == null || i.prevTick == null || i.tick === i.prevTick) return false;
  if (i.reduced || i.hidden) return false;
  return i.now - i.lastSweep >= SWEEP_MIN_GAP_S;
}
