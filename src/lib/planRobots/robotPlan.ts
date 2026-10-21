/**
 * THE FAST CHARGERS' ROBOTS AND THE CARS' DOORS, SEEN FROM ABOVE: where each moving part
 * stands on the 2D plan, from exactly the transforms the 3D view draws them through.
 *
 * Plan units, y south. The 3D world is coordUtils.toWorld's: world x = 150 - plan x, world
 * z = 110 - plan y, so a world point is back on the plan at (150 - x, 110 - z).
 *
 *  - The OTTO-CHARGE ARM is the rig at placeArm's world point, turned rotationY and scaled
 *    metres to plan units (ChargingArm.tsx). Its joints come from cobotIK's forward
 *    kinematics, the chain the rig is built to.
 *  - The OTTO-CLEAN ARM and the doors are authored in the CAR's frame (metres: x along the
 *    car, + to the nose; z across it, + to its right) and drawn through the car body's own
 *    conversion: scale, Ry(-PI/2), then the car's yaw (yawFromHeading2D) at its centre
 *    (CleanArm.tsx, Vehicle3D.tsx). Seen from above that is
 *        plan = centre + s * (x * fwd + z * right),  fwd = (cos h, sin h), right = (-sin h, cos h)
 *    for a car at plan heading h, s = PLAN_UNITS_PER_METRE.
 *
 * robotPlan.test.ts holds each of these equal to the 3D rigs' own world points.
 */
import { forwardElbow, forwardTCP, forwardWristCentre, type JointAngles } from '@/lib/ottoChargeArm/cobotIK';
import { OTTO_CHARGE_ARM, PLAN_UNITS_PER_METRE, type CobotSpec } from '@/lib/ottoChargeArm/cobotSpec';
import type { ArmPlacement } from '@/lib/ottoChargeArm/depotPlacement';
import { CAR_WIDTH_M, DOOR, doorHinge, doorPoint } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { cleanArmPoints, type CleanJoints } from '@/lib/ottoCleanArm/cleanArmPose';
import { chargerParkedHeading } from '@/lib/ottoCleanArm/cleanArmPlacement';

export interface PlanPoint { x: number; y: number }

/** A point of the OTTO-CHARGE ARM's base frame (metres; +z toward the car) on the plan. */
export function armToPlan(p: ArmPlacement, v: { x: number; z: number }): PlanPoint {
  const c = Math.cos(p.rotationY), s = Math.sin(p.rotationY);
  const wx = p.world[0] + p.scale * (v.x * c + v.z * s);
  const wz = p.world[2] + p.scale * (-v.x * s + v.z * c);
  return { x: 150 - wx, y: 110 - wz };
}

export interface ArmPlanPoints {
  /** J1's axis, on the pedestal */
  base: PlanPoint;
  elbow: PlanPoint;
  /** the wrist centre */
  wrist: PlanPoint;
  /** the connector's tip */
  tcp: PlanPoint;
}

/** The OTTO-CHARGE ARM's joints on the plan, for one set of joint angles. */
export function armPlanPoints(p: ArmPlacement, a: JointAngles, spec: CobotSpec = OTTO_CHARGE_ARM): ArmPlanPoints {
  return {
    base: armToPlan(p, { x: 0, z: 0 }),
    elbow: armToPlan(p, forwardElbow(a, spec)),
    wrist: armToPlan(p, forwardWristCentre(a, spec)),
    tcp: armToPlan(p, forwardTCP(a, spec)),
  };
}

/** A point of a car's own frame (metres) on the plan, for the car at (cx, cy) heading `heading`. */
export function carToPlan(cx: number, cy: number, heading: number, v: { x: number; z: number }): PlanPoint {
  const s = PLAN_UNITS_PER_METRE, c = Math.cos(heading), n = Math.sin(heading);
  return { x: cx + s * (v.x * c - v.z * n), y: cy + s * (v.x * n + v.z * c) };
}

export interface CleanArmPlanPoints {
  /** J1's axis, under the canopy mount */
  j1: PlanPoint;
  elbow: PlanPoint;
  /** the top of the mast: link 2's tip; the mast hangs straight down from it */
  mast: PlanPoint;
  /** the wrist pivot at the mast's foot, where the wand starts */
  pivot: PlanPoint;
  /** the end of the wand, and the nozzle's tip */
  knuckle: PlanPoint;
  tip: PlanPoint;
}

/**
 * The OTTO-CLEAN ARM's joints on the plan, for the arm over the fast-charger stall at
 * (stallX, stallY, angle): its frame IS the parked car's (cleanArmPlacement), at the stall's
 * centre and parked heading.
 */
export function cleanArmPlanPoints(stallX: number, stallY: number, angleDeg: number, q: CleanJoints): CleanArmPlanPoints {
  const h = chargerParkedHeading(angleDeg);
  const at = (v: { x: number; z: number }) => carToPlan(stallX, stallY, h, v);
  const p = cleanArmPoints(q);
  return { j1: at(p.j1), elbow: at(p.elbow), mast: at(p.mastTop), pivot: at(p.pivot), knuckle: at(p.knuckle), tip: at(p.tip) };
}

/**
 * One door of a car on the plan: its hinge and its rear edge, the door panel's line seen from
 * above, swung out by `open01` (0 shut .. 1 open to DOOR.openDeg) as Vehicle3D swings it.
 */
export function doorPlanEdge(
  cx: number, cy: number, heading: number, side: 1 | -1, open01: number,
): { hinge: PlanPoint; edge: PlanPoint } {
  const h = doorHinge(side);
  const rear = doorPoint(side, open01, { x: DOOR.alongMin, y: 0, z: side * (CAR_WIDTH_M / 2 + DOOR.hingeOut) });
  return { hinge: carToPlan(cx, cy, heading, h), edge: carToPlan(cx, cy, heading, rear) };
}
