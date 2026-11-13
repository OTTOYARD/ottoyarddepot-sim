// Where each sensor of a fleet vehicle is, for the machine that cleans it: the centre of the face a pad must polish
// and the way that face looks, in the wash bay's frame (washSolid.ts: x east of the drive line, dy south of the
// parked car's centre, y up; metres). Read from the vehicle's own spec, the way build.ts draws it, so the point is on
// the part the model shows.
//
// WHAT IS A SENSOR TO CLEAN: a lidar, a camera, a radar or a thermal camera. A `pod` is a housing and `audio` has no
// window: neither is in the map.
//
// ONE SENSOR CAN HAVE MORE THAN ONE FACE.
//   - A lidar that turns (a cylinder with a window all round it) has 3 faces a side. On the centreline both arms take
//     their own side's 3. Off it, one arm takes the 3 it can come at from outside the vehicle.
//   - A window wider than a pad covers has 2 faces, side by side.
//
// A SENSOR BEHIND A COVER. A camera behind the windscreen, or one drawn inside its housing, is cleaned on the cover in
// front of it: the face is where its line of sight leaves the vehicle, and it looks the way that surface does.
import type { SensorSpec, SensorType, VehicleSpec } from './spec';
import { fleetWashSolid, type P3, type WashSolid } from './washSolid';

export type CleanZone = 'front' | 'sides' | 'roof' | 'rear';
/** Which detail arm: +1 the east one (the vehicle's right), -1 the west one. */
export type ArmSide = 1 | -1;

export const CLEANABLE: readonly SensorType[] = ['lidar', 'camera', 'radar', 'thermal'];
export const isCleanable = (s: SensorSpec): boolean => CLEANABLE.includes(s.type);

/** The polishing pad's radius, metres (washSpec.WASH_GANTRY.detail.padR is this in plan units). */
export const PAD_RADIUS_M = 0.06;
/** A flat window wider than this takes two pad places. */
export const WIDE_FACE_M = 2.4 * PAD_RADIUS_M;
/**
 * A lidar that turns is met this far under the top edge of its window (the generic car's roof lidar is met at its
 * top edge). So the pad and the plate behind it stand as high above the roof as they can. On a window more than
 * 0.09 m tall the pad does not cover the bottom of it.
 */
export const SPIN_TOP_M = 0.03;
/** A sensor on the centre, within this of it, can go to either arm. */
export const CENTRE_BAND_M = 0.15;
/** A line of sight that is still inside the vehicle this far out is not a window: the sensor is left out. */
export const COVER_MAX_M = 0.30;

export interface SensorFace {
  /** the sensor's id in the spec; with `@...` when the sensor has more than one face */
  id: string;
  /** the spec's sensor */
  sensor: string;
  type: SensorType;
  /** what it is, for the screens: no maker's name */
  label: string;
  /** the face's centre, on the vehicle */
  p: P3;
  /** unit vector out of the face */
  out: P3;
  /** half the face's size, metres */
  r: number;
  /** the face is a cover in front of the sensor (glass, or its housing's skin) */
  covered: boolean;
  zone: CleanZone;
  arm: ArmSide;
}

export interface SensorMap {
  key: string;
  faces: SensorFace[];
  /** sensors with no face a pad can come to, and why */
  buried: { sensor: string; label: string; why: string }[];
  /** how many sensors of the spec are sensors to clean */
  cleanable: number;
}

const TYPE_WORD: Record<SensorType, string> = { lidar: 'lidar', camera: 'camera', radar: 'radar', thermal: 'thermal camera', audio: 'microphone', pod: 'housing' };
const unit = (v: P3): P3 => { const n = Math.hypot(v.x, v.dy, v.y) || 1; return { x: v.x / n, dy: v.dy / n, y: v.y / n }; };
const add = (a: P3, b: P3, k: number): P3 => ({ x: a.x + b.x * k, dy: a.dy + b.dy * k, y: a.y + b.y * k });
/** A model-frame point or direction in the bay frame. */
const bay = (v: readonly [number, number, number]): P3 => ({ x: v[2], dy: -v[0], y: v[1] });

interface Raw { id: string; sensor: SensorSpec; p: P3; out: P3; r: number; both?: boolean; arm?: ArmSide; suffix?: string }

/** The faces a sensor is drawn with, before any cover is found. */
function rawFaces(sp: SensorSpec, solid: WashSolid): Raw[] {
  const pose = solid.pose(sp.id);
  if (!pose) return [];
  const sz = sp.size ?? [];
  const o = bay(pose.pos), look = bay(pose.look);
  // across the face, level: the look direction turned a quarter turn
  const across: P3 = { x: look.dy, dy: -look.x, y: 0 };
  const flat = (ahead: number, r: number, width: number): Raw[] => {
    const c = add(o, look, ahead);
    if (width <= WIDE_FACE_M) return [{ id: sp.id, sensor: sp, p: c, out: look, r }];
    return [-1, 1].map((k) => ({ id: `${sp.id}@${k < 0 ? 'a' : 'b'}`, sensor: sp, p: add(c, across, (k * width) / 4), out: look, r: Math.min(r, width / 4), suffix: k < 0 ? 'part 1' : 'part 2' }));
  };
  switch (sp.shape) {
    case 'spinLidar': {
      const [r = 0.08, h = 0.12] = sz;
      const centre = Math.abs(o.x) <= CENTRE_BAND_M;
      const out: Raw[] = [];
      for (const side of centre ? ([1, -1] as const) : ([o.x > 0 ? 1 : -1] as const)) {
        // round the window from the front: 35, 90 and 145 degrees on the centre (the two arms then do 6 places round
        // it); 30, 90 and 150 for a lidar on one side, which is come at from outside only
        for (const [deg, name] of (centre ? [[35, 'front side'], [90, 'side'], [145, 'rear side']] : [[30, 'front side'], [90, 'side'], [150, 'rear side']]) as [number, string][]) {
          const a = (deg * Math.PI) / 180;
          const dir: P3 = { x: side * Math.sin(a), dy: -Math.cos(a), y: 0 };
          out.push({ id: `${sp.id}@${side > 0 ? 'e' : 'w'}${deg}`, sensor: sp, p: add({ x: o.x, dy: o.dy, y: o.y + Math.max(h * 0.53, h * 0.84 - SPIN_TOP_M) }, dir, r), out: dir, r: Math.min(r, h * 0.31), both: centre, arm: side, suffix: name });
        }
      }
      return out;
    }
    case 'puckLidar': { const [r = 0.05, h = 0.07] = sz; return flat(h - 0.01, r, 2 * r); }
    case 'camera': { const [r = 0.018, d = 0.03] = sz; return flat(d - 0.006, r, 2 * r); }
    case 'radar': { const [l = 0.02, h = 0.07, w = 0.1] = sz; return flat(l / 2, Math.hypot(h, Math.min(w, WIDE_FACE_M)) / 2, w); }
    case 'dome': return [];
    default: { const [l = 0.1, h = 0.08, w = 0.12] = sz; return flat(l / 2, Math.hypot(h, Math.min(w, WIDE_FACE_M)) / 2, w); }
  }
}

