/**
 * OTTO-TIRE's program: one wheel change, played by the lift, the portal and both wheel robots, for one vehicle model.
 *
 * Made BY RULE from the vehicle's own facts (fleetModels/specs: wheelbase, track, tyre, the body's sill), as the wash
 * machine and the cleaning arm make theirs. The twin and the CAD read the same poses: the Robotics tab plays them, and
 * cad/spec/poses.json (cadPoses.ts) holds the clash check to every one of them.
 *
 * A STEP moves one group of axes from where the last step left them to where this one ends, in a straight line in the
 * machine's own state (the 5 spindles' pitch circle follows its one value exactly). So the middle
 * of a step is a pose the machine really passes through, and the clash check's 2 samples a step (its middle and its end)
 * test real moves.
 *
 * Frame and units: tireSpec.ts (the bay's frame, metres, radians, sim seconds).
 */
import { FLEET_SPECS } from '@/lib/fleetModels';
import { makeSurface } from '@/lib/fleetModels/surface';
import type { VehicleSpec } from '@/lib/fleetModels/spec';
import {
  COVER_INSET, COVER_NEST, COVER_RIM, FACE_AHEAD_OF_MAST, HEAD, LIFT, PORTAL, RACK, SLEW, SOCKET_RACK, TROLLEY, ZAXIS, armFor,
} from './tireSpec';

// ═══════════════════════════════════════════════════════════════════ WHAT EACH WHEEL IS HELD BY ═══
/**
 * Each fleet model's wheel fastening, with its source. OTTO-Q reads a car's facts before the car arrives; the head sets
 * its pitch circle, its sockets and its torque from them. A fact marked `assumed` is not from the vehicle maker and must
 * be read from the maker's service data before the bay serves that model (docs/OTTO-TIRE.md, "What the fleet must give").
 *
 * Read 2026-11-17 through a web search (the claim, its source):
 *   Tesla Model Y: lug nut torque 175 N m, 21 mm socket (Tesla's Model Y service manual,
 *     https://service.tesla.com/docs/ModelY/ServiceManual/en-us/GUID-6B20CACF-C224-4B28-9592-7BEB02E9AEB6.html); 5 x 114.3,
 *     M14 x 1.5, 64.1 mm bore (https://wheel-sizes.com/lugnuts/tesla/model-y/).
 *   Jaguar I-PACE: 5 x 108, M14 x 1.5, 63.4 mm bore, 133 N m (https://limitlesstire.com/vehicles/jaguar/i-pace/2024/);
 *     a second source gives 120 N m (https://spurverbreiterung.de/en/category-4/category-42/jaguar-7194/i-pace-x590-2018-19991).
 *   Zeekr 001 (the Waymo Ojai's SEA platform): 5 x 108, 63.4 mm bore, M14 x 1.5 wheel BOLTS
 *     (https://koleso.ee/en/valuveljed/zeekr/001/4941/2023-now/10193); the Zeekr Mix 5 x 108
 *     (https://tirewheelguide.com/sizes/zeekr/mix/2025/). No torque was found: 140 N m is the Zeekr X's (koleso.ee).
 *   Lucid Gravity: 5 x 120, 64.1 mm bore, M14 x 1.5 nuts (owners, https://lucidowners.com/threads/aftermarket-wheels-for-gravity.13979/post-308716);
 *     140 N m (https://openlaborproject.com/torque-specs/lucid/gravity/2024-2024/gt-awd/cv-boot-inner/), an owner reports 190.
 *   Tesla Cybercab: front 215/60 R18, rear 225/60 R21, a snap-on cover over the wheel (reports of a patent and photographs,
 *     https://notateslaapp.com/news/4362/tesla-cybercab-patent-reveals-unique-wheel-design). No fastening data.
 *   Zoox: no wheel data was found.
 */
export interface WheelFacts {
  /** pitch circle diameter, metres, and the number of studs or bolts */
  pcd: number; count: 5;
  /** a nut on a stud, or a bolt into the hub */
  fastener: 'nut' | 'bolt';
  thread: string; hexMm: number; torqueNm: number;
  /** an aero cover or hubcap hides the nuts: the head takes it off first and puts it back last */
  cover: boolean;
  assumed: string[];
}

export const WHEEL_FACTS: Record<string, WheelFacts> = {
  tesla_model_y: { pcd: 0.1143, count: 5, fastener: 'nut', thread: 'M14 x 1.5', hexMm: 21, torqueNm: 175, cover: true,
    assumed: ['the 19 in wheel\'s aero cover (fitted on the robotaxi?)'] },
  waymo_ipace: { pcd: 0.108, count: 5, fastener: 'nut', thread: 'M14 x 1.5', hexMm: 21, torqueNm: 133, cover: false,
    assumed: ['torque (two third-party sources: 133 and 120 N m)', 'nut, not bolt', 'hex 21 mm'] },
  waymo_ojai: { pcd: 0.108, count: 5, fastener: 'bolt', thread: 'M14 x 1.5', hexMm: 17, torqueNm: 140, cover: true,
    assumed: ['the Zeekr 001\'s bolts and pattern carried to the Ojai', 'torque', 'hex 17 mm', 'the aero cover'] },
  lucid_gravity_nuro: { pcd: 0.120, count: 5, fastener: 'nut', thread: 'M14 x 1.5', hexMm: 21, torqueNm: 140, cover: false,
    assumed: ['torque (140 N m in one source, 190 reported by an owner)', 'hex 21 mm'] },
  tesla_cybercab: { pcd: 0.1143, count: 5, fastener: 'nut', thread: 'M14 x 1.5', hexMm: 21, torqueNm: 175, cover: true,
    assumed: ['every fastening fact: the Model Y\'s'] },
  zoox_robotaxi: { pcd: 0.1143, count: 5, fastener: 'nut', thread: 'M14 x 1.5', hexMm: 21, torqueNm: 150, cover: false,
    assumed: ['every fastening fact: none is published'] },
};

