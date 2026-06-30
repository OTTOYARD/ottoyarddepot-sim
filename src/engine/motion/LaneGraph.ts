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

export class LaneGraph {
  nodes = new Map<string, Node>();
  lanes = new Map<string, Lane>();
  /** how far to shift the centerline to the right of travel (lane half-width). */
  rightOffset = 2.4;

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
  }
  /** Two opposing directed lanes on the same centerline (a divided road). */
  addRoad(a: string, b: string) {
    this.addLane(a, b);
    this.addLane(b, a);
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

  /** Dijkstra node path (list of node ids) from→to over directed lanes. */
  private nodePath(from: string, to: string): string[] {
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const seen = new Set<string>();
    dist.set(from, 0);
    // small graph → simple linear-scan priority selection
    while (true) {
      let u = "";
      let best = Infinity;
      for (const [id, d] of dist) if (!seen.has(id) && d < best) { best = d; u = id; }
      if (!u || u === to) break;
      seen.add(u);
      for (const lid of this.nodes.get(u)!.out) {
        const lane = this.lanes.get(lid)!;
        const nd = best + lane.length;
        if (nd < (dist.get(lane.to) ?? Infinity)) {
          dist.set(lane.to, nd);
          prev.set(lane.to, u);
        }
      }
    }
    if (!dist.has(to)) return [];
    const path = [to];
    let c = to;
    while (c !== from) {
      const p = prev.get(c);
      if (!p) return []; // unreachable
      path.unshift(p);
      c = p;
    }
    return path;
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

  /** Shift a polyline to the right of travel by `amount` (drive-on-the-right). */
  static offsetRight(pts: Pt[], amount: number): Pt[] {
    if (pts.length < 2 || amount === 0) return pts.map((p) => ({ ...p }));
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const m = Math.hypot(dx, dy) || 1;
      // y-DOWN frame (south = +y): the right-of-travel normal of (dx,dy) is (-dy,dx)
      out.push({ x: pts[i].x - (dy / m) * amount, y: pts[i].y + (dx / m) * amount });
    }
    return out;
  }

  /**
   * Route a drivable polyline from `from` to `to` along the one-way lanes,
   * returned already offset to the right (the actual path the car drives).
   * Falls back to a straight segment if the graph can't connect them.
   */
  route(from: Pt, to: Pt): Pt[] {
    const a = this.nearestNode(from);
    const b = this.nearestNode(to);
    const np = a && b ? this.nodePath(a, b) : [];
    let center: Pt[];
    if (np.length >= 2) {
      center = [{ ...from }, ...this.centerline(np), { ...to }];
    } else {
      center = [{ ...from }, { ...to }];
    }
    // de-dupe
    const clean: Pt[] = [];
    for (const p of center) if (!clean.length || len(clean[clean.length - 1], p) > 0.5) clean.push(p);
    return LaneGraph.offsetRight(clean, this.rightOffset);
  }
}

/**
 * Build the depot's one-way lane network from the sitePlan constants.
 */
export function buildDepotLanes(): LaneGraph {
  const g = new LaneGraph();
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

  // --- south boulevard chain (two-way), west→east through all junctions ---
  const southChain = ["SW", "Sg0", "S_in", "Sg1", "Sg2", "S_eg", "Sg3", "SE"]
    .sort((a, b) => g.nodes.get(a)!.x - g.nodes.get(b)!.x);
  for (let i = 1; i < southChain.length; i++) g.addRoad(southChain[i - 1], southChain[i]);

  // --- north boulevard chain (two-way) ---
  const northChain = ["NW", "Ng0", "Ng1", "Ng2", "Ng3", "NE"]
    .sort((a, b) => g.nodes.get(a)!.x - g.nodes.get(b)!.x);
  for (let i = 1; i < northChain.length; i++) g.addRoad(northChain[i - 1], northChain[i]);

  // --- avenues (two-way) ---
  g.addRoad("NW", "SW");
  g.addRoad("NE", "SE");

  // --- gap lanes: ONE-WAY NORTHBOUND (chargers face north) ---
  for (let i = 0; i < gapX.length; i++) g.addLane(`Sg${i}`, `Ng${i}`);

  // --- gates ---
  g.addLane("ingress", "S_in"); // drive in
  g.addLane("S_eg", "egress");  // drive out

  return g;
}
