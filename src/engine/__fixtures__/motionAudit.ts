// ============================================================================
// MOTION AUDIT — one replay, every motion metric, with the MECHANISM named.
//
// The founder, 2026-10-06, after watching run fd6ed035 (twinRun.chase1006.json):
// "major vehicle issues with the vehicle still spin in place when they approach
// other vehicles or potential traffic jams ... making sure as vehicles approach
// each other they don't collide or pass through one another."
//
// The ratchets before this could not see it. `spinSteps` (turnRadius.replay.test)
// counts a heading change at < 0.001u of travel, and the heading is budgeted
// YAW_PER_UNIT = 2.5 rad per unit of travel — so a car creeping in a queue may
// turn 143° in ONE unit of travel and never register: it is moving, just not
// enough to matter to the eye. This measures what the eye sees:
//
//  • PIVOT EVENT — the drawn heading turns by >= 45° within 4u of travel (one car
//    width; an effective radius under 5.1u), or by >= 90° within 9.8u (one car
//    length; under 6.2u). The car's own minimum radius is 11u (KinematicCar:
//    wheelbase 6 / tan 0.5), so either is a body turning about a point well inside
//    the turn a real car makes. After an event the window starts again, so one
//    continuous 360° spin counts eight 45° events. Each event records the car's
//    speed and travel, the nearest other car (centre distance; "near" < 15u), and
//    the MECHANISM, read off the driver's own state over the event's window:
//      backout   — inside a scripted reverse manoeuvre (allowed; measured anyway)
//      cusp      — a new rail at the end of a back-out
//      retask    — a new rail because the destination changed (moving re-rail)
//      watchdog  — a new rail from the 45 s stationary watchdog
//      start     — a first rail from rest (spawn, departure, residue repair)
//      hairpin   — the rail ITSELF turns >= 120° at one vertex inside the window
//      corner    — the rail itself turns the angle (a sharp fillet)
//      dock      — the dock blend at the end of a rail
//      catchup   — the rail did not turn: the drawn heading was catching up to it
//  • OVERLAP — oriented 9.8 x 4.0 bodies intersecting (replay.ts's test, never centre
//    distance), at flowReplay's own sample cadence, classified by situation:
//      parked/parked · passing/parked · docking/parked · backout/parked ·
//      backout (moving pair, one reversing) · merge · oncoming · queue rear-end ·
//      side-by-side · junction crossing · crossing off a junction
//  • the existing metrics, from the same pass: spin steps, share of turning at
//    R < 5u, crab (> 20° between heading and motion), structure contacts.
// ============================================================================
import { replayFlow, type FlowOptions, type FlowReport, FIXTURES, type MotionFixture } from "./flowReplay";
import { bodiesOverlap } from "./replay";
import { twinMotionDriver, MAX_VIEW_MULT } from "../TwinMotionDriver";
import { pointAt, type Rail } from "../motion/RailFlow";
import { buildDepotLanes } from "../motion/LaneGraph";
import { allStructureSolids, bodyHitsRect, type Rect } from "@/lib/structurePlan";
import { CAR_BODY_LENGTH, CAR_BODY_WIDTH } from "../motion/traffic";

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = Math.PI / 180;

/** The two pivot thresholds: turn this many degrees within this much travel (u). */
export const PIVOT_RULES = [
  { name: "p45", deg: 45, within: CAR_BODY_WIDTH },
  { name: "p90", deg: 90, within: CAR_BODY_LENGTH },
] as const;
type RuleName = (typeof PIVOT_RULES)[number]["name"];

/** Centre distance under which another car counts as "near" a pivot (u). */
export const NEAR_U = 15;

/** A step that moves < 0.001u is a spin step only if it also turns faster than this
 *  (rad per unit of travel): a radius under 1u, i.e. about the car's own centre. */
export const SPIN_YAW_PER_UNIT = 1;

export type PivotCause =
  | "backout" | "cusp" | "retask" | "watchdog" | "start"
  | "hairpin" | "corner" | "dock" | "catchup";

