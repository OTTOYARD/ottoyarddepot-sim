// ============================================================================
// FLOW replay — does traffic actually MOVE, or does it hesitate and back up?
//
// replay.ts measures GEOMETRY (bodies overlapping, cars off the map, a knot of
// moving cars) and a coarse `stuck` count (a car making no arc progress for
// >10 s). None of those can see the founder's complaint of 2026-09-22: traffic
// that "gets horribly backed up", cars "hesitating and stopping when they meet
// one another at intersections and in passing". A car that stops at every
// junction for 3 s and then moves on is never `stuck`, never overlaps anything,
// and is exactly what makes the depot unwatchable. So this measures FLOW:
//
//  • stopped fraction — share of taxiing car-seconds spent at v < 0.3 u/s
//  • WHY it was stopped — the limiter RailFlow records on each rail: a body in
//    its path, an intersection it could not claim, a charger mouth held by
//    another car
//  • trips — each contiguous stretch a car spends in motion (rail or back-out),
//    with its duration, distance, and the number of times it came to a halt
//    before arriving (a hesitation), plus trips still unfinished at the end
//  • lock waits-for cycles — cars each waiting on an intersection held by the
//    next: a deadlock the 45 s watchdog is the only way out of
//
// TWO PACINGS. The August busy_day fixture carries no wall clock, so it keeps
// replay.ts's settle-per-frame pacing. The 2026-09-22 live capture carries each
// tick's WALL time, and is replayed the way the cockpit actually consumed it:
// a snapshot poll every 1.5 s (useTwinFeed POLL_MS), with motion running at the
// renderer's view multiplier — min(MAX_VIEW_MULT, speed_x), the driver's own
// ceiling (8x since 2026-09-22; it was 3x, so an 8x run moved at 3x) — between
// polls. performance.now() is replaced by the SIMULATED wall clock for the
// duration of the replay, so the 12 s commit-and-hold floor and the 45 s cap mean
// what they mean live, and the result does not depend on how fast this machine
// computes.
// ============================================================================
import busyday from "./twinRun.busyday.json";
import live0922 from "./twinRun.live0922.json";
import live0922rec from "./twinRun.live0922rec.json";
import fresh0922 from "./twinRun.fresh0922.json";
import { twinMotionDriver, MAX_VIEW_MULT } from "../TwinMotionDriver";
import { poseStore } from "../motion/poseStore";
import { useDepotStore } from "@/store/depotStore";
import type { TwinSnapshot } from "@/lib/ottoTwin";
import { bodiesOverlap, offMap } from "./replay";

interface RosterRow { id: string; av_id: string; make: string; platform: string; soc: number }
interface Change { id: string; state: string; stall_id: string | null }
interface Frame {
  t: string;
  wall_ms?: number;
  changes: Change[];
  /** reservation deltas (stall id -> vehicle id) published as stalls_status.reserved_by */
  reserved_set?: Record<string, string>;
  reserved_clear?: string[];
  /** stall ids the twin reports faulted/offline at this frame (replaces the previous list) */
  faulted?: string[];
  /** the newest TRAVEL leg per vehicle, as [seq, end_sim] (delta) — published as snapshot.legs */
  legs_set?: Record<string, [number, string]>;
  legs_clear?: string[];
}
export interface MotionFixture {
  runId: string;
  speedX?: number;
  stalls: { id: string; code: string; type: string; x?: number; y?: number }[];
  roster: RosterRow[];
  frames: Frame[];
}

export const FIXTURES: Record<string, MotionFixture> = {
  busyday: busyday as unknown as MotionFixture,
  live0922: live0922 as unknown as MotionFixture,
  live0922rec: live0922rec as unknown as MotionFixture,
  fresh0922: fresh0922 as unknown as MotionFixture,
};

export interface FlowOptions {
  /** poll cadence for wall-paced fixtures (ms of simulated wall time) */
  pollMs?: number;
  /** motion seconds per frame for fixtures WITHOUT wall_ms */
  settleSeconds?: number;
  dt?: number;
  /** motion seconds between geometry samples */
  sampleEvery?: number;
  /** stop the replay after this much simulated wall time (wall-paced only) */
  maxWallMs?: number;
  /** keep polling this long after the last frame so in-flight trips can land */
  tailWallMs?: number;
  /** replay the SAME world timeline as though the run had been PLAYED at this
   *  speed_x: every frame lands (speedX / playAt)x later on the wall clock, and
   *  the renderer's motion runs at min(MAX_VIEW_MULT, playAt). Wall-paced fixtures only; a
   *  maxWallMs is on the retimed clock. */
  playAt?: number;
  /** diagnostic hook, called after every reconcile with the simulated wall ms */
  onPoll?: (wallMs: number, driver: unknown) => void;
}

