/**
 * Where every moving part of a wash bay is, for one session: the gantry (in the BAY frame of washSpec.ts: plan units,
 * `dy` from the parked car's centre, negative = north, `x` from the drive line, heights above grade) and the two
 * detail arms (detailArm.ts, metres).
 *
 * Pure: (phase, t, the pose its phase began from) -> pose. The air knives meet the car where carShape.ts says the
 * car is, and the arms' pads where its solid is (vehicleEnvelope.ts). No brush touches the car, and no door opens.
 */
import {
  PASS_EASE, PASS_FROM, PASS_KIND, WASH_GANTRY, WASH_HOME_DY, WIPE_PARTS, isPass, isWipe, passTo, stationOf,
  washChain, type WashPhase, type WipeStation,
} from './washSpec';
import { CAR_HALF_LEN_U, carHalfWidthAtU, carTopU } from './carShape';
import { armInZone, armOut, armReturn, armStow, armTuck, stowed, type ArmState } from './detailArm';

export interface WashPose {
  /** the gantry's centreline, plan u from the car's centre (negative = north) */
  dy: number;
  /** 0..1: the air knives on the car */
  dryEngage: number;
  /** the top air knife's lower face, plan u above grade */
  dryerTopY: number;
  /** each side air knife's inner face, plan u from the drive line */
  dryerSideX: number;
  /** the two detail arms: east, then west. Each moves on its own (detailArm.ts; points in metres) */
  arms: readonly [ArmState, ArmState];
  /** the part of the car the arms are working on, or going to */
  station: WipeStation | null;
  /** what the arch sprays */
  spray: 'none' | 'soak' | 'jet' | 'rinse';
  /** the air knives blow */
  air: boolean;
  /** the status beacon */
  status: 'home' | 'working' | 'moving' | 'finishing';
  /** the stop lights show red: the car must stay where it is */
  stop: boolean;
}

const G = WASH_GANTRY;
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

const STOWED_ARMS: readonly [ArmState, ArmState] = [stowed(1), stowed(-1)];

/** The gantry with everything off the car, at `dy`, and both arms in their docks. */
function retracted(dy: number): WashPose {
  return {
    dy, dryEngage: 0, dryerTopY: G.dryer.top.retractY, dryerSideX: G.dryer.side.retractX,
    arms: STOWED_ARMS, station: null, spray: 'none', air: false, status: 'moving', stop: true,
  };
}

/** Fill in the air knives' positions from their engagement at the gantry's `dy`. */
function place(p: WashPose): WashPose {
  const kd = p.dy + G.dryer.dy;
  p.dryerTopY = lerp(G.dryer.top.retractY, dryerTopContactY(kd), p.dryEngage);
  p.dryerSideX = lerp(G.dryer.side.retractX, DRYER_SIDE_CONTACT_X, p.dryEngage);
  return p;
}

export interface PoseSource {
  phase: WashPhase;
  t: number;
  /** the pose the current phase began from (the phases that start from wherever the machine is) */
  from: WashPose | null;
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
    case 'arms_out': {
      // the gantry is home at the entrance; each arm unfolds at its dock and rides down its track to the nose
      const p = retracted(WASH_HOME_DY);
      p.arms = [armOut(1, t), armOut(-1, t)];
      p.station = 'front';
      return place(p);
    }
    case 'arms_stow': {
      const p = retracted(WASH_HOME_DY);
      p.arms = [armStow(1, t), armStow(-1, t)];
      return place(p);
    }
    case 'retract': {
      // the seat ended mid-program: the air knives come off the car and each arm tucks, where it stands
      const p = retracted(from?.dy ?? WASH_HOME_DY);
      p.dryEngage = lerp(from?.dryEngage ?? 0, 0, ease(t));
      if (from) p.arms = [armTuck(from.arms[0], t), armTuck(from.arms[1], t)];
      p.status = 'finishing';
      return place(p);
    }
    case 'return': {
      // the gantry goes home to the entrance, and each arm to its dock at the exit
      const p = retracted(lerp(from?.dy ?? WASH_HOME_DY, WASH_HOME_DY, ease(t)));
      if (from) p.arms = [armReturn(from.arms[0], t), armReturn(from.arms[1], t)];
      p.status = 'finishing';
      return place(p);
    }
    default: {
      if (isWipe(s.phase)) {
        const zone = stationOf(s.phase);
        const p = retracted(WASH_HOME_DY);
        p.arms = [armInZone(1, zone, t, WIPE_PARTS), armInZone(-1, zone, t, WIPE_PARTS)];
        p.station = zone;
        p.status = p.arms.some((a) => a.engage > 0) ? 'working' : 'moving';
        return place(p);
      }
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
