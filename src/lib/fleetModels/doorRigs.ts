// How each door of a fleet vehicle moves, derived from its spec and its body surface. PURE (no three.js): build.ts
// writes this rig onto the door's node, rig.ts moves the node with it, and cabin.ts places the open door leaf with it
// for the robots' clearance. One derivation, so the drawn door and the measured door cannot disagree.
//
// Frame: the model's (surface.ts): metres, +X toward the nose, +Y up, +Z to the vehicle's right, origin on the ground
// under the middle of the body.
import { K_BELT, polyline, type Surface } from './surface';
import type { DoorSpec } from './spec';

export interface DoorRig {
  id: string;
  kind: 'hinge' | 'slide' | 'butterfly';
  side: -1 | 1;
  pivot: [number, number, number];
  /** hinge / butterfly: unit axis through the pivot and the signed full-open angle, radians. */
  axis?: [number, number, number];
  angle?: number;
  /** slide: the step outboard and the run along the body, metres. */
  out?: [number, number, number];
  along?: [number, number, number];
}

type V3 = [number, number, number];

/** Rotate `v` about the unit axis `k` by `a` radians (Rodrigues). */
export function rotateAbout(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [
    v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d * (1 - c),
    v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d * (1 - c),
    v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d * (1 - c),
  ];
}

/** The ring parameter a door's pivot is read at: mid body side. */
export const DOOR_PIVOT_TT = 4.2;

export function doorRigOf(door: DoorSpec, s: Surface): DoorRig {
  const L = s.length;
  const ttMid = DOOR_PIVOT_TT;
  const xf = polyline(door.front)(ttMid);
  const xb = polyline(door.rear)(ttMid);
  const rig: DoorRig = { id: door.id, kind: door.kind, side: door.side, pivot: [0, 0, 0] };
  if (door.kind === 'hinge') {
    const xh = door.hingeAtRear ? xb - 0.02 : xf + 0.02;
    const p = s.point(xh, ttMid, door.side);
    rig.pivot = [p[0], 0, p[2] - door.side * 0.035];
    rig.axis = [0, 1, 0];
    rig.angle = ((door.swingDeg ?? 65) * Math.PI / 180) * door.side * (door.hingeAtRear ? -1 : 1);
  } else if (door.kind === 'slide') {
    const p = s.point((xf + xb) / 2, ttMid, door.side);
    rig.pivot = [p[0], 0, p[2]];
    rig.out = [0, 0, door.side * (door.popOut ?? 0.14)];
    rig.along = [(door.slideDir ?? -1) * (door.travel ?? xb - xf), 0, 0];
  } else {
    const [a, b] = door.axis!;
    const za = s.point(a[0], ttMid, door.side)[2] - door.side * a[2];
    const zb = s.point(b[0], ttMid, door.side)[2] - door.side * b[2];
    const pivot: V3 = [L / 2 - a[0], a[1], za];
    const d: V3 = [L / 2 - b[0] - pivot[0], b[1] - pivot[1], zb - pivot[2]];
    const inv = 1 / (Math.hypot(d[0], d[1], d[2]) || 1);
    const axis: V3 = [d[0] * inv, d[1] * inv, d[2] * inv];
    // Pick the sense that lifts the door: its trailing edge, at the belt, must end higher and further out.
    const full = (door.swingDeg ?? 80) * Math.PI / 180;
    const q = s.point(xb, K_BELT, door.side);
    const probe: V3 = [q[0] - pivot[0], q[1] - pivot[1], q[2] - pivot[2]];
    const gain = (sgn: number) => { const r = rotateAbout(probe, axis, sgn * full); return (r[1] - probe[1]) + door.side * (r[2] - probe[2]); };
    const up = gain(1) - gain(-1);
    rig.pivot = pivot;
    rig.axis = axis;
    rig.angle = full * (up >= 0 ? 1 : -1);
  }
  return rig;
}

const smooth = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

/**
 * Where a point of the SHUT door (model frame) is with the door open `t` (0 shut .. 1 open). The same motion as
 * rig.doorPose, without three.js.
 */
export function doorPointAt(rig: DoorRig, t: number, p: V3): V3 {
  if (rig.kind === 'slide') {
    const o = smooth(0, 0.3, t);
    const a = smooth(0.15, 1, t);
    return [
      p[0] + rig.out![0] * o + rig.along![0] * a,
      p[1] + rig.out![1] * o + rig.along![1] * a,
      p[2] + rig.out![2] * o + rig.along![2] * a,
    ];
  }
  const rel: V3 = [p[0] - rig.pivot[0], p[1] - rig.pivot[1], p[2] - rig.pivot[2]];
  const r = rotateAbout(rel, rig.axis!, rig.angle! * smooth(0, 1, t));
  return [r[0] + rig.pivot[0], r[1] + rig.pivot[1], r[2] + rig.pivot[2]];
}
