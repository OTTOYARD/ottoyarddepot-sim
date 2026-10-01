// ============================================================================
// ARRIVAL PROBE — does a car bound for a staging stall pull straight in, or does
// it drive past the stall and come back to it?
//
// The founder, 2026-10-01: "they go past their designated stall first and then
// come back to it and park ... Literally what it looks like is reverse and then
// pull into a parking spot. If it is going to a designated spot, it should not go
// past and then come back to it. It needs to immediately turn into that spot."
//
// Measured on the replayed motion (flowReplay, sampled every motion step), for
// every ARRIVAL leg — a car on a rail whose destination is a staging stall, from
// the step it gets that rail to the step it parks:
//
//  • OVERSHOOT — the stall's axis is the line the car parks along. A car coming
//    up the aisle from one side of that axis should reach it once, at the turn-in.
//    `overshootU` is how far (centre, measured square to the axis) it got PAST the
//    axis on the far side while in front of the stall (within FRONT_DEPTH of its
//    face), before coming back to park. A car that turns straight in reads ~0; the
//    reported defect reads a car length or more.
//  • DOUBLE-BACK — the path's direction of travel reverses: over any OPEN_ARC of
//    travel the heading of motion turns by more than DOUBLE_BACK_DEG. A U-turn
//    back to a stall it drove past.
//  • TAIL-FIRST — steps where the body is drawn moving backwards (velocity
//    against its own heading). The rail is always driven forward, so this is the
//    heading lagging a hairpin: the "reverse, then pull in" the founder saw.
//  • REVERSE GEAR — a leg that began by BACKING OUT of the stall the car was
//    leaving (a relocation from one staging stall to another). That back-out is a
//    departure manoeuvre and is intended; it is reported, and the arrival itself is
//    traced from the cusp where the car stops reversing. A rail is only ever driven
//    forward, so no car can reverse INTO its stall.
//
// Zones are the PARK_RUNS the stall belongs to (W / E / S1-3 perimeter carports,
// N1 overflow row, TW / TE temp block).
// ============================================================================
import { replayFlow, type FlowOptions, FIXTURES } from "./flowReplay";
import { twinMotionDriver } from "../TwinMotionDriver";
import { PARK_RUNS } from "@/lib/sitePlan";

/** Depth in front of the stall's parked centre that counts as "at the stall". */
const FRONT_DEPTH = 26;
/** How far past the axis counts as an overshoot (half a car width). */
export const OVERSHOOT_TOL = 2;
const OPEN_ARC = 14;
const DOUBLE_BACK_DEG = 135;

type Internals = {
  entries: Map<string, {
    car: { x: number; y: number; heading: number; speed: number };
    tracker: { s: number; total: number } | null;
    reverse: unknown;
    dest: { kind: "stall"; lane: string; x: number; y: number; heading: number } | { kind: "egress" } | null;
  }>;
};

export interface Arrival {
  id: string;
  zone: string;
  stall: { x: number; y: number };
  overshootU: number;
  doubleBack: boolean;
  tailFirstSteps: number;
  /** where the body was first drawn moving tail-first, if it was */
  tailFirstAt?: { x: number; y: number };
  reverseGear: boolean;
  pathU: number;
  /** the traced arrival path (only kept when `trace` is asked for) */
  trace?: { x: number; y: number }[];
  /** straight-line distance from where the car was when it got this rail */
  startDist: number;
}

export interface ArrivalReport {
  arrivals: Arrival[];
  /** legs still open at the end (not counted as arrivals) */
  unfinished: number;
}

export function zoneOf(x: number, y: number): string {
  let best = "?", bd = Infinity;
  for (const r of PARK_RUNS) {
    for (let i = 0; i < r.n; i++) {
      const d = Math.hypot(r.x0 + r.dx * i - x, r.y0 + r.dy * i - y);
      if (d < bd) { bd = d; best = r.id; }
    }
  }
  return bd < 3 ? best : "?";
}

interface Open {
  key: string; zone: string; sx: number; sy: number; h: number;
  pts: { x: number; y: number; hd: number }[];
  overshoot: number; side: number; tail: number; tailAt?: { x: number; y: number }; reverse: boolean; startDist: number;
}