// ═══════════════════════════════════════════════════════════════════ THE VEHICLE, AS THE BAY SEES IT ═══
/** How far each lift point stands from its axle, inboard (ASSUMPTION: a sill lift point behind the wheel arch). */
export const LIFT_POINT_FROM_AXLE = 0.60;
/** How far each wheel hangs on its suspension when the body is lifted (ASSUMPTION: the cameras measure the real one). */
export const WHEEL_DROOP = 0.06;
/** Each ram's rise with its pads just touching their sills (a pad's top is its arm's top: the ram's rise), and at service
 *  height (the body lifted LIFT.serviceRise). */
export const touchRise = (sill: number): number => sill;
export const serviceLift = (sill: number): number => sill + LIFT.serviceRise;

export interface TireVehicle {
  key: string; name: string;
  /** wheels: the axles' Z with the car on the lift mark, the tyre's outer face (|X|), radius, width, the rim's radius */
  frontZ: number; rearZ: number; faceX: number; tyreR: number; tyreW: number; rimR: number;
  /** the wheel's centre height on the lift at service height */
  centreY: number;
  /** pads: Z of the front and rear lift points, their |X|, the sill's height over each at rest */
  padFrontZ: number; padRearZ: number; padX: number; sillFront: number; sillRear: number;
  /** each post's arms (the 2 sides mirror): swing and reach to the lift points */
  armFront: { swing: number; reach: number }; armRear: { swing: number; reach: number };
  /** the body's centre stands this far north of the lift mark */
  bodyOffsetZ: number;
  facts: WheelFacts;
}

export function tireVehicle(spec: VehicleSpec): TireVehicle {
  const d = spec.dims;
  const s = makeSurface(spec.curves);
  const half = d.wheelbase / 2;
  const facts = WHEEL_FACTS[spec.key];
  if (!facts) throw new Error(`no wheel facts for ${spec.key}`);
  const padX = d.width / 2 - 0.20;
  const fXr = d.frontAxle + LIFT_POINT_FROM_AXLE;              // the lift points' stations, from the front bumper
  const rXr = d.frontAxle + d.wheelbase - LIFT_POINT_FROM_AXLE;
  return {
    key: spec.key, name: spec.name,
    frontZ: half, rearZ: -half,
    faceX: d.track / 2 + d.tyreWidth / 2, tyreR: d.tyreRadius, tyreW: d.tyreWidth, rimR: d.rimRadius,
    centreY: d.tyreRadius + LIFT.serviceRise - WHEEL_DROOP,
    padFrontZ: half - LIFT_POINT_FROM_AXLE, padRearZ: -half + LIFT_POINT_FROM_AXLE, padX,
    sillFront: s.at(fXr).yb, sillRear: s.at(rXr).yb,
    armFront: armFor(LIFT.postZ[0], padX, half - LIFT_POINT_FROM_AXLE),
    armRear: armFor(LIFT.postZ[1], padX, -half + LIFT_POINT_FROM_AXLE),
    bodyOffsetZ: d.length / 2 - d.frontAxle - half,
    facts,
  };
}

export const TIRE_VEHICLES: TireVehicle[] = FLEET_SPECS.map(tireVehicle);
/** The model the Robotics tab plays its cycle on (and the CAD's clash check tests): one with an aero cover, so the cycle
 *  shows every step but the socket change, which cad/spec/poses.json tests from its own presets. */
export const CYCLE_MODEL = 'tesla_model_y';

// ═══════════════════════════════════════════════════════════════════ THE MACHINE'S STATE ═══
export interface SideState {
  /** the mast's axis from the drive line (outward), the turn, the head's axis height, the camber */
  trol: number; slew: number; headY: number; tilt: number;
  /** the grip unit's slide back, each clamp arm's position from the axis, the spindles' turn and pitch circle, the cover slide */
  grip: number; clamp: number; a: number; pcd: number; cover: number;
}
/** One lift arm: its swing (0 stowed along the drive line, pi/2 square to the car) and its reach from its pivot to its
 *  pad's centre. The front post's 2 arms mirror, and so do the rear post's. */
export interface ArmState { swing: number; reach: number }
export interface BayState {
  portal: number;
  W: SideState; E: SideState;
  /** each ram's rise (front and rear: each rises on its own to its own sills), and each post's arms */
  liftF: number; liftR: number; armF: ArmState; armR: ArmState;
}

export const SIDES = ['W', 'E'] as const;
export type Side = typeof SIDES[number];

const PARK_SIDE: SideState = {
  trol: TROLLEY.park, slew: 0, headY: ZAXIS.to, tilt: 0, grip: 0, clamp: HEAD.clampMax, a: 0, pcd: 0.1143, cover: 0,
};

/** A lift arm stowed: along the drive line, slid in. */
export const ARM_STOWED: ArmState = { swing: 0, reach: LIFT.reach[0] };

/** The machine at rest, ready for a car: portal parked, robots parked, rams down, arms stowed flush in their recesses. */
export function homeState(): BayState {
  return { portal: PORTAL.park, W: { ...PARK_SIDE }, E: { ...PARK_SIDE }, liftF: 0, liftR: 0, armF: { ...ARM_STOWED }, armR: { ...ARM_STOWED } };
}

