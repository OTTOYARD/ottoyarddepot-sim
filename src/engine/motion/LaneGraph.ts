// ============================================================================
// LaneGraph — the depot's ONE-WAY directed road network.
//
// Cars never free-roam; they route along real lanes. The graph is a set of
// centerline nodes + DIRECTED lanes (edges). Routing is Dijkstra over lane
// length; the resulting centerline polyline is then shifted "drive-on-the-right"
// so opposing streams separate into a left + right side and cars pass BESIDE
// each other, never head-on / through each other.
//
// Topology (one-way-loop, deadlock-resistant per the research):
//   • A two-way divided RING: south & north boulevards (y=172 / y=74) and west &
//     east avenues (x=30 / x=275). Both travel directions exist as directed
//     edges on the same centerline; the right-offset puts them on opposite sides.
//   • One-way NORTHBOUND gap lanes through the canopy band at the sitePlan gap-x
//     (80 / 126.5 / 173.5 / 220). Cars enter from the south boulevard, drive
//     NORTH past the chargers (so every charging car faces north toward the
//     wash/service bays), and exit onto the north boulevard.
//   • Ingress spur (south) feeds the ring; egress spur drains it.
//
// Stall pull-ins/outs and bay/parking spurs are handled by the integration as
// maneuvers off the nearest lane node — this module owns the road network only.
// ============================================================================
import type { Pt } from "./PathTracker";
import {
  GAP_LANES, NORTH_LANE_Y, SOUTH_LANE_Y, WEST_AISLE_X, EAST_AISLE_X, INGRESS, EGRESS,
  REAR_LANE_Y, TEMP_LANE_X, N1_LANE_Y, PARK_RUNS,
} from "@/lib/sitePlan";

interface Lane {
  id: string;
  from: string;
  to: string;
  pts: Pt[]; // centerline polyline from→to (usually 2 points; gap lanes straight)
  length: number;
}
interface Node {
  id: string;
  x: number;
  y: number;
  out: string[]; // outgoing lane ids
}