export interface Trip {
  id: string;
  /** motion seconds from the first moving step to arrival */
  durationS: number;
  distance: number;
  /** times the car came to a halt (v < 0.3) after having moved (v >= 1) mid-trip */
  halts: number;
  stoppedS: number;
  finished: boolean;
}

export interface FlowReport {
  wallSeconds: number;
  motionSeconds: number;
  geometry: {
    samples: number;
    overlapPairSamples: number;
    /** overlapPairSamples / samples. Samples are every `sampleEvery` MOTION
     *  seconds, so the raw count grows with the view multiplier (8x motion puts
     *  8/3 as many samples in the same wall window as 3x did); the rate does not. */
    overlapRate: number;
    distinctOverlapPairs: number;
    stuckSamples: number;
    worstMovingCluster: number;
    worstOffMap: number;
  };
  flow: {
    taxiCarSeconds: number;
    stoppedCarSeconds: number;
    stoppedFraction: number;
    /** mean speed over all taxiing car-seconds, u/s (MAX_SPEED is 8) */
    meanTaxiSpeed: number;
    stoppedBy: { body: number; node: number; mouth: number; other: number };
    trips: number;
    finishedTrips: number;
    unfinishedTrips: number;
    meanTripS: number;
    p50TripS: number;
    p95TripS: number;
    maxTripS: number;
    /** distance / (duration * 8 u/s): 1.0 = free flow the whole way */
    meanTripEfficiency: number;
    haltsPerTrip: number;
    /** trips that halted at least 3 times before arriving */
    stopAndGoTrips: number;
    /** samples (every step) in which some set of cars waited on each other's node locks */
    lockCycleSteps: number;
    peakTaxiing: number;
    meanTaxiing: number;
  };
  /** THE PICTURE AS THE COCKPIT SHOWS IT: overlapping body pairs counted once per
   *  snapshot poll, i.e. uniformly in WALL time — what a viewer watching for the
   *  length of the capture actually sees. Wall-paced fixtures only (0 otherwise). */
  viewer: { polls: number; overlapPairPolls: number };
  trips: Trip[];
}

type DriverInternals = {
  entries: Map<string, {
    car: { x: number; y: number; heading: number; speed: number };
    tracker: { s: number; v: number; total: number; stationaryFor: number; limiter?: string | null; limiterId?: string | null } | null;
    reverse: unknown;
  }>;
};

interface World { reserved: Map<string, string>; faulted: Set<string>; legs: Map<string, [number, string]> }

function applyFrame(f: Frame, states: Map<string, Change>, w: World) {
  for (const c of f.changes) {
    if (c.state === "__gone__") states.delete(c.id);
    else states.set(c.id, c);
  }
  for (const [stall, v] of Object.entries(f.reserved_set ?? {})) w.reserved.set(stall, v);
  for (const stall of f.reserved_clear ?? []) w.reserved.delete(stall);
  if (f.faulted) w.faulted = new Set(f.faulted);
  for (const [v, leg] of Object.entries(f.legs_set ?? {})) w.legs.set(v, leg);
  for (const v of f.legs_clear ?? []) w.legs.delete(v);
}