export interface PivotEvent {
  rule: RuleName;
  id: string;
  x: number;
  y: number;
  /** simulated wall clock at the event (ms since the capture's start) */
  wallMs: number;
  deg: number;
  travel: number;
  /** mean speed over the event (u/s of motion) */
  speed: number;
  /** stopped (v < 0.3) at some step in the window */
  stopped: boolean;
  nearestU: number;
  cause: PivotCause;
  limiter: string | null;
}

export type OverlapSituation =
  | "parked/parked" | "passing/parked" | "docking/parked" | "backout/parked"
  | "backout" | "merge" | "oncoming" | "queue" | "side-by-side" | "junction" | "crossing";

export interface AuditReport {
  name: string;
  flow: FlowReport;
  pivots: Record<RuleName, number>;
  /** pivots with another car within NEAR_U */
  pivotsNear: Record<RuleName, number>;
  pivotCauses: Record<RuleName, Partial<Record<PivotCause, number>>>;
  events: PivotEvent[];
  spinSteps: number;
  turningDeg: number;
  tightShare: number;
  crabShare: number;
  structureHits: number;
  structureKinds: Record<string, number>;
  overlapSamples: number;
  overlapBySituation: Partial<Record<OverlapSituation, number>>;
  /** 10u bins, per situation, for hotspot reading */
  overlapHotspots: Map<string, number>;
  /** every rail a car was given, by how it began: how many there were, how many
   *  started more than 30° / 60° off the way the car pointed (a kink the heading can
   *  only take by pivoting), and how many contain a vertex that turns >= 120° (a
   *  hairpin the rounding cannot open into a drivable arc) */
  rails: Partial<Record<PivotCause, { n: number; kink30: number; kink60: number; hairpin: number }>>;
}

type Entry = {
  car: { x: number; y: number; heading: number; speed: number };
  tracker: (Rail & { stationaryFor: number }) | null;
  reverse: { committed?: boolean } | null;
  dest: { kind: "stall"; lane: string; x: number; y: number; heading: number } | { kind: "egress" } | null;
  stallId: string | null;
};
type Internals = { entries: Map<string, Entry> };

interface Ctx {
  k: number;
  rail: Rail | null;
  rev: boolean;
  dest: string;
  v: number;
  s: number;
  limiter: string | null;
  stationary: number;
  /** unwrapped drawn heading after this step */
  H: number;
}
interface WinSample { S: number; H: number; k: number }
interface Track {
  x: number; y: number; h: number;
  S: number; H: number;
  wins: Record<RuleName, WinSample[]>;
  ctx: Ctx[];
}

const CTX_KEEP = 600; // steps of context kept per car (30 s of motion at dt 0.05)

/** Static solids, binned so a pose only tests the few that can reach it. */
function solidGrid() {
  const solids = allStructureSolids();
  const reach = Math.hypot(CAR_BODY_LENGTH / 2, CAR_BODY_WIDTH / 2) + 0.1;
  const CELL = 16;
  const grid = new Map<string, { kind: string; r: Rect }[]>();
  for (const k of solids) {
    for (let cx = Math.floor((k.r.x0 - reach) / CELL); cx <= Math.floor((k.r.x1 + reach) / CELL); cx++) {
      for (let cy = Math.floor((k.r.y0 - reach) / CELL); cy <= Math.floor((k.r.y1 + reach) / CELL); cy++) {
        const key = `${cx},${cy}`;
        (grid.get(key) ?? grid.set(key, []).get(key)!).push({ kind: k.kind, r: k.r });
      }
    }
  }
  return (x: number, y: number) => grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? [];
}

/** Largest single-vertex deflection (rad) of a rail between arc positions s0..s1. */
function railVertexTurn(r: Rail, s0: number, s1: number): number {
  let best = 0;
  for (let i = 1; i < r.pts.length - 1; i++) {
    if (r.cum[i] < s0 - 0.5 || r.cum[i] > s1 + 0.5) continue;
    const a = r.pts[i - 1], b = r.pts[i], c = r.pts[i + 1];
    const d = Math.abs(wrap(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)));
    best = Math.max(best, d);
  }
  return best;
}

