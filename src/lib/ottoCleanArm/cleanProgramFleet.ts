/**
 * A FLEET VEHICLE'S CLEAN PROGRAM, MADE BY RULE FROM ITS CABIN.
 *
 * The generic car's program (cleanArmPose.STROKE_TARGETS) was written by hand for one cabin. The six fleet vehicles
 * have six cabins: one, two or no pillar a flank, hinged, sliding and butterfly doors, two to five seats, a roof from
 * 1.41 m to 1.94 m. This file writes each one's program from its cabin profile (fleetModels/cabin.ts) by ONE set of
 * rules, the generic program's own:
 *
 *   at each door opening the arm can stand at, in order:
 *     in by the door  ->  an air pass under the headliner  ->  each seat the opening reaches: its cushion, then
 *     its back  ->  the floor deep  ->  the floor by the door, finishing toward the way out;
 *   between two of those the wand comes back to a short pose just inside the door (the 'turn');
 *   the nozzle's mouth stands 6 cm off a cushion, 5 cm off the floor and 11 cm off a seat back.
 *
 * HOW A STROKE IS CHOSEN. A stroke is where the nozzle's tip must be. The wand that puts it there is searched over
 * the points of the door opening it can cross and a few nozzle angles; the first one (cheapest: least turned, most
 * room in the opening) that holds EVERY margin of cleanArmFleetClearance with room to spare (EXTRA), and from which
 * the way out holds them too, is taken. The moves between strokes are checked the same way. A stroke with no such
 * wand is left out and named in `notReached` with the reason: nothing is forced, and no margin is relaxed for a
 * vehicle.
 *
 * WHERE THE MAST STANDS. An open door leaf is a wall beside the opening: a hinged leaf stands out from its hinge
 * (and its window frame leans back over the opening), a sliding panel lies along the body, a butterfly door is a
 * roof over the opening. The mast comes down only where it keeps its margin from every leaf (the 'wrist run'), and
 * the wand reaches in from there, at a yaw if it must.
 *
 * PURE and deterministic. It is not run in the yard: its results are stored (programs/fleetPrograms.json,
 * cleanPrograms.ts) and cleanProgramFleet.test.ts makes them again and compares.
 */
import { cabinProfile, type CabinProfile, type CabinSeat } from '@/lib/fleetModels/cabin';
import type { VehicleSpec } from '@/lib/fleetModels/spec';
import { measureChargeBeside, measureOpeningBeside, type ChargeBesideMeasure } from './chargeArmBeside';
import { CLEAN_ARM, MAST_FOOT_MAX, PIVOT_Y_MAX, PIVOT_Y_MIN } from './cleanArmSpec';
import {
  cleanArmPoints, cleanJointsAt, makeCleanProgram, scaraIK, strokeJoints,
  type ChargeBeside, type CleanGeom, type CleanJoints, type CleanProgram, type CleanSides, type CleanVisit, type StrokeKey,
} from './cleanArmPose';
import { fleetBreach, jointLimitBreach, measureFleetPose, type ExtraMargin } from './cleanArmFleetClearance';
import type { StoredCleanProgram } from './cleanPrograms';

const rad = (d: number) => (d * Math.PI) / 180;
const degOf = (r: number) => (r * 180) / Math.PI;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The wrist stands this far out from the vehicle's widest point (the generic car's rule, cleanArmSpec.pivotZ). */
export const PIVOT_STANDOFF_M = 0.2;
/** Every margin a generated pose holds, over what the tests hold it to. */
export const GEN_EXTRA = 0.02;
/**
 * ...but two gaps are not a program's to choose: the mast's to the body is the wrist's standoff less the mast's own
 * radius (0.112 m), and the nozzle's to a seat is small on purpose (its mouth works 6 cm off a cushion, its edge
 * 3.5 cm). Those two keep less to spare.
 */
const EXTRA: ExtraMargin = { all: GEN_EXTRA, body: 0.005, seat: 0.008 };
/** A stroke's wand is never turned or tipped past these (the generic program's own range, a little wider). */
const YAW_MAX_DEG = 68;
const PITCH_RANGE_DEG: readonly [number, number] = [-60, 25];
/** How many wands that reach a target are measured in full before it is given up. */
const TRIES = 120;

type Kind = 'air' | 'cushion' | 'back' | 'floor';
interface Target { tip: { x: number; y: number; z: number }; kind: Kind; what: string; w: number; facing?: 1 | -1 }
type Key = Omit<StrokeKey, 'what' | 'w'>;

const SIDES: CleanSides = { a: 1, b: -1 };

