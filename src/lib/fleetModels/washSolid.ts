// A fleet vehicle as the solid the WASH machine works on: the body's own skin (surface.ts), every sensor and housing
// the model draws (build.ts sensorNode), the door mirrors and the tyres. carSolid.ts gives the charge arm a box that
// CONTAINS the car, which is right for a robot that must stay away. The detail arms must put a pad ON a sensor, so
// they need the shape itself: a sensor on a bumper's corner is 0.2 m inside that box.
//
// FRAME: the wash bay's (ottoWash/detailArm.ts), metres. `x` east of the drive line, `dy` south of the parked car's
// centre, `y` up from grade. A car in a bay faces north, so the model's nose (+X) is -dy and its right flank (+Z) is +x.
//
// HOW THE DISTANCE IS FOUND. The body is the union of its cross-sections. The section at the point's own station is
// taken from the surface exactly; the sections each side of it are kept SECTION_STEP_M apart or closer. The distance to a
// section is hypot(distance along the car, distance in the section's plane), so the answer is the distance to a set
// of curves that all lie ON the body: never less than the true distance, and more than it by at most
// SOLID_RESOLUTION_M (measured in washSolid.test.ts against the surface's own mesh). Every other part is an exact
// primitive: a box, or a profile turned about an axis.
import { K_BELT, K_TOP, makeSurface, sdPolygon, type Pt } from './surface';
import type { SensorSpec, VehicleSpec } from './spec';

/** A point or a direction in the bay frame, metres. */
export interface P3 { x: number; dy: number; y: number }

/** The stations kept each side of a point's own: 25 mm apart at the middle of the vehicle, and closer toward each bumper. */
export const SECTION_STEP_M = 0.025;
/** The most the solid's distance is over the true one (washSolid.test.ts measures it). */
export const SOLID_RESOLUTION_M = 0.004;
/**
 * Farther than this from the vehicle's box, `gap` gives the distance to the box: a lower bound, and far clear. Nearer,
 * it gives the distance to the vehicle itself.
 */
export const FAR_M = 0.45;
/** Points round half a section: every quarter of a control span. */
const RING_STEP = 0.25;
const RING_N = Math.round(K_TOP / RING_STEP) + 1;

type V3 = [number, number, number];

/** A drawn part other than the body's skin, in the MODEL frame (x forward from the centre, y up, z right). */
export type SolidPart =
  | { kind: 'box'; id: string; c: V3; half: V3; cos: number; sin: number; r: number }
  /** a profile [radius, along] turned about the axis from `o` along the unit vector `u` */
  | { kind: 'lathe'; id: string; o: V3; u: V3; profile: Pt[]; c: V3; r: number };

/** Where a sensor's node stands and which way it looks (build.ts sensorNode), in the model frame. */
export interface SensorPose { pos: V3; yaw: number; look: V3 }

export interface WashSolid {
  key: string;
  length: number;
  halfLen: number;
  /** half the widest thing on the vehicle, mirrors and sensors too */
  halfWidth: number;
  /** half the body's width alone */
  bodyHalfWidth: number;
  /** the highest thing on the vehicle */
  top: number;
  /** Clearance from a bay point to the vehicle, metres (negative inside). `skip`: leave this part out. */
  gap(p: P3, skip?: string): number;
  /** Clearance to the body's skin alone. */
  bodyGap(p: P3): number;
  /** The unit vector away from the vehicle at a point near it (the distance's gradient). */
  away(p: P3, skip?: string): P3;
  /** The highest thing at `dy`, metres above grade, or null past the vehicle's ends. */
  topAt(dy: number): number | null;
  /** Half the widest thing between two heights. */
  halfWidthIn(y0: number, y1: number): number;
  /** The body's roof rail at `dy`: its height and half-width; null past the ends. */
  railAt(dy: number): { y: number; halfWidth: number; top: number } | null;
  /** Where each sensor's node stands, by id. */
  pose(id: string): SensorPose | undefined;
  parts: readonly SolidPart[];
}

// ── the parts ────────────────────────────────────────────────────────────────

const lathe = (id: string, o: V3, u: V3, profile: Pt[]): SolidPart => {
  const a0 = Math.min(...profile.map((q) => q[1])), a1 = Math.max(...profile.map((q) => q[1]));
  const rr = Math.max(...profile.map((q) => q[0]));
  const mid = (a0 + a1) / 2;
  return { kind: 'lathe', id, o, u, profile, c: [o[0] + u[0] * mid, o[1] + u[1] * mid, o[2] + u[2] * mid], r: Math.hypot(rr, (a1 - a0) / 2) };
};
const box = (id: string, c: V3, size: V3, yaw: number): SolidPart => {
  const half: V3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  return { kind: 'box', id, c, half, cos: Math.cos(yaw), sin: Math.sin(yaw), r: Math.hypot(half[0], half[1], half[2]) };
};