export function probeArrivals(fixture: keyof typeof FIXTURES, opts: FlowOptions = {}, keepTrace = false): ArrivalReport {
  const d = twinMotionDriver as unknown as Internals;
  const open = new Map<string, Open>();
  const arrivals: Arrival[] = [];
  const close = (id: string, o: Open) => {
    let path = 0;
    for (let i = 1; i < o.pts.length; i++) path += Math.hypot(o.pts[i].x - o.pts[i - 1].x, o.pts[i].y - o.pts[i - 1].y);
    arrivals.push({
      id, zone: o.zone, stall: { x: o.sx, y: o.sy }, overshootU: o.overshoot,
      doubleBack: doublesBack(o.pts), tailFirstSteps: o.tail, ...(o.tailAt ? { tailFirstAt: o.tailAt } : {}), reverseGear: o.reverse,
      pathU: path, startDist: o.startDist,
      ...(keepTrace ? { trace: o.pts.map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1) })) } : {}),
    });
  };
  replayFlow(fixture, {
    ...opts,
    onStep: () => {
      const live = new Set<string>();
      for (const [id, e] of d.entries) {
        live.add(id);
        const dest = e.dest;
        const bound = dest && dest.kind === "stall" && dest.lane === "staging" && (e.tracker || e.reverse);
        const key = bound ? `${dest.x.toFixed(2)},${dest.y.toFixed(2)}` : "";
        let o = open.get(id);
        if (o && o.key !== key) {
          // the leg ended: parked on its stall = an arrival; anything else (re-assigned,
          // departing) is dropped, it never arrived
          const parked = !e.tracker && !e.reverse && Math.hypot(e.car.x - o.sx, e.car.y - o.sy) < 0.5;
          if (parked) close(id, o);
          open.delete(id);
          o = undefined;
        }
        if (!bound) continue;
        if (!o) {
          o = {
            key, zone: zoneOf(dest.x, dest.y), sx: dest.x, sy: dest.y, h: dest.heading, pts: [],
            overshoot: 0, side: 0, tail: 0, reverse: false,
            startDist: Math.hypot(e.car.x - dest.x, e.car.y - dest.y),
          };
          open.set(id, o);
        }
        if (e.reverse) {
          // a back-out out of the stall the car is LEAVING is a departure manoeuvre,
          // not part of the arrival: the arrival is traced from where it ends
          o.reverse = true;
          o.pts = [];
          o.side = 0;
          o.overshoot = 0;
          continue;
        }
        const last = o.pts[o.pts.length - 1];
        const x = e.car.x, y = e.car.y;
        if (last) {
          const dx = x - last.x, dy = y - last.y, ds = Math.hypot(dx, dy);
          if (ds > 0.02 && ds < 5) {
            if (Math.cos(Math.atan2(dy, dx) - e.car.heading) < -0.2) { o.tail++; o.tailAt ??= { x: +x.toFixed(1), y: +y.toFixed(1) }; }
          }
          if (ds < 0.05) continue;
        }
        o.pts.push({ x, y, hd: e.car.heading });
        // stall frame: f = parked heading (into the stall), u = square to it
        const fx = Math.cos(o.h), fy = Math.sin(o.h);
        const rx = x - o.sx, ry = y - o.sy;
        const depth = -(rx * fx + ry * fy); // how far in FRONT of the parked centre
        const lat = rx * -fy + ry * fx;     // signed offset from the stall's axis
        if (depth < 0 || depth > FRONT_DEPTH) continue;
        if (o.side === 0) { if (Math.abs(lat) > OVERSHOOT_TOL) o.side = Math.sign(lat); continue; }
        o.overshoot = Math.max(o.overshoot, -o.side * lat);
      }
      for (const [id] of open) if (!live.has(id)) open.delete(id);
    },
  });
  return { arrivals, unfinished: open.size };
}

/** Does the traced path turn its direction of travel by more than DOUBLE_BACK_DEG
 *  within OPEN_ARC of travel? */
function doublesBack(pts: { x: number; y: number }[]): boolean {
  // resample at ~1u
  const r: { x: number; y: number }[] = [];
  for (const p of pts) {
    const l = r[r.length - 1];
    if (!l || Math.hypot(p.x - l.x, p.y - l.y) >= 1) r.push(p);
  }
  const dirs: number[] = [];
  for (let i = 1; i < r.length; i++) dirs.push(Math.atan2(r[i].y - r[i - 1].y, r[i].x - r[i - 1].x));
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length && j - i <= OPEN_ARC; j++) {
      if (Math.cos(dirs[j] - dirs[i]) < Math.cos((DOUBLE_BACK_DEG * Math.PI) / 180)) return true;
    }
  }
  return false;
}

export function summarize(name: string, r: ArrivalReport): string {
  const zones = new Map<string, Arrival[]>();
  for (const a of r.arrivals) (zones.get(a.zone) ?? zones.set(a.zone, []).get(a.zone)!).push(a);
  const lines = [`${name}: ${r.arrivals.length} staging arrivals (${r.unfinished} legs unfinished at end)`];
  const row = (z: string, as: Arrival[]) => {
    const over = as.filter((a) => a.overshootU > OVERSHOOT_TOL).length;
    const db = as.filter((a) => a.doubleBack).length;
    const tf = as.filter((a) => a.tailFirstSteps > 0).length;
    const rg = as.filter((a) => a.reverseGear).length;
    const worst = Math.max(0, ...as.map((a) => a.overshootU));
    return `  ${z.padEnd(4)} n=${String(as.length).padStart(3)} · overshoot ${over}/${as.length} (worst ${worst.toFixed(1)}u) · double-back ${db}/${as.length} · tail-first ${tf}/${as.length} · reverse gear ${rg}/${as.length}`;
  };
  for (const [z, as] of [...zones].sort()) lines.push(row(z, as));
  lines.push(row("ALL", r.arrivals));
  return lines.join("\n");
}