/** The keyframe whose wand crosses the plane at (cx, cy) and puts the nozzle's tip on `tip`, the nozzle `nozzleDeg` off the wand. */
export function keyThrough(g: CleanGeom, cx: number, cy: number, tip: { x: number; y: number; z: number }, nozzleDeg: number): Key | null {
  const N = CLEAN_ARM.nozzle.len;
  const inward = g.planeZ - tip.z;
  if (inward <= 0.02) return null;
  const h = Math.hypot(tip.x - cx, inward), v = tip.y - cy;
  const nu = rad(nozzleDeg);
  const under = h * h + v * v - (N * Math.sin(nu)) ** 2;
  if (under <= 0) return null;
  const s = -N * Math.cos(nu) + Math.sqrt(under);
  if (s <= 0) return null;
  const yaw = Math.atan2(tip.x - cx, inward);
  const pitch = Math.atan2(v, h) - Math.atan2(N * Math.sin(nu), s + N * Math.cos(nu));
  const dOut = (g.pivotZ - g.planeZ) / (Math.cos(yaw) * Math.cos(pitch));
  return { cx, cy, yaw: degOf(yaw), pitch: degOf(pitch), ext: s + dOut - CLEAN_ARM.wand.base, nozzle: nozzleDeg };
}

function jointsOf(k: Key, g: CleanGeom): CleanJoints | null {
  try { return strokeJoints(k, 1, g); } catch { return null; }
}

/** What was done at one opening, and what was left and why. */
export interface OpeningReport {
  opening: string;
  used: boolean;
  why?: string;
  /** the wrist's clear run along the car beside this opening, metres */
  corridor?: [number, number];
  cleaned: string[];
  left: string[];
}

/** One opening's doors beside the charge arm, as measured, metres. */
export interface OpeningBeside { opening: string; doors: string[]; stowedM: number; latchedM: number | null; stowed: boolean; latched: boolean }

export interface FleetProgramResult {
  stored: StoredCleanProgram;
  openings: OpeningReport[];
  /** the whole port flank beside the charge arm, and each opening's own doors */
  beside: ChargeBesideMeasure;
  openingBeside: OpeningBeside[];
}

interface Base {
  g: CleanGeom;
  corridor: [number, number];
  /** the turn pose: a short wand just inside the door, which the cycle comes in to and can leave from */
  hub: StrokeKey;
  scoopY: number;
  readyX: number;
  turnYaw: number;
}

class OpeningPlan {
  readonly a;
  readonly g: CleanGeom;
  corridor: [number, number] | null = null;
  base: Base | null = null;
  /** Why the last pick or move check found nothing. */
  lastWhy = '';
  private crossGrid: { cx: number; cy: number; m: number }[] = [];

  constructor(readonly cabin: CabinProfile, readonly ai: number, readonly pivotZ: number) {
    this.a = cabin.apertures[ai];
    this.g = { pivotZ, planeZ: this.a.z };
    this.findCorridor();
    for (let cx = this.a.x0 + 0.06; cx <= this.a.x1 - 0.06 + 1e-9; cx += 0.05) {
      for (let cy = this.a.sill + 0.08; cy <= this.a.top - 0.05 + 1e-9; cy += 0.06) {
        const m = cabin.openingMargin(cx, cy, ai);
        if (m >= 0.07) this.crossGrid.push({ cx, cy, m });
      }
    }
  }

  /** Where the mast can come down beside this opening: clear of every door leaf and of the body, and in reach. */
  private findCorridor(): void {
    const { cabin, a, pivotZ } = this;
    // the mast below its outer sleeve (cleanArmClearance's capsules): the sleeve itself stays above MAST_FOOT_MAX
    const r = (CLEAN_ARM.mast.sections[1] * Math.SQRT2) / 2;
    const STEP = 0.02;
    const lo = a.x0 - 0.7, hi = a.x1 + 0.7;
    const ok: boolean[] = [];
    for (let x = lo; x <= hi + 1e-9; x += STEP) {
      let good = false;
      const ik = scaraIK(x, pivotZ);
      if (ik && ik.t2 <= CLEAN_ARM.limits.j2[1]) {
        good = true;
        for (let y = PIVOT_Y_MIN; y <= MAST_FOOT_MAX && good; y += 0.05) {
          const p = { x, y, z: pivotZ };
          if (cabin.leafClearance(p) - r < 0.1 + GEN_EXTRA || cabin.bodyClearance(p) - r < 0.1) good = false;
        }
      }
      ok.push(good);
    }
    // the clear run nearest the opening's middle
    const mid = (a.x0 + a.x1) / 2;
    let best: [number, number] | null = null, bestD = Infinity;
    for (let i = 0; i < ok.length; i++) {
      if (!ok[i]) continue;
      let j = i;
      while (j + 1 < ok.length && ok[j + 1]) j++;
      const run: [number, number] = [lo + i * STEP, lo + j * STEP];
      const d = mid < run[0] ? run[0] - mid : mid > run[1] ? mid - run[1] : 0;
      if (run[1] - run[0] >= 0.04 && d < bestD) { best = run; bestD = d; }
      i = j;
    }
    this.corridor = best;
  }