/** The joints the CAD's nodes take for a machine state (names: cad/otto_cad/robots/tire_bay.py). */
export function tireAngles(s: BayState): Record<string, number> {
  const out: Record<string, number> = { TB_PORTAL: s.portal };
  for (const side of SIDES) {
    const q = s[side];
    out[`TB_TROL_${side}`] = q.trol;
    out[`TB_SLEW_${side}`] = q.slew;
    out[`TB_Z_${side}`] = q.headY - ZAXIS.from;
    out[`TB_TILT_${side}`] = q.tilt;
    out[`TB_GRIP_${side}`] = q.grip;
    out[`TB_CLAMPL_${side}`] = q.clamp;
    out[`TB_CLAMPR_${side}`] = q.clamp;
    out[`TB_ACLU_${side}`] = q.a;
    for (let k = 1; k <= 5; k++) out[`TB_PCD${k}_${side}`] = (q.pcd - HEAD.pcdMin) / 2;
    out[`TB_COVER_${side}`] = q.cover;
  }
  out.TB_RAM_F = s.liftF;
  out.TB_RAM_R = s.liftR;
  for (const [k, q] of [['F', s.armF], ['R', s.armR]] as const) {
    for (const side of SIDES) {
      out[`TB_SW${k}_${side}`] = q.swing;
      out[`TB_RCH${k}_${side}`] = q.reach - LIFT.reach[0];
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════ THE STEPS ═══
export interface TireStep { id: string; label: string; seconds: number; end: BayState }
/** The tire robot's two jobs (otto-q-core 0842): a worn set replaced with new wheels, or the quarterly rotation. */
export type TireJob = 'replacement' | 'rotation';
export const TIRE_JOBS: readonly TireJob[] = ['replacement', 'rotation'];
/**
 * The job a service-bay seat is doing, from its work (the twin snapshot's `bay_seat.work`, otto-q-core 0843): a
 * replacement when the tires are being replaced (a new set restarts the quarter, so OTTO-Q never asks for both), else
 * a rotation, else none (the seat is for other work and the robot stays home).
 */
export function tireJobFor(work: readonly string[] | null | undefined): TireJob | null {
  if (!work) return null;
  if (work.includes('tire_replacement')) return 'replacement';
  if (work.includes('tire_rotation')) return 'rotation';
  return null;
}
export interface TireCycle {
  vehicle: TireVehicle;
  /** which job this cycle is */
  job: TireJob;
  steps: TireStep[];
  total: number;
  /** the machine's state `u` (0..1) through step `i` */
  stateAt(i: number, u: number): BayState;
  /** the joints at `t` seconds into the cycle (wraps), and which step that is */
  at(t: number): { step: number; angles: Record<string, number> };
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
function lerpSide(a: SideState, b: SideState, u: number): SideState {
  const o = {} as SideState;
  for (const k of Object.keys(a) as (keyof SideState)[]) o[k] = lerp(a[k], b[k], u);
  return o;
}
function lerpArm(a: ArmState, b: ArmState, u: number): ArmState {
  return { swing: lerp(a.swing, b.swing, u), reach: lerp(a.reach, b.reach, u) };
}
export function lerpState(a: BayState, b: BayState, u: number): BayState {
  return {
    portal: lerp(a.portal, b.portal, u), W: lerpSide(a.W, b.W, u), E: lerpSide(a.E, b.E, u),
    liftF: lerp(a.liftF, b.liftF, u), liftR: lerp(a.liftR, b.liftR, u), armF: lerpArm(a.armF, b.armF, u), armR: lerpArm(a.armR, b.armR, u),
  };
}

/** The trolley position that puts the grip face at |X| = faceX with the head turned to the car. */
export const trolForFace = (faceX: number): number => faceX + FACE_AHEAD_OF_MAST;
/** ... and with the head turned to the wall (the racks). */
export const trolForWallFace = (faceX: number): number => faceX - FACE_AHEAD_OF_MAST;
/** The suction cups' face ahead of the mast's axis with the cover slide out (their face is flush with the housing's front,
 *  x = 0 in the head's frame, with the slide in). */
export const CUPS_AHEAD_OF_MAST = HEAD.cover - HEAD.tiltX;

/** How far out past the travel line a removed cover is carried, so it clears the wheel before the robot turns. */
export const COVER_PULL = 0.15;
/**
 * The angle (rad, about the wheel's axis) at which the car's studs stand when it stops, front and rear: the cameras find
 * it and the cluster turns to it. A car stops with its wheels at any angle; a 5-stud circle repeats every 72 degrees, so
 * the cluster's +/- 40 degrees reaches any of them. These two are a sample for the cycle the tab plays.
 */
export const HUB_ANGLE = [0.05, -0.12] as const;
/** How far the face stands off a tyre before the head closes on it. */
export const APPROACH = 0.10;
/** The grip face's travel line: the rollers' tips then stand 0.13 m off the widest fleet car's flank. */
export const TRAVEL_FACE_X = 1.42;
/** Where a robot turns: its sweep then stays 0.15 m off the widest fleet car's flank, so it may turn anywhere along it. */
export const TURN_TROL = 2.0;
/** The wheel comes straight off its studs this far before it is lifted or moved. */
export const PULL_OFF = 0.12;
/**
 * A nut's outer face stands this far inboard of its tyre's outer face (ASSUMPTION: an alloy wheel's lug pocket; the
 * 3D camera measures each car's), and a socket goes this far over the nut to drive it.
 */
export const NUT_DEPTH = 0.12;
export const SOCKET_ENGAGE = 0.025;
/** The grip slide that puts the sockets over the nuts while the grip face stays on the tyre. */
export const GRIP_ON_NUTS = NUT_DEPTH + SOCKET_ENGAGE - HEAD.faceAhead;
/** The head's height while the portal moves: the racked wheels stand outside its path, so the wheels' own height. */
export const TRAVEL_Y = 0.80;
/** The socket tips' reach ahead of the mast's axis (the head turned to them). */
export const SOCKETS_AHEAD_OF_MAST = HEAD.socketTip - HEAD.tiltX;
/** The trolley that puts the socket tips `engage` into the socket rack's holders, and the one 0.10 m back from them. */
export const SOCK_IN_TROL = SOCKET_RACK.faceX + SOCKET_RACK.engage - SOCKETS_AHEAD_OF_MAST;
export const SOCK_CLEAR_TROL = SOCKET_RACK.faceX - 0.10 - SOCKETS_AHEAD_OF_MAST;
/** Whether a model's fastening needs the socket rack's second set. */
export const needsSocketSwap = (f: WheelFacts): boolean => f.hexMm !== SOCKET_RACK.hexOnHead;
/** The rack's wheel centre for a tyre of radius R. */
export const rackCentreY = (R: number): number => RACK.tyreBottom + R;
/** How far the head stands back from a racked wheel before it closes on it or after it lets go. */
export const RACK_CLEAR = 0.25;

/**
 * The cycle for one vehicle: the lift, then the front axle, then the rear, both robots at once (the 2 sides mirror).
 * The cover steps run only for a wheel with a cover. Every turn starts with the head raised to SLEW_Y and the trolley at
 * TURN_TROL. Times are nominal sim seconds (ASSUMPTION, docs/OTTO-TIRE.md).
 */
export function tireCycle(v: TireVehicle, job: TireJob = 'replacement'): TireCycle {
  const steps: TireStep[] = [];
  let cur = homeState();
  const both = (f: (q: SideState) => Partial<SideState>): Partial<BayState> => ({
    W: { ...cur.W, ...f(cur.W) }, E: { ...cur.E, ...f(cur.E) },
  });
  const step = (id: string, label: string, seconds: number, change: Partial<BayState>) => {
    cur = { ...cur, ...change };
    steps.push({ id, label, seconds, end: cur });
  };
  const pcd = v.facts.pcd;
  const clampOn = clampFor(v.tyreR);
  const faceGrip = v.faceX + 0.01;
  const coverFace = v.faceX - COVER_INSET;
  const armsOut: Partial<BayState> = { armF: { ...v.armFront }, armR: { ...v.armRear } };
  const nestY = coverNestY(v);
  // a turn: out to the turning line at (or under) the turning height, then the slew alone
  const turn = (id: string, label: string, slew: number) => {
    step(`${id}_line`, 'The heads move out to where they may turn', 3,
      both((q) => ({ trol: TURN_TROL, headY: Math.min(q.headY, SLEW.maxHeadY) })));
    step(id, label, 4, both(() => ({ slew })));
  };

  // the socket change: the head's 5 sockets into ring `from`'s empty holders, the other set out of ring `to`'s
  const sockets = (tag: string, put: string, take: string, ringPut: number, ringTake: number) => {
    step(`${tag}_portal`, 'The portal moves to the socket racks', 6,
      { portal: SOCKET_RACK.z, ...both((q) => ({ trol: TURN_TROL, headY: Math.min(q.headY, SLEW.maxHeadY), pcd: SOCKET_RACK.pcd, a: 0 })) });
    step(`${tag}_turn`, 'Each robot turns to its socket rack', 4, both(() => ({ slew: Math.PI })));
    step(`${tag}_put_line`, `The heads line up with the empty holders for the ${put} sockets`, 3,
      both(() => ({ headY: ringPut, trol: SOCK_CLEAR_TROL })));
    step(`${tag}_put`, `The ${put} sockets go into their holders. The holders keep them`, 3, both(() => ({ trol: SOCK_IN_TROL })));
    step(`${tag}_put_back`, 'The heads pull back. Each extension\'s ball lock lets its socket go', 3, both(() => ({ trol: SOCK_CLEAR_TROL })));
    step(`${tag}_take_line`, `The heads line up with the ${take} sockets`, 3, both(() => ({ headY: ringTake })));
    step(`${tag}_take`, `Each extension goes into a ${take} socket and locks`, 3, both(() => ({ trol: SOCK_IN_TROL })));
    step(`${tag}_take_back`, `The heads pull back with the ${take} sockets. The axis camera checks all 5`, 3,
      both(() => ({ trol: SOCK_CLEAR_TROL })));
    step(`${tag}_line`, 'The heads move to where they may turn', 3, both(() => ({ trol: TURN_TROL })));
    step(`${tag}_back`, 'Each robot turns back to the car', 4, both(() => ({ slew: 0 })));
  };
  const swap = needsSocketSwap(v.facts);
  const hexMm = `${v.facts.hexMm} mm`;
  const homeHex = `${SOCKET_RACK.hexOnHead} mm`;

  step('home', 'Ready. The portal and both robots wait at the exit end', 2, {});
  if (swap) sockets('sock_out', homeHex, hexMm, SOCKET_RACK.ringY[0], SOCKET_RACK.ringY[1]);
  step('arms_up', 'The lift\'s 2 rams lift their arms out of the floor', 4, { liftF: LIFT.armClearRise, liftR: LIFT.armClearRise });
  step('arms_out', 'The arms swing out and slide to the car\'s lift points. Each pad\'s camera checks its point', 10, armsOut);
  step('pads_touch', 'Each ram rises on its own until both its pads touch', 4, { liftF: touchRise(v.sillFront), liftR: touchRise(v.sillRear) });
  step('lift_up', 'Both rams lift the car 0.50 m together. The locks hold it', 12,
    { liftF: serviceLift(v.sillFront), liftR: serviceLift(v.sillRear) });

  // ── THE ROTATION (otto-q-core 0842: once a quarter) ──
  // Each side's front wheel goes to the rear hub and its rear wheel to the front hub. One wheel must wait while the
  // other moves, so the front wheel waits in an OLD rack's cradle. Each wheel keeps its own aero cover: a side has one
  // cover nest, so the front wheel's cover goes back onto it in the cradle before the rear cover comes off, and comes
  // off again before that wheel goes onto the rear hub. A racked tyre faces the bay's centre, so its cover sits
  // COVER_INSET beyond its face, and the head reaches it turned to the wall.
  const rotate = () => {
    const parkZ = RACK.oldZ[0];
    const rackY = rackCentreY(v.tyreR);
    const parkCover = RACK.faceX + COVER_INSET - CUPS_AHEAD_OF_MAST;
    const nut = v.facts.fastener;
    const coverOff = (a: string, word: string) => {
      if (!v.facts.cover) return;
      step(`${a}_cups_out`, 'The suction cups come out past the sockets', 3, both(() => ({ cover: HEAD.cover })));
      step(`${a}_cups_on`, `The cups take hold of the ${word} cover`, 3, both(() => ({ trol: coverFace + CUPS_AHEAD_OF_MAST })));
      step(`${a}_cover_off`, 'The cups pull the cover off', 3, both(() => ({ trol: trolForFace(TRAVEL_FACE_X) + COVER_PULL })));
      turn(`${a}_cover_turn`, 'Each robot turns to its portal leg with the cover', Math.PI);
      step(`${a}_cover_nest`, 'Each cover goes into its nest on the portal leg', 5,
        both(() => ({ trol: COVER_NEST.x - CUPS_AHEAD_OF_MAST, headY: nestY })));
      step(`${a}_cover_leave`, 'The cups let go and come back in', 3, both(() => ({ cover: 0, trol: TURN_TROL })));
      step(`${a}_cover_back`, 'Each robot turns back to the car', 4, both(() => ({ slew: 0 })));
      step(`${a}_regain`, 'The heads go back to the wheels', 6, both(() => ({ trol: trolForFace(TRAVEL_FACE_X), headY: v.centreY })));
    };
    const unbolt = (a: string, word: string, hub: number) => {
      step(`${a}_grip`, `The rollers close on each ${word} tyre below its centre. The cluster turns to the ${nut}s`, 5,
        both(() => ({ trol: trolForFace(faceGrip), clamp: clampOn, a: hub })));
      step(`${a}_nuts_on`, `The sockets go onto the ${nut}s. The grip holds the wheel still`, 3,
        both(() => ({ trol: trolForFace(faceGrip) - GRIP_ON_NUTS, grip: GRIP_ON_NUTS })));
      step(`${a}_unbolt`, nut === 'nut' ? 'Each nut breaks free in turn. Then all 5 spin off into their sockets'
        : 'Each bolt breaks free in turn. Then all 5 spin out into their sockets', 16, {});
      step(`${a}_nuts_back`, `The sockets come back with the ${nut}s in them`, 3, both(() => ({ trol: trolForFace(faceGrip), grip: 0 })));
      step(`${a}_pull`, `Each ${word} wheel comes straight off its studs`, 4, both(() => ({ trol: trolForFace(faceGrip + PULL_OFF) })));
      step(`${a}_out`, 'The heads move out, clear of the car', 3, both(() => ({ trol: trolForFace(TRAVEL_FACE_X) })));
    };
    // onto a hub: the head holds the wheel facing the car at its centre's height, clear of the car
    const mount = (a: string, word: string) => {
      step(`${a}_align`, nut === 'nut' ? `The cameras find the ${word} studs. The rollers turn each wheel to them`
        : `The cameras find the ${word} hub's holes. The rollers turn each wheel to them`, 6,
        both(() => ({ trol: trolForFace(faceGrip + PULL_OFF) })));
      step(`${a}_mount`, nut === 'nut' ? `Each wheel goes onto its ${word} hub, on the studs and the centre bore`
        : `Each wheel goes onto its ${word} hub's centre spigot. The rollers hold it there`, 5, both(() => ({ trol: trolForFace(faceGrip) })));
      step(`${a}_nuts_in`, nut === 'nut' ? 'The sockets put the nuts to the studs' : 'The sockets put the bolts to the hub\'s holes', 3,
        both(() => ({ trol: trolForFace(faceGrip) - GRIP_ON_NUTS, grip: GRIP_ON_NUTS })));
      step(`${a}_torque`, `All 5 run down. Then each is tightened to ${v.facts.torqueNm} N m in a star order`, 23, {});
      step(`${a}_nuts_out`, 'The sockets come back, empty', 3, both(() => ({ trol: trolForFace(faceGrip), grip: 0, a: 0 })));
      step(`${a}_open`, 'The rollers open', 2, both(() => ({ clamp: HEAD.clampMax })));
      step(`${a}_away`, 'The heads move out, clear of the car', 3, both(() => ({ trol: trolForFace(TRAVEL_FACE_X) })));
    };
    // the cover that waits in the nest goes back onto the wheel now on this hub
    const coverOn = (a: string) => {
      if (!v.facts.cover) return;
      turn(`${a}_cover_fetch`, 'Each robot turns to its portal leg', Math.PI);
      step(`${a}_cups_reach`, 'The cups come out to the cover in the nest', 5,
        both(() => ({ cover: HEAD.cover, trol: COVER_NEST.x - CUPS_AHEAD_OF_MAST, headY: nestY })));
      step(`${a}_cover_lift`, 'The cups take the cover out of the nest', 3, both(() => ({ trol: TURN_TROL })));
      step(`${a}_cover_return`, 'Each robot turns back to the car with the cover', 4, both(() => ({ slew: 0 })));
      step(`${a}_cover_in`, 'The heads bring the covers to the wheels', 6,
        both(() => ({ trol: trolForFace(TRAVEL_FACE_X) + COVER_PULL, headY: v.centreY })));
      step(`${a}_cover_press`, 'The cups press each cover back on', 4, both(() => ({ trol: coverFace + CUPS_AHEAD_OF_MAST })));
      step(`${a}_cups_in`, 'The cups let go and come back in', 3, both(() => ({ cover: 0, trol: trolForFace(TRAVEL_FACE_X) })));
    };

    // THE FRONT WHEELS: off, and into the OLD racks to wait
    step('f_portal', 'The portal moves to the front wheels', 6, { portal: v.frontZ, ...both(() => ({ pcd, trol: trolForFace(TRAVEL_FACE_X) })) });
    step('f_lower', 'The heads go down to the wheels\' height', 4, both(() => ({ headY: v.centreY })));
    step('f_approach', 'The heads come in, 0.10 m off the tyres. The cameras find each wheel and its nuts', 6,
      both(() => ({ trol: trolForFace(v.faceX + APPROACH) })));
    coverOff('f', 'front');
    unbolt('f', 'front', HUB_ANGLE[0]);
    turn('f_turn_wait', 'Each robot turns its front wheel to the wall side', Math.PI);
    step('f_to_wait', 'The portal carries the front wheels to the OLD racks, to wait there', 6, { portal: parkZ });
    step('f_wait_near', 'The heads move each wheel up to a cradle', 3, both(() => ({ trol: trolForWallFace(RACK.faceX - RACK_CLEAR) })));
    step('f_wait_in', 'The heads move each wheel over its cradle', 3, both(() => ({ trol: trolForWallFace(RACK.faceX) })));
    step('f_wait_down', 'The heads set each front wheel down in its cradle', 4, both(() => ({ headY: rackY })));
    step('f_wait_release', 'The rollers open', 2, both(() => ({ clamp: HEAD.clampMax })));
    step('f_wait_out', 'The heads back away from the wheels', 3, both(() => ({ trol: TURN_TROL })));
    if (v.facts.cover) {
      step('f_wc_go', 'The portal moves clear of the racks', 6, { portal: v.frontZ });
      step('f_wc_reach', 'The cups come out to the front cover in its nest', 5,
        both(() => ({ cover: HEAD.cover, trol: COVER_NEST.x - CUPS_AHEAD_OF_MAST, headY: nestY })));
      step('f_wc_lift', 'The cups take the cover out of the nest', 3, both(() => ({ trol: TURN_TROL })));
      step('f_wc_carry', 'The portal carries the covers to the waiting front wheels', 6, { portal: parkZ, ...both(() => ({ headY: rackY })) });
      step('f_wc_press', 'The cups press each cover onto its own wheel in the cradle', 4, both(() => ({ trol: parkCover })));
      step('f_wc_leave', 'The cups let go and come back in', 3, both(() => ({ cover: 0, trol: TURN_TROL })));
    }

    // THE REAR WHEELS: off, and onto the front hubs
    turn('r_face_car', 'Each robot turns back to the car', 0);
    step('r_portal', 'The portal moves to the rear wheels', 6, { portal: v.rearZ, ...both(() => ({ pcd, trol: trolForFace(TRAVEL_FACE_X) })) });
    step('r_lower', 'The heads go down to the wheels\' height', 4, both(() => ({ headY: v.centreY })));
    step('r_approach', 'The heads come in, 0.10 m off the tyres. The cameras find each wheel and its nuts', 6,
      both(() => ({ trol: trolForFace(v.faceX + APPROACH) })));
    coverOff('r', 'rear');
    unbolt('r', 'rear', HUB_ANGLE[1]);
    step('rf_carry', 'The portal carries the rear wheels along the car to the front hubs', 7, { portal: v.frontZ });
    mount('rf', 'front');
    coverOn('rf');
    step('rf_up', 'The heads go up to the travel height', 3, both(() => ({ headY: TRAVEL_Y, trol: trolForFace(TRAVEL_FACE_X) })));

    // THE WAITING FRONT WHEELS: out of the cradles, and onto the rear hubs
    turn('w_turn', 'Each robot turns to the wall side', Math.PI);
    step('w_to_racks', 'The portal goes to the waiting front wheels', 7, { portal: parkZ, ...both(() => ({ headY: rackY })) });
    if (v.facts.cover) {
      step('w_cups_on', 'The cups come out to each waiting wheel\'s cover', 4, both(() => ({ cover: HEAD.cover, trol: parkCover })));
      step('w_cover_off', 'The cups pull the cover off', 3, both(() => ({ trol: TURN_TROL })));
      step('w_cover_go', 'The portal moves clear of the racks with the covers', 6, { portal: v.frontZ });
      step('w_cover_nest', 'Each cover goes into its nest on the portal leg', 5,
        both(() => ({ trol: COVER_NEST.x - CUPS_AHEAD_OF_MAST, headY: nestY })));
      step('w_cover_leave', 'The cups let go and come back in', 3, both(() => ({ cover: 0, trol: TURN_TROL })));
      step('w_back', 'The portal goes back to the waiting wheels', 6, { portal: parkZ, ...both(() => ({ headY: rackY })) });
    }
    step('w_in', 'The heads move over the waiting wheels', 3, both(() => ({ trol: trolForWallFace(RACK.faceX) })));
    step('w_grip', 'The rollers close on each tyre', 3, both(() => ({ clamp: clampOn })));
    step('w_up', 'The heads lift the wheels out of their cradles', 4, both(() => ({ headY: TRAVEL_Y })));
    step('w_out', 'The heads back away from the racks', 3, both(() => ({ trol: TURN_TROL })));
    step('w_to_axle', 'The portal carries the front wheels to the rear hubs', 7, { portal: v.rearZ });
    step('w_turn_car', 'Each robot turns the wheel to the car', 4, both(() => ({ slew: 0 })));
    step('w_back_in', 'The heads come back toward the car', 3, both(() => ({ trol: trolForFace(TRAVEL_FACE_X) })));
    step('w_lower_hub', 'The heads go down to the hubs\' height', 4, both(() => ({ headY: v.centreY })));
    mount('w', 'rear');
    coverOn('w');
    step('w_travel', 'The heads go up to the travel height', 3, both(() => ({ headY: TRAVEL_Y, trol: trolForFace(TRAVEL_FACE_X) })));
  };

  if (job === 'rotation') rotate();
  else for (const axle of ['front', 'rear'] as const) {
    const a = axle === 'front' ? 'f' : 'r';
    const z = axle === 'front' ? v.frontZ : v.rearZ;
    const oldZ = axle === 'front' ? RACK.oldZ[0] : RACK.oldZ[1];
    const newZ = axle === 'front' ? RACK.newZ[0] : RACK.newZ[1];
    const word = axle === 'front' ? 'front' : 'rear';
    const hub = axle === 'front' ? HUB_ANGLE[0] : HUB_ANGLE[1];
    step(`${a}_portal`, `The portal moves to the ${word} wheels`, 6, { portal: z, ...both(() => ({ pcd, trol: trolForFace(TRAVEL_FACE_X) })) });
    step(`${a}_lower`, 'The heads go down to the wheels\' height', 4, both(() => ({ headY: v.centreY })));
    step(`${a}_approach`, 'The heads come in, 0.10 m off the tyres. The cameras find each wheel and its nuts', 6,
      both(() => ({ trol: trolForFace(v.faceX + APPROACH) })));
    if (v.facts.cover) {
      step(`${a}_cups_out`, 'The suction cups come out past the sockets', 3, both(() => ({ cover: HEAD.cover })));
      step(`${a}_cups_on`, 'The cups take hold of the cover', 3, both(() => ({ trol: coverFace + CUPS_AHEAD_OF_MAST })));
      step(`${a}_cover_off`, 'The cups pull the cover off', 3, both(() => ({ trol: trolForFace(TRAVEL_FACE_X) + COVER_PULL })));
      turn(`${a}_cover_turn`, 'Each robot turns to its portal leg with the cover', Math.PI);
      step(`${a}_cover_nest`, 'Each cover goes into its nest on the portal leg', 5,
        both(() => ({ trol: COVER_NEST.x - CUPS_AHEAD_OF_MAST, headY: nestY })));
      step(`${a}_cover_leave`, 'The cups let go and come back in', 3, both(() => ({ cover: 0, trol: TURN_TROL })));
      step(`${a}_cover_back`, 'Each robot turns back to the car', 4, both(() => ({ slew: 0 })));
      step(`${a}_regain`, 'The heads go back to the wheels', 6, both(() => ({ trol: trolForFace(TRAVEL_FACE_X), headY: v.centreY })));
    }
    step(`${a}_grip`, 'The rollers close on each tyre below its centre. The cluster turns to the nuts', 5,
      both(() => ({ trol: trolForFace(faceGrip), clamp: clampOn, a: hub })));
    step(`${a}_nuts_on`, 'The sockets go onto the nuts. The grip holds the wheel still', 3,
      both(() => ({ trol: trolForFace(faceGrip) - GRIP_ON_NUTS, grip: GRIP_ON_NUTS })));
    step(`${a}_unbolt`, v.facts.fastener === 'nut' ? 'Each nut breaks free in turn. Then all 5 spin off into their sockets'
      : 'Each bolt breaks free in turn. Then all 5 spin out into their sockets', 16, {});
    step(`${a}_nuts_back`, `The sockets come back with the ${v.facts.fastener}s in them`, 3,
      both(() => ({ trol: trolForFace(faceGrip), grip: 0 })));
    step(`${a}_pull`, 'Each wheel comes straight off its studs', 4, both(() => ({ trol: trolForFace(faceGrip + PULL_OFF) })));
    step(`${a}_out`, 'The heads move out, clear of the car', 3, both(() => ({ trol: trolForFace(TRAVEL_FACE_X) })));
    turn(`${a}_turn_old`, 'Each robot turns its old wheel to the wall side', Math.PI);
    step(`${a}_to_old`, 'The portal carries the old wheels to the OLD racks', 6, { portal: oldZ });
    step(`${a}_rack_near`, 'The heads move each wheel up to its cradle', 3, both(() => ({ trol: trolForWallFace(RACK.faceX - RACK_CLEAR) })));
    step(`${a}_rack_in`, 'The heads move each wheel over its cradle', 3, both(() => ({ trol: trolForWallFace(RACK.faceX) })));
    step(`${a}_rack_down`, 'The heads set each old wheel down in its cradle', 4, both(() => ({ headY: rackCentreY(v.tyreR) })));
    step(`${a}_release`, 'The rollers open', 2, both(() => ({ clamp: HEAD.clampMax })));
    step(`${a}_rack_out`, 'The heads back away from the old wheels', 3, both(() => ({ trol: TURN_TROL })));
    step(`${a}_to_new`, 'The portal goes to the NEW racks', 9, { portal: newZ });
    step(`${a}_new_in`, 'The heads move over the new wheels', 3, both(() => ({ trol: trolForWallFace(RACK.faceX) })));
    step(`${a}_new_grip`, 'The rollers close on each new tyre', 3, both(() => ({ clamp: clampOn })));
    step(`${a}_new_up`, 'The heads lift the new wheels out of their cradles', 4, both(() => ({ headY: TRAVEL_Y })));
    step(`${a}_new_out`, 'The heads back away from the racks', 3, both(() => ({ trol: TURN_TROL })));
    step(`${a}_to_axle`, `The portal carries the new wheels to the ${word} hubs`, 7, { portal: z });
    step(`${a}_turn_car`, 'Each robot turns the new wheel to the car', 4, both(() => ({ slew: 0 })));
    step(`${a}_back_in`, 'The heads come back toward the car', 3, both(() => ({ trol: trolForFace(TRAVEL_FACE_X) })));
    step(`${a}_lower_hub`, 'The heads go down to the hubs\' height', 4, both(() => ({ headY: v.centreY })));
    step(`${a}_align`, v.facts.fastener === 'nut' ? 'The cameras find the studs. The rollers turn each wheel to them'
      : 'The cameras find the hub\'s holes. The rollers turn each wheel to them', 6,
      both(() => ({ trol: trolForFace(faceGrip + PULL_OFF) })));
    step(`${a}_mount`, v.facts.fastener === 'nut' ? 'Each wheel goes onto its hub, on the studs and the centre bore'
      : 'Each wheel goes onto its hub\'s centre spigot. The rollers hold it there', 5, both(() => ({ trol: trolForFace(faceGrip) })));
    step(`${a}_nuts_in`, v.facts.fastener === 'nut' ? 'The sockets put the nuts to the studs' : 'The sockets put the bolts to the hub\'s holes', 3,
      both(() => ({ trol: trolForFace(faceGrip) - GRIP_ON_NUTS, grip: GRIP_ON_NUTS })));
    step(`${a}_torque`, `All 5 run down. Then each is tightened to ${v.facts.torqueNm} N m in a star order`, 23, {});
    step(`${a}_nuts_out`, 'The sockets come back, empty', 3, both(() => ({ trol: trolForFace(faceGrip), grip: 0, a: 0 })));
    step(`${a}_open`, 'The rollers open', 2, both(() => ({ clamp: HEAD.clampMax })));
    step(`${a}_away`, 'The heads move out, clear of the car', 3, both(() => ({ trol: trolForFace(TRAVEL_FACE_X) })));
    if (v.facts.cover) {
      turn(`${a}_cover_fetch`, 'Each robot turns to its portal leg', Math.PI);
      step(`${a}_cups_reach`, 'The cups come out to the cover in the nest', 5,
        both(() => ({ cover: HEAD.cover, trol: COVER_NEST.x - CUPS_AHEAD_OF_MAST, headY: nestY })));
      step(`${a}_cover_lift`, 'The cups take the cover out of the nest', 3, both(() => ({ trol: TURN_TROL })));
      step(`${a}_cover_return`, 'Each robot turns back to the car with the cover', 4, both(() => ({ slew: 0 })));
      step(`${a}_cover_in`, 'The heads bring the covers to the wheels', 6,
        both(() => ({ trol: trolForFace(TRAVEL_FACE_X) + COVER_PULL, headY: v.centreY })));
      step(`${a}_cover_press`, 'The cups press each cover back on', 4, both(() => ({ trol: coverFace + CUPS_AHEAD_OF_MAST })));
      step(`${a}_cups_in`, 'The cups let go and come back in', 3, both(() => ({ cover: 0, trol: trolForFace(TRAVEL_FACE_X) })));
    }
    step(`${a}_up`, 'The heads go up to the travel height', 3, both(() => ({ headY: TRAVEL_Y, trol: trolForFace(TRAVEL_FACE_X) })));
  }
  if (swap) sockets('sock_back', hexMm, homeHex, SOCKET_RACK.ringY[1], SOCKET_RACK.ringY[0]);
  step('park', 'The portal and both robots go back to the exit end', 8, { portal: PORTAL.park, ...both(() => ({ ...PARK_SIDE, pcd })) });
  step('lift_down', 'The locks open. The lift lowers the car onto its wheels', 12, { liftF: touchRise(v.sillFront), liftR: touchRise(v.sillRear) });
  step('pads_off', 'The rams lower the pads off the sills', 4, { liftF: LIFT.armClearRise, liftR: LIFT.armClearRise });
  step('arms_in', 'The arms slide in and swing back along the drive line', 10, { armF: { ...ARM_STOWED }, armR: { ...ARM_STOWED } });
  step('arms_down', 'The rams lower the arms into the floor. The car may go', 4, { liftF: 0, liftR: 0 });

  const total = steps.reduce((t, s) => t + s.seconds, 0);
  const starts = steps.map((_, i) => steps.slice(0, i).reduce((t, s) => t + s.seconds, 0));
  const stateAt = (i: number, u: number) => lerpState(i === 0 ? steps[0].end : steps[i - 1].end, steps[i].end, Math.min(1, Math.max(0, u)));
  return {
    vehicle: v, job, steps, total, stateAt,
    at(t: number) {
      const tt = ((t % total) + total) % total;
      let i = steps.length - 1;
      while (i > 0 && starts[i] > tt) i--;
      const u = steps[i].seconds > 0 ? Math.min(1, (tt - starts[i]) / steps[i].seconds) : 1;
      return { step: i, angles: tireAngles(stateAt(i, u)) };
    },
  };
}

/** The head's axis height with a model's cover in the nest: the cover's rim on the hooks. */
export const coverNestY = (v: TireVehicle): number => COVER_NEST.seatY + v.rimR - COVER_RIM;
/** Each clamp arm's position (z from the axis) that puts its roller on a tyre of radius R. */
export function clampFor(R: number): number {
  const dist = R + HEAD.rollerR;
  const y = -HEAD.rollerY;
  return Math.sqrt(Math.max(0, dist * dist - y * y));
}
/** The contact's angle from the tyre's bottom (rad) for a tyre of radius R. */
export const clampContactAngle = (R: number): number => Math.atan2(clampFor(R), -HEAD.rollerY);

/** The machine holding one model's wheels (front or rear): the preset the tab offers and the clash check tests. */
export function gripState(v: TireVehicle, axle: 'front' | 'rear'): BayState {
  const h = homeState();
  const q = (): SideState => ({ ...h.W, trol: trolForFace(v.faceX + 0.01), slew: 0, headY: v.centreY, clamp: clampFor(v.tyreR), pcd: v.facts.pcd });
  return {
    ...h, portal: axle === 'front' ? v.frontZ : v.rearZ, W: q(), E: q(),
    liftF: serviceLift(v.sillFront), liftR: serviceLift(v.sillRear), armF: { ...v.armFront }, armR: { ...v.armRear },
  };
}
