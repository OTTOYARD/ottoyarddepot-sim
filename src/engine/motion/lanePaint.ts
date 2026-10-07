// ============================================================================
// lanePaint — RAILS P2. Turns the LaneGraph into render-ready ROAD MARKINGS.
//
// Single source of truth: every stripe, arrow and stop bar below is DERIVED from
// the same directed graph the cars actually drive (LaneGraph and each lane's own
// offset, LaneGraph.offsetOf), so the painted right-of-way can never drift from the
// routed motion. If a lane's direction changes in the graph, the paint changes with
// it — no hand-authored geometry to keep in sync.
//
// Emits, per lane:
//   • driveLine  — the offset centerline a car in THAT direction follows
//   • arrows     — travel-direction chevrons placed IN that lane
//   • stopBars   — at the mouth of one-way lanes where they meet a collector
//   • stripes    — the shared centerline of a two-way AISLE (drawn once/pair)
//   • medians    — the strip between the two streams of a DIVIDED road (once/pair)
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
/** One stretch of a divided road's median, between two junctions. */
export interface MedianStrip {
  /** the strip's two edges, each painted as a solid yellow line along the road */
  edges: [Pt[], Pt[]];
  /** short diagonal marks between the edges: centre, angle (y-DOWN atan2), length */
  hatch: { x: number; y: number; angle: number; len: number }[];
  /** clear width between the two lanes' painted edges (u) */
  width: number;
  kind: LaneKind;
}
export interface LanePaint {
  lanes: PaintedLane[];
  arrows: LaneArrow[];
  stopBars: StopBar[];
  stripes: CenterStripe[];
  medians: MedianStrip[];
}

const ARROW_SPACING = 18; // world units between chevrons
const ARROW_EDGE_MARGIN = 6; // don't paint arrows right on an intersection
// Visual lane width = 2 x LaneGraph.rightOffset, DERIVED not retyped. It was the
// literal 6.4 with "(2 × rightOffset = 2 × 3.2)" in a comment, which is a copy that
// nothing checked: changing rightOffset would have moved every car and left the paint
// where it was. The file header claims paint can "never drift from the routed motion";
// this is what makes that true for the width as well as the position. Every lane is
// painted this wide, a divided road's too: what a divided road adds is the space
// BETWEEN its two lanes (medians).
const LANE_WIDTH = new LaneGraph().rightOffset * 2;

// ── THE MEDIAN ──────────────────────────────────────────────────────────────
// Chase, 2026-10-06: the two directions of a divided road need "a slight median in
// the middle of just empty space". A divided road's drive lines are DIVIDED_SPAN (8u)
// apart, so its two 6.4u lanes leave a 1.6u (0.77 m) strip between them that no
// route uses. It is painted as a flush median: a solid yellow line along each edge
// with light diagonal hatching between — the marking for road space that is not
// driven on. It is NOT a kerb: a car turning left across the road at a junction
// crosses it, so it stops short of every junction (MEDIAN_END_GAP) and resumes past it.
/** How far short of a junction node the median ends (u): clear of a crossing lane's
 *  6.4u band and of the corner a car turning across it takes (fillets to R 5.8u). */
const MEDIAN_END_GAP = 8;
/** A stretch shorter than this between two junction gaps is left unpainted (u). */
const MEDIAN_MIN_LEN = 6;
/** The yellow edge line's centre, this far inside the strip's edge (u). */
const MEDIAN_EDGE_INSET = 0.25;
/** Spacing of the hatch marks along the strip (u). */
const MEDIAN_HATCH_SPACING = 3;

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
 * Does the median of road a–b carry straight on through node `n`? Only when `n` joins
 * this road to ONE other divided road running on in the same line, and nothing else:
 * no lane crosses there, so there is nothing to leave a gap for. (No node on today's
 * depot qualifies — every ring node is a junction or a corner.)
 */
function medianRunsThrough(graph: LaneGraph, n: string, other: string): boolean {
  const neighbours = new Set<string>();
  for (const l of graph.lanes.values()) {
    if (l.from === n) neighbours.add(l.to);
    if (l.to === n) neighbours.add(l.from);
  }
  neighbours.delete(other);
  if (neighbours.size !== 1) return false;
  const [next] = neighbours;
  if (!graph.isDivided(`${n}>${next}`) || !graph.isDivided(`${next}>${n}`)) return false;
  const N = graph.nodes.get(n)!, A = graph.nodes.get(other)!, B = graph.nodes.get(next)!;
  const ux = N.x - A.x, uy = N.y - A.y, vx = B.x - N.x, vy = B.y - N.y;
  return (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)) > 0.999;
}