function len(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** How far ahead of its projection a car joining a lane aims (u). About one car
 *  length: the merge reads as a lean into the lane, not a sideways hop onto it. */
const JOIN_LEAD = 8;
/** routeOff: the farthest a stall's turn-in may lie from the lane line a car leaves
 *  the road from (u). The south rows' turn-ins sit 19.2u off the collector's far
 *  (westbound) lane line; every other staging turn-in is within 13u of its lane. */
const OFF_REACH = 22;
/** routeOff: how far the move off the lane may deviate from the way the car parks. */
const OFF_ALIGN = (50 * Math.PI) / 180;
/** routeOff: how far beyond the end of a lane a turn-in may lie and still be taken
 *  from it (u). The south rows' corner stalls sit 6u past the ring corner; a stall
 *  farther round the corner than this falls back to the nearest-node route. */
const OFF_SLIP = 7;
/** Longest miter offsetRight will take, as a multiple of the lane offset. 2 allows
 *  every join up to a 120° turn exactly; sharper ones are clamped. */
const MITER_LIMIT = 2;
/** What turning about at a node costs a route, in units of road (see LaneGraph.search).
 *  A CHOICE between two ways of going (the two ways a back-out can swing, the two ways
 *  out of a gap lane onto the collector) differs by tens of units, so this decides every
 *  one of those against the U-turn. Reversing direction for real is another matter: on
 *  this depot the way round a block to come back along the same road is 390-490u
 *  (eastbound on the south collector at Sg1 to westbound there: east to SE, up the east
 *  avenue, west to Tn, down the temp aisle and back: 491u), so a car re-tasked to
 *  somewhere behind it still turns about rather than lapping the lot for it. */
export const U_TURN_COST = 150;
/** A search state: a node, and the node it was reached from ("" at the start). */
const stateKey = (node: string, came: string | null) => `${node}|${came ?? ""}`;
function splitState(s: string): [string, string | null] {
  const i = s.indexOf("|");
  const came = s.slice(i + 1);
  return [s.slice(0, i), came === "" ? null : came];
}

/**
 * Drive line to drive line across a DIVIDED road: the perimeter ring the founder locked
 * as two-way divided, the north and south collectors and the west and east avenues.
 * Chase, 2026-10-06: the lanes "should also be spaced wide enough with potential slight
 * median in the middle of just empty space that completely separates the two oncoming
 * lanes from one another so they're not touching."
 *
 * At 2 x rightOffset = 6.4u two 4.0u bodies passed 2.4u (1.15 m) apart with only a
 * dashed stripe between them. At 8u they pass 4.0u (1.91 m, a car's width) apart, and
 * the two 6.4u lanes leave a 1.6u (0.77 m) median between them that nothing is routed
 * on (lanePaint.medians draws it).
 *
 * WHERE THE EXTRA 1.6u GOES WAS MEASURED, NOT SPLIT DOWN THE MIDDLE. The avenues have
 * room on both sides and take half each, 4.0u a side (the east avenue's bodies keep
 * 1.77u from the TE and E stall faces, the west avenue's 2.77u from the W faces). Each
 * collector has the canopies on ONE side, and the stream on that side cannot move
 * toward them:
 *   - north collector, EASTBOUND: a car turning left off it into wash bay 3 swings its
 *     tail toward canopy C's spine column. From this lane, drawn as stepRail draws it,
 *     it clears by 0.33u (TwinMotionDriver's bay branch); 0.8u further south, no
 *     forecourt point within 5u of the bay clears the column and the wash brushes
 *     (best -0.19u: contact).
 *   - south collector, WESTBOUND: the southernmost charger back-outs end with their
 *     tails 1.0u short of this stream's design-vehicle envelope
 *     (TwinMotionDriver.traffic.test), and the canopy end-cap light poles (r 0.4u at
 *     y 165.3) stand 1.1u from a passing body. 0.8u further north: 0.2u and 0.3u.
 * So the canopy-side streams keep rightOffset, and the other stream of each collector
 * moves out by the whole 1.6u, to DIVIDED_SPAN - rightOffset = 4.8u: the north
 * collector's westbound toward the bays' concrete forecourt, the south collector's
 * eastbound toward the S rows, whose stall faces stay 12.5u from its bodies.
 */
export const DIVIDED_SPAN = 8;

export class LaneGraph {
  nodes = new Map<string, Node>();
  lanes = new Map<string, Lane>();
  /** how far to shift the centerline to the right of travel (lane half-width) on a
   *  ONE-WAY lane and on each side of a two-way AISLE (the temp block's aisle, the N1
   *  approach): opposing directions end up 2×this apart. Widened from 2.4 (4.8u apart
   *  — a 5u car had ~0 passing clearance) to 3.2 (6.4u apart) so cars sit centred in
   *  their own lane with real clearance when passing. A DIVIDED road gives each of its
   *  directions its own offset instead (addRoad, DIVIDED_SPAN). */
  rightOffset = 3.2;
  /** the offset of each directed lane of a DIVIDED road (addRoad's `divided`) */
  private laneOffsets = new Map<string, number>();

  addNode(id: string, x: number, y: number) {
    if (!this.nodes.has(id)) this.nodes.set(id, { id, x, y, out: [] });
  }
  /** Directed lane a→b along an optional via-polyline. */
  addLane(a: string, b: string, via: Pt[] = []) {
    const na = this.nodes.get(a)!;
    const nb = this.nodes.get(b)!;
    const pts = [{ x: na.x, y: na.y }, ...via, { x: nb.x, y: nb.y }];
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += len(pts[i - 1], pts[i]);
    const id = `${a}>${b}`;
    this.lanes.set(id, { id, from: a, to: b, pts, length: L });
    na.out.push(id);
    this.inDeg = null; // topology changed — recompute lazily
  }

  /** in-degree per node, cached. Lets route() tell a real ring node from an
   *  entry/exit SPUR: the ingress stub has in-degree 0 (you can only be there by
   *  spawning), the egress stub has out-degree 0 (nothing ever leaves it). */
  private inDeg: Map<string, number> | null = null;
  private inDegree(id: string): number {
    if (!this.inDeg) {
      const m = new Map<string, number>();
      for (const n of this.nodes.keys()) m.set(n, 0);
      for (const l of this.lanes.values()) m.set(l.to, (m.get(l.to) ?? 0) + 1);
      this.inDeg = m;
    }
    return this.inDeg.get(id) ?? 0;
  }
  /** Two opposing directed lanes on the same centreline: a two-way road. A DIVIDED
   *  road gives each direction its own offset, `divided` = [a→b, b→a], summing to
   *  DIVIDED_SPAN; an aisle keeps rightOffset both ways. */
  addRoad(a: string, b: string, divided?: readonly [number, number]) {
    this.addLane(a, b);
    this.addLane(b, a);
    if (divided) {
      this.laneOffsets.set(`${a}>${b}`, divided[0]);
      this.laneOffsets.set(`${b}>${a}`, divided[1]);
    }
  }

  /** Is this directed lane one side of a divided road? */
  isDivided(laneId: string): boolean {
    return this.laneOffsets.has(laneId);
  }

  /** How far right of its centreline a car on this directed lane drives. */
  offsetOf(laneId: string): number {
    return this.laneOffsets.get(laneId) ?? this.rightOffset;
  }

  /** The offset of the directed lane a route segment a→b runs along, or null when it
   *  runs along none (a leg off the road: from a car, to a stall). Every lane in this
   *  graph is a straight run, so "along" means both ends on it, pointing its way. */
  private offsetAlong(a: Pt, b: Pt): number | null {
    const L = len(a, b);
    if (L < 1e-9) return null;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    for (const lane of this.lanes.values()) {
      for (let i = 1; i < lane.pts.length; i++) {
        const p = lane.pts[i - 1], q = lane.pts[i];
        const Lq = len(p, q);
        if (Lq < 1e-9) continue;
        const vx = (q.x - p.x) / Lq, vy = (q.y - p.y) / Lq;
        if (ux * vx + uy * vy < 0.999) continue;
        const on = (r: Pt) => {
          const t = (r.x - p.x) * vx + (r.y - p.y) * vy;
          return t > -1e-6 && t < Lq + 1e-6 && Math.abs((r.x - p.x) * -vy + (r.y - p.y) * vx) < 1e-6;
        };
        if (on(a) && on(b)) return this.offsetOf(lane.id);
      }
    }
    return null;
  }

  /** Per-segment drive-on-the-right offsets for a route CENTRELINE: each road
   *  segment takes its lane's offset, and a leg off the road takes its road
   *  neighbour's (the one it starts onto, or the one it leaves). */
  private segOffsets(pts: Pt[]): number[] {
    const raw: (number | null)[] = [];
    for (let i = 1; i < pts.length; i++) raw.push(this.offsetAlong(pts[i - 1], pts[i]));
    return raw.map((v, i) => {
      if (v !== null) return v;
      let prev: number | null = null, next: number | null = null;
      for (let j = i - 1; j >= 0 && prev === null; j--) prev = raw[j];
      for (let j = i + 1; j < raw.length && next === null; j++) next = raw[j];
      return (i === 0 ? next ?? prev : prev ?? next) ?? this.rightOffset;
    });
  }

  /** The offset of the directed lane whose centreline passes through `p` running
   *  within 30° of `heading` — rightOffset when none does. */
  offsetAt(p: Pt, heading: number): number {
    const fx = Math.cos(heading), fy = Math.sin(heading);
    let best = this.rightOffset, bd = Infinity;
    for (const lane of this.lanes.values()) {
      for (let i = 1; i < lane.pts.length; i++) {
        const a = lane.pts[i - 1], b = lane.pts[i];
        const L = len(a, b);
        if (L < 1e-6) continue;
        const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
        if (ux * fx + uy * fy < Math.cos(Math.PI / 6)) continue;
        const t = (p.x - a.x) * ux + (p.y - a.y) * uy;
        if (t < -1e-6 || t > L + 1e-6) continue;
        const lat = Math.abs((p.x - a.x) * -uy + (p.y - a.y) * ux);
        if (lat < bd) { bd = lat; best = this.offsetOf(lane.id); }
      }
    }
    return bd < 1 ? best : this.rightOffset;
  }

  nearestNode(p: Pt, pred?: (n: Node) => boolean): string {
    let best = "";
    let bestD = Infinity;
    for (const n of this.nodes.values()) {
      if (pred && !pred(n)) continue;
      const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  /**
   * Dijkstra over (node, the node it was reached from), so a U-TURN can be priced.
   *
   * Every two-way road is a pair of directed lanes on one centreline, so a plain
   * node Dijkstra could leave a node back along the lane it had just arrived on, at
   * no cost: A -> B -> A. On the road that is a car turning about inside its own
   * lane pair — the two drive lines 6.4u apart (8u on a divided road), against
   * the car's 11u minimum radius — and the corner rounding can only draw it as a
   * hairpin about a point, i.e. the car spinning in place. It was cheap enough to be
   * CHOSEN: a staging back-out picks the swing whose onward route is shorter, and on
   * the founder's run (twinRun.chase1006.json) a south-row car was swung to face
   * EAST for a charger to the WEST because the route east to Ts and straight back
   * was 10u shorter than facing the right way — 5 of the 16 back-outs whose rail
   * still opened > 30° off the car's heading after startOnHeading, in the first 30
   * minutes, were that.
   *
   * A U-turn now costs U_TURN_COST of road. Every route that has a way round under
   * that takes it; one that does not (a car re-tasked to somewhere far behind it
   * on a long road) still gets its U-turn rather than no route. A DEAD END — a node
   * whose only way out is back — turns about for free: there is nothing else to do
   * there (the N1 row's west stub).
   */
  private search(from: string, arrivedFrom: string | null): { dist: Map<string, number>; back: Map<string, string> } {
    const dist = new Map<string, number>([[stateKey(from, arrivedFrom), 0]]);
    const back = new Map<string, string>();
    const seen = new Set<string>();
    // small graph -> simple linear-scan priority selection
    while (true) {
      let u = "";
      let best = Infinity;
      for (const [s, d] of dist) if (!seen.has(s) && d < best) { best = d; u = s; }
      if (!u) break;
      seen.add(u);
      const [node, came] = splitState(u);
      const outs = this.nodes.get(node)!.out;
      for (const lid of outs) {
        const lane = this.lanes.get(lid)!;
        const uTurn = came !== null && lane.to === came && outs.length > 1;
        const nd = best + lane.length + (uTurn ? U_TURN_COST : 0);
        const s = stateKey(lane.to, node);
        if (nd < (dist.get(s) ?? Infinity)) { dist.set(s, nd); back.set(s, u); }
      }
    }
    return { dist, back };
  }

  /** The node path that a search state was reached by. */
  private static pathTo(back: Map<string, string>, state: string): string[] {
    const path = [splitState(state)[0]];
    for (let s = back.get(state); s !== undefined; s = back.get(s)) path.unshift(splitState(s)[0]);
    return path;
  }

  /** Dijkstra node path (list of node ids) from→to over directed lanes, U-turns
   *  priced (search). `arrivedFrom` is the node the car is coming from, when it is
   *  already driving into `from` along a lane. */
  private nodePath(from: string, to: string, arrivedFrom: string | null = null): string[] {
    const { dist, back } = this.search(from, arrivedFrom);
    let best: string | null = null, bd = Infinity;
    for (const [s, d] of dist) if (splitState(s)[0] === to && d < bd) { bd = d; best = s; }
    return best === null ? [] : LaneGraph.pathTo(back, best);
  }

  /** Concatenate the centerline polylines for a node path. */
  private centerline(nodePath: string[]): Pt[] {
    const out: Pt[] = [];
    for (let i = 1; i < nodePath.length; i++) {
      const lane = this.lanes.get(`${nodePath[i - 1]}>${nodePath[i]}`)!;
      for (const p of lane.pts) {
        if (!out.length || len(out[out.length - 1], p) > 1e-6) out.push({ x: p.x, y: p.y });
      }
    }
    return out;
  }

  /** Shift a polyline to the right of travel by `amount` (drive-on-the-right).
   *
   *  Each interior vertex takes a MITER join: the point where the two shifted
   *  legs actually meet, `amount / cos(half the turn)` out along the bisector.
   *  It used to take the normal of the CHORD between its two neighbours, which
   *  moves a vertex only `amount` along that bisector — at a 90° corner 3.2u
   *  where the lanes meet 4.53u out — so every car rounding a corner cut 1.33u
   *  toward the centreline and the OPPOSING stream. Measured on the 2026-09-22
   *  live recording: a car turning east out of the ingress ran at y = 173.7
   *  instead of its lane at 175.2, 4.9u from the westbound lane. A collinear
   *  vertex is unchanged by the fix (the miter of a straight join IS the normal).
   *  The miter is capped at MITER_LIMIT x amount so a hairpin cannot throw a
   *  vertex across the lot.
   *
   *  ONLY BETWEEN TWO ROAD LEGS. Vertices outside [miterFrom, miterTo] keep the
   *  old chord normal: route() passes the first and last NODE of a path there,
   *  because one of their legs is not a lane at all — it is the car's own start
   *  point or a stall's approach point off the road — and a miter on such a join
   *  swings the path into the parked row beside it (measured on busy_day: body
   *  overlap 74 -> 133 when every vertex took one).
   *
   *  `amount` is one offset for the whole polyline, or one PER SEGMENT (segment i
   *  runs pts[i] -> pts[i+1]): each side of a divided road has its own offset
   *  (DIVIDED_SPAN), unlike a one-way lane. Where two segments of DIFFERENT offset meet
   *  at a corner, the vertex goes where the two shifted legs actually cross (the
   *  general miter); on a straight run it steps by half the difference each side, so
   *  the change is spread over both legs rather than taken as a jog at the vertex. A
   *  legacy (chord) join takes the offset of its ROAD leg. */
  static offsetRight(pts: Pt[], amount: number | readonly number[], miterFrom = 1, miterTo = pts.length - 2): Pt[] {
    const seg = (i: number) => typeof amount === "number" ? amount
      : amount[Math.max(0, Math.min(amount.length - 1, i))];
    if (pts.length < 2 || (typeof amount === "number" && amount === 0)) return pts.map((p) => ({ ...p }));
    const out: Pt[] = [];
    // y-DOWN frame (south = +y): the right-of-travel normal of (dx,dy) is (-dy,dx)
    const normal = (a: Pt, b: Pt): Pt | null => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const m = Math.hypot(dx, dy);
      return m > 1e-9 ? { x: -dy / m, y: dx / m } : null;
    };
    for (let i = 0; i < pts.length; i++) {
      const nIn = i > 0 ? normal(pts[i - 1], pts[i]) : null;
      const nOut = i < pts.length - 1 ? normal(pts[i], pts[i + 1]) : null;
      let nx: number, ny: number, k = 1, amt: number;
      if (nIn && nOut && (i < miterFrom || i > miterTo)) {
        // legacy join: the normal of the chord between the two neighbours, at the
        // offset of the leg that is road (the outgoing one at a route's start, the
        // incoming one at its end)
        const chord = normal(pts[i - 1], pts[i + 1]) ?? nIn;
        nx = chord.x; ny = chord.y;
        amt = i < miterFrom ? seg(i) : seg(i - 1);
      } else if (nIn && nOut) {
        const a = seg(i - 1), b = seg(i);
        if (Math.abs(a - b) > 1e-9) {
          out.push(LaneGraph.miterOf(pts[i], nIn, nOut, a, b));
          continue;
        }
        amt = a;
        const sx = nIn.x + nOut.x, sy = nIn.y + nOut.y;
        const sm = Math.hypot(sx, sy);
        if (sm < 1e-9) { nx = nIn.x; ny = nIn.y; }            // a full reversal: no miter exists
        else {
          nx = sx / sm; ny = sy / sm;
          const cosHalf = nx * nIn.x + ny * nIn.y;            // = cos(turn / 2)
          k = Math.min(MITER_LIMIT, 1 / Math.max(cosHalf, 1e-9));
        }
      } else {
        const n = nIn ?? nOut;
        if (!n) { out.push({ ...pts[i] }); continue; }
        nx = n.x; ny = n.y;
        amt = nIn ? seg(i - 1) : seg(i);
      }
      out.push({ x: pts[i].x + nx * amt * k, y: pts[i].y + ny * amt * k });
    }
    return out;
  }

  /** Where the incoming leg, shifted `a` right of travel, meets the outgoing leg
   *  shifted `b` (the two legs' right normals nIn, nOut), at vertex V. Parallel legs:
   *  half the change each side on a straight run; the incoming side on a reversal.
   *  Capped at MITER_LIMIT x the larger offset, like the single-offset miter. */
  private static miterOf(V: Pt, nIn: Pt, nOut: Pt, a: number, b: number): Pt {
    // travel directions are the normals turned back (y-DOWN: right of (ux,uy) is (-uy,ux))
    const u1 = { x: nIn.y, y: -nIn.x }, u2 = { x: nOut.y, y: -nOut.x };
    const cross = u1.x * u2.y - u1.y * u2.x;
    if (Math.abs(cross) < 1e-6) {
      const m = u1.x * u2.x + u1.y * u2.y > 0 ? (a + b) / 2 : a;
      return { x: V.x + nIn.x * m, y: V.y + nIn.y * m };
    }
    const A = { x: V.x + nIn.x * a, y: V.y + nIn.y * a };
    const w = { x: V.x + nOut.x * b - A.x, y: V.y + nOut.y * b - A.y };
    const t = (w.x * u2.y - w.y * u2.x) / cross;
    let P = { x: A.x + u1.x * t, y: A.y + u1.y * t };
    const d = Math.hypot(P.x - V.x, P.y - V.y), cap = MITER_LIMIT * Math.max(a, b);
    if (d > cap) P = { x: V.x + ((P.x - V.x) / d) * cap, y: V.y + ((P.y - V.y) / d) * cap };
    return P;
  }

  /** The streams a straight move from `a` to `b` crosses: where it crosses each
   *  directed lane's drive line, and which way that lane flows. A crossing within 1u
   *  of either end is left out: that is the lane the move starts from, or joins. */
  streamsCrossed(a: Pt, b: Pt): { x: number; y: number; hx: number; hy: number }[] {
    const out: { x: number; y: number; hx: number; hy: number }[] = [];
    const L = len(a, b);
    if (L < 2) return out;
    const rx = b.x - a.x, ry = b.y - a.y;
    for (const lane of this.lanes.values()) {
      const line = LaneGraph.offsetRight(lane.pts, this.offsetOf(lane.id));
      for (let i = 1; i < line.length; i++) {
        const p = line[i - 1], q = line[i];
        const sx = q.x - p.x, sy = q.y - p.y;
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) continue; // parallel: runs beside the move, does not cross it
        const t = ((p.x - a.x) * sy - (p.y - a.y) * sx) / den;
        const u = ((p.x - a.x) * ry - (p.y - a.y) * rx) / den;
        if (t * L < 1 || (1 - t) * L < 1 || u < 0 || u > 1) continue;
        const Ls = Math.hypot(sx, sy);
        out.push({ x: a.x + rx * t, y: a.y + ry * t, hx: sx / Ls, hy: sy / Ls });
      }
    }
    return out;
  }

  /**
   * How far short of junction `id` a car arriving along `heading` waits for it
   * (RailFlow's NODE_STOP, as a centre-to-node "stationary leader" distance): its
   * nose keeps 0.6u from the body of the NEAREST stream crossing its way in — the
   * crossing lane whose drive line lies on the side the car comes from. 6 when that
   * stream is 3.2u out (the formula's own case), more for a divided road's outer
   * stream: 7.6 on the ingress spur at the south collector, 6.8 on the N1 approach at
   * the east avenue. `fallback` when nothing crosses there.
   */
  stopDistance(id: string, heading: number, fallback: number): number {
    const fx = Math.cos(heading), fy = Math.sin(heading);
    let near = 0;
    for (const lane of this.lanes.values()) {
      if (lane.from !== id && lane.to !== id) continue;
      const k = lane.from === id ? 1 : lane.pts.length - 1;
      const a = lane.pts[k - 1], b = lane.pts[k];
      const L = len(a, b);
      if (L < 1e-9) continue;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      if (Math.abs(ux * fx + uy * fy) > 0.5) continue; // runs along my way in, not across it
      // its drive line is offsetOf right of the node (y-DOWN: right of (ux,uy) is
      // (-uy,ux)): on MY side of it when that points back the way I come
      if (-uy * fx + ux * fy < 0) near = Math.max(near, this.offsetOf(lane.id));
    }
    return near > 0 ? near + 2.8 : fallback;
  }

  /**
   * The directed lane a car at `p`, pointing along `heading`, can join AHEAD of
   * its nose — or null when no lane agrees with where it points.
   *
   * WHY THIS EXISTS. route() picks its origin as the NEAREST node, which knows
   * nothing about which way the car faces. For a car already in a lane that is
   * usually harmless; for a car that has just backed out of a stall it is not.
   * Replaying the 2026-09-22 live run, the nearest node to a car in the TE temp
   * column was the SE ring corner 47u away, so the first leg of its route ran
   * diagonally THROUGH its own stall column: it drove into the parked neighbour
   * 6.7u south and sat there for the rest of the run, with the 45 s watchdog
   * rebuilding the same rail from the same place. A car joins the road it is
   * facing, going the way it is facing.
   *
   * A lane qualifies when its travel direction is within 60° of the heading and
   * its drive-on-the-right line passes within `maxLat` of the car. The join point
   * is JOIN_LEAD ahead of the car's projection, so the merge is a lean into the
   * lane rather than a sideways hop onto it.
   */
  joinAhead(p: Pt, heading: number, maxLat = 16): { laneId: string; seg: number; t: number; lat: number } | null {
    const fx = Math.cos(heading), fy = Math.sin(heading);
    let best: { laneId: string; seg: number; t: number; lat: number } | null = null;
    for (const lane of this.lanes.values()) {
      for (let i = 1; i < lane.pts.length; i++) {
        const a = lane.pts[i - 1], b = lane.pts[i];
        const L = len(a, b);
        if (L < 1e-6) continue;
        const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
        if (ux * fx + uy * fy < 0.5) continue; // points the wrong way for this car
        // the drive-on-the-right line of this segment (y-DOWN: right of (ux,uy) is (-uy,ux))
        const off = this.offsetOf(lane.id);
        const ox = a.x - uy * off, oy = a.y + ux * off;
        const t = (p.x - ox) * ux + (p.y - oy) * uy;
        if (t > L) continue;                                // this piece is behind the car
        // …and so is a piece the car stands at the END of: nothing of it is ahead. A
        // car at a junction stood on two lanes at once, the one arriving there and the
        // one leaving, and took whichever the graph listed first. Joining the arriving
        // one routes on from the junction it is already at: a charger car turning onto
        // the north collector's eastbound line at Ng0 was routed from Ng0 back WEST
        // (a U-turn the search priced and then took, the east way round being longer),
        // which offsetRight draws as a diagonal from the eastbound line to the
        // westbound one: the car drove 54u west in the eastbound lane, beside the
        // westbound traffic (docking test E, 31 contact samples once the median put
        // the streams 8u apart).
        if (L - Math.max(0, t) < 1) continue;
        const lat = Math.abs((p.x - ox) * -uy + (p.y - oy) * ux);
        // a car short of the segment's start measures its distance to that start
        const d = t < 0 ? Math.hypot(p.x - ox, p.y - oy) : lat;
        if (d > maxLat) continue;
        if (!best || d < best.lat) best = { laneId: lane.id, seg: i, t: Math.max(0, t), lat: d };
      }
    }
    return best;
  }

  /**
   * route(), but starting from a car that is POINTING somewhere: it joins the lane
   * ahead of its nose (joinAhead) and is routed on from that lane's end node. Falls
   * back to the plain nearest-node route when no lane agrees with the heading —
   * the gate approach road, for one, has no lane a westbound car can join.
   */
  routeFacing(from: Pt, heading: number, to: Pt): Pt[] {
    const j = this.joinAhead(from, heading);
    if (!j) return this.route(from, to);
    const lane = this.lanes.get(j.laneId)!;
    const a = lane.pts[j.seg - 1], b = lane.pts[j.seg];
    const L = len(a, b);
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const off = this.offsetOf(lane.id);
    const shift = (q: Pt) => ({ x: q.x - uy * off, y: q.y + ux * off });
    const tJoin = Math.min(L, j.t + JOIN_LEAD);
    const joinPt = shift({ x: a.x + ux * tJoin, y: a.y + uy * tJoin });
    // Destination ON this lane, ahead of the join: go straight to it rather than
    // driving past it to the lane's end node and doubling back.
    const tTo = (to.x - a.x) * ux + (to.y - a.y) * uy;
    const latTo = Math.abs((to.x - a.x) * -uy + (to.y - a.y) * ux);
    if (tTo > tJoin && tTo <= L && latTo <= off * 3) {
      return [{ ...from }, joinPt, { ...to }];
    }
    const destOk = (n: Node) => this.inDegree(n.id) > 0;
    const bNode = this.nearestNode(to, destOk) || this.nearestNode(to);
    // the car is driving INTO lane.to along this lane: turning straight back at it is a U-turn
    const np = this.nodePath(lane.to, bNode, lane.from);
    // the joined lane leads nowhere the destination can be reached from (a sink
    // spur such as the egress stub): do not commit to it
    if (np.length < 2 && lane.to !== bNode) return this.route(from, to);
    // centreline from the join onward: the rest of this lane, then the graph path
    const center: Pt[] = [{ x: a.x + ux * tJoin, y: a.y + uy * tJoin }];
    for (let i = j.seg; i < lane.pts.length; i++) center.push({ ...lane.pts[i] });
    if (np.length >= 2) for (const q of this.centerline(np)) center.push(q);
    center.push({ ...to });
    const clean: Pt[] = [];
    for (const q of center) if (!clean.length || len(clean[clean.length - 1], q) > 0.5) clean.push(q);
    const shifted = LaneGraph.offsetRight(clean, this.segOffsets(clean), 1, clean.length - 3);
    shifted[shifted.length - 1] = clean[clean.length - 1]; // `to` is a physical point
    shifted[0] = joinPt;
    return [{ ...from }, ...shifted];
  }

  /**
   * Route to a point OFF the road — a parking stall's turn-in — leaving the road
   * ABREAST of it, and return null when no lane runs abreast of it.
   *
   * WHY THIS EXISTS. route() and routeFacing() end at the graph node NEAREST the
   * target. A staging stall is not at a node: it sits beside an aisle or collector
   * somewhere along a lane up to ~98u long, so the nearest node was as often PAST the
   * stall as short of it. The car drove by its stall to that node, turned round and
   * came back to it — the founder, 2026-10-01: "they go past their designated stall
   * first and then come back to it ... it should not go past and then come back to
   * it. It needs to immediately turn into that spot." Replayed on the five captures,
   * 102 of 299 staging arrivals overshot their stall's axis, by up to 44.6u (the
   * temp aisle's whole length; arrivalProbe.ts).
   *
   * So every directed lane is a candidate exit: `to` is projected onto it, and the
   * cheapest (graph distance to the lane, then along it to the projection, then off
   * the lane to `to`) wins. The car rides its lane to the point abreast of `to` and
   * turns off there. `facing` is the way the car must point as it reaches `to` (the
   * parked heading): an exit counts only when the move from its lane line to `to`
   * runs within OFF_ALIGN of it, so a car never pulls off SIDEWAYS from a road that
   * merely passes near the stall (the gate spurs beside S2/S3, the avenue beside the
   * corner stalls of the south rows).
   *
   * `heading`, when known, joins the lane ahead of the car's nose (joinAhead), as
   * routeFacing does; the joined lane is itself a candidate.
   */
  routeOff(from: Pt, heading: number | undefined, to: Pt, facing: number): Pt[] | null {
    const fx = Math.cos(facing), fy = Math.sin(facing);
    const cosAlign = Math.cos(OFF_ALIGN);
    // where the trip starts on the road: the lane ahead of the nose, or a node
    let joined: { lane: Lane; seg: number; tJoin: number; c: Pt } | null = null;
    if (heading !== undefined) {
      const j = this.joinAhead(from, heading);
      if (j) {
        const lane = this.lanes.get(j.laneId)!;
        const a = lane.pts[j.seg - 1], b = lane.pts[j.seg];
        const L = len(a, b);
        const tJoin = Math.min(L, j.t + JOIN_LEAD);
        joined = { lane, seg: j.seg, tJoin, c: { x: a.x + ((b.x - a.x) / L) * tJoin, y: a.y + ((b.y - a.y) / L) * tJoin } };
      }
    }
    const startNode = joined ? joined.lane.to : this.originNode(from);
    if (!startNode) return null;
    const { dist, back } = this.search(startNode, joined ? joined.lane.from : null);
    // The cheapest way to START down a lane from its from-node, U-turn priced: the
    // search reaches a node in several states (one per way in), and leaving a node
    // back along the lane a state arrived on is a U-turn (LaneGraph.search).
    const startDown = (lane: Lane): { cost: number; state: string } | undefined => {
      const outs = this.nodes.get(lane.from)!.out.length;
      let r: { cost: number; state: string } | undefined;
      for (const [s, d] of dist) {
        const [node, came] = splitState(s);
        if (node !== lane.from) continue;
        const c = d + (came === lane.to && outs > 1 ? U_TURN_COST : 0);
        if (!r || c < r.cost) r = { cost: c, state: s };
      }
      return r;
    };
    // how far along the joined lane the join point lies (its own arc coordinate)
    let joinAt = 0;
    if (joined) {
      for (let i = 1; i < joined.seg; i++) joinAt += len(joined.lane.pts[i - 1], joined.lane.pts[i]);
      joinAt += joined.tJoin;
    }
    // A route through the graph starts at startNode, the END of the joined lane, so the
    // car first drives the rest of that lane. The cost left that out, which made the
    // lane just past the end of the joined one look as near as the one the car was on:
    // a stall abreast of the joined lane's last few units (OFF_SLIP) was left from the
    // NEXT lane instead — the car drove on to the junction and doubled back to it (a
    // car eastbound on the north collector for wash bay 1, x 168, ran on to Ng2 at x
    // 173.5 and turned 110 deg back into the bay).
    const toStart = joined ? Math.max(0, joined.lane.length - joinAt) : 0;
    let best: { cost: number; lane: Lane; seg: number; E: Pt; direct: boolean; state?: string } | null = null;
    for (const lane of this.lanes.values()) {
      const start = startDown(lane);
      const viaGraph = start?.cost;
      const onJoined = joined?.lane === lane;
      const off = this.offsetOf(lane.id);
      if (viaGraph === undefined && !onJoined) continue;
      let at = 0; // arc coordinate of this segment's start along the lane
      for (let i = 1; i < lane.pts.length; i++) {
        const a = lane.pts[i - 1], b = lane.pts[i];
        const L = len(a, b);
        if (L < 1e-6) continue;
        const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
        const tRaw = (to.x - a.x) * ux + (to.y - a.y) * uy;
        const t = Math.max(0, Math.min(L, tRaw));
        // `to` must lie ABREAST of this piece of lane (give or take a corner stall
        // just past its end): from a lane it only lies beyond, the move off the road
        // would be a diagonal across the junction, not a turn into the stall
        if (Math.abs(tRaw - t) > OFF_SLIP) { at += L; continue; }
        const E = { x: a.x + ux * t, y: a.y + uy * t };
        // the lane LINE the car is on there (drive-on-the-right; y-DOWN right of (ux,uy) is (-uy,ux))
        const dx = to.x - (E.x - uy * off), dy = to.y - (E.y + ux * off);
        const d = Math.hypot(dx, dy);
        const ok = d <= OFF_REACH && (d < 1e-6 || (dx * fx + dy * fy) / d >= cosAlign);
        if (ok) {
          const along = at + t;
          if (onJoined && along > joinAt + 0.5) {
            const cost = along - joinAt + d;
            if (!best || cost < best.cost) best = { cost, lane, seg: i, E, direct: true };
          }
          if (viaGraph !== undefined) {
            const cost = toStart + viaGraph + along + d;
            if (!best || cost < best.cost) best = { cost, lane, seg: i, E, direct: false, state: start!.state };
          }
        }
        at += L;
      }
    }
    if (!best) return null;
    // the road's centreline from the start to the exit point E
    const C: Pt[] = [];
    if (joined) {
      C.push(joined.c);
      const last = best.direct ? best.seg - 1 : joined.lane.pts.length - 1;
      for (let i = joined.seg; i <= last; i++) C.push({ ...joined.lane.pts[i] });
    }
    if (!best.direct) {
      const np = LaneGraph.pathTo(back, best.state!);
      if (np[0] !== startNode) return null;
      if (np.length >= 2) C.push(...this.centerline(np));
      else { const n = this.nodes.get(startNode)!; C.push({ x: n.x, y: n.y }); }
      for (let i = 1; i < best.seg; i++) C.push({ ...best.lane.pts[i] });
    }
    C.push(best.E);
    const clean: Pt[] = [];
    for (const q of C) if (!clean.length || len(clean[clean.length - 1], q) > 0.5) clean.push(q);
    // E is the exit: keep it even when it lands within 0.5u of the vertex before it
    if (len(clean[clean.length - 1], best.E) > 1e-9) clean[clean.length - 1] = best.E;
    let road: Pt[];
    if (joined) {
      if (clean.length < 2) return null;
      // the join point is a road point already, on the joined lane's line
      road = LaneGraph.offsetRight(clean, this.segOffsets(clean), 1, clean.length - 2);
    } else {
      // [from, node0, …, E]: node0 joins a leg that is not a lane (the car's start)
      // (as in route(): a start already ON the first node is that node, not a leg to it —
      // kept as a leg, its 3.2u shift drew a hairpin at every bay pull-through exit)
      const full = [{ ...from }, ...(clean.length > 1 && len(clean[0], from) <= 0.5 ? clean.slice(1) : clean)];
      road = LaneGraph.offsetRight(full, this.segOffsets(full), 2, full.length - 2).slice(1);
    }
    const out = [{ ...from }, ...road, { ...to }];
    const dd: Pt[] = [];
    for (const q of out) if (!dd.length || len(dd[dd.length - 1], q) > 1e-3) dd.push(q);
    return dd;
  }

  /** The node a car standing at `from` starts a route from: the nearest one it can
   *  legally leave from ("" only when the graph has no node at all). */
  private originNode(from: Pt): string {
    // ENTRY/EXIT SPURS ARE NOT WAYPOINTS. The ingress stub sits at (200,210) —
    // Euclidean-closer to the east/south staging block than any real ring node —
    // so an unfiltered nearestNode picked it as the route ORIGIN for departures
    // out of exactly the block the renderer fills first. Those cars drove
    // BACKWARDS to the entrance gate before they could leave, and the departure
    // TTL then despawned them in place: "a taxi drives down the road to the
    // entrance gate and disappears at the gate."
    //
    // Told apart structurally, not by name, so this survives graph edits:
    //   in-degree 0  => source spur (ingress). You can only be there by spawning,
    //                   so it is a legal ORIGIN only if the car is genuinely on it,
    //                   and never a legal DESTINATION (Dijkstra cannot reach it).
    //   out-degree 0 => sink (egress). Never a legal ORIGIN — no path leaves it.
    // A plain radius cannot tell the two apart: the gate queue lines up 6..92
    // units east of the ingress stub while the east staging block sits only ~18
    // units from it. DIRECTION can. A source spur is a legal origin only for a
    // car approaching from OUTSIDE it — on the far side from where the spur
    // leads. Queue cars sit outward of the entrance (legal); parked cars inside
    // the lot sit inward of it (illegal, and were the ones driving backwards).
    const SPUR_SLACK = 4;
    const outwardOf = (n: Node, p: Pt) => {
      const lane = this.lanes.get(n.out[0]);
      const tgt = lane && this.nodes.get(lane.to);
      if (!tgt) return false;
      const dx = n.x - tgt.x;
      const dy = n.y - tgt.y;
      const m = Math.hypot(dx, dy) || 1;
      return ((p.x - n.x) * dx + (p.y - n.y) * dy) / m >= -SPUR_SLACK;
    };
    const originOk = (n: Node) =>
      n.out.length > 0 && (this.inDegree(n.id) > 0 || outwardOf(n, from));
    return this.nearestNode(from, originOk);
  }

  /**
   * Route a drivable polyline from `from` to `to` along the one-way lanes,
   * returned already offset to the right (the actual path the car drives).
   * Falls back to a straight segment if the graph can't connect them.
   */
  route(from: Pt, to: Pt): Pt[] {
    const destOk = (n: Node) => this.inDegree(n.id) > 0;

    let a = this.originNode(from);
    let b = this.nearestNode(to, destOk);
    // never strand a car: if the filters admit nothing, fall back to the old
    // unfiltered pick rather than degrading to a beeline across the lot.
    if (!a) a = this.nearestNode(from);
    if (!b) b = this.nearestNode(to);
    const np = a && b ? this.nodePath(a, b) : [];
    let center: Pt[];
    if (np.length >= 2) {
      center = [{ ...from }, ...this.centerline(np), { ...to }];
    } else if (a && a === b) {
      // both endpoints collapse to ONE node: route VIA it. The old straight
      // from→to beeline here is what sent gate arrivals diagonally across the
      // fence/crosswalk and overflow cars looping over the entrance road.
      const n = this.nodes.get(a)!;
      center = [{ ...from }, { x: n.x, y: n.y }, { ...to }];
    } else {
      center = [{ ...from }, { ...to }];
    }
    // de-dupe
    const clean: Pt[] = [];
    for (const p of center) if (!clean.length || len(clean[clean.length - 1], p) > 0.5) clean.push(p);
    // clean = [from, node0, …, nodeK, to]: node0 and nodeK each join a leg that is
    // not a lane (the car's start, the target point), so only node1..nodeK-1 miter
    const shifted = LaneGraph.offsetRight(clean, this.segOffsets(clean), 2, clean.length - 3);
    // THE ENDPOINTS ARE PHYSICAL POSITIONS, NOT CENTERLINES. `from` is where the
    // car actually IS and `to` is the exact point it must reach; only the road
    // vertices in between are centerlines that need the drive-on-the-right shift.
    //
    // Offsetting the whole polyline moved both by the full rightOffset (3.2u),
    // which broke two things at once. A car starting a route was teleported 3.2u
    // SIDEWAYS onto a rail that did not begin where it stood — and since the
    // perimeter/temp park runs pitch stalls only 5.7u apart, that put its body
    // most of the way into the neighbouring stall (the "vehicles pile into each
    // other"). Worse, from that displaced start its own forward window then ran
    // within RailFlow's LANE_HALF of the parked neighbour, so IDM read a negative
    // gap and pinned v at 0: the car never advanced past s=0 and sat wedged until
    // the 45s watchdog, which rebuilt the same rail from the same place. Every
    // wedged car observed in the busy_day fixture replay was stuck at s=0 with no
    // node lock and no mouth lock — this was why.
    //
    // Restoring the two ends leaves every interior shift byte-identical (the
    // normals are still computed from the same neighbours); the car simply merges
    // onto the lane from where it stands, and pulls off it onto the exact target.
    shifted[0] = clean[0];
    shifted[shifted.length - 1] = clean[clean.length - 1];
    return shifted;
  }
}

/**
 * Build the depot's one-way lane network from the sitePlan constants.
 */
export function buildDepotLanes(): LaneGraph {
  const g = new LaneGraph();
  // each direction of a divided road (DIVIDED_SPAN): the stream beside the canopies,
  // the one away from them, and each side of an avenue
  const near = g.rightOffset, far = DIVIDED_SPAN - g.rightOffset, even = DIVIDED_SPAN / 2;
  const gapX = [GAP_LANES.westOfA, GAP_LANES.AB, GAP_LANES.BC, GAP_LANES.eastOfC];

  // --- ring corners ---
  g.addNode("NW", WEST_AISLE_X, NORTH_LANE_Y);
  g.addNode("NE", EAST_AISLE_X, NORTH_LANE_Y);
  g.addNode("SW", WEST_AISLE_X, SOUTH_LANE_Y);
  g.addNode("SE", EAST_AISLE_X, SOUTH_LANE_Y);

  // --- ingress / egress junctions + gates ---
  g.addNode("S_in", INGRESS.x, SOUTH_LANE_Y);
  g.addNode("S_eg", EGRESS.x, SOUTH_LANE_Y);
  g.addNode("ingress", INGRESS.x, INGRESS.y - 5);
  g.addNode("egress", EGRESS.x, EGRESS.y - 5);

  // --- gap-lane junctions on south + north boulevards ---
  gapX.forEach((x, i) => {
    g.addNode(`Sg${i}`, x, SOUTH_LANE_Y);
    g.addNode(`Ng${i}`, x, NORTH_LANE_Y);
  });

  // --- TEMP BLOCK AISLE junctions -------------------------------------------
  // sitePlan has declared TEMP_LANE_X since the temp block was drawn, and
  // routeToStall() has always routed the block's traffic along it — but it existed
  // ONLY as a constant. There was no node and no edge here, so route() could not
  // follow it: it picked the nearest RING node instead and drew a straight line to
  // the stall, which is why cars crossed the block diagonally over parked cars.
  // This is the founder's item 3: the aisle the plan already declares becomes real road.
  g.addNode("Tn", TEMP_LANE_X, NORTH_LANE_Y);
  g.addNode("Ts", TEMP_LANE_X, SOUTH_LANE_Y);

  // --- south boulevard chain (two-way), west→east through all junctions ---
  const southChain = ["SW", "Sg0", "S_in", "Sg1", "Sg2", "S_eg", "Sg3", "Ts", "SE"]
    .sort((a, b) => g.nodes.get(a)!.x - g.nodes.get(b)!.x);
  // DIVIDED (DIVIDED_SPAN): west→east is EASTBOUND, driven on the south side, toward
  // the S rows (4.8u); the westbound stream keeps rightOffset beside the canopies
  for (let i = 1; i < southChain.length; i++) g.addRoad(southChain[i - 1], southChain[i], [far, near]);

  // --- north boulevard chain (two-way) ---
  const northChain = ["NW", "Ng0", "Ng1", "Ng2", "Ng3", "Tn", "NE"]
    .sort((a, b) => g.nodes.get(a)!.x - g.nodes.get(b)!.x);
  // DIVIDED: the EASTBOUND stream keeps rightOffset beside the canopies, the westbound
  // one moves north toward the bays' forecourt (4.8u)
  for (let i = 1; i < northChain.length; i++) g.addRoad(northChain[i - 1], northChain[i], [near, far]);

  // The aisle itself: TWO-WAY, because it is double-loaded (TW and TE face each other
  // across it) and it is a dead-end for anything but a through run between the two
  // collectors. 24.39 ft of clear pavement between the stall faces — the founder's
  // real-world two-way / 90-degree-parking spec. See sitePlan's TW/TE comment.
  //
  // NOT DIVIDED, and that is deliberate: it is a parking aisle, not a through road. A
  // car pulls into or backs out of a stall on EITHER side of it, so its body crosses
  // the middle of the aisle every time (a staging back-out ends 17.8u out from the
  // stall centre, past the far lane line); a median there would be painted where
  // every pull-in drives. The same holds for the N1 approach below (a single-loaded
  // row). Real parking aisles have none. They keep rightOffset each way.
  g.addRoad("Tn", "Ts");

  // --- avenues (two-way, divided) ---
  g.addRoad("NW", "SW", [even, even]);
  g.addRoad("NE", "SE", [even, even]);

  // --- gap lanes: ONE-WAY NORTHBOUND (chargers face north) ---
  for (let i = 0; i < gapX.length; i++) g.addLane(`Sg${i}`, `Ng${i}`);

  // --- gates ---
  g.addLane("ingress", "S_in"); // drive in
  g.addLane("S_eg", "egress");  // drive out

  // --- REAR APRON behind the pull-through wash/service bays: ONE-WAY EASTBOUND.
  // Bays are full pull-through — a serviced car pulls FORWARD out the rear (north)
  // into this apron, then it drains EAST to the east avenue and down to the east-
  // side staging block. It deliberately spans only the bay x-range and connects
  // ONLY at its EAST end: there is NO lane west of the westmost bay, because that
  // way lies the fenced BESS / switchgear yard — so the graph can never route a
  // car toward the battery equipment. Cars join it mid-span via the bay-exit
  // pull-through maneuver (TwinMotionDriver), not from the south. */
  const rearXs = [120, 138, 156, 174, 192, 210, EAST_AISLE_X];
  rearXs.forEach((x, i) => g.addNode(`R${i}`, x, REAR_LANE_Y));
  for (let i = 1; i < rearXs.length; i++) g.addLane(`R${i - 1}`, `R${i}`); // eastbound only

  // --- N1 APPROACH: the east-west lane serving the open NE overflow row -------
  // The row had no lane. sitePlan's old single `inTemp` predicate sent N1 traffic up
  // TEMP_LANE_X to the row's own y, and TEMP_LANE_X (247) runs through N1 stall 5
  // (render x 246.16..251.84) — the one route in drove the length of a parked car.
  // The row is SINGLE-loaded, so it is served from a lane BELOW it and cars sidestep
  // north into a stall; the lane body clears the stall faces by 4.65 ft.
  const n1 = PARK_RUNS.find((r) => r.id === "N1")!;
  // West stub, off the row's first stall. 3u west of it, not 6: a car turning round
  // at this dead end swings its nose past the node, and at x0 - 6 that nose reached
  // x = 212.2 — 0.3u INSIDE the wash hall's east wall (x 211.4..212), measured by
  // structureClearance.replay.test.ts on the fresh0922 capture. At x0 - 3 the swing
  // clears the wall by ~3u and the stub still sits beside stall 1 (x0).
  g.addNode("N1w", n1.x0 - 3, N1_LANE_Y);
  g.addNode("N1c", TEMP_LANE_X, N1_LANE_Y);                     // meets the temp aisle
  g.addNode("N1e", EAST_AISLE_X, N1_LANE_Y);                    // meets the east avenue
  g.addRoad("N1w", "N1c");
  g.addRoad("N1c", "N1e");
  g.addRoad("Tn", "N1c");   // temp aisle continues north to the row (empty ground, y 50..74)

  // The rear apron drains into the avenue AT the N1 junction, not past it: the avenue
  // stub is spliced R6 -> N1e -> NE so a car leaving a bay can turn straight into the
  // overflow row. The apron itself stays ONE-WAY (see above); the avenue stub is
  // two-way like the rest of the divided avenue, which is what lets a car reach the
  // row FROM the north collector instead of only from the bays.
  g.addLane(`R${rearXs.length - 1}`, "N1e");
  g.addRoad("N1e", "NE", [even, even]);

  return g;
}
