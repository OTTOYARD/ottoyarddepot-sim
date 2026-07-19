// ============================================================================
// lanePaint — RAILS P2. Turns the LaneGraph into render-ready ROAD MARKINGS.
//
// Single source of truth: every stripe, arrow and stop bar below is DERIVED from
// the same directed graph the cars actually drive (LaneGraph + rightOffset), so
// the painted right-of-way can never drift from the routed motion. If a lane's
// direction changes in the graph, the paint changes with it — no hand-authored
// geometry to keep in sync.
//
// Emits, per lane:
//   • driveLine  — the offset centerline a car in THAT direction follows
//   • arrows     — travel-direction chevrons placed IN that lane
//   • stopBars   — at the mouth of one-way lanes where they meet a collector
//   • stripes    — the shared centerline of a two-way road (drawn once/pair)
//
// Both renderers (2D SVG + 3D ground decals) consume this, so they agree.
// ============================================================================
import type { Pt } from "./PathTracker";
import { LaneGraph } from "./LaneGraph";

export type LaneKind = "boulevard" | "avenue" | "gap" | "rear" | "gate";

export interface PaintedLane {
  id: string;
  from: string;
  to: string;
  /** the offset line a car travelling from→to actually drives */
  driveLine: Pt[];
  /** true when no reverse lane exists on this centerline */
  oneWay: boolean;
  kind: LaneKind;
}
export interface LaneArrow {
  x: number;
  y: number;
  /** heading in radians, y-DOWN frame (atan2(dy, dx)) */
  angle: number;
  oneWay: boolean;
  kind: LaneKind;
}
export interface StopBar {
  x: number;
  y: number;
  angle: number;
  /** bar length across the lane */
  width: number;
}
export interface CenterStripe {
  pts: Pt[];
  kind: LaneKind;
}
export interface LanePaint {
  lanes: PaintedLane[];
  arrows: LaneArrow[];
  stopBars: StopBar[];
  stripes: CenterStripe[];
}

const ARROW_SPACING = 18; // world units between chevrons
const ARROW_EDGE_MARGIN = 6; // don't paint arrows right on an intersection
const LANE_WIDTH = 4.8; // visual lane width (2 × rightOffset)

function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Classify a lane from its endpoint node ids (matches buildDepotLanes naming). */
export function classify(from: string, to: string): LaneKind {
  if (/^Sg\d+$/.test(from) && /^Ng\d+$/.test(to)) return "gap";
  if (/^R\d+$/.test(from) || /^R\d+$/.test(to)) return "rear";
  if (from === "ingress" || to === "egress") return "gate";
  // north/south collectors run east-west between x-ordered junctions
  if (/^(NW|NE|Ng\d+)$/.test(from) && /^(NW|NE|Ng\d+)$/.test(to)) return "boulevard";
  if (/^(SW|SE|Sg\d+|S_in|S_eg)$/.test(from) && /^(SW|SE|Sg\d+|S_in|S_eg)$/.test(to)) return "boulevard";
  return "avenue";
}

/** Walk a polyline emitting evenly spaced points with local heading. */
function sampleAlong(pts: Pt[], spacing: number, margin: number) {
  const out: { x: number; y: number; angle: number }[] = [];
  if (pts.length < 2) return out;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  if (total <= margin * 2) return out;

  let target = margin;
  let acc = 0;
  for (let i = 1; i < pts.length && target <= total - margin; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segLen = dist(a, b);
    if (segLen < 1e-6) continue;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    while (target <= acc + segLen && target <= total - margin) {
      const t = (target - acc) / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle });
      target += spacing;
    }
    acc += segLen;
  }
  return out;
}

/**
 * Build all road markings from the directed graph.
 * `graph.rightOffset` is reused verbatim so paint sits exactly where cars drive.
 */
export function paintLanes(graph: LaneGraph): LanePaint {
  const lanes: PaintedLane[] = [];
  const arrows: LaneArrow[] = [];
  const stopBars: StopBar[] = [];
  const stripes: CenterStripe[] = [];
  const seenPair = new Set<string>();

  for (const lane of graph.lanes.values()) {
    const reverseId = `${lane.to}>${lane.from}`;
    const oneWay = !graph.lanes.has(reverseId);
    const kind = classify(lane.from, lane.to);

    // the line a car in THIS direction drives (same offset the router applies)
    const driveLine = LaneGraph.offsetRight(lane.pts, graph.rightOffset);
    lanes.push({ id: lane.id, from: lane.from, to: lane.to, driveLine, oneWay, kind });

    // direction chevrons, in-lane
    for (const s of sampleAlong(driveLine, ARROW_SPACING, ARROW_EDGE_MARGIN)) {
      arrows.push({ x: s.x, y: s.y, angle: s.angle, oneWay, kind });
    }

    // two-way roads share ONE painted centre stripe — emit once per pair
    if (!oneWay) {
      const pairKey = [lane.id, reverseId].sort().join("|");
      if (!seenPair.has(pairKey)) {
        seenPair.add(pairKey);
        stripes.push({ pts: lane.pts.map((p) => ({ ...p })), kind });
      }
    }

    // stop bar where a ONE-WAY lane launches off a collector (gap mouths, gates)
    if (oneWay && (kind === "gap" || kind === "gate") && driveLine.length >= 2) {
      const a = driveLine[0];
      const b = driveLine[1];
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      // set the bar a little INTO the lane so it reads as a stop line, not a cap
      stopBars.push({
        x: a.x + Math.cos(angle) * 2.5,
        y: a.y + Math.sin(angle) * 2.5,
        angle,
        width: LANE_WIDTH,
      });
    }
  }

  return { lanes, arrows, stopBars, stripes };
}

export const LANE_PAINT_WIDTH = LANE_WIDTH;