function snapshotOf(F: MotionFixture, states: Map<string, Change>, simClock: string, w?: World): TwinSnapshot {
  const vehicles = F.roster
    .filter((r) => states.has(r.id))
    .map((r) => {
      const s = states.get(r.id)!;
      return { id: r.id, av_id: r.av_id, make: r.make, platform: r.platform, state: s.state, soc: r.soc, stall_id: s.stall_id };
    });
  return {
    run: {
      sim_run_id: F.runId, scenario: "busy_day", status: "running",
      sim_clock: simClock, tick_count: 1, time_scale: 60, seed: 1, speed_x: F.speedX ?? 1,
    },
    legs: w ? [...w.legs].map(([vehicle_id, [seq, end_sim]]) => ({ vehicle_id, kind: "travel", seq, end_sim })) : [],
    fleet: { counts: {}, total: vehicles.length, vehicles },
    stalls_status: w
      ? F.stalls
          .filter((st) => w.reserved.has(st.id) || w.faulted.has(st.id))
          .map((st) => ({
            id: st.id,
            status: w.faulted.has(st.id) ? "faulted" : "reserved",
            reserved_by: w.reserved.get(st.id) ?? null,
          }))
      : [],
    energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

/** Detect whether any cars are waiting on each other at junctions in a cycle. */
function hasLockCycle(d: DriverInternals): boolean {
  // waits-for: a car stopped at a junction waits on the car RailFlow names as the
  // reason (the conflicting car inside, or the stopped body past the box).
  const waitsOn = new Map<string, string>();
  for (const [id, e] of d.entries) {
    const r = e.tracker;
    if (!r || r.limiter !== "node" || r.v > 0.3 || !r.limiterId) continue;
    waitsOn.set(id, r.limiterId);
  }
  for (const start of waitsOn.keys()) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      cur = waitsOn.get(cur);
      if (cur === start) return true;
    }
  }
  return false;
}

