/**
 * Clearance of the OTTO-CLEAN ARM against a FLEET VEHICLE: its own body, its own open door leaves, its own door
 * openings, cabin and seats (fleetModels/cabin.ts). The generic car's measure is cleanArmClearance.ts; this is the
 * same measure against a vehicle's own geometry, and the same rules:
 *
 *   - everything outside the wand (the SCARA, the mast, the wrist) is measured against the WHOLE vehicle: its solid
 *     at full width, its sensors and mirrors, and every open door leaf;
 *   - the wand and the nozzle may be inside the body, and only through a door opening: where they cross the body
 *     side they are measured against that opening's edges, inside they are measured against the cabin's free volume
 *     and the seats, outside they are measured against the door leaves and the vehicle's equipment.
 *
 * PURE. The program generator (cleanProgramFleet.ts) keeps its strokes inside these numbers with room to spare, and
 * cleanArmFleet.test.ts holds every pose of every vehicle's cycle to them.
 */
import type { CabinProfile } from '@/lib/fleetModels/cabin';
import { CLEAN_ARM, MAST_FOOT_MAX, MAST_FOOT_MIN } from './cleanArmSpec';
import { cleanArmCapsules, type Capsule } from './cleanArmClearance';
import { cleanArmPoints, type CleanJoints, type Vec3 } from './cleanArmPose';

/** Top of the drop column the clearance is taken to (the canopy header is above every vehicle). */
export const FLEET_COLUMN_TOP = 5.3;

export interface FleetPoseMeasure {
  /** Everything outside the wand: nearest to the vehicle's outside, and to an open door leaf. */
  linkCar: number;
  linkLeaf: number;
  /** The wand and nozzle where they are outside the body: nearest to its skin away from a doorway, to a door leaf,
   *  and to a sensor or mirror. */
  wandSkin: number;
  wandLeaf: number;
  wandEquipment: number;
  /** The wand and nozzle where they are inside the body: room in the cabin's free volume, and off the seats. */
  room: number;
  seat: number;
  /** The wand's and the nozzle's section inside the door opening where they cross the body side. Infinity: no crossing. */
  aperture: number;
  /** Which measure is worst against its own margin is the caller's to say; this names the part for each. */
  at: { linkCar: string; linkLeaf: string };
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/** Sample a capsule's axis every `step` metres. */
function* along(c: Capsule, step: number): Generator<Vec3> {
  const L = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y, c.b.z - c.a.z);
  const n = Math.max(1, Math.ceil(L / step));
  for (let i = 0; i <= n; i++) yield lerp3(c.a, c.b, i / n);
}

/**
 * Measure one pose of the arm against a vehicle.
 * @param side the flank the arm works at (the opening the wand may cross is on it)
 * @param aperture which of that flank's openings the wand may cross
 * @param open01 how far the doors stand open
 */
export function measureFleetPose(
  cabin: CabinProfile, q: CleanJoints, side: 1 | -1, aperture: number, open01 = 1, step = 0.03,
): FleetPoseMeasure {
  const pt = cleanArmPoints(q);
  const caps = cleanArmCapsules(pt, FLEET_COLUMN_TOP);
  const m: FleetPoseMeasure = {
    linkCar: Infinity, linkLeaf: Infinity, wandSkin: Infinity, wandLeaf: Infinity, wandEquipment: Infinity, room: Infinity, seat: Infinity,
    aperture: Infinity, at: { linkCar: '', linkLeaf: '' },
  };
  // nothing of the vehicle or its doors is above this: a part wholly above it by FAR is not sampled
  const FAR = 0.6;
  let top = cabin.height;
  for (const l of cabin.leaves) top = Math.max(top, l.box.y1);
  for (const e of cabin.equipment) top = Math.max(top, e.y1);
  for (const c of caps.outside) {
    if (Math.min(c.a.y, c.b.y) - c.r > top + FAR) continue;
    for (const p of along(c, step)) {
      if (p.y - c.r > top + FAR) continue;
      const car = cabin.bodyClearance(p) - c.r;
      if (car < m.linkCar) { m.linkCar = car; m.at.linkCar = c.name; }
      const leaf = cabin.leafClearance(p, open01) - c.r;
      if (leaf < m.linkLeaf) { m.linkLeaf = leaf; m.at.linkLeaf = c.name; }
    }
  }
  for (const c of [caps.wand, ...caps.nozzle]) {
    for (const p of along(c, step)) {
      if (cabin.skin(p).sd >= 0) {
        m.wandSkin = Math.min(m.wandSkin, cabin.outsideSkin(p) - c.r);
        m.wandLeaf = Math.min(m.wandLeaf, cabin.leafClearance(p, open01) - c.r);
        for (const e of cabin.equipment) {
          const dx = Math.max(e.x0 - p.x, p.x - e.x1, 0), dy = Math.max(e.y0 - p.y, p.y - e.y1, 0), dz = Math.max(e.z0 - p.z, p.z - e.z1, 0);
          m.wandEquipment = Math.min(m.wandEquipment, Math.hypot(dx, dy, dz) - c.r);
        }
      } else {
        m.room = Math.min(m.room, cabin.room(p) - c.r);
        m.seat = Math.min(m.seat, cabin.seatClearance(p) - c.r);
      }
    }
    const x = cabin.crossing(c.a, c.b, side, aperture, c.r);
    if (x) m.aperture = Math.min(m.aperture, x.margin);
  }
  return m;
}