/** Net tangent turning (rad) of a rail between arc positions s0..s1, unwrapped. */
function railTurn(r: Rail, s0: number, s1: number): number {
  if (s1 <= s0) return 0;
  let prev = pointAt(r.pts, r.cum, s0).heading, acc = 0;
  for (let s = s0 + 0.5; s <= s1 + 1e-9; s += 0.5) {
    const h = pointAt(r.pts, r.cum, Math.min(s, s1)).heading;
    acc += wrap(h - prev);
    prev = h;
  }
  return Math.abs(acc);
}

export function auditFixture(
  fixture: keyof typeof FIXTURES | MotionFixture,
  opts: FlowOptions = {},
  name = typeof fixture === "string" ? fixture : "custom",
): AuditReport {
  const d = twinMotionDriver as unknown as Internals;
  const nodes = [...buildDepotLanes().nodes.values()];
  const solidsAt = solidGrid();
  const F = typeof fixture === "string" ? FIXTURES[fixture] : fixture;
  const walled = F.frames.every((f) => typeof f.wall_ms === "number");
  const speedX = opts.playAt ?? F.speedX ?? 1;
  const mult = walled ? Math.max(1, Math.min(MAX_VIEW_MULT, speedX)) : 1;
  const dt = opts.dt ?? 0.05;
  const sampleSteps = Math.round((opts.sampleEvery ?? 2) / dt);

  const tracks = new Map<string, Track>();
  const events: PivotEvent[] = [];
  const pivots = { p45: 0, p90: 0 } as Record<RuleName, number>;
  const pivotsNear = { p45: 0, p90: 0 } as Record<RuleName, number>;
  const pivotCauses = { p45: {}, p90: {} } as Record<RuleName, Partial<Record<PivotCause, number>>>;
  let spin = 0, deg = 0, tight = 0, travel = 0, crab = 0;
  let structureHits = 0;
  const structureKinds: Record<string, number> = {};
  let overlapSamples = 0;
  const overlapBySituation: Partial<Record<OverlapSituation, number>> = {};
  const overlapHotspots = new Map<string, number>();
  let k = 0;
  let wallMs = 0, pollWall = 0, stepsSincePoll = 0;

  const nearNode = (x: number, y: number, r: number) => nodes.some((n) => Math.hypot(n.x - x, n.y - y) < r);
  /** how each rail began, decided the step it first appears on its car */
  const railCause = new WeakMap<Rail, PivotCause>();
  const rails: AuditReport["rails"] = {};
  /** A rail seen for the first time on a car pointing `heading` (before this step's
   *  ease): its kink and its sharpest vertex. */
  const censusRail = (r: Rail, cause: PivotCause, heading: number) => {
    const row = (rails[cause] ??= { n: 0, kink30: 0, kink60: 0, hairpin: 0 });
    row.n++;
    if (r.total > 0.5) {
      const kink = Math.abs(wrap(pointAt(r.pts, r.cum, Math.min(1.5, r.total)).heading - heading));
      if (kink > 30 * DEG) row.kink30++;
      if (kink > 60 * DEG) row.kink60++;
    }
    if (railVertexTurn(r, 0, r.total) >= 120 * DEG) row.hairpin++;
  };
  const startCause = (p: Ctx | undefined, c: Ctx): PivotCause => {
    if (!p) return "start";
    if (p.rev) return "cusp";
    if (!p.rail) return "start";
    if (p.dest !== c.dest) return "retask";
    if (p.stationary > 40) return "watchdog";
    return "retask";
  };

  /** The mechanism behind the rotation in the window [kStart, now]: the run of
   *  steps on one rail (or in one reverse) that rotated the body the most. A rail
   *  that began inside the window, or whose first 12u the window lies in, is
   *  credited to how it began — its first segment is what the heading turns to. */
  const attribute = (t: Track, kStart: number, e: Entry): PivotCause => {
    const all = t.ctx;
    let i0 = all.findIndex((c) => c.k >= kStart);
    if (i0 < 0) return "catchup";
    i0 = Math.max(1, i0);
    let best: { a: number; b: number; rot: number } | null = null;
    for (let a = i0; a < all.length;) {
      let b = a;
      while (b + 1 < all.length && all[b + 1].rail === all[a].rail && all[b + 1].rev === all[a].rev) b++;
      const rot = Math.abs(all[b].H - all[a - 1].H);
      if (!best || rot > best.rot) best = { a, b, rot };
      a = b + 1;
    }
    const run = all[best!.a];
    // A scripted reverse turns at R >= 11u, so it cannot reach either threshold on
    // its own (45° takes 8.6u, 90° takes 17.3u): a window that holds a reverse AND
    // the rail after it is the turn at the cusp, whichever half rotated more.
    if (run.rev) return all.slice(i0).some((c) => !c.rev && c.rail) ? "cusp" : "backout";
    const r = run.rail;
    if (!r) return "catchup";
    const began = railCause.get(r);
    if (all[best!.a - 1].rail !== r || all[best!.a].s < 12) return began ?? "start";
    const s0 = all[best!.a].s, s1 = all[best!.b].s;
    if (railVertexTurn(r, s0 - 2, s1 + 2) >= 120 * DEG) return "hairpin";
    if (e.dest?.kind === "stall" && r.total - s1 < 10.5) return "dock";
    const turned = railTurn(r, Math.max(0, s0 - 2), Math.min(r.total, s1 + 2));
    if (turned >= 0.7 * (PIVOT_RULES[0].deg * DEG)) return "corner";
    return "catchup";
  };

  const report = replayFlow(fixture, {
    ...opts,
    onPoll: (w, drv) => { pollWall = w; stepsSincePoll = 0; opts.onPoll?.(w, drv); },
    onStep: (poses) => {
      opts.onStep?.(poses);
      k++;
      stepsSincePoll++;
      wallMs = walled ? pollWall + (stepsSincePoll * dt * 1000) / mult : k * dt * 1000;
      const live = new Set<string>();
      for (const p of poses) {
        live.add(p.id);
        const e = d.entries.get(p.id);
        if (!e) continue;
        // ── structures (every pose, every step, as structureClearance.replay.test) ──
        for (const s of solidsAt(p.x, p.y)) {
          if (bodyHitsRect(p, s.r, 0.05)) {
            structureHits++;
            const kind = s.kind.replace(/-\d+$/, "");
            structureKinds[kind] = (structureKinds[kind] ?? 0) + 1;
          }
        }
        const rail = e.tracker;
        const ctx: Ctx = {
          k, rail, rev: !!e.reverse,
          dest: e.dest ? (e.dest.kind === "stall" ? `${e.dest.x.toFixed(2)},${e.dest.y.toFixed(2)}` : "egress") : "",
          v: rail ? rail.v : Math.abs(e.car.speed), s: rail ? rail.s : 0,
          limiter: rail?.limiter ?? null, stationary: rail?.stationaryFor ?? 0, H: 0,
        };
        let t = tracks.get(p.id);
        if (!t) {
          ctx.H = p.heading;
          if (rail && !railCause.has(rail)) { railCause.set(rail, "start"); censusRail(rail, "start", p.heading); }
          t = { x: p.x, y: p.y, h: p.heading, S: 0, H: p.heading, wins: { p45: [], p90: [] }, ctx: [ctx] };
          tracks.set(p.id, t);
          continue;
        }
        const dx = p.x - t.x, dy = p.y - t.y, ds = Math.hypot(dx, dy);
        const dh = wrap(p.heading - t.h);
        const prevH = t.h;
        t.x = p.x; t.y = p.y; t.h = p.heading;
        const prevCtx = t.ctx[t.ctx.length - 1];
        if (rail && prevCtx.rail !== rail && !railCause.has(rail)) {
          const cause = startCause(prevCtx, ctx);
          railCause.set(rail, cause);
          censusRail(rail, cause, prevH);
        }
        if (ds > 5) { // a spawn or re-placement, not motion
          t.S = 0; t.H = p.heading; t.wins = { p45: [], p90: [] };
          ctx.H = t.H;
          t.ctx = [ctx];
          continue;
        }
        ctx.H = t.H + dh;
        // a parked car's steps are not logged: nothing it does there can pivot it
        if (rail || ctx.rev || ds > 1e-6 || Math.abs(dh) > 1e-9) {
          t.ctx.push(ctx);
          if (t.ctx.length > 2 * CTX_KEEP) t.ctx.splice(0, t.ctx.length - CTX_KEEP);
        }
        // ── the existing turn metrics (turnRadius.replay.test's definitions) ──
        // a spin step turns faster than 1 rad per unit while moving < 0.001u (see
        // turnRadius.replay.test: a car creeping along a curve is not spinning)
        if (ds < 1e-3) { if (Math.abs(dh) > Math.max(1e-4, ds * SPIN_YAW_PER_UNIT)) spin++; }
        else {
          travel += ds;
          if (ds > 0.02) {
            let c = Math.abs(wrap(Math.atan2(dy, dx) - p.heading));
            if (c > Math.PI / 2) c = Math.PI - c;
            if (c > 20 * DEG) crab += ds;
          }
          if (Math.abs(dh) > 1e-4) {
            const dd = Math.abs(dh) / DEG;
            deg += dd;
            if (ds / Math.abs(dh) < 5) tight += dd;
          }
        }
        if (ds < 1e-6 && Math.abs(dh) < 1e-9) continue; // standing still
        t.S += ds;
        t.H += dh;
        // ── pivot events ──
        for (const rule of PIVOT_RULES) {
          const w = t.wins[rule.name];
          w.push({ S: t.S, H: t.H, k });
          while (w.length > 1 && t.S - w[0].S > rule.within) w.shift();
          let lo = Infinity, hi = -Infinity, kLo = k, kHi = k;
          for (const s of w) {
            if (s.H < lo) { lo = s.H; kLo = s.k; }
            if (s.H > hi) { hi = s.H; kHi = s.k; }
          }
          const turned = Math.max(t.H - lo, hi - t.H);
          if (turned < rule.deg * DEG) continue;
          const kStart = t.H - lo >= hi - t.H ? kLo : kHi;
          const from = w.find((s) => s.k === kStart)!;
          const steps = Math.max(1, k - kStart);
          let nearest = Infinity;
          for (const o of poses) if (o.id !== p.id) nearest = Math.min(nearest, Math.hypot(o.x - p.x, o.y - p.y));
          const cause = attribute(t, kStart, e);
          const win = t.ctx.filter((c) => c.k >= kStart);
          const ev: PivotEvent = {
            rule: rule.name, id: p.id, x: +p.x.toFixed(1), y: +p.y.toFixed(1), wallMs: Math.round(wallMs),
            deg: +(turned / DEG).toFixed(1), travel: +(t.S - from.S).toFixed(2),
            speed: +((t.S - from.S) / (steps * dt)).toFixed(2), stopped: win.some((c) => c.v < 0.3),
            nearestU: +nearest.toFixed(1), cause, limiter: [...win].reverse().find((c) => c.limiter)?.limiter ?? null,
          };
          events.push(ev);
          pivots[rule.name]++;
          if (nearest < NEAR_U) pivotsNear[rule.name]++;
          pivotCauses[rule.name][cause] = (pivotCauses[rule.name][cause] ?? 0) + 1;
          t.wins[rule.name] = [{ S: t.S, H: t.H, k }];
        }
      }
      for (const id of tracks.keys()) if (!live.has(id)) tracks.delete(id);

      // ── overlaps, on flowReplay's own sample cadence, by situation ──
      if (k % sampleSteps !== 0) return;
      const bodies = poses.map((p) => ({ id: p.id, x: p.x, y: p.y, h: p.heading, moving: p.moving }));
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const A = bodies[i], B = bodies[j];
          if (!bodiesOverlap(A, B)) continue;
          overlapSamples++;
          const ea = d.entries.get(A.id), eb = d.entries.get(B.id);
          const sit = situation(A, B, ea, eb, nearNode);
          overlapBySituation[sit] = (overlapBySituation[sit] ?? 0) + 1;
          const key = `${sit}@${Math.round((A.x + B.x) / 20) * 10},${Math.round((A.y + B.y) / 20) * 10}`;
          overlapHotspots.set(key, (overlapHotspots.get(key) ?? 0) + 1);
        }
      }
    },
  });

  return {
    name, flow: report, pivots, pivotsNear, pivotCauses, events, spinSteps: spin,
    turningDeg: deg, tightShare: deg ? tight / deg : 0, crabShare: travel ? crab / travel : 0,
    structureHits, structureKinds, overlapSamples, overlapBySituation, overlapHotspots, rails,
  };
}