function partGap(q: SolidPart, x: number, y: number, z: number): number {
  if (q.kind === 'box') {
    const dx = x - q.c[0], dz = z - q.c[2];
    // into the box's own axes: its length lies along (cos, 0, sin)
    const lx = Math.abs(dx * q.cos + dz * q.sin) - q.half[0];
    const ly = Math.abs(y - q.c[1]) - q.half[1];
    const lz = Math.abs(-dx * q.sin + dz * q.cos) - q.half[2];
    const out = Math.hypot(Math.max(lx, 0), Math.max(ly, 0), Math.max(lz, 0));
    return out > 0 ? out : Math.max(lx, ly, lz);
  }
  const dx = x - q.o[0], dy = y - q.o[1], dz = z - q.o[2];
  const a = dx * q.u[0] + dy * q.u[1] + dz * q.u[2];
  const rho = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - a * a));
  return sdPolygon(rho, a, q.profile);
}

/** What a sensor is drawn as (build.ts sensorNode, the full model), as solid parts. */
function sensorParts(sp: SensorSpec, pose: SensorPose): SolidPart[] {
  const sz = sp.size ?? [];
  const { pos, yaw, look } = pose;
  const up: V3 = [0, 1, 0];
  switch (sp.shape) {
    case 'spinLidar': {
      const [r = 0.08, h = 0.12] = sz;
      return [lathe(sp.id, pos, up, [[0, 0], [r * 1.15, 0], [r * 1.15, h * 0.22], [r, h * 0.22], [r, h * 0.84], [r * 1.04, h * 0.84], [r * 1.04, h], [0, h]])];
    }
    case 'puckLidar': {
      const [r = 0.05, h = 0.07] = sz;
      return [lathe(sp.id, pos, look, [[0, -h * 0.15], [r * 1.12, -h * 0.15], [r * 1.12, h * 0.15], [r, h * 0.15], [r, h - 0.01], [0, h - 0.01]])];
    }
    case 'camera': {
      const [r = 0.018, d = 0.03] = sz;
      return [lathe(sp.id, pos, look, [[0, -0.006], [r * 1.15, -0.006], [r, d - 0.006], [0, d - 0.006]])];
    }
    case 'dome': {
      const [r = 0.3, hh = 0.14] = sz;
      return [lathe(sp.id, pos, up, [[0, 0], [r, 0], [r, hh * 0.2], [r * 0.9, hh * 0.5], [r * 0.62, hh * 0.86], [r * 0.5, hh], [0, hh]])];
    }
    case 'radar': {
      const [l = 0.02, h = 0.07, w = 0.1] = sz;
      return [box(sp.id, pos, [l, h, w], yaw)];
    }
    default: {
      const [l = 0.1, h = 0.08, w = 0.12] = sz;
      return [box(sp.id, pos, [l, h, w], yaw)];
    }
  }
}

// ── the solid ────────────────────────────────────────────────────────────────

const cache = new Map<string, WashSolid>();