  private mastClearAt(x: number): boolean {
    const c = this.corridor;
    return !!c && x >= c[0] && x <= c[1];
  }

  /** Cheap first test of a keyframe: its joints, the wrist's place, and the wand's inner end in free cabin. */
  private quick(k: Key): CleanJoints | null {
    if (Math.abs(k.yaw) > YAW_MAX_DEG || k.pitch < PITCH_RANGE_DEG[0] || k.pitch > PITCH_RANGE_DEG[1]) return null;
    if (k.ext < 0 || k.ext > CLEAN_ARM.wand.maxExt) return null;
    const q = jointsOf(k, this.g);
    if (!q || jointLimitBreach(q)) return null;
    const pt = cleanArmPoints(q);
    if (!this.mastClearAt(pt.pivot.x) || pt.pivot.y > PIVOT_Y_MAX || pt.pivot.y < PIVOT_Y_MIN) return null;
    const { cabin } = this;
    for (const [p, r] of [[pt.tip, CLEAN_ARM.nozzle.h / 2], [pt.knuckle, CLEAN_ARM.wand.r]] as const) {
      if (cabin.skin(p).sd >= 0) return null;
      if (cabin.room(p) - r < GEN_EXTRA || cabin.seatClearance(p) - r < 0.01 + (EXTRA.seat ?? 0)) return null;
    }
    return q;
  }

  full(q: CleanJoints): string | null {
    return jointLimitBreach(q) ?? fleetBreach(measureFleetPose(this.cabin, q, 1, this.ai, 1, 0.04), EXTRA);
  }

  /** A one-visit program over these strokes, to play this opening's own moves through cleanJointsAt. */
  private probe(strokes: readonly StrokeKey[], scoopY: number, readyX: number, turnYaw: number): CleanProgram {
    const v: CleanVisit = { flank: 'far', opening: this.a.name, aperture: this.ai, planeZ: this.g.planeZ, readyX, scoopY, strokes };
    if (turnYaw !== 0) v.turnYaw = turnYaw;
    return makeCleanProgram('probe', this.pivotZ, [v]);
  }

  /** The way out from a keyframe holds every margin. */
  exitOk(k: StrokeKey, b: Pick<Base, 'scoopY' | 'readyX' | 'turnYaw'>): string | null {
    const from = jointsOf(k, this.g);
    if (!from) return 'out of reach';
    const program = this.probe([k], b.scoopY, b.readyX, b.turnYaw);
    for (let i = 1; i <= 16; i++) {
      const why = this.full(cleanJointsAt('exit_a', i / 16, SIDES, { from, program }));
      if (why) return `on the way out: ${why}`;
    }
    return null;
  }

  /** The move between two keyframes holds every margin. */
  segOk(a: StrokeKey, b: StrokeKey): string | null {
    for (let i = 1; i <= 7; i++) {
      const f = i / 8;
      const q = jointsOf({
        cx: lerp(a.cx, b.cx, f), cy: lerp(a.cy, b.cy, f), yaw: lerp(a.yaw, b.yaw, f), pitch: lerp(a.pitch, b.pitch, f),
        ext: lerp(a.ext, b.ext, f), nozzle: lerp(a.nozzle, b.nozzle, f),
      }, this.g);
      if (!q) return 'out of reach on the way';
      const why = this.full(q);
      if (why) return `on the way: ${why}`;
      // a step can end at any point of a stroke: the way out is checked from points along it, not only from its ends
      if (this.base) {
        const program = this.probe([this.base.hub], this.base.scoopY, this.base.readyX, this.base.turnYaw);
        for (const t of [0.08, 0.16, 0.25, 0.35, 0.45, 0.55, 0.65, 0.85]) {
          const out = this.full(cleanJointsAt('exit_a', t, SIDES, { from: q, program }));
          if (out) return `on the way out from between two strokes: ${out}`;
        }
      }
    }
    return null;
  }

  pathOk(path: StrokeKey[]): boolean {
    for (let n = 0; n + 1 < path.length; n++) {
      const why = this.segOk(path[n], path[n + 1]);
      if (why) { this.lastWhy = `${why}, between ${path[n].what} and ${path[n + 1].what}`; return false; }
    }
    return true;
  }

