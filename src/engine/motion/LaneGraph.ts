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
  REAR_LANE_Y,
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
  /** how far to shift the centerline to the right of travel (lane half-width).
   *  Opposing directions on a divided road end up 2×this apart. Widened from 2.4
   *  (4.8u apart — a 5u car had ~0 passing clearance) to 3.2 (6.4u apart) so
   *  cars sit centred in their own lane with real clearance when passing. */
  rightOffset = 3.2;

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

  /** Dijkstra from one node over the WHOLE graph: cost to every reachable node
   *  plus the predecessor tree. Run once per candidate origin, then every
   *  candidate destination is scored off the same table. */
  private dijkstra(from: string): { dist: Map<string, number>; prev: Map<string, string> } {
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const seen = new Set<string>();
    dist.set(from, 0);
    // small graph → simple linear-scan priority selection
    while (true) {
      let u = "";
      let best = Infinity;
      for (const [id, d] of dist) if (!seen.has(id) && d < best) { best = d; u = id; }
      if (!u) break;
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
    return { dist, prev };
  }

  /** Walk the predecessor tree back from `to` to `from`. [] if unreachable. */
  private static walk(prev: Map<string, string>, from: string, to: string): string[] {
    if (from === to) return [from];
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

  /** Dijkstra node path (list of node ids) from→to over directed lanes. */
  private nodePath(from: string, to: string): string[] {
    const { dist, prev } = this.dijkstra(from);
    if (!dist.has(to)) return [];
    return LaneGraph.walk(prev, from, to);
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
    const destOk = (n: Node) => this.inDegree(n.id) > 0;

    // THE JOIN NODES ARE CHOSEN ON TOTAL DRIVEN DISTANCE, NOT ON PROXIMITY.
    //
    // Picking the Euclidean-nearest node at each end makes the car U-TURN when the
    // nearest node sits the wrong side of it. Measured on the busy_day fixture: a
    // car leaving the east staging block at (252.8, 168.8) for the west egress
    // joined the ring at SE (272.25, 172) because SE is 19.7u away and Sg3 is 32.9u
    // away — so its rail read
    //     (252.8,168.8) (271.9,168.8) (220.0,168.8) (200.0,168.8) …
    // i.e. drive 19u EAST down the WESTBOUND side of the south boulevard, spin 180°
    // in the SE corner, then drive back west past the point it started from. Eight
    // such cars produced 363 wrong-way samples and the (270,170) corner accounted
    // for 2210 of 4090 body-overlap pair-samples — over half of symptom 2, and
    // exactly the founder's "come to an intersection and the back bumper slides".
    //
    // The honest cost is the distance the car actually DRIVES: the approach leg
    // |from→a|, the graph leg a→b, and the pull-off leg |b→to|. Scoring on that,
    // Sg3 wins 190.9 to 229.9 and the backtrack disappears.
    //
    // The approach and pull-off legs are BEELINES, not lanes — they cut across
    // whatever happens to be between the car and the node — so they are fenced
    // in two ways. Candidates are capped at the nearest + APPROACH_SLACK (and at
    // 4 per end), so a join can only ever trade a SHORT extra approach for a
    // large saving on the network; and the beeline is scored at a PREMIUM, so an
    // exact tie breaks toward the nearer node. Without the premium,
    // (234,170)→egress preferred a 34u diagonal over a 14u one to save 0.08u.
    const APPROACH_SLACK = 25;
    const APPROACH_W = 1.35;
    const near = (p: Pt, ok: (n: Node) => boolean): Node[] => {
      const legal: { n: Node; d: number }[] = [];
      for (const n of this.nodes.values()) {
        if (!ok(n)) continue;
        legal.push({ n, d: Math.hypot(n.x - p.x, n.y - p.y) });
      }
      if (!legal.length) return [];
      legal.sort((u, v) => u.d - v.d);
      const cut = legal[0].d + APPROACH_SLACK;
      return legal.filter((c) => c.d <= cut).slice(0, 4).map((c) => c.n);
    };
    const origins = near(from, originOk);
    const dests = near(to, destOk);
    let a = "", b = "", np: string[] = [];
    let bestCost = Infinity;
    for (const o of origins) {
      const { dist, prev } = this.dijkstra(o.id);
      const lead = Math.hypot(o.x - from.x, o.y - from.y) * APPROACH_W;
      for (const d of dests) {
        const g = dist.get(d.id);
        if (g === undefined) continue;
        const cost = lead + g + Math.hypot(d.x - to.x, d.y - to.y) * APPROACH_W;
        if (cost >= bestCost) continue;
        const path = LaneGraph.walk(prev, o.id, d.id);
        if (!path.length) continue;
        bestCost = cost;
        a = o.id; b = d.id; np = path;
      }
    }
    // never strand a car: if the filters admit nothing (or nothing connects), fall
    // back to the old unfiltered nearest pick rather than degrading to a beeline.
    if (!a) { a = this.nearestNode(from); b = this.nearestNode(to); np = a && b ? this.nodePath(a, b) : []; }
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
    const shifted = LaneGraph.offsetRight(clean, this.rightOffset);
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
  g.addLane(`R${rearXs.length - 1}`, "NE"); // rear-east corner → down the east avenue

  return g;
}