type B = { id: string; x: number; y: number; h: number; moving: boolean };

function situation(A: B, Bb: B, ea: Entry | undefined, eb: Entry | undefined, nearNode: (x: number, y: number, r: number) => boolean): OverlapSituation {
  const revA = !!ea?.reverse, revB = !!eb?.reverse;
  if (!A.moving && !Bb.moving) return "parked/parked";
  if (A.moving !== Bb.moving) {
    const M = A.moving ? A : Bb, em = A.moving ? ea : eb;
    if (em?.reverse) return "backout/parked";
    const dst = em?.dest;
    if (dst?.kind === "stall" && Math.hypot(dst.x - M.x, dst.y - M.y) < 15) return "docking/parked";
    return "passing/parked";
  }
  if (revA || revB) return "backout";
  for (const [P, e] of [[A, ea], [Bb, eb]] as const) {
    const m = e?.tracker?.merge;
    if (m && Math.hypot(m.x - P.x, m.y - P.y) < 12) return "merge";
  }
  const c = Math.cos(A.h - Bb.h);
  if (c < -0.7) return "oncoming";
  const mx = (A.x + Bb.x) / 2, my = (A.y + Bb.y) / 2;
  if (c > 0.7) {
    const lat = Math.abs((Bb.x - A.x) * -Math.sin(A.h) + (Bb.y - A.y) * Math.cos(A.h));
    return lat < 1.5 ? "queue" : "side-by-side";
  }
  return nearNode(mx, my, 14) ? "junction" : "crossing";
}