  /** The wand for one target: the cheapest crossing point and nozzle angle that passes every check, the way out too. */
  pick(t: Target, near: { cx: number; cy: number; yaw: number } | null): StrokeKey | null {
    const b = this.base!;
    const nozzles = t.kind === 'air' ? [20, 35, 45, 0] : t.kind === 'back' ? [0, 8, -15, 20, -30] : [-62, -45, -75, -30];
    const cands: { k: StrokeKey; cost: number }[] = [];
    for (const c of this.crossGrid) {
      for (let ni = 0; ni < nozzles.length; ni++) {
        const k0 = keyThrough(this.g, c.cx, c.cy, t.tip, nozzles[ni]);
        if (!k0) continue;
        // the nozzle faces what it cleans
        const pn = rad(k0.pitch + k0.nozzle), ps = rad(k0.yaw);
        const ny = Math.sin(pn), nx = Math.sin(ps) * Math.cos(pn);
        if ((t.kind === 'cushion' || t.kind === 'floor') && ny > -0.5) continue;
        if (t.kind === 'air' && ny < 0.15) continue;
        if (t.kind === 'back' && nx * -(t.facing ?? 1) < 0.45) continue;
        let cost = Math.abs(k0.yaw) / 90 + Math.abs(k0.pitch) / 120 + ni * 0.05 - Math.min(c.m, 0.2);
        if (near) cost += 0.6 * Math.hypot(k0.cx - near.cx, k0.cy - near.cy) + Math.abs(k0.yaw - near.yaw) / 180;
        cands.push({ k: { ...k0, what: t.what, w: t.w }, cost });
      }
    }
    cands.sort((p, q) => p.cost - q.cost);
    let tried = 0;
    const tally = new Map<string, number>();
    const note = (why: string) => { const key = why.replace(/-?\d+\.\d+ m /g, ''); tally.set(key, (tally.get(key) ?? 0) + 1); };
    for (const { k } of cands) {
      const q = this.quick(k);
      if (!q) continue;
      if (++tried > TRIES) break;
      const why = this.full(q) ?? this.exitOk(k, b);
      if (why) { note(why); continue; }
      return k;
    }
    const top = [...tally.entries()].sort((p, q) => q[1] - p[1])[0];
    this.lastWhy = !cands.length ? 'no wand through the opening points the nozzle at it'
      : tried === 0 ? 'no wand through the opening reaches it inside the arm\'s travel and the cabin\'s free space'
        : `${top[0]} (${top[1]} of ${Math.min(tried, TRIES)} wands measured)`;
    return null;
  }

  /** A short wand through (cx, cy) at a yaw, tipped 3 degrees down: a turn pose. */
  turnKey(cx: number, cy: number, yaw: number): StrokeKey {
    return { cx, cy, yaw, pitch: -3, ext: 0.03, nozzle: 0, what: 'turn', w: 1 };
  }

  /** The best turn pose whose wrist stands at `x`, straight in, that also has a way out. Null when there is none. */
  turnAt(x: number): StrokeKey | null {
    const b = this.base!;
    const top = Math.max(...this.cabin.seats.map((s) => s.cushionTop), this.cabin.floorTop + 0.3);
    let best: StrokeKey | null = null, bestSlack = -Infinity;
    for (let y = top + 0.17; y <= top + 0.7 + 1e-9; y += 0.075) {
      const k = this.turnKey(x, y, 0);
      const q = this.quick(k);
      if (!q) continue;
      const m = measureFleetPose(this.cabin, q, 1, this.ai);
      if (fleetBreach(m, EXTRA)) continue;
      const slack = Math.min(m.linkLeaf - 0.1, m.aperture - 0.03, m.seat - 0.01, m.room, m.wandLeaf - 0.03);
      if (slack > bestSlack && !this.exitOk(k, b)) { bestSlack = slack; best = k; }
    }
    return best;
  }