/** The arm's own limits: every joint inside its travel. Null when it is, else which one is not. */
export function jointLimitBreach(q: CleanJoints): string | null {
  const A = CLEAN_ARM, e = 1e-9;
  if (q.ext < -e || q.ext > A.wand.maxExt + e) return `wand extension ${q.ext.toFixed(3)} m (0..${A.wand.maxExt})`;
  if (q.pitch < A.limits.pitch[0] - e || q.pitch > A.limits.pitch[1] + e) return `wrist pitch ${((q.pitch * 180) / Math.PI).toFixed(1)} deg`;
  if (q.nozzle < A.limits.nozzle[0] - e || q.nozzle > A.limits.nozzle[1] + e) return `nozzle pitch ${((q.nozzle * 180) / Math.PI).toFixed(1)} deg`;
  if (q.t2 < A.limits.j2[0] - e || q.t2 > A.limits.j2[1] + e) return `elbow ${((q.t2 * 180) / Math.PI).toFixed(1)} deg`;
  if (q.foot < MAST_FOOT_MIN - e || q.foot > MAST_FOOT_MAX + e) return `mast foot ${q.foot.toFixed(3)} m (${MAST_FOOT_MIN.toFixed(2)}..${MAST_FOOT_MAX.toFixed(2)})`;
  return null;
}

/** The margins the tests hold every pose to, metres (cleanArmClearance.test.ts states why each is what it is). */
export const FLEET_MARGIN = {
  /** every part outside the wand, to the vehicle and to its open door leaves */
  link: 0.1,
  /** the wand's section to the door opening's edges */
  aperture: 0.03,
  /** the wand and nozzle outside the body, to a door leaf or a sensor */
  wandOutside: 0.03,
  /** the wand and nozzle inside: in the cabin's free volume, and off the seats */
  room: 0,
  seat: 0.01,
} as const;

/** Room a caller asks for over FLEET_MARGIN, metres: on everything, or less on the two gaps a program cannot choose. */
export interface ExtraMargin {
  all: number;
  /** the mast's gap to the body: the wrist's standoff fixes it */
  body?: number;
  /** the nozzle's gap to a seat: it is there to come close to it */
  seat?: number;
}

/** What a measure breaks, in words, or null when it holds every margin (each grown by `extra`). */
export function fleetBreach(m: FleetPoseMeasure, extra: ExtraMargin = { all: 0 }): string | null {
  const M = FLEET_MARGIN;
  const e = extra.all, body = extra.body ?? e, seat = extra.seat ?? e;
  if (m.linkCar < M.link + body) return `${m.at.linkCar} ${m.linkCar.toFixed(3)} m from the body`;
  if (m.linkLeaf < M.link + e) return `${m.at.linkLeaf} ${m.linkLeaf.toFixed(3)} m from a door leaf`;
  if (m.aperture < M.aperture + e) return `the wand ${m.aperture.toFixed(3)} m inside the door opening's edge`;
  if (m.wandSkin < M.wandOutside + e) return `the wand ${m.wandSkin.toFixed(3)} m from the body outside the door`;
  if (m.wandLeaf < M.wandOutside + e) return `the wand ${m.wandLeaf.toFixed(3)} m from a door leaf`;
  if (m.wandEquipment < M.wandOutside + e) return `the wand ${m.wandEquipment.toFixed(3)} m from a sensor`;
  if (m.room < M.room + e) return `the wand ${m.room.toFixed(3)} m inside the cabin's free space`;
  if (m.seat < M.seat + seat) return `the wand ${m.seat.toFixed(3)} m off a seat`;
  return null;
}