/** The zone a face is cleaned in: the roof's from above; the nose's and the tail's from the ends; the rest from the side. */
function zoneOf(p: P3, out: P3, solid: WashSolid): CleanZone {
  const rail = solid.railAt(Math.max(-solid.halfLen, Math.min(solid.halfLen, p.dy)));
  // on top: it looks up, or it stands above the roof rail and inboard of it
  if (out.y > 0.5) return 'roof';
  if (rail && p.y > rail.y - 0.02 && Math.abs(p.x) < rail.halfWidth + 0.05 && Math.abs(p.dy) < solid.halfLen - 0.3) return 'roof';
  if (p.dy < -(solid.halfLen - 0.5) || (out.dy < -0.7 && p.dy < 0)) return 'front';
  if (p.dy > solid.halfLen - 0.5 || (out.dy > 0.7 && p.dy > 0)) return 'rear';
  return 'sides';
}

function labelOf(sp: SensorSpec, p: P3, zone: CleanZone, solid: WashSolid, suffix?: string): string {
  const fore = p.dy < -solid.halfLen / 3 ? 'front' : p.dy > solid.halfLen / 3 ? 'rear' : '';
  const lr = p.x < -0.1 ? 'left' : p.x > 0.1 ? 'right' : '';
  const where = [zone === 'roof' ? 'roof' : '', fore, lr].filter(Boolean).join(' ') || 'centre';
  return `${where} ${TYPE_WORD[sp.type]}${suffix ? `, ${suffix}` : ''}`;
}

const maps = new Map<string, SensorMap>();

/** Every sensor of a vehicle that is cleaned, as the faces a pad polishes. */
export function sensorMap(spec: VehicleSpec): SensorMap {
  const hit = maps.get(spec.key);
  if (hit) return hit;
  const solid = fleetWashSolid(spec);
  const faces: SensorFace[] = [];
  const buried: SensorMap['buried'] = [];
  const count: Record<CleanZone, Record<ArmSide, number>> = { front: { 1: 0, [-1]: 0 }, sides: { 1: 0, [-1]: 0 }, roof: { 1: 0, [-1]: 0 }, rear: { 1: 0, [-1]: 0 } } as Record<CleanZone, Record<ArmSide, number>>;
  const sensors = spec.sensors.filter(isCleanable);
  for (const sp of sensors) {
    const made: SensorFace[] = [];
    let why = 'It has no window.';
    let arm: ArmSide | null = null;
    for (const raw of rawFaces(sp, solid)) {
      let p = raw.p, out = raw.out, covered = false;
      // is the face under something else (glass, a housing)? Then the pad polishes that, where the sensor looks out
      if (solid.gap(p, sp.id) < -0.002) {
        let far = 0;
        while (far < COVER_MAX_M) {
          const g = solid.gap(p);
          if (g >= -1e-4) break;
          const stepM = Math.max(-g, 0.002);
          p = add(p, raw.out, stepM); far += stepM;
        }
        if (far >= COVER_MAX_M) { why = `Its line of sight is still inside the vehicle ${COVER_MAX_M.toFixed(2)} m out.`; continue; }
        // back onto the surface, then the way the surface looks there
        for (let i = 0; i < 30; i++) { const g = solid.gap(p); if (Math.abs(g) < 2e-5) break; p = add(p, raw.out, -g); }
        out = solid.away(add(p, raw.out, 0.004));
        covered = true;
      }
      const zone = zoneOf(p, out, solid);
      if (raw.arm) arm = raw.arm;
      else if (arm === null) arm = Math.abs(p.x) > CENTRE_BAND_M ? (p.x > 0 ? 1 : -1) : count[zone][1] <= count[zone][-1] ? 1 : -1;
      made.push({ id: raw.id, sensor: sp.id, type: sp.type, label: labelOf(sp, p, zone, solid, raw.suffix), p, out: unit(out), r: raw.r, covered, zone, arm: raw.arm ?? arm });
    }
    if (made.length === 0) { buried.push({ sensor: sp.id, label: `${TYPE_WORD[sp.type]}`, why }); continue; }
    for (const f of made) count[f.zone][f.arm]++;
    faces.push(...made);
  }
  const map: SensorMap = { key: spec.key, faces, buried, cleanable: sensors.length };
  maps.set(spec.key, map);
  return map;
}