  /** The opening's standing choices: the turn pose, the swing-in height and yaw, and the ready point. */
  makeBase(): string | null {
    const { cabin, a, g } = this;
    if (!this.corridor) return 'the mast has no clear place to come down beside this opening: an open door leaf is in the way everywhere in reach';
    if (!this.crossGrid.length) return 'the opening is too small for the wand with its margin';
    // The turn pose: a short wand just inside the door, where the arm stands clearest. The cycle comes in to that
    // pose (stroke 0) and can leave from it. Straight in where the mast can stand abeam the opening, else at a yaw.
    const hubs: { k: StrokeKey; score: number; x: number }[] = [];
    let why = '';
    const top = Math.max(...cabin.seats.map((s) => s.cushionTop), cabin.floorTop + 0.3);
    for (let cx = a.x0 + 0.06; cx <= a.x1 - 0.06 + 1e-9; cx += 0.04) {
      for (const yaw of [0, 15, -15, 30, -30, 45, -45, 60, -60]) {
        for (let y = top + 0.17; y <= top + 0.7 + 1e-9; y += 0.075) {
          const k = this.turnKey(cx, y, yaw);
          const q = this.quick(k);
          if (!q) continue;
          const m = measureFleetPose(cabin, q, 1, this.ai);
          const broke = fleetBreach(m, EXTRA);
          if (broke) { why = broke; continue; }
          const slack = Math.min(m.linkLeaf - 0.1, m.aperture - 0.03, m.seat - 0.01, m.room, m.wandLeaf - 0.03);
          hubs.push({ k, score: slack - 0.004 * Math.abs(yaw), x: cleanArmPoints(q).pivot.x });
        }
      }
    }
    if (!hubs.length) return `no short pose just inside the door holds the margins${why ? ` (${why})` : ''}`;
    hubs.sort((p, q) => q.score - p.score);
    // The swing-in height is the highest that holds the margins: the nozzle crosses mid-door, well over the sill.
    for (const h of hubs.slice(0, 16)) {
      for (let s = a.sill + 0.5; s >= a.sill + 0.16 - 1e-9; s -= 0.04) {
        const broke = this.movesOk([{ ...h.k, w: 0 }], s, h.x, h.k.yaw);
        if (!broke) { this.base = { g, corridor: this.corridor, hub: h.k, scoopY: s, readyX: h.x, turnYaw: h.k.yaw }; return null; }
        why = broke;
      }
    }
    return `the wand cannot swing in through this opening and out again with its margins (${why})`;
  }

  /** The moves outside the clean, played through cleanJointsAt: lower, descend, enter, exit, ascend, raise. */
  movesOk(strokes: readonly StrokeKey[], scoopY: number, readyX: number, turnYaw: number): string | null {
    const program = this.probe(strokes, scoopY, readyX, turnYaw);
    for (const phase of ['lower_a', 'descend_a', 'enter_a', 'exit_a', 'ascend_a', 'raise_a'] as const) {
      for (let i = 0; i <= 16; i++) {
        let q: CleanJoints;
        try { q = cleanJointsAt(phase, i / 16, SIDES, { program }); } catch { return `${phase.slice(0, -2)}: out of reach`; }
        const why = this.full(q);
        if (why) return `${phase.slice(0, -2)}: ${why}`;
      }
    }
    return null;
  }

  /**
   * One group of strokes: the wands for its targets, and a way to them from the turn pose and back. The strokes
   * returned start and end where the turn pose can be reached. Null when it cannot be made (lastWhy says why).
   */
  group(targets: Target[]): StrokeKey[] | null {
    const b = this.base!;
    const keys: StrokeKey[] = [];
    let near: { cx: number; cy: number; yaw: number } | null = null;
    for (const t of targets) {
      const k = this.pick(t, near);
      if (!k) return null;
      keys.push(k);
      near = k;
    }
    if (this.pathOk([b.hub, ...keys, b.hub])) return keys;
    const direct = this.lastWhy;
    // come to the first stroke, and leave the last, with the wand drawn back along its own axis
    const drawn = (k: StrokeKey): StrokeKey => ({ ...k, ext: Math.max(0, k.ext - 0.2), nozzle: 0, what: 'turn', w: 0.8 });
    const d0 = drawn(keys[0]), d1 = drawn(keys[keys.length - 1]);
    const drawnOut = !this.exitOk(d0, b) && !this.exitOk(d1, b);
    if (drawnOut && this.pathOk([b.hub, d0, ...keys, d1, b.hub])) return [d0, ...keys, d1];
    // or by a turn pose of its own, abeam the first stroke's wrist
    const q0 = jointsOf(keys[0], this.g);
    const local = q0 ? this.turnAt(cleanArmPoints(q0).pivot.x) : null;
    if (local && this.pathOk([b.hub, local, ...keys, local, b.hub])) return [local, ...keys, local];
    if (local && drawnOut && this.pathOk([b.hub, local, d0, ...keys, d1, local, b.hub])) return [local, d0, ...keys, d1, local];
    this.lastWhy = direct;
    return null;
  }
}

