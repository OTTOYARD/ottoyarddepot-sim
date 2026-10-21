/**
 * Where every moving part of a bay's rollover machine is, for one session, in the BAY frame
 * (washSpec.ts): plan units, `dy` from the parked car's centre (negative = north, toward
 * the nose), `x` from the drive line, heights above grade.
 *
 * Pure: (phase, t, the session's pace and the pose its phase began from) -> pose. The
 * brushes and air knives meet the car where carShape.ts says the car is, which is the
 * solid the car mesh is drawn from (vehicleEnvelope.ts).
 */
import {
  PASS_EASE, PASS_FROM, PASS_KIND, WASH_CABIN_DY, WASH_GANTRY, WASH_HOME_DY, isPass, passTo, type WashPhase,
} from './washSpec';
import { CAR_HALF_LEN_U, CAR_HALF_WIDTH_U, carTopU } from './carShape';

export interface WashPose {
  /** the gantry's centreline, plan u from the car's centre (negative = north) */
  dy: number;
  /** 0..1: the side and top brushes on the car */
  brushEngage: number;
  /** 0..1: the air knives on the car */
  dryEngage: number;
  /** each side brush's axis, plan u from the drive line */
  sideBrushX: number;
  /** the top brush's axis height, plan u */
  topBrushY: number;
  /** the top air knife's lower face, plan u above grade */
  dryerTopY: number;
  /** each side air knife's inner face, plan u from the drive line */
  dryerSideX: number;
  /** 0..1: each vacuum wand's vertical stage, from under the beam to the door's mid-height */
  wandDrop: number;
  /** 0..1: each wand's horizontal stage, from its carriage into the cabin */
  wandReach: number;
  /** what the arch sprays */
  spray: 'none' | 'soak' | 'foam' | 'rinse';
  /** the air knives blow */
  air: boolean;
  /** the brushes turn */
  spinning: boolean;
  /** the car's doors, 0 shut .. 1 open */
  doors: number;
  /** the status beacon */
  status: 'home' | 'working' | 'moving' | 'finishing';
  /** the stop light shows red: the car must stay where it is */
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
 * Where the top brush's axis rides over the car at `dy`: a cylinder of radius r rolling on
 * the car's top, pressed in by its squash. Past the car's ends it holds the bumper's height.
 */
export function topBrushContactY(dy: number): number {
  const { r, squash } = G.topBrush;
  let h = 0;
  for (let k = -8; k <= 8; k++) {
    const s = (k / 8) * r;
    h = Math.max(h, topHeld(dy + s) + Math.sqrt(Math.max(0, r * r - s * s)));
  }
  return h - squash;
}

/** The side brushes' axis on the car: the brush's radius off the flank, less its squash. */
export const SIDE_BRUSH_CONTACT_X = CAR_HALF_WIDTH_U + G.sideBrush.r - G.sideBrush.squash;

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
export const DRYER_SIDE_CONTACT_X = CAR_HALF_WIDTH_U + G.dryer.side.gap;

/** Everything off the car, the machine at `dy`. */
function retracted(dy: number): WashPose {
  return {
    dy, brushEngage: 0, dryEngage: 0,
    sideBrushX: G.sideBrush.retractX, topBrushY: G.topBrush.retractY,
    dryerTopY: G.dryer.top.retractY, dryerSideX: G.dryer.side.retractX,
    wandDrop: 0, wandReach: 0, spray: 'none', air: false, spinning: false, doors: 0,
    status: 'moving', stop: true,
  };
}

/** Fill in the brushes' and air knives' positions from their engagement at the machine's `dy`. */
function place(p: WashPose): WashPose {
  const td = p.dy + G.topBrush.dy;
  const kd = p.dy + G.dryer.dy;
  // the side brushes close to the flank's line; past the car's ends they turn in the air
  p.sideBrushX = lerp(G.sideBrush.retractX, SIDE_BRUSH_CONTACT_X, p.brushEngage);
  p.topBrushY = lerp(G.topBrush.retractY, topBrushContactY(td), p.brushEngage);
  p.dryerTopY = lerp(G.dryer.top.retractY, dryerTopContactY(kd), p.dryEngage);
  p.dryerSideX = lerp(G.dryer.side.retractX, DRYER_SIDE_CONTACT_X, p.dryEngage);
  return p;
}

export interface PoseSource {
  phase: WashPhase;
  t: number;
  /** the vacuum's length, sim seconds (it sets how many sweeps the wands make) */
  vacuumS: number;
  /** the pose the current phase began from (the phases that start from wherever the machine is) */
  from: WashPose | null;
}

/** The vacuum's sweep: the gantry's small travel along the cabin floor, plan u either way. */
export const VACUUM_SWEEP_U = 0.15;

/** The machine's pose for this session. */
export function washPoseAt(s: PoseSource): WashPose {
  const t = clamp01(s.t);
  const from = s.from;
  switch (s.phase) {
    case 'home': {
      const p = retracted(WASH_HOME_DY);
      p.status = 'home'; p.stop = false;
      return place(p);
    }
    case 'settle':
      return place(retracted(WASH_HOME_DY));
    case 'to_cabin':
      return place(retracted(lerp(from?.dy ?? WASH_HOME_DY, WASH_CABIN_DY, ease(t))));
    case 'doors_open': {
      const p = retracted(WASH_CABIN_DY);
      p.doors = ease(t);
      return place(p);
    }
    case 'wands_down': {
      const p = retracted(WASH_CABIN_DY);
      p.doors = 1; p.wandDrop = ease(t);
      return place(p);
    }
    case 'wands_in': {
      const p = retracted(WASH_CABIN_DY);
      p.doors = 1; p.wandDrop = 1; p.wandReach = ease(t);
      return place(p);
    }
    case 'vacuum': {
      // whole sweeps, so the pose is the same at the vacuum's two ends as at wands_in's end
      const n = Math.max(1, Math.round(s.vacuumS / 9));
      const m = Math.max(1, Math.round(s.vacuumS / 4));
      const p = retracted(WASH_CABIN_DY + VACUUM_SWEEP_U * Math.sin(2 * Math.PI * n * t));
      p.doors = 1; p.wandDrop = 1;
      p.wandReach = 1 - 0.4 * (1 - Math.cos(2 * Math.PI * m * t)) / 2;
      p.status = 'working';
      return place(p);
    }
    case 'wands_out': {
      const p = retracted(from?.dy ?? WASH_CABIN_DY);
      p.doors = 1; p.wandDrop = from?.wandDrop ?? 1;
      p.wandReach = lerp(from?.wandReach ?? 1, 0, ease(t));
      return place(p);
    }
    case 'wands_up': {
      const p = retracted(from?.dy ?? WASH_CABIN_DY);
      p.doors = 1; p.wandDrop = lerp(from?.wandDrop ?? 1, 0, ease(t));
      return place(p);
    }
    case 'doors_close': {
      const p = retracted(from?.dy ?? WASH_CABIN_DY);
      p.doors = 1 - ease(t);
      return place(p);
    }
    case 'to_start':
      return place(retracted(lerp(from?.dy ?? WASH_CABIN_DY, PASS_FROM.soak, ease(t))));
    case 'done': {
      const p = retracted(WASH_HOME_DY);
      p.status = 'home'; p.stop = false;
      return place(p);
    }
    case 'retract': {
      // the seat ended mid-pass: brushes and air knives come off the car where it stands
      const f = ease(t);
      const p = retracted(from?.dy ?? WASH_HOME_DY);
      p.brushEngage = lerp(from?.brushEngage ?? 0, 0, f);
      p.dryEngage = lerp(from?.dryEngage ?? 0, 0, f);
      p.spinning = p.brushEngage > 0.02;
      p.status = 'finishing';
      return place(p);
    }
    case 'return': {
      const p = retracted(lerp(from?.dy ?? WASH_HOME_DY, WASH_HOME_DY, ease(t)));
      p.status = 'finishing';
      return place(p);
    }
    default: {
      if (!isPass(s.phase)) return place(retracted(WASH_HOME_DY));
      // a pass: close in standing still, travel, open out standing still
      const u = ease((t - PASS_EASE) / (1 - 2 * PASS_EASE));
      const p = retracted(lerp(PASS_FROM[s.phase], passTo(s.phase), u));
      const e = t < PASS_EASE ? ease(t / PASS_EASE) : t > 1 - PASS_EASE ? ease((1 - t) / PASS_EASE) : 1;
      const on = t > PASS_EASE * 0.5 && t < 1 - PASS_EASE * 0.5;
      p.status = 'working';
      switch (PASS_KIND[s.phase]) {
        case 'soak': p.spray = on ? 'soak' : 'none'; break;
        case 'brush': p.brushEngage = e; p.spinning = true; p.spray = on ? 'foam' : 'none'; break;
        case 'rinse': p.spray = on ? 'rinse' : 'none'; break;
        case 'dry': p.dryEngage = e; p.air = on; break;
      }
      return place(p);
    }
  }
}