export function replayFlow(fixtureName: keyof typeof FIXTURES | MotionFixture, opts: FlowOptions = {}): FlowReport {
  const F0 = typeof fixtureName === "string" ? FIXTURES[fixtureName] : fixtureName;
  const F = opts.playAt && F0.frames.every((f) => typeof f.wall_ms === "number")
    ? retime(F0, opts.playAt)
    : F0;
  const dt = opts.dt ?? 0.05;
  const sampleEvery = opts.sampleEvery ?? 2;
  const pollMs = opts.pollMs ?? 1500;
  const walled = F.frames.every((f) => typeof f.wall_ms === "number");
  // the driver's own ceiling, so a replay always runs the multiplier the cockpit does
  const mult = walled ? Math.max(1, Math.min(MAX_VIEW_MULT, F.speedX ?? 1)) : 1;

  // ── simulated wall clock for everything that reads performance.now() ──
  let wallMs = 0;
  const perf = globalThis.performance;
  const realNow = perf.now.bind(perf);
  Object.defineProperty(perf, "now", { configurable: true, writable: true, value: () => wallMs });

  try {
    twinMotionDriver.clear();
    useDepotStore.setState({
      stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })),
    });
    twinMotionDriver.setTwinStallMap(F.stalls);
    twinMotionDriver.setViewMult(F.speedX ?? 1);
    const d = twinMotionDriver as unknown as DriverInternals;

    const states = new Map<string, Change>();
    const world: World = { reserved: new Map(), faulted: new Set(), legs: new Map() };
    let motionS = 0;
    let sinceSample = 0;
    // geometry
    let samples = 0, overlapPairSamples = 0, stuckSamples = 0, worstCluster = 0, worstOff = 0;
    const pairs = new Set<string>();
    // flow
    let taxiS = 0, stoppedS = 0, speedInt = 0, lockCycleSteps = 0, peakTaxi = 0, taxiIntegral = 0;
    const stoppedBy = { body: 0, node: 0, mouth: 0, other: 0 };
    let viewerPolls = 0, viewerOverlap = 0;
    const viewerCensus = () => {
      viewerPolls++;
      const b: { id: string; x: number; y: number; h: number; moving: boolean }[] = [];
      for (const [id, e] of d.entries) {
        const p = poseStore.get(id) ?? { x: e.car.x, y: e.car.y, heading: e.car.heading };
        b.push({ id, x: p.x, y: p.y, h: p.heading, moving: !!e.tracker });
      }
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (bodiesOverlap(b[i], b[j])) viewerOverlap++;
    };
    const open = new Map<string, Trip & { moved: boolean; lx: number; ly: number }>();
    const trips: Trip[] = [];

    const stepOnce = () => {
      twinMotionDriver.tickMotion(dt);
      motionS += dt;
      wallMs += (dt / mult) * 1000;
      let taxiing = 0;
      const live = new Set<string>();
      for (const [id, e] of d.entries) {
        live.add(id);
        const moving = !!e.tracker || !!e.reverse;
        let t = open.get(id);
        if (moving && !t) {
          t = { id, durationS: 0, distance: 0, halts: 0, stoppedS: 0, finished: false, moved: false, lx: e.car.x, ly: e.car.y };
          open.set(id, t);
        }
        if (moving && t) {
          t.durationS += dt;
          t.distance += Math.hypot(e.car.x - t.lx, e.car.y - t.ly);
          t.lx = e.car.x; t.ly = e.car.y;
          const v = Math.abs(e.tracker ? e.tracker.v : e.car.speed);
          if (v >= 1) t.moved = true;
          else if (v < 0.3) {
            t.stoppedS += dt;
            if (t.moved) { t.halts++; t.moved = false; }
          }
        } else if (!moving && t) {
          t.finished = true;
          trips.push({ id, durationS: t.durationS, distance: t.distance, halts: t.halts, stoppedS: t.stoppedS, finished: true });
          open.delete(id);
        }
        if (e.tracker) {
          taxiing++;
          taxiS += dt;
          speedInt += e.tracker.v * dt;
          if (e.tracker.v < 0.3) {
            stoppedS += dt;
            const why = e.tracker.limiter;
            if (why === "body" || why === "node" || why === "mouth") stoppedBy[why] += dt;
            else stoppedBy.other += dt;
          }
        }
      }
      // a car that left the scene mid-trip (despawned at the egress) finished it
      for (const [id, t] of open) {
        if (!live.has(id)) {
          trips.push({ id, durationS: t.durationS, distance: t.distance, halts: t.halts, stoppedS: t.stoppedS, finished: true });
          open.delete(id);
        }
      }
      peakTaxi = Math.max(peakTaxi, taxiing);
      taxiIntegral += taxiing * dt;
      if (hasLockCycle(d)) lockCycleSteps++;

      sinceSample += dt;
      if (sinceSample + 1e-9 >= sampleEvery) {
        sinceSample = 0;
        samples++;
        const bodies: { id: string; x: number; y: number; h: number; moving: boolean }[] = [];
        let stuck = 0, off = 0;
        for (const [id, e] of d.entries) {
          const p = poseStore.get(id) ?? { x: e.car.x, y: e.car.y, heading: e.car.heading };
          bodies.push({ id, x: p.x, y: p.y, h: p.heading, moving: !!e.tracker });
          if (e.tracker && e.tracker.stationaryFor > 10) stuck++;
          if (offMap(p)) off++;
        }
        stuckSamples += stuck;
        worstOff = Math.max(worstOff, off);
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) {
            if (bodiesOverlap(bodies[i], bodies[j])) {
              overlapPairSamples++;
              const a = bodies[i].id, b = bodies[j].id;
              pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
            }
          }
        }
        const movers = bodies.filter((b) => b.moving);
        for (const c of movers) {
          let n = 0;
          for (const o of movers) if (Math.hypot(c.x - o.x, c.y - o.y) <= 14) n++;
          worstCluster = Math.max(worstCluster, n);
        }
      }
    };

    if (walled) {
      const lastMs = F.frames[F.frames.length - 1].wall_ms!;
      const endMs = Math.min(opts.maxWallMs ?? Infinity, lastMs + (opts.tailWallMs ?? 0));
      let fi = 0;
      let lastFrame: Frame | null = null;
      const stepsPerPoll = Math.round(((pollMs / 1000) * mult) / dt);
      for (let poll = 0; poll <= endMs; poll += pollMs) {
        while (fi < F.frames.length && F.frames[fi].wall_ms! <= poll) {
          applyFrame(F.frames[fi], states, world);
          lastFrame = F.frames[fi];
          fi++;
        }
        if (lastFrame) {
          const base = Date.parse(lastFrame.t);
          const sim = new Date(base + (poll - lastFrame.wall_ms!) * (F.speedX ?? 1)).toISOString();
          twinMotionDriver.reconcile(snapshotOf(F, states, sim, world));
        }
        opts.onPoll?.(poll, twinMotionDriver);
        viewerCensus();
        for (let i = 0; i < stepsPerPoll; i++) stepOnce();
      }
    } else {
      const stepsPerFrame = Math.round((opts.settleSeconds ?? 30) / dt);
      for (const f of F.frames) {
        applyFrame(f, states, world);
        twinMotionDriver.reconcile(snapshotOf(F, states, f.t, world));
        for (let i = 0; i < stepsPerFrame; i++) stepOnce();
      }
    }

    for (const t of open.values()) {
      trips.push({ id: t.id, durationS: t.durationS, distance: t.distance, halts: t.halts, stoppedS: t.stoppedS, finished: false });
    }
    const done = trips.filter((t) => t.finished && t.distance > 1);
    const durs = done.map((t) => t.durationS).sort((a, b) => a - b);
    const q = (p: number) => (durs.length ? durs[Math.min(durs.length - 1, Math.floor(p * durs.length))] : 0);
    const eff = done.length ? done.reduce((a, t) => a + t.distance / Math.max(1e-6, t.durationS * 8), 0) / done.length : 0;
    return {
      wallSeconds: wallMs / 1000,
      motionSeconds: motionS,
      geometry: {
        samples, overlapPairSamples, overlapRate: samples ? overlapPairSamples / samples : 0,
        distinctOverlapPairs: pairs.size, stuckSamples,
        worstMovingCluster: worstCluster, worstOffMap: worstOff,
      },
      flow: {
        taxiCarSeconds: taxiS,
        stoppedCarSeconds: stoppedS,
        stoppedFraction: taxiS ? stoppedS / taxiS : 0,
        meanTaxiSpeed: taxiS ? speedInt / taxiS : 0,
        stoppedBy,
        trips: trips.length,
        finishedTrips: done.length,
        unfinishedTrips: trips.filter((t) => !t.finished).length,
        meanTripS: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0,
        p50TripS: q(0.5),
        p95TripS: q(0.95),
        maxTripS: durs.length ? durs[durs.length - 1] : 0,
        meanTripEfficiency: eff,
        haltsPerTrip: done.length ? done.reduce((a, t) => a + t.halts, 0) / done.length : 0,
        stopAndGoTrips: done.filter((t) => t.halts >= 3).length,
        lockCycleSteps,
        peakTaxiing: peakTaxi,
        meanTaxiing: motionS ? taxiIntegral / motionS : 0,
      },
      viewer: { polls: viewerPolls, overlapPairPolls: viewerOverlap },
      trips,
    };
  } finally {
    Object.defineProperty(perf, "now", { configurable: true, writable: true, value: realNow });
  }
}