/** The runs of x where `ok` holds, longest first. */
function runs(x0: number, x1: number, step: number, ok: (x: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let from: number | null = null;
  for (let x = x0; x <= x1 + step + 1e-9; x += step) {
    const good = x <= x1 + 1e-9 && ok(x);
    if (good && from === null) from = x;
    if (!good && from !== null) { out.push([from, x - step]); from = null; }
  }
  return out.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
}

const seatName = (cabin: CabinProfile, s: CabinSeat): string => {
  const rows = [...new Set(cabin.seats.map((q) => q.x))].sort((p, q) => q - p);
  if (rows.length === 1) return 'seat';
  const i = rows.indexOf(s.x);
  return i === 0 ? 'front seat' : i === rows.length - 1 ? 'rear seat' : 'middle seat';
};

/** What one cabin gives: a visit for each opening the arm can stand at, front to rear, and what is left. */
interface CabinPlan { pivotZ: number; perOpening: Omit<CleanVisit, 'flank'>[]; left: string[]; reports: OpeningReport[] }

/** Make the visits of one flank from a cabin: every opening the arm can stand at, front to rear. */
function planCabin(cabin: CabinProfile): CabinPlan {
  const pivotZ = cabin.width / 2 + PIVOT_STANDOFF_M;
  const plans = cabin.apertures.map((_, i) => new OpeningPlan(cabin, i, pivotZ));
  const refused = plans.map((p) => p.makeBase());
  const reports: OpeningReport[] = cabin.apertures.map((a, i) => ({
    opening: a.name, used: refused[i] === null, why: refused[i] ?? undefined, corridor: plans[i].corridor ?? undefined, cleaned: [], left: [],
  }));
  const groups: StrokeKey[][][] = cabin.apertures.map(() => []);
  const left: string[] = [];
  const inUse = (i: number) => refused[i] === null;
  /** The openings nearest a station first. */
  const order = (x: number) => cabin.apertures.map((a, i) => ({ i, d: x < a.x0 ? a.x0 - x : x > a.x1 ? x - a.x1 : 0 })).sort((p, q) => p.d - q.d).map((o) => o.i);

  // the air pass, at every opening in use
  for (let i = 0; i < plans.length; i++) {
    if (!inUse(i)) continue;
    const a = cabin.apertures[i];
    const z = Math.max(a.z - 0.72, 0.15);
    const yAt = (x: number) => cabin.ceilingAt(x, z) - 0.14;
    const clear = runs(Math.max(a.x0 + 0.1, cabin.x0 + 0.12), Math.min(a.x1 - 0.1, cabin.x1 - 0.12), 0.03,
      (x) => cabin.seatClearance({ x, y: yAt(x), z }) >= 0.1 && cabin.room({ x, y: yAt(x), z }) >= 0.08);
    let g: StrokeKey[] | null = null;
    let why = '';
    for (const run of clear) {
      const xa = run[1] - 0.02, xb = run[0] + 0.02, xm = (xa + xb) / 2;
      const one = (x: number, w: number): Target => ({ tip: { x, y: yAt(x), z }, kind: 'air', what: 'air pass', w });
      // the whole run, else its middle
      if (xa - xb > 0.1) { g = plans[i].group([one(xa, 1.6), one(xb, 2.6)]); if (!g && !why) why = plans[i].lastWhy; }
      if (!g) { g = plans[i].group([one(xm, 1.6)]); if (!g && !why) why = plans[i].lastWhy; }
      if (g) break;
    }
    if (g) { groups[i].push(g); reports[i].cleaned.push(g.filter((k) => k.what === 'air pass').length > 1 ? 'air pass under the headliner' : 'air pass under the headliner (one point)'); }
    else {
      why = why || 'no clear run under the headliner beside this opening';
      reports[i].left.push(`air pass (${why})`); left.push(`the air pass under the headliner at the ${a.name}: ${why}`);
    }
  }

  // each seat on this flank's half of the cabin, at the opening nearest it that reaches it
  for (const s of cabin.seats) {
    if (s.cushion.z1 < 0.15) continue; // the other flank's seat: its own flank's visit cleans it
    const name = seatName(cabin, s);
    const zHi = Math.min(s.cushion.z1 - 0.1, cabin.width / 2 - 0.33), zLo = Math.max(s.cushion.z0 + 0.1, 0.02);
    const zMid = (zHi + zLo) / 2;
    const at = (lx: number) => s.x + s.facing * lx;
    const yC = s.cushionTop + 0.06;
    const cushion: Target[] = [
      { tip: { x: at(0.17), y: yC, z: zHi }, kind: 'cushion', what: `${name}, cushion`, w: 1 },
      { tip: { x: at(0.0), y: yC, z: zMid }, kind: 'cushion', what: `${name}, cushion`, w: 2 },
      { tip: { x: at(0.12), y: yC, z: zLo }, kind: 'cushion', what: `${name}, cushion`, w: 1 },
    ];
    const face = (y: number) => {
      const slab = s.back.find((q) => y >= q.y0 && y <= q.y1) ?? s.back[s.back.length - 1];
      return (s.facing > 0 ? slab.x1 : slab.x0) + s.facing * 0.11;
    };
    const back: Target[] = [s.cushionTop + 0.14, s.cushionTop + 0.36].map((y, n) => (
      { tip: { x: face(y), y, z: zMid }, kind: 'back' as const, what: `${name}, back`, w: n === 0 ? 1 : 1.5, facing: s.facing }
    ));
    let doneC = false, doneB = false, whyC = '', whyB = '';
    for (const i of order(at(0.05))) {
      if (!inUse(i)) continue;
      if (!doneC) {
        const g = plans[i].group(cushion);
        if (g) { groups[i].push(g); reports[i].cleaned.push(`${name} cushion`); doneC = true; }
        else if (!whyC) whyC = `at the ${cabin.apertures[i].name}, ${plans[i].lastWhy}`;
      }
      if (!doneB) {
        const g = plans[i].group(back);
        if (g) { groups[i].push(g); reports[i].cleaned.push(`${name} back`); doneB = true; }
        else if (!whyB) whyB = `at the ${cabin.apertures[i].name}, ${plans[i].lastWhy}`;
      }
    }
    if (!doneC) left.push(`the ${name}'s cushion: ${whyC || 'no opening in use'}`);
    if (!doneB) left.push(`the ${name}'s back: ${whyB || 'no opening in use'}`);
  }

  // the floor: deep (toward the centre line), then by the door
  for (let i = 0; i < plans.length; i++) {
    if (!inUse(i)) continue;
    const a = cabin.apertures[i];
    const y = cabin.floorTop + 0.05;
    for (const [zs, what, label] of [[[0.1, 0.25], 'floor, deep', 'floor deep'], [[a.z - 0.46, a.z - 0.56], 'floor by the door', 'floor by the door']] as const) {
      let g: StrokeKey[] | null = null;
      let why = '';
      for (const z of zs) {
        const free = runs(Math.max(a.x0, cabin.x0) + 0.08, Math.min(a.x1, cabin.x1) - 0.08, 0.02, (x) => cabin.seatClearance({ x, y, z }) >= 0.07);
        for (const run of free) {
          const xa = run[1] - 0.02, xb = run[0] + 0.02, xm = (xa + xb) / 2;
          const ends = what === 'floor, deep' ? [xa, xb] : [xb, xa]; // the last stroke finishes toward the way out
          const one = (x: number, w: number): Target => ({ tip: { x, y, z }, kind: 'floor', what, w });
          if (Math.abs(xa - xb) > 0.08) { g = plans[i].group([one(ends[0], 1), one(ends[1], 3)]); if (!g && !why) why = plans[i].lastWhy; }
          if (!g) { g = plans[i].group([one(xm, 2)]); if (!g && !why) why = plans[i].lastWhy; }
          if (g) break;
        }
        if (g) break;
      }
      if (g) { groups[i].push(g); reports[i].cleaned.push(g.filter((k) => k.what === what).length > 1 ? label : `${label} (one point)`); }
      else {
        why = why || 'no floor free of seats beside this opening';
        reports[i].left.push(`${label} (${why})`); left.push(`the ${label} at the ${a.name}: ${why}`);
      }
    }
  }

  // assemble: in by the door (the turn pose), then each group, the turn pose between two groups
  const perOpening: Omit<CleanVisit, 'flank'>[] = [];
  for (let i = 0; i < plans.length; i++) {
    const b = plans[i].base;
    if (!b) { left.push(`everything at the ${cabin.apertures[i].name}: ${refused[i]}`); continue; }
    const strokes: StrokeKey[] = [{ ...b.hub, w: 0 }];
    groups[i].forEach((g, n) => { if (n > 0) strokes.push(b.hub); strokes.push(...g); });
    // a clean needs two keyframes: the turn pose twice if nothing else was reached
    if (!groups[i].length) strokes.push(b.hub);
    const why = plans[i].movesOk(strokes, b.scoopY, b.readyX, b.turnYaw);
    if (why) { reports[i].used = false; reports[i].why = why; left.push(`everything at the ${cabin.apertures[i].name}: ${why}`); continue; }
    const v: Omit<CleanVisit, 'flank'> = { opening: cabin.apertures[i].name, aperture: i, planeZ: b.g.planeZ, readyX: b.readyX, scoopY: b.scoopY, strokes };
    if (b.turnYaw !== 0) v.turnYaw = b.turnYaw;
    perOpening.push(v);
  }
  return { pivotZ, perOpening, left, reports };
}

/** The cabin a visit's strokes were made in: the vehicle's, or the one with only the visit's doors able to open. */
export function cabinForVisit(spec: VehicleSpec, v: Pick<CleanVisit, 'doors' | 'partial'>): CabinProfile {
  return v.partial && v.doors ? cabinProfile(spec, v.doors) : cabinProfile(spec);
}

/**
 * Make one vehicle's program from its cabin.
 *
 * THE FAR FLANK: one visit an opening, front to rear. No charger stands on that flank.
 *
 * THE PORT FLANK, PER OPENING (2026-11-14). The charge arm stands on this flank, and an opening's doors may be open
 * only while that arm is still in a place measured clear of THOSE doors over their whole travel
 * (chargeArmBeside.measureOpeningBeside). So each port visit names its doors and carries its own rule:
 *   - an opening whose doors clear the latched arm is worked during the charge;
 *   - an opening whose doors do not is worked with the charge arm stowed: after the charge, or with no charge;
 *   - an opening made by two sliding panels, of which one clears the latched arm and one does not, gets a visit
 *     with ONLY the clear panel open, if the cabin with that one panel open gives the arm a program by the same
 *     rules and margins (its strokes are made in that cabin: the shut panel is the body). The whole opening is
 *     still worked, both panels open, when the charge arm is stowed.
 * The visits that may be worked latched come first, so the arm waits once, at the last of them.
 *
 * `beside` (the whole flank's rule and the charge arm's park position) is stored with the program as before.
 */
export function fleetCleanProgram(spec: VehicleSpec): FleetProgramResult {
  const cabin = cabinProfile(spec);
  const whole = measureChargeBeside(spec, cabin);
  const beside: ChargeBeside = whole.facts;
  const plan = planCabin(cabin);
  const far: CleanVisit[] = plan.perOpening.map((v) => ({ flank: 'far' as const, ...v }));
  const port: CleanVisit[] = [];
  const besides: OpeningBeside[] = [];
  const reports = [...plan.reports];
  for (const v of plan.perOpening) {
    const doors = cabin.apertures[v.aperture].doorIds;
    const m = measureOpeningBeside(spec, cabin, doors, beside.parkX);
    besides.push({ opening: v.opening, doors: [...doors], stowedM: m.stowedM, latchedM: m.latchedM, ...m.facts });
    if (!m.facts.latched && doors.length > 1) {
      // two panels make this opening: the ones that clear the latched arm, each alone and together
      const clear = doors.filter((d) => measureOpeningBeside(spec, cabin, [d], beside.parkX).facts.latched);
      const part = clear.length && clear.length < doors.length ? measureOpeningBeside(spec, cabin, clear, beside.parkX) : null;
      if (part && part.facts.latched && part.facts.stowed) {
        const partCabin = cabinProfile(spec, clear);
        const partPlan = planCabin(partCabin);
        const name = `${v.opening}, ${clear.map((d) => (d === doors[0] ? 'front' : d === doors[doors.length - 1] ? 'rear' : d)).join(' and ')} panel only`;
        besides.push({ opening: name, doors: [...clear], stowedM: part.stowedM, latchedM: part.latchedM, ...part.facts });
        for (const r of partPlan.reports) reports.push({ ...r, opening: name, left: [...partPlan.left] });
        for (const pv of partPlan.perOpening) {
          port.push({ flank: 'port', ...pv, opening: name, doors: [...clear], partial: true, beside: part.facts });
        }
      }
    }
    port.push({ flank: 'port', ...v, doors: [...doors], beside: m.facts });
  }
  // what may be worked latched first: the arm then waits once, for the rest
  const order = [...port.filter((v) => v.beside!.latched), ...port.filter((v) => !v.beside!.latched)];
  // Across the roof the arm always comes to the flank's FRONT opening's ready point, the swing every program has
  // and every vehicle is measured on. Where the order starts at another whole opening it goes there by that point.
  const front = port.find((v) => !v.partial);
  if (front && order[0] !== front && !order[0].partial) order[0] = { ...order[0], swingVia: front.readyX };
  return {
    stored: { pivotZ: plan.pivotZ, visits: [...far, ...order], notReached: plan.left, beside, flankDoors: cabin.leaves.map((l) => l.id) },
    openings: reports, beside: whole, openingBeside: besides,
  };
}
