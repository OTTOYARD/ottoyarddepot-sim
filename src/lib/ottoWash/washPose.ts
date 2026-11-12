/**
 * Where every moving part of a bay's wash machine is, for one session, in the BAY frame
 * (washSpec.ts): plan units, `dy` from the parked car's centre (negative = north, toward
 * the nose), `x` from the drive line, heights above grade.
 *
 * Pure: (phase, t, the pose its phase began from) -> pose. The air knives and the wipe pads
 * meet the car where carShape.ts says the car is, which is the solid the car mesh is drawn
 * from (vehicleEnvelope.ts). Nothing that turns touches the car, and no door opens.
 */
import {
  PASS_EASE, PASS_FROM, PASS_KIND, WASH_GANTRY, WASH_HOME_DY, WIPE_PARTS, isPass, isWipe, passTo, stationOf,
  washChain, type WashPhase, type WipeStation,
} from './washSpec';
import { CAR_HALF_LEN_U, carHalfWidthAtU, carTopU } from './carShape';
import { BODY_BEVEL_M, BODY_ROOF_M, ROOF_POD } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';

/** Which way a wipe pad faces: down (stowed), in toward the drive line, aft (south, onto the nose), fore (north, onto the tail). */
export type PadFace = 'down' | 'in' | 'aft' | 'fore';

export interface WashPose {
  /** the gantry's centreline, plan u from the car's centre (negative = north) */
  dy: number;
  /** 0..1: the air knives on the car */
  dryEngage: number;
  /** the top air knife's lower face, plan u above grade */
  dryerTopY: number;
  /** each side air knife's inner face, plan u from the drive line */
  dryerSideX: number;
  /** each wipe arm's mast axis from the drive line, plan u (the two arms mirror each other) */
  mastX: number;
  /** each wipe pad's centre above grade, plan u (the mast's foot) */
  padY: number;
  /** the wrist's turn: 0 = the pad faces in toward the drive line, +1 = aft (south, onto the nose), -1 = fore (north, onto the tail) */
  padYaw: number;
  /** the wrist's tilt: 0 = the pad faces down (stowed), 1 = it faces the car */
  padTilt: number;
  /** each wipe pad's centre from the drive line, plan u: the mast's axis less the forearm, as the wrist is turned */
  padX: number;
  /** the pads' centre along the bay, plan u from the car's centre */
  padDy: number;
  /** which way the pads face, from the wrist */
  padFace: PadFace;
  /** 0..1: the pads pressed on a sensor */
  wipeEngage: number;
  /** the place the arms are working at, or going to */
  station: WipeStation | null;
  /** what the arch sprays */
  spray: 'none' | 'soak' | 'jet' | 'rinse';
  /** the air knives blow */
  air: boolean;
  /** the status beacon */
  status: 'home' | 'working' | 'moving' | 'finishing';
  /** the stop light shows red: the car must stay where it is */
  stop: boolean;
}

const G = WASH_GANTRY;
const W = G.wipe;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
/** Smooth start and stop (smoothstep). */
const ease = (t: number) => { const u = clamp01(t); return u * u * (3 - 2 * u); };

/** The car's top at `dy`, holding the end's height past either end (the bumper's top). */
function topHeld(dy: number): number {
  const lim = CAR_HALF_LEN_U - 1e-6;
  return carTopU(Math.max(-lim, Math.min(lim, dy))) ?? 0;
}

/**
 * The top air knife's lower face over the car at `dy`: the car's highest point under it plus
 * its gap, ramped (DRYER_RAMP_SLOPE) so it rises before the roof pod and settles after it,
 * the way a profile-following knife moves, instead of stepping 0.27 u at the pod's edge.
 */
export const DRYER_RAMP_SLOPE = 0.6;
export function dryerTopContactY(dy: number): number {
  const d = G.dryer.top.d / 2;
  const reach = d + 0.6;
  let h = 0;
  for (let k = -12; k <= 12; k++) {
    const s = (k / 12) * reach;
    const off = Math.max(0, Math.abs(s) - d);
    h = Math.max(h, topHeld(dy + s) - DRYER_RAMP_SLOPE * off);
  }
  return h + G.dryer.top.gap;
}

/** The side air knives' inner face on the car. */
export const DRYER_SIDE_CONTACT_X = carHalfWidthAtU(0) + G.dryer.side.gap;

/**
 * Where the pads work at each place. `armDy` is the cross rail's line along the bay, `x` and `y` the pad's centre
 * with its face on the car, and `sweep` the small motion that wipes: across the bay (the pads slide) or along it
 * (the gantry moves).
 *   front  the nose: the corner sensors and the cameras behind the bumper's face
 *   sides  the front wings: the side cameras, low on the flank
 *   roof   the roof pod, from its two sides
 *   rear   the tail: the rear cameras and corner sensors
 */