/** The fixture as it would have arrived had the run been played at `speedX`: the
 *  world's own (sim-clock) timeline is unchanged; only when each frame reaches the
 *  cockpit moves. */
function retime(F: MotionFixture, speedX: number): MotionFixture {
  const k = (F.speedX ?? 1) / speedX;
  return { ...F, speedX, frames: F.frames.map((f) => ({ ...f, wall_ms: Math.round(f.wall_ms! * k) })) };
}

/** One-line human summary for logs and PR evidence. */
export function formatFlow(name: string, r: FlowReport): string {
  const f = r.flow, g = r.geometry;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return [
    `${name}: wall ${r.wallSeconds.toFixed(0)}s · motion ${r.motionSeconds.toFixed(0)}s`,
    `  stopped ${pct(f.stoppedFraction)} of ${f.taxiCarSeconds.toFixed(0)} taxi car-s · mean speed ${f.meanTaxiSpeed.toFixed(2)} u/s`,
    `  stopped by: body ${f.stoppedBy.body.toFixed(0)}s · node ${f.stoppedBy.node.toFixed(0)}s · mouth ${f.stoppedBy.mouth.toFixed(0)}s · other ${f.stoppedBy.other.toFixed(0)}s`,
    `  trips ${f.finishedTrips} done / ${f.unfinishedTrips} unfinished · mean ${f.meanTripS.toFixed(1)}s p50 ${f.p50TripS.toFixed(1)}s p95 ${f.p95TripS.toFixed(1)}s max ${f.maxTripS.toFixed(1)}s`,
    `  efficiency ${pct(f.meanTripEfficiency)} · halts/trip ${f.haltsPerTrip.toFixed(2)} · stop-and-go trips ${f.stopAndGoTrips} · lock-cycle steps ${f.lockCycleSteps}`,
    `  taxiing peak ${f.peakTaxiing} mean ${f.meanTaxiing.toFixed(1)}`,
    `  geometry: overlap ${g.overlapPairSamples} of ${g.samples} samples (${pct(g.overlapRate)}, distinct ${g.distinctOverlapPairs}) · stuck ${g.stuckSamples} · cluster ${g.worstMovingCluster} · offMap ${g.worstOffMap}`,
    `  on screen: ${r.viewer.overlapPairPolls} overlapping pairs over ${r.viewer.polls} polls`,
  ].join("\n");
}