/** The median of the divided road whose a→b lane is `lane`, or null when the stretch
 *  between its junction gaps is too short to paint. */
function medianOf(graph: LaneGraph, lane: { id: string; from: string; to: string; pts: Pt[] }, kind: LaneKind): MedianStrip | null {
  const reverse = `${lane.to}>${lane.from}`;
  const oAB = graph.offsetOf(lane.id), oBA = graph.offsetOf(reverse);
  const width = oAB + oBA - LANE_WIDTH;
  if (width <= 2 * MEDIAN_EDGE_INSET) return null;
  const P = lane.pts[0], Q = lane.pts[lane.pts.length - 1];
  const L = dist(P, Q);
  if (L < 1e-6) return null;
  const ux = (Q.x - P.x) / L, uy = (Q.y - P.y) / L;
  // y-DOWN: right of (ux,uy) is (-uy,ux). The a→b stream drives oAB to the right of
  // the centreline and the b→a stream oBA to its left, so the strip's middle is
  // (oAB - oBA) / 2 to the right.
  const nx = -uy, ny = ux, mid = (oAB - oBA) / 2;
  const s0 = medianRunsThrough(graph, lane.from, lane.to) ? 0 : MEDIAN_END_GAP;
  const s1 = L - (medianRunsThrough(graph, lane.to, lane.from) ? 0 : MEDIAN_END_GAP);
  if (s1 - s0 < MEDIAN_MIN_LEN) return null;
  const at = (s: number, lat: number): Pt => ({ x: P.x + ux * s + nx * lat, y: P.y + uy * s + ny * lat });
  const e = width / 2 - MEDIAN_EDGE_INSET;
  const edges: [Pt[], Pt[]] = [[at(s0, mid - e), at(s1, mid - e)], [at(s0, mid + e), at(s1, mid + e)]];
  // diagonal marks spanning the space between the edge lines, at 45° to the road
  const hatch: MedianStrip["hatch"] = [];
  const angle = Math.atan2(uy, ux) + Math.PI / 4;
  const len = (2 * e - 2 * MEDIAN_EDGE_INSET) * Math.SQRT2;
  const n = Math.floor((s1 - s0) / MEDIAN_HATCH_SPACING);
  const first = s0 + ((s1 - s0) - (n - 1) * MEDIAN_HATCH_SPACING) / 2;
  for (let i = 0; i < n && len > 0; i++) {
    const c = at(first + i * MEDIAN_HATCH_SPACING, mid);
    hatch.push({ x: c.x, y: c.y, angle, len });
  }
  return { edges, hatch, width, kind };
}

/**
 * Build all road markings from the directed graph.
 * Each lane's own offset (LaneGraph.offsetOf) is reused verbatim so paint sits
 * exactly where cars drive.
 */
export function paintLanes(graph: LaneGraph): LanePaint {
  const lanes: PaintedLane[] = [];
  const arrows: LaneArrow[] = [];
  const stopBars: StopBar[] = [];
  const stripes: CenterStripe[] = [];
  const medians: MedianStrip[] = [];
  const seenPair = new Set<string>();

  for (const lane of graph.lanes.values()) {
    const reverseId = `${lane.to}>${lane.from}`;
    const oneWay = !graph.lanes.has(reverseId);
    const kind = classify(lane.from, lane.to);

    // the line a car in THIS direction drives (same offset the router applies)
    const driveLine = LaneGraph.offsetRight(lane.pts, graph.offsetOf(lane.id));
    lanes.push({ id: lane.id, from: lane.from, to: lane.to, driveLine, oneWay, kind });

    // direction chevrons, in-lane
    for (const s of sampleAlong(driveLine, ARROW_SPACING, ARROW_EDGE_MARGIN)) {
      arrows.push({ x: s.x, y: s.y, angle: s.angle, oneWay, kind });
    }

    // a two-way road is marked down its middle ONCE per pair: a dashed centre stripe
    // on an aisle, a median between the streams of a divided road
    if (!oneWay) {
      const pairKey = [lane.id, reverseId].sort().join("|");
      if (!seenPair.has(pairKey)) {
        seenPair.add(pairKey);
        if (graph.isDivided(lane.id)) {
          const m = medianOf(graph, lane, kind);
          if (m) medians.push(m);
        } else {
          stripes.push({ pts: lane.pts.map((p) => ({ ...p })), kind });
        }
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

  return { lanes, arrows, stopBars, stripes, medians };
}

export const LANE_PAINT_WIDTH = LANE_WIDTH;