export interface WipeTarget { padDy: number; x: number; y: number; yaw: -1 | 0 | 1; sweep: { axis: 'x' | 'dy'; amp: number } }
const POD_R = ROOF_POD.radius * PLAN_UNITS_PER_METRE;
/** The roof's top face beside the pod: the body's roof line and its bevel. The pad's rim stands 10 mm above it. */
const ROOF_U = (BODY_ROOF_M + BODY_BEVEL_M) * PLAN_UNITS_PER_METRE;
/**
 * The height of the nose's and the tail's upright face, where the low cameras and radars are: the car's solid stands
 * upright to 1.3 u (0.62 m) and slopes back above it, so a pad higher than that would wipe air.
 */
const NOSE_FACE_Y = 1.2;
export const WIPE_TARGET: Readonly<Record<WipeStation, WipeTarget>> = {
  front: { padDy: -(CAR_HALF_LEN_U + W.padT / 2), x: 1.2, y: NOSE_FACE_Y, yaw: 1, sweep: { axis: 'x', amp: 0.45 } },
  sides: { padDy: -2.4, x: carHalfWidthAtU(2.0) + W.padT / 2, y: 2.0, yaw: 0, sweep: { axis: 'dy', amp: 0.45 } },
  roof: { padDy: 0, x: POD_R + W.padT / 2, y: ROOF_U + W.padR + 0.02, yaw: 0, sweep: { axis: 'dy', amp: 0.2 } },
  rear: { padDy: CAR_HALF_LEN_U + W.padT / 2, x: 1.2, y: NOSE_FACE_Y, yaw: -1, sweep: { axis: 'x', amp: 0.45 } },
};
const yawRad = (yaw: number) => (yaw * Math.PI) / 2;
/** The mast's axis and the gantry's line that put the pad's centre on a place's point, with the wrist turned for it. */
export function wipeJoints(k: WipeTarget): { mastX: number; dy: number } {
  return { mastX: k.x + W.forearm * Math.cos(yawRad(k.yaw)), dy: k.padDy - W.dy - W.forearm * Math.sin(yawRad(k.yaw)) };
}
/** Fill in the pad's centre and its face from the joints. */
function wrist(p: WashPose): WashPose {
  p.padX = p.mastX - W.forearm * Math.cos(yawRad(p.padYaw));
  p.padDy = p.dy + W.dy + W.forearm * Math.sin(yawRad(p.padYaw));
  p.padFace = p.padTilt < 0.5 ? 'down' : p.padYaw > 0.5 ? 'aft' : p.padYaw < -0.5 ? 'fore' : 'in';
  return p;
}
/** Whole wipes a place: the pose is the same at the wipe's two ends. */
export const WIPE_STROKES = 2;

/** Everything off the car and stowed, the machine at `dy`. */
function retracted(dy: number): WashPose {
  return {
    dy, dryEngage: 0, dryerTopY: G.dryer.top.retractY, dryerSideX: G.dryer.side.retractX,
    mastX: W.parkX, padY: W.stowY, padYaw: 0, padTilt: 0, padX: W.parkX - W.forearm, padDy: dy + W.dy, padFace: 'down',
    wipeEngage: 0, station: null,
    spray: 'none', air: false, status: 'moving', stop: true,
  };
}

/** Fill in the air knives' positions from their engagement at the machine's `dy`. */
function place(p: WashPose): WashPose {
  const kd = p.dy + G.dryer.dy;
  p.dryerTopY = lerp(G.dryer.top.retractY, dryerTopContactY(kd), p.dryEngage);
  p.dryerSideX = lerp(G.dryer.side.retractX, DRYER_SIDE_CONTACT_X, p.dryEngage);
  return wrist(p);
}

export interface PoseSource {
  phase: WashPhase;
  t: number;
  /** the pose the current phase began from (the phases that start from wherever the machine is) */
  from: WashPose | null;
}

/** The arms as they come down at the north end: at the nose's height, the wrists turned for the nose. */
function armsReady(): WashPose {
  const p = retracted(WASH_HOME_DY);
  p.padY = WIPE_TARGET.front.y; p.padYaw = WIPE_TARGET.front.yaw; p.padTilt = 1; p.station = 'front';
  return p;
}