/** One line per metric, for logs and the PR's before/after table. */
export function formatAudit(r: AuditReport): string {
  const f = r.flow, g = f.geometry;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const causes = (n: RuleName) => Object.entries(r.pivotCauses[n]).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${v}`).join(" · ");
  const sits = Object.entries(r.overlapBySituation).sort((a, b) => b[1] - a[1]).map(([s, v]) => `${s} ${v}`).join(" · ");
  return [
    `${r.name}: wall ${f.wallSeconds.toFixed(0)} s · motion ${f.motionSeconds.toFixed(0)} s · trips ${f.flow.finishedTrips}`,
    `  pivots p45 ${r.pivots.p45} (near ${r.pivotsNear.p45}) [${causes("p45")}]`,
    `  pivots p90 ${r.pivots.p90} (near ${r.pivotsNear.p90}) [${causes("p90")}]`,
    `  spin steps ${r.spinSteps} · R<5u ${pct(r.tightShare)} of ${r.turningDeg.toFixed(0)}° · crab ${(100 * r.crabShare).toFixed(2)}% · structures ${r.structureHits}${r.structureHits ? ` (${Object.entries(r.structureKinds).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}`,
    `  overlap ${g.overlapPairSamples} pair-samples of ${g.samples} (${pct(g.overlapRate)}, distinct ${g.distinctOverlapPairs}) · on screen ${f.viewer.overlapPairPolls}/${f.viewer.polls} polls`,
    `  overlap by situation: ${sits || "none"}`,
    `  stuck ${g.stuckSamples} · stopped ${pct(f.flow.stoppedFraction)} · lock-cycle ${f.flow.lockCycleSteps} · cluster ${g.worstMovingCluster} · offMap ${g.worstOffMap}`,
    `  rails: ${Object.entries(r.rails).map(([c, v]) => `${c} ${v.n} (kink>30° ${v.kink30}, >60° ${v.kink60}, hairpin ${v.hairpin})`).join(" · ")}`,
  ].join("\n");
}
