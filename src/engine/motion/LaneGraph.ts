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
/** Longest miter offsetRight will take, as a multiple of the lane offset. 2 allows
 *  every join up to a 120° turn exactly; sharper ones are clamped. */
const MITER_LIMIT = 2;

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
   *  overlap 74 -> 133 when every vertex took one). */
  static offsetRight(pts: Pt[], amount: number, miterFrom = 1, miterTo = pts.length - 2): Pt[] {
    if (pts.length < 2 || amount === 0) return pts.map((p) => ({ ...p }));
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
      let nx: number, ny: number, k = 1;
      if (nIn && nOut && (i < miterFrom || i > miterTo)) {
        // legacy join: the normal of the chord between the two neighbours
        const chord = normal(pts[i - 1], pts[i + 1]) ?? nIn;
        nx = chord.x; ny = chord.y;
      } else if (nIn && nOut) {
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
      }
      out.push({ x: pts[i].x + nx * amount * k, y: pts[i].y + ny * amount * k });
    }
    return out;
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
        const ox = a.x - uy * this.rightOffset, oy = a.y + ux * this.rightOffset;
        const t = (p.x - ox) * ux + (p.y - oy) * uy;
        if (t > L) continue;                                // this piece is behind the car
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
    const shift = (q: Pt) => ({ x: q.x - uy * this.rightOffset, y: q.y + ux * this.rightOffset });
    const tJoin = Math.min(L, j.t + JOIN_LEAD);
    const joinPt = shift({ x: a.x + ux * tJoin, y: a.y + uy * tJoin });
    // Destination ON this lane, ahead of the join: go straight to it rather than
    // driving past it to the lane's end node and doubling back.
    const tTo = (to.x - a.x) * ux + (to.y - a.y) * uy;
    const latTo = Math.abs((to.x - a.x) * -uy + (to.y - a.y) * ux);
    if (tTo > tJoin && tTo <= L && latTo <= this.rightOffset * 3) {
      return [{ ...from }, joinPt, { ...to }];
    }
    const destOk = (n: Node) => this.inDegree(n.id) > 0;
    const bNode = this.nearestNode(to, destOk) || this.nearestNode(to);
    const np = this.nodePath(lane.to, bNode);
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
    const shifted = LaneGraph.offsetRight(clean, this.rightOffset, 1, clean.length - 3);
    shifted[shifted.length - 1] = clean[clean.length - 1]; // `to` is a physical point
    shifted[0] = joinPt;
    return [{ ...from }, ...shifted];
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

    let a = this.nearestNode(from, originOk);
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
    const shifted = LaneGraph.offsetRight(clean, this.rightOffset, 2, clean.length - 3);
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
  for (let i = 1; i < southChain.length; i++) g.addRoad(southChain[i - 1], southChain[i]);

  // --- north boulevard chain (two-way) ---
  const northChain = ["NW", "Ng0", "Ng1", "Ng2", "Ng3", "Tn", "NE"]
    .sort((a, b) => g.nodes.get(a)!.x - g.nodes.get(b)!.x);
  for (let i = 1; i < northChain.length; i++) g.addRoad(northChain[i - 1], northChain[i]);

  // The aisle itself: TWO-WAY, because it is double-loaded (TW and TE face each other
  // across it) and it is a dead-end for anything but a through run between the two
  // collectors. 24.39 ft of clear pavement between the stall faces — the founder's
  // real-world two-way / 90-degree-parking spec. See sitePlan's TW/TE comment.
  g.addRoad("Tn", "Ts");

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

  // --- N1 APPROACH: the east-west lane serving the open NE overflow row -------
  // The row had no lane. sitePlan's old single `inTemp` predicate sent N1 traffic up
  // TEMP_LANE_X to the row's own y, and TEMP_LANE_X (247) runs through N1 stall 5
  // (render x 246.16..251.84) — the one route in drove the length of a parked car.
  // The row is SINGLE-loaded, so it is served from a lane BELOW it and cars sidestep
  // north into a stall; the lane body clears the stall faces by 4.65 ft.
  const n1 = PARK_RUNS.find((r) => r.id === "N1")!;
  g.addNode("N1w", n1.x0 - 6, N1_LANE_Y);                       // west stub, off the row's first stall
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
  g.addRoad("N1e", "NE");

  return g;
}