/** One place: out to clear the car, travel, close in, wipe, back out. */
function wipeAt(station: WipeStation, t: number, from: WashPose | null): WashPose {
  const k = WIPE_TARGET[station];
  const j = wipeJoints(k);
  const f = from ?? armsReady();
  const { travel, close, wipe } = WIPE_PARTS;
  const p = retracted(j.dy);
  p.station = station; p.padTilt = 1; p.padYaw = k.yaw; p.padY = k.y; p.mastX = W.parkX;
  if (t < travel) {
    // the masts go out to clear the car first, then the gantry travels, the masts set their height and the wrists turn
    const u = t / travel;
    p.mastX = lerp(f.mastX, W.parkX, ease(u / 0.3));
    const m = ease((u - 0.3) / 0.7);
    p.dy = lerp(f.dy, j.dy, m);
    p.padY = lerp(f.padY, k.y, m);
    p.padYaw = lerp(f.padYaw, k.yaw, m);
    return place(p);
  }
  if (t < travel + close) {
    p.mastX = lerp(W.parkX, j.mastX, ease((t - travel) / close));
    return place(p);
  }
  if (t < travel + close + wipe) {
    const s = Math.sin(2 * Math.PI * WIPE_STROKES * ((t - travel - close) / wipe));
    p.mastX = j.mastX; p.wipeEngage = 1; p.status = 'working';
    if (k.sweep.axis === 'x') p.mastX = j.mastX + k.sweep.amp * s;
    else p.dy = j.dy + k.sweep.amp * s;
    return place(p);
  }
  p.mastX = lerp(j.mastX, W.parkX, ease((t - travel - close - wipe) / (1 - travel - close - wipe)));
  return place(p);
}

/** The machine's pose for this session. */
export function washPoseAt(s: PoseSource): WashPose {
  const t = clamp01(s.t);
  const from = s.from;
  switch (s.phase) {
    case 'home': case 'done': {
      const p = retracted(WASH_HOME_DY);
      p.status = 'home'; p.stop = false;
      return place(p);
    }
    case 'settle':
      return place(retracted(WASH_HOME_DY));
    case 'cabin_hold': {
      // a detail seat's cabin time: the machine stands parked and dry, and the car stays (washSpec.ts)
      const p = retracted(WASH_HOME_DY);
      p.status = 'working';
      return place(p);
    }
    case 'arms_down': {
      const r = armsReady();
      const p = retracted(WASH_HOME_DY);
      p.station = 'front';
      p.padY = lerp(W.stowY, r.padY, ease(t));
      p.padTilt = ease(t); p.padYaw = r.padYaw * ease(t);
      return place(p);
    }
    case 'arms_up': {
      const p = retracted(from?.dy ?? WASH_HOME_DY);
      p.mastX = from?.mastX ?? W.parkX;
      p.padY = lerp(from?.padY ?? W.stowY, W.stowY, ease(t));
      p.padTilt = lerp(from?.padTilt ?? 0, 0, ease(t)); p.padYaw = lerp(from?.padYaw ?? 0, 0, ease(t));
      return place(p);
    }
    case 'to_home':
      return place(retracted(lerp(from?.dy ?? WASH_HOME_DY, WASH_HOME_DY, ease(t))));
    case 'retract': {
      // the seat ended mid-program: the air knives come off the car and the pads go out, then up, where it stands
      const p = retracted(from?.dy ?? WASH_HOME_DY);
      p.dryEngage = lerp(from?.dryEngage ?? 0, 0, ease(t));
      p.mastX = lerp(from?.mastX ?? W.parkX, W.parkX, ease(t / 0.5));
      const up = ease((t - 0.5) / 0.5);
      p.padY = lerp(from?.padY ?? W.stowY, W.stowY, up);
      p.padTilt = lerp(from?.padTilt ?? 0, 0, up); p.padYaw = lerp(from?.padYaw ?? 0, 0, up);
      p.status = 'finishing';
      return place(p);
    }
    case 'return': {
      const p = retracted(lerp(from?.dy ?? WASH_HOME_DY, WASH_HOME_DY, ease(t)));
      p.status = 'finishing';
      return place(p);
    }
    default: {
      if (isWipe(s.phase)) return wipeAt(stationOf(s.phase), t, from);
      if (!isPass(s.phase)) return place(retracted(WASH_HOME_DY));
      // a pass: a steady travel from one end to the other; the air knives close in standing still and open out so
      const u = ease((t - PASS_EASE) / (1 - 2 * PASS_EASE));
      const p = retracted(lerp(PASS_FROM[s.phase], passTo(s.phase), u));
      const e = t < PASS_EASE ? ease(t / PASS_EASE) : t > 1 - PASS_EASE ? ease((1 - t) / PASS_EASE) : 1;
      const on = t > PASS_EASE * 0.5 && t < 1 - PASS_EASE * 0.5;
      p.status = 'working';
      switch (PASS_KIND[s.phase]) {
        case 'soak': p.spray = on ? 'soak' : 'none'; break;
        case 'jet': p.spray = on ? 'jet' : 'none'; break;
        case 'rinse': p.spray = on ? 'rinse' : 'none'; break;
        case 'dry': p.dryEngage = e; p.air = on; break;
      }
      return place(p);
    }
  }
}

/**
 * The pose at (phase, t) of the whole program played from its start: each phase begins from the end of the one before
 * it, as a session plays it. For the engineering model's cycle and its clash poses, which have no session.
 */
export function programPoseAt(phase: WashPhase, t: number): WashPose {
  const chain = washChain(true);
  const i = chain.indexOf(phase);
  return washPoseAt({ phase, t, from: i > 0 ? programPoseAt(chain[i - 1], 1) : null });
}
