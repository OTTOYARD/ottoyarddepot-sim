/**
 * Where each OTTO-CLEAN ARM hangs in the depot, and the canopy steel that carries it.
 *
 * The arm is authored in the CAR's frame (cleanArmSpec.ts: metres, x along the car,
 * y up from grade, z to its right), because its whole job is reaching into a car that
 * stands exactly where its stall puts it. So placing the arm IS placing the parked
 * car: the stall's centre, turned to the parked heading, through the same metre ->
 * plan-unit conversion as the car's body (vehicleBody.planUnits: scale, then Ry(-PI/2)).
 * Nothing here is a second guess of where the car is; the motion driver only lets the
 * arm work on a car within 1.9 cm of this pose (TwinMotionDriver CLEAN_POSE_EPS).
 *
 * The canopy steel is the opposite case: it belongs to the CANOPY, not the car. Its
 * purlins run along the canopy (plan y) at 4.6u and 8.0u out from the spine
 * (SolarCanopy.tsx), and a car's centre is 7u out, so a short header beam is hung
 * under those two purlins at the arm's J1, and a drop column hangs from the header to
 * J1's housing. SolarCanopy skips any of its LED fixtures that the header would cut.
 */

import { CANOPIES, chargerStallFrame } from '@/lib/sitePlan';
import { towardFor } from '@/lib/ottoChargeArm/depotPlacement';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { yawFromHeading2D } from '@/components/canvas/three/coordUtils';
import { CLEAN_ARM } from './cleanArmSpec';
import { sidesFor, type CleanSides } from './cleanArmPose';

const NORTH = -Math.PI / 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A fast-charger car's parked heading (plan radians), the rule TwinMotionDriver's
 * parkedHeading('dcfc', …) applies: an angled stall's bearing is the heading; a stall
 * at 0 or 180 faces north. cleanArmPlacement.test.ts holds the two equal on every stall.
 */
export function chargerParkedHeading(angleDeg: number): number {
  return angleDeg % 180 !== 0 ? wrap(chargerStallFrame(angleDeg).heading) : NORTH;
}

/** The roof underside `d` plan units out from a canopy's spine (SolarCanopy.roofAt). */
export const CANOPY_RIDGE_U = 13;
export const CANOPY_EAVE_U = 10.5;
export const CANOPY_HALF_U = 15;
export const canopyRoofAt = (d: number) => CANOPY_RIDGE_U - ((CANOPY_RIDGE_U - CANOPY_EAVE_U) * d) / CANOPY_HALF_U;
/** The two purlins the header hangs from, plan units out from the spine (SolarCanopy's 4.6 and 8.0). */
export const HEADER_PURLINS_U = [4.6, 8.0] as const;
/** The header beam: depth below the purlins' undersides, and width along the canopy, plan units. */
export const HEADER_DEPTH_U = 0.42;
export const HEADER_WIDTH_U = 0.38;
/** A purlin's underside sits 0.1u below the roof line (SolarCanopy). */
export const PURLIN_UNDERSIDE_U = 0.1;

export interface CleanArmPlacement {
  /** The parked car's centre in world coordinates (plan units) — the arm's frame origin, at grade. */
  world: { x: number; z: number };
  /** World yaw of the car frame (yawFromHeading2D of the parked heading). */
  yaw: number;
  /** The stall's charge-port sign, and so which flank the arm cleans first. */
  toward: 1 | -1;
  sides: CleanSides;
  /** J1's axis in PLAN coordinates, and the mount that carries it. */
  j1Plan: { x: number; y: number };
  mount: {
    /** the canopy's spine (plan x), which side of it (+1 = plan east), J1's distance out, and its plan y */
    cx: number; side: 1 | -1; d: number; planY: number;
    /** the header's span out from the spine, from the inner purlin to the outer */
    d0: number; d1: number;
    /** heights above the depot datum (y = 0), plan units */
    headerBottomAtJ1: number; columnBottom: number;
  };
}

/**
 * Place the cleaning arm of the fast-charger stall at plan (x, y) with compass bearing
 * `angle`. `deckY` is the grade the car's tyres rest on (coordUtils.DECK_Y).
 */
export function placeCleanArm(x: number, y: number, angle: number, deckY: number): CleanArmPlacement {
  const heading = chargerParkedHeading(angle);
  const fwd = { x: Math.cos(heading), y: Math.sin(heading) };
  const toward = towardFor(x);
  const along = CLEAN_ARM.mountX * PLAN_UNITS_PER_METRE;
  const j1Plan = { x: x + fwd.x * along, y: y + fwd.y * along };
  const canopy = CANOPIES.reduce((b, c) => (Math.abs(c.cx - j1Plan.x) < Math.abs(b.cx - j1Plan.x) ? c : b), CANOPIES[0]);
  const side = (Math.sign(j1Plan.x - canopy.cx) || 1) as 1 | -1;
  const d = Math.abs(j1Plan.x - canopy.cx);
  const headerBottomAtJ1 = canopyRoofAt(d) - PURLIN_UNDERSIDE_U - HEADER_DEPTH_U;
  const columnBottom = deckY + (CLEAN_ARM.link1Y + CLEAN_ARM.j1.h / 2 + 0.05) * PLAN_UNITS_PER_METRE;
  return {
    world: { x: 150 - x, z: 110 - y },
    yaw: yawFromHeading2D(heading),
    toward,
    sides: sidesFor(toward),
    j1Plan,
    mount: {
      cx: canopy.cx, side, d, planY: j1Plan.y,
      d0: HEADER_PURLINS_U[0], d1: HEADER_PURLINS_U[1], headerBottomAtJ1, columnBottom,
    },
  };
}

/** Does a canopy LED fixture (centred `d` out on `side`, spanning y ± halfLen) cut a cleaning arm's header? */
export function fixtureHitsMount(
  m: Pick<CleanArmPlacement['mount'], 'cx' | 'side' | 'planY'>, cx: number, side: 1 | -1, fixtureY: number, halfLen: number,
): boolean {
  if (Math.abs(m.cx - cx) > 0.5 || m.side !== side) return false;
  return Math.abs(m.planY - fixtureY) < halfLen + HEADER_WIDTH_U / 2 + 0.3;
}

/** A robotic fast-charger stall's pose, for the OTTO-CLEAN ARM's canopy steel over it. */
export interface ArmStallPose { x: number; y: number; angle: number }

/** A stable key for the arm stalls (the StaticMerge version): the steel is rebuilt only when they move. */
export const armStallsKey = (stalls: readonly ArmStallPose[]): string =>
  stalls.map((p) => `${p.x},${p.y},${p.angle}`).join('|');