/** The vehicle as the wash machine meets it. Built once for each model. */
export function fleetWashSolid(spec: VehicleSpec): WashSolid {
  const hit = cache.get(spec.key);
  if (hit) return hit;
  const s = makeSurface(spec.curves);
  const L = s.length;
  const d = spec.dims;

  /** Half a section at a station: [z, y] from the underside's centre round to the roof's centre. */
  const sectionAt = (xr: number): Float64Array => {
    const out = new Float64Array(RING_N * 2);
    for (let i = 0; i < RING_N; i++) {
      const p = s.point(xr, Math.min(K_TOP, i * RING_STEP), 1);
      out[2 * i] = Math.max(0, p[2]); out[2 * i + 1] = p[1];
    }
    return out;
  };
  // the stations: close together at the two bumpers, where the skin turns to face along the car, and SECTION_STEP_M
  // apart at the middle (the surface's own spacing, surface.ts xrOf)
  const nSt = Math.ceil((Math.PI * L) / (2 * SECTION_STEP_M));
  const xrOf = (j: number) => L * (0.5 - 0.5 * Math.cos((Math.PI * j) / nSt));
  const stationOf = (xr: number) => Math.round((Math.acos(1 - 2 * Math.min(1, Math.max(0, xr / L))) / Math.PI) * nSt);
  const xrs = new Float64Array(nSt + 1);
  const secs: Float64Array[] = [];
  const zMax = new Float64Array(nSt + 1), yMin = new Float64Array(nSt + 1), yMax = new Float64Array(nSt + 1);
  for (let j = 0; j <= nSt; j++) {
    xrs[j] = xrOf(j);
    const sec = sectionAt(xrs[j]);
    secs.push(sec);
    let zm = 0, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < RING_N; i++) { zm = Math.max(zm, sec[2 * i]); y0 = Math.min(y0, sec[2 * i + 1]); y1 = Math.max(y1, sec[2 * i + 1]); }
    zMax[j] = zm; yMin[j] = y0; yMax[j] = y1;
  }
  /** Signed distance in a section's plane from (|z|, y) to the section (negative inside). */
  const inSection = (sec: Float64Array, az: number, y: number): number => {
    let best = Infinity;
    let inside = false;
    // the half ring, closed along the centre plane: the closing edge is not part of the skin, so it only counts for
    // which side the point is on
    for (let i = 0, j = RING_N - 1; i < RING_N; j = i++) {
      const ax = sec[2 * j], ay = sec[2 * j + 1], bx = sec[2 * i], by = sec[2 * i + 1];
      if ((ay > y) !== (by > y) && az < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      if (i === 0) continue;
      const ex = bx - ax, ey = by - ay, wx = az - ax, wy = y - ay;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
      const qx = wx - ex * t, qy = wy - ey * t;
      best = Math.min(best, qx * qx + qy * qy);
    }
    return (inside ? -1 : 1) * Math.sqrt(best);
  };
  let ownXr = NaN, own: Float64Array = secs[0];
  const body = (mx: number, y: number, mz: number): number => {
    const xr = L / 2 - mx, az = Math.abs(mz);
    let best = Infinity, inside = false;
    if (xr >= 0 && xr <= L) {
      if (xr !== ownXr) { own = sectionAt(xr); ownXr = xr; }
      const d2 = inSection(own, az, y);
      inside = d2 < 0;
      best = Math.abs(d2);
    }
    const j0 = stationOf(xr);
    for (let k = 0; k <= nSt; k++) {
      let any = false;
      for (const j of k === 0 ? [j0] : [j0 - k, j0 + k]) {
        if (j < 0 || j > nSt) continue;
        const dx = Math.abs(xr - xrs[j]);
        if (dx >= best) continue;
        any = true;
        const rz = Math.max(0, az - zMax[j]), ry = Math.max(yMin[j] - y, 0, y - yMax[j]);
        if (!inside && dx * dx + rz * rz + ry * ry >= best * best) continue;
        const d2 = inSection(secs[j], az, y);
        best = Math.min(best, Math.hypot(dx, inside ? d2 : Math.max(0, d2)));
      }
      if (!any && k > 0) break;
    }
    return inside ? -best : best;
  };

  // the sensors and housings, the mirrors and the tyres
  const parts: SolidPart[] = [];
  const poses = new Map<string, SensorPose>();
  for (const sp of spec.sensors) {
    let yaw = ((sp.yawDeg ?? 0) * Math.PI) / 180;
    let pos: V3 = [0, 0, 0];
    if (sp.on) {
      const side = sp.on.side === 0 ? 1 : sp.on.side;
      const tt = sp.on.side === 0 ? K_TOP : sp.on.tt;
      const p = s.point(sp.on.xr, tt, side), n = s.normalAt(sp.on.xr, tt, side);
      const lift = sp.on.lift ?? 0;
      pos = [p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift];
      if (sp.yawDeg === undefined && Math.hypot(n[0], n[2]) > 0.3) yaw = Math.atan2(n[2], n[0]);
    } else if (sp.pos) pos = [L / 2 - sp.pos[0], sp.pos[1], sp.pos[2]];
    const pose: SensorPose = { pos, yaw, look: [Math.cos(yaw), 0, Math.sin(yaw)] };
    poses.set(sp.id, pose);
    parts.push(...sensorParts(sp, pose));
  }
  if (spec.mirrors) {
    for (const side of [-1, 1] as const) {
      const p = s.point(spec.mirrors.xr, K_BELT + 0.25, side);
      parts.push(box(`mirror_${side}`, [p[0], spec.mirrors.y - 0.02, p[2] + side * 0.05], [0.07, 0.03, 0.12], 0));
      parts.push(box(`mirror_${side}`, [p[0] - 0.01, spec.mirrors.y + 0.03, p[2] + side * 0.17], [0.1, 0.13, 0.2], 0));
    }
  }
  for (const xr of [d.frontAxle, d.frontAxle + d.wheelbase]) {
    for (const side of [-1, 1] as const) {
      parts.push(lathe(`tyre_${side}`, [L / 2 - xr, d.tyreRadius, side * d.track / 2], [0, 0, 1],
        [[0, -d.tyreWidth / 2], [d.tyreRadius, -d.tyreWidth / 2], [d.tyreRadius, d.tyreWidth / 2], [0, d.tyreWidth / 2]]));
    }
  }

  // the box round the whole vehicle, in the model frame
  const box0 = { x: 0, fore: L / 2, aft: L / 2, top: 0 };
  for (let j = 0; j <= nSt; j++) { box0.x = Math.max(box0.x, zMax[j]); box0.top = Math.max(box0.top, yMax[j]); }
  for (const q of parts) {
    box0.x = Math.max(box0.x, Math.abs(q.c[2]) + q.r); box0.top = Math.max(box0.top, q.c[1] + q.r);
    box0.fore = Math.max(box0.fore, q.c[0] + q.r); box0.aft = Math.max(box0.aft, -q.c[0] + q.r);
  }
  const bodyGap = (p: P3) => body(-p.dy, p.y, p.x);
  const gap = (p: P3, skip?: string): number => {
    const mx = -p.dy, y = p.y, mz = p.x;
    // well clear of everything: the distance to the vehicle's box, which is never more than the true distance
    const far = Math.hypot(Math.max(0, Math.abs(mz) - box0.x), Math.max(0, mx - box0.fore, -mx - box0.aft), Math.max(0, y - box0.top));
    if (far >= FAR_M) return far;
    let best = body(mx, y, mz);
    for (const q of parts) {
      if (q.id === skip) continue;
      // nothing of this part is nearer than its centre less its radius
      if (Math.hypot(mx - q.c[0], y - q.c[1], mz - q.c[2]) - q.r >= best) continue;
      best = Math.min(best, partGap(q, mx, y, mz));
    }
    return best;
  };
  const away = (p: P3, skip?: string): P3 => {
    const e = 2e-3;
    const g = (dx: number, ddy: number, dyy: number) => gap({ x: p.x + dx, dy: p.dy + ddy, y: p.y + dyy }, skip);
    const v = { x: g(e, 0, 0) - g(-e, 0, 0), dy: g(0, e, 0) - g(0, -e, 0), y: g(0, 0, e) - g(0, 0, -e) };
    const n = Math.hypot(v.x, v.dy, v.y) || 1;
    return { x: v.x / n, dy: v.dy / n, y: v.y / n };
  };

  // each part's box in the bay frame, for the gantry's profile
  const spans = parts.map((q) => {
    const ex = q.kind === 'box' ? Math.abs(q.cos) * q.half[0] + Math.abs(q.sin) * q.half[2] : q.r;
    const ez = q.kind === 'box' ? Math.abs(q.sin) * q.half[0] + Math.abs(q.cos) * q.half[2] : q.r;
    const ey = q.kind === 'box' ? q.half[1] : q.r;
    return { dy0: -q.c[0] - ex, dy1: -q.c[0] + ex, y0: q.c[1] - ey, y1: q.c[1] + ey, x: Math.abs(q.c[2]) + ez };
  });
  let bodyHalfWidth = 0;
  for (let j = 0; j <= nSt; j++) bodyHalfWidth = Math.max(bodyHalfWidth, zMax[j]);
  const solid: WashSolid = {
    key: spec.key, length: L, halfLen: L / 2, bodyHalfWidth,
    halfWidth: Math.max(bodyHalfWidth, ...spans.map((b) => b.x)),
    top: Math.max(...Array.from(yMax), ...spans.map((b) => b.y1)),
    gap, bodyGap, away,
    topAt(dy) {
      const xr = dy + L / 2;
      if (xr < 0 || xr > L) return null;
      let top = s.at(xr).yt;
      for (const b of spans) if (dy >= b.dy0 && dy <= b.dy1) top = Math.max(top, b.y1);
      return top;
    },
    halfWidthIn(y0, y1) {
      let w = bodyHalfWidth;
      for (const b of spans) if (b.y1 >= y0 && b.y0 <= y1) w = Math.max(w, b.x);
      return w;
    },
    railAt(dy) {
      const xr = dy + L / 2;
      if (xr < 0 || xr > L) return null;
      const a = s.at(xr);
      return { y: a.rail, halfWidth: a.railW, top: a.yt };
    },
    pose: (id) => poses.get(id),
    parts,
  };
  cache.set(spec.key, solid);
  return solid;
}
