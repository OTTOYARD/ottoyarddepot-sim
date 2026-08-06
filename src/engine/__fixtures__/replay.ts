// ============================================================================
// Deterministic fixture replay for TwinMotionDriver.
//
// The motion defects (cars drawn off-map, cars piling into each other and
// bunching in a corner) are INTERMITTENT against a live sim, so a live run
// cannot tell a real fix from luck. This replays ONE captured run —
// `twinRun.busyday.json`, a read-only capture of sim_run 1fe94791 (116
// vehicles, scenario busy_day) — through the real driver at a fixed timestep
// and reports hard geometry metrics.
//
// Same fixture in, same numbers out. Every number is reproducible.
//
// METRICS, and why each is defined the way it is:
//  • OFF-MAP — a rendered pose outside the drivable envelope (the lot plus the
//    southern gate approach road). Symptom 1.
//  • BODY OVERLAP — two cars whose ORIENTED 4.2 x 10.2 bodies (the dimensions
//    VehicleDot actually draws) intersect. Centre-distance is the wrong test:
//    the perimeter park runs pitch stalls 5.7u apart, so every pair of parked
//    neighbours would read as a false "pile-up". Symptom 2.
//  • MOVING CLUSTER — the most TAXIING cars inside one 14u disc. Parked rows
//    are dense by design; a knot of moving cars is the thing that reads as
//    "bunched up in a corner".
//  • STUCK — a car that holds a route but makes no arc progress. A corner that
//    fills up and never drains is stuck cars, not slow ones.
// ============================================================================
import fixture from "./twinRun.busyday.json";
import { twinMotionDriver } from "../TwinMotionDriver";
import { poseStore } from "../motion/poseStore";
import { useDepotStore } from "@/store/depotStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import { LOT, INGRESS } from "@/lib/sitePlan";

interface RosterRow { id: string; av_id: string; make: string; platform: string; soc: number }
interface Change { id: string; state: string; stall_id: string | null }
interface Frame { t: string; changes: Change[] }

const F = fixture as unknown as {
  runId: string;
  stalls: { id: string; code: string; type: string }[];
  roster: RosterRow[];
  frames: Frame[];
};

/** Body the 2D cockpit actually draws (VehicleDot: width 4.2, height 10.2). */
export const CAR_W = 4.2;
export const CAR_L = 10.2;

/** The DRIVABLE ENVELOPE. Anything outside this is not a place a vehicle can be.
 *  The lot is x 6..294, y 6..206; the gate approach road runs south of it
 *  (INGRESS/EGRESS sit at y=215) and arrivals queue back east along it. 6u of
 *  tolerance keeps a car nosing into a perimeter stall from tripping it. */
export const ENVELOPE = {
  minX: LOT.x - 6,
  maxX: LOT.x + LOT.w + 6,
  minY: LOT.y - 6,
  maxY: INGRESS.y + 6,
};

export function offMap(p: { x: number; y: number }): boolean {
  return p.x < ENVELOPE.minX || p.x > ENVELOPE.maxX || p.y < ENVELOPE.minY || p.y > ENVELOPE.maxY;
}

interface Body { id: string; x: number; y: number; h: number; moving: boolean }

/** Separating-axis test on two oriented rectangles. `true` = bodies intersect. */
export function bodiesOverlap(a: Body, b: Body): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx * dx + dy * dy > (CAR_L + CAR_L) * (CAR_L + CAR_L)) return false; // cheap reject
  const axes = [a.h, a.h + Math.PI / 2, b.h, b.h + Math.PI / 2];
  // half-extents along each body's own (forward, lateral) axes
  const halfF = CAR_L / 2, halfS = CAR_W / 2;
  for (const t of axes) {
    const ux = Math.cos(t), uy = Math.sin(t);
    const proj = (h: number) =>
      Math.abs(Math.cos(h) * ux + Math.sin(h) * uy) * halfF +
      Math.abs(-Math.sin(h) * ux + Math.cos(h) * uy) * halfS;
    if (Math.abs(dx * ux + dy * uy) > proj(a.h) + proj(b.h)) return false; // separating axis
  }
  return true;
}

export interface Sample {
  frame: number;
  /** seconds of motion since this frame's snapshot landed */
  at: number;
  rendered: number;
  taxiing: number;
  offMap: { id: string; x: number; y: number; state: string }[];
  overlaps: { a: string; b: string; x: number; y: number }[];
  /** densest 14u disc counting only TAXIING cars */
  movingCluster: { n: number; x: number; y: number };
  stuck: number;
}

export interface ReplayReport {
  samples: Sample[];
  worstOffMap: number;
  worstOverlap: number;
  worstMovingCluster: Sample["movingCluster"] & { frame: number; at: number };
  worstStuck: number;
  /** every distinct (rounded) location where a body overlap was seen */
  overlapHotspots: Map<string, number>;
  /** aggregate totals — far less noisy than the per-sample maxima */
  totals: {
    samples: number;
    /** sum of overlapping pairs across every sample = "car-samples spent inside
     *  another car". The headline number for symptom 2. */
    overlapPairSamples: number;
    /** distinct unordered vehicle pairs that overlapped at least once */
    distinctOverlapPairs: number;
    /** sum of wedged cars across every sample */
    stuckSamples: number;
  };
}

type DriverInternals = {
  entries: Map<string, {
    car: { x: number; y: number; heading: number; speed: number };
    tracker: { s: number; total: number; stationaryFor: number } | null;
    lane: string | null;
    vstatus: string;
  }>;
};

/** Build the twin snapshot the feed would have delivered at frame `i`. */
function snapshotAt(states: Map<string, Change>, t: string): TwinSnapshot {
  const vehicles = F.roster
    .filter((r) => states.has(r.id))
    .map((r) => {
      const s = states.get(r.id)!;
      return {
        id: r.id, av_id: r.av_id, make: r.make, platform: r.platform,
        state: s.state, soc: r.soc, stall_id: s.stall_id,
      };
    });
  return {
    run: {
      sim_run_id: F.runId, scenario: "busy_day", status: "running",
      sim_clock: t, tick_count: 1, time_scale: 1, seed: 1, speed_x: 1,
    },
    legs: [],
    fleet: { counts: {}, total: vehicles.length, vehicles },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

/**
 * Replay the whole fixture, sampling geometry DURING motion (not only once it
 * has settled) so transient pile-ups cannot hide between snapshots.
 *
 * @param settleSeconds motion time between snapshots
 * @param sampleEvery   seconds between geometry samples
 */
export function replayFixture(settleSeconds = 30, sampleEvery = 2, dt = 0.05): ReplayReport {
  twinMotionDriver.clear();
  useDepotStore.setState({
    stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
  });
  twinMotionDriver.setTwinStallMap(F.stalls);

  const states = new Map<string, Change>();
  const samples: Sample[] = [];
  const stepsPerSample = Math.round(sampleEvery / dt);
  const samplesPerFrame = Math.round(settleSeconds / sampleEvery);

  F.frames.forEach((f, index) => {
    for (const c of f.changes) states.set(c.id, c);
    twinMotionDriver.reconcile(snapshotAt(states, f.t));
    for (let k = 0; k < samplesPerFrame; k++) {
      for (let i = 0; i < stepsPerSample; i++) twinMotionDriver.tickMotion(dt);
      samples.push(measure(index, (k + 1) * sampleEvery, states));
    }
  });

  const overlapHotspots = new Map<string, number>();
  for (const s of samples) {
    for (const o of s.overlaps) {
      const key = `${Math.round(o.x / 10) * 10},${Math.round(o.y / 10) * 10}`;
      overlapHotspots.set(key, (overlapHotspots.get(key) ?? 0) + 1);
    }
  }
  let worstCluster = { n: 0, x: 0, y: 0, frame: 0, at: 0 };
  for (const s of samples) {
    if (s.movingCluster.n > worstCluster.n) {
      worstCluster = { ...s.movingCluster, frame: s.frame, at: s.at };
    }
  }

  const pairs = new Set<string>();
  for (const s of samples) {
    for (const o of s.overlaps) pairs.add(o.a < o.b ? `${o.a}|${o.b}` : `${o.b}|${o.a}`);
  }

  return {
    samples,
    worstOffMap: Math.max(...samples.map((s) => s.offMap.length)),
    worstOverlap: Math.max(...samples.map((s) => s.overlaps.length)),
    worstMovingCluster: worstCluster,
    worstStuck: Math.max(...samples.map((s) => s.stuck)),
    overlapHotspots,
    totals: {
      samples: samples.length,
      overlapPairSamples: samples.reduce((a, s) => a + s.overlaps.length, 0),
      distinctOverlapPairs: pairs.size,
      stuckSamples: samples.reduce((a, s) => a + s.stuck, 0),
    },
  };
}

function measure(frame: number, at: number, states: Map<string, Change>): Sample {
  const entries = (twinMotionDriver as unknown as DriverInternals).entries;
  const bodies: Body[] = [];
  const off: Sample["offMap"] = [];
  let taxiing = 0, stuck = 0;
  for (const [id, e] of entries) {
    const p = poseStore.get(id) ?? { x: e.car.x, y: e.car.y, heading: e.car.heading };
    bodies.push({ id, x: p.x, y: p.y, h: p.heading, moving: !!e.tracker });
    if (e.tracker) {
      taxiing++;
      if (e.tracker.stationaryFor > 10) stuck++;
    }
    if (offMap(p)) {
      off.push({
        id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        state: states.get(id)?.state ?? "?",
      });
    }
  }

  const overlaps: Sample["overlaps"] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (bodiesOverlap(bodies[i], bodies[j])) {
        overlaps.push({
          a: bodies[i].id, b: bodies[j].id,
          x: Math.round((bodies[i].x + bodies[j].x) / 2),
          y: Math.round((bodies[i].y + bodies[j].y) / 2),
        });
      }
    }
  }

  const movers = bodies.filter((b) => b.moving);
  let movingCluster = { n: 0, x: 0, y: 0 };
  for (const c of movers) {
    let n = 0;
    for (const o of movers) if (Math.hypot(c.x - o.x, c.y - o.y) <= 14) n++;
    if (n > movingCluster.n) movingCluster = { n, x: Math.round(c.x), y: Math.round(c.y) };
  }

  return { frame, at, rendered: bodies.length, taxiing, offMap: off, overlaps, movingCluster, stuck };
}
