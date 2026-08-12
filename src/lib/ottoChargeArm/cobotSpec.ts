/**
 * OTTOYARD OTTO-CHARGE ARM — kinematic + dimensional specification.
 *
 * ============================== UNITS ==============================
 * EVERYTHING IN THIS FILE IS IN METRES. glTF is a metre-denominated format,
 * so the exported .glb is metre-true and will drop correctly into any
 * standard DCC tool (Blender, Omniverse, Unreal with the right import scale).
 *
 * The OTTOYARD depot renderer does NOT work in metres. Its 3D world is 1:1
 * with the 2D site-plan grid, where 1 plan unit = 0.4785 m. Anything authored
 * in metres and dropped into that world without conversion renders at ~48%
 * of its true size — the same class of defect that made Vehicle3D a toy car.
 * Use PLAN_UNITS_PER_METRE below at the single point of insertion.
 * ===================================================================
 */

import { CAR_WIDTH } from '@/engine/motion/traffic';
import { pedestalBoxes } from '@/components/canvas/three/pedestalGeometry';

/** Site-plan yardstick: 1 plan unit = 0.4785 m. */
export const METRES_PER_PLAN_UNIT = 0.4785;
/** Multiply metres by this to get depot plan units. */
export const PLAN_UNITS_PER_METRE = 1 / METRES_PER_PLAN_UNIT; // 2.08986...

/**
 * Lateral offset from a charging stall's centre to its charger pedestal, plan
 * units — ChargingField.tsx's gas-pump layout rule.
 *
 * It is DEFINED here and re-exported by depotPlacement.ts, which is where the
 * renderer imports it from. Both files used to state 4.5 independently, and
 * everything below that calls itself "depot-derived" derives from this one.
 */
export const PEDESTAL_OFFSET_PU = 4.5;

export interface CobotSpec {
  /** Height of the shoulder pitch axis above the arm's mount plate. */
  shoulderHeight: number;
  /** Lateral offset of the shoulder axis from the base yaw axis (link offset). */
  shoulderOffset: number;
  /** Upper arm: shoulder pitch axis -> elbow pitch axis. */
  upperArm: number;
  /** Forearm: elbow pitch axis -> wrist pitch axis. */
  forearm: number;
  /** Wrist pitch axis -> tool flange face. */
  wrist: number;
  /** Tool flange face -> connector tip (the TCP). */
  tool: number;
  /** Radii used for the cast housings, purely cosmetic. */
  radii: { base: number; shoulder: number; upper: number; elbow: number; fore: number; wristR: number };
  /** Joint limits in radians. */
  limits: {
    j1: [number, number]; // base yaw
    j2: [number, number]; // shoulder pitch
    j3: [number, number]; // elbow pitch
    j4: [number, number]; // wrist pitch
    j5: [number, number]; // wrist roll
    j6: [number, number]; // tool roll
  };
}

/**
 * Link lengths are sized to the ACTUAL depot geometry, not to a catalogue arm:
 *
 *   - The DCFC pedestal stands 4.5 plan units (2.153 m) from the stall centre,
 *     i.e. from the parked car's centreline.
 *   - The arm is bolted to the cabinet's CAR-FACING FACE, ARM_MOUNT_OFFSET_M
 *     = 0.317 m in front of the pedestal axis, so its own base axis stands
 *     1.836 m from the car's centreline.
 *   - The rendered car body is 4.2 plan units wide (2.010 m), so its flank is
 *     1.005 m from its own centreline.
 *   - Clear span from the ARM'S BASE to the car flank is therefore
 *     1.836 - 1.005 = 0.831 m.
 *   - A charge port sits roughly 0.55-1.05 m above grade across the fleet.
 *
 * ══════════ THAT CLEAR SPAN WAS 1.148 m UNTIL THE MOUNT WAS PUT ON THE ══════
 * ══════════ FACE IT ALWAYS CLAIMED TO BE ON ═════════════════════════════════
 * This comment used to say the arm was "mounted on a plinth on the pedestal's
 * car-facing flank". It was not: placeArm() put the J1 axis on the pedestal's
 * CENTRE, and the whole mount and the bottom of the arm sat 0.1675 m INSIDE the
 * drawn cabinet. See ARM_MOUNT_OFFSET_M.
 *
 * Putting the mount where the drawing says costs span, because a mount on a
 * face is the cabinet's half-depth plus the plinth's half-depth further out.
 * With the cabinet drawn 1.5 plan units DEEP toward the car that came to
 * 0.509 m and left the arm 0.640 m to work in. Turning the cabinet to present
 * its 1.5-unit frontage to the car instead — see pedestalGeometry.ts — drops
 * the offset to 0.317 m and gives 0.191 m of it straight back. The cabinet did
 * not change size; it changed which way it faces, and the arm keeps its span.
 *
 * ═══════════════ THE SPAN ALSO SHRANK ONCE BEFORE, AND THAT MATTERED ════════
 * The 3D car was built at 3.367 plan units wide while the cockpit drew, and the
 * traffic model budgeted, 4.2. Unifying them onto the real robotaxi width moved
 * the flank plane 0.199 m closer.
 *
 * A previous attempt resized the car and left the arm alone, on the strength of
 * all 26 arm tests passing unmodified. They passed because every one of them
 * measured the arm against a PLANE, a POINT or the DECK; none measured it
 * against the CAR. Measured properly, the two-link chain folded tighter to
 * reach the closer flank and swung the elbow housing 173 mm THROUGH the
 * bodywork, at 1098 of the 9922 poses that still solved at all — and 1148 more
 * would not solve. armClearance.test.ts is that measurement, its header states
 * the whole sweep, and it is why the numbers below moved. The mount offset is
 * the same class of defect against the CHARGER, and pedestalClearance.test.ts
 * is the measurement that closes it.
 *
 * The arm is mounted at MOUNT_HEIGHT_M on the cabinet's car-facing face, NOT on
 * the cabinet roof at ~2.05 m — reaching down 1.4 m from a roof mount needs a
 * far larger, and far less believable, arm, and the roof is where the LED strip
 * and the power cap are.
 *
 * Maximum reach at scale 1.0 = upperArm + forearm + wrist + tool
 *               = 0.80 + 0.68 + 0.16 + 0.22 = 1.86 m, so 1.339 m at the shipped
 * ARM_SCALE, against a worst-case required reach of 1.297 m — shoulder axis to
 * connector tip, at the LOW far corner of the service window (along -0.70 m,
 * height 0.49 m). That 42 mm is the whole margin, and it is why the along
 * window is where it is: the bottom corners are what run out of arm first.
 */
/**
 * Sizing multiplier on the whole machine — links AND housings.
 *
 * BASE_LINKS below was sized for a 1.148 m clear span, so at 1.0 the arm was
 * "sized to the job and nothing more" FOR A JOB IT NO LONGER HAS. The job is
 * now a 0.831 m span, and this multiplier is what sizes the machine to it.
 * Below 1.0 is not a stylistic choice; it is the mount being on the face of the
 * cabinet instead of buried in the middle of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT WAS 1.20, AND IT IS SQUEEZED FROM BOTH ENDS.
 *
 * TOO BIG and the elbow leaves the corridor: the arm has 0.831 m in front of it
 * and the charger 0.150 m behind, and a bigger arm folds harder to reach an
 * inlet that close. TOO SMALL and it cannot reach the corners of its own
 * service window at all — the bottom corners need 1.297 m of shoulder-to-tip
 * reach and the arm only has 1.86 * ARM_SCALE. Measured over the whole duty
 * cycle, against the drawn body:
 *
 *      ARM_SCALE   worst structural clearance   ports the arm REFUSES
 *        0.60          +0.1320 m                  6 of 9   cannot reach them
 *        0.66          +0.1452 m                  2 of 9   cannot reach them
 *        0.72          +0.1205 m   <- shipped     0 of 9
 *        0.78          +0.0889 m                  0 of 9
 *        0.84          +0.0575 m                  0 of 9
 *        0.90          +0.0232 m                  0 of 9   elbow grazing the car
 *
 * ONE sweep, ONE band, and both columns come out of it: mount 0.80 m, standoff
 * 0.20 m, studio LOD, the 9 ports on the corners and centre of the advertised
 * window (along +/-0.70 m x height 0.49-1.11 m), the whole duty cycle at 8
 * steps per phase, structure only.
 *
 * 0.72 is the only row that both reaches everything and keeps the 0.10 m
 * margin, and it is nearly centred between the two failures rather than
 * pressed against either. Over the full 135-target matrix — every OEM band
 * corner as chargePort resolves it, plus the advertised window corners — the
 * shipped configuration measures +0.1243 m over 11070 poses, and
 * armClearance.test.ts asserts >= 0.10 m and names the offending part when it
 * does not.
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OLD CEILING IS STILL THERE, AND IT MOVED UP.
 *
 * chargePort.ts rests on a load-bearing claim: a pedestal arm CANNOT serve a
 * port on the vehicle's far flank, which is why an AV must present its inlet to
 * the charger and why OTTO-Q may not assign a stall on the wrong side. That
 * claim is only true while the arm is short enough. A WIDER car puts the far
 * flank further away, so this ceiling rose — it is no longer the binding one.
 * kinematics.test.ts recomputes it from the spec rather than trusting any
 * number written here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const ARM_SCALE = 0.72;

/** Depot-derived sizing at scale 1.0, metres. ARM_SCALE multiplies all of it. */
const BASE_LINKS = {
  shoulderHeight: 0.26,
  upperArm: 0.80,
  forearm: 0.68,
  wrist: 0.16,
  tool: 0.22,
  radii: { base: 0.115, shoulder: 0.095, upper: 0.070, elbow: 0.080, fore: 0.058, wristR: 0.050 },
} as const;

const s = ARM_SCALE;
export const OTTO_CHARGE_ARM: CobotSpec = {
  shoulderHeight: BASE_LINKS.shoulderHeight * s,
  shoulderOffset: 0.0,
  upperArm: BASE_LINKS.upperArm * s,
  forearm: BASE_LINKS.forearm * s,
  wrist: BASE_LINKS.wrist * s,
  tool: BASE_LINKS.tool * s,
  // Housings scale too. The tubes are what actually make it read as a machine
  // rather than a stick, and at 1.0 the forearm is a 116 mm pipe seen from tens
  // of metres away.
  radii: {
    base: BASE_LINKS.radii.base * s,
    shoulder: BASE_LINKS.radii.shoulder * s,
    upper: BASE_LINKS.radii.upper * s,
    elbow: BASE_LINKS.radii.elbow * s,
    fore: BASE_LINKS.radii.fore * s,
    wristR: BASE_LINKS.radii.wristR * s,
  },
  // Limits match the SPHERICAL-WRIST architecture (J4 roll, J5 pitch, J6 roll).
  // Roll joints get full rotation, as they do on any real cobot; the earlier
  // +/-0.8pi on J4 was left over from when J4 was a pitch, and it rejected
  // perfectly ordinary straight-ahead targets that need a 180 deg forearm roll.
  limits: {
    j1: [-Math.PI, Math.PI],                       // base yaw
    j2: [-Math.PI * 0.75, Math.PI * 0.75],         // shoulder pitch
    j3: [-Math.PI * 0.90, Math.PI * 0.90],         // elbow pitch
    j4: [-Math.PI, Math.PI],                       // forearm roll
    j5: [-Math.PI, Math.PI],                       // wrist pitch
    j6: [-Math.PI, Math.PI],                       // tool roll
  },
};

/** Total kinematic reach from the shoulder axis to the connector tip, metres. */
export function maxReach(s: CobotSpec = OTTO_CHARGE_ARM): number {
  return s.upperArm + s.forearm + s.wrist + s.tool;
}

/**
 * Height of the arm's mount plate above grade, metres — a plinth bolted to the
 * charger cabinet's car-facing face.
 *
 * TWO constraints now pull in opposite directions, where there used to be one.
 *
 * DOWNWARD: a high mount reaching to a low port drives J2 toward 90 deg and
 * throws the elbow forward into the flank. That is what took this from 0.70 m
 * to 0.55 m when the car was widened.
 *
 * UPWARD, and it is new: the arm is bolted to the cabinet, 0.150 m in front of
 * a 1.72 m wall of it. Reaching to a HIGH port swings the upper arm and its
 * dress pack BACKWARD, and a low mount puts that swing squarely into the
 * cabinet. Nothing measured this before — the arm was inside the cabinet
 * already, so there was nothing to notice.
 *
 * Measured over the whole duty cycle at ARM_SCALE 0.72, standoff 0.20 m, over
 * the 9 corner-and-centre ports of the advertised window:
 *
 *      mount    clearance to the CAR   clearance to the CHARGER   refused
 *      0.60 m       +0.1397 m               -0.0368 m             0 of 9
 *      0.70 m       +0.1247 m               -0.0017 m             0 of 9
 *      0.80 m       +0.1205 m               +0.0437 m             0 of 9  <- shipped
 *      0.90 m       +0.1263 m               +0.0470 m             2 of 9
 *      1.00 m       +0.1257 m               +0.0470 m             2 of 9
 *
 * Both failures are real and neither was visible before. Below 0.80 m the arm
 * reaching for the TOP of the window swings its upper-arm dress pack back into
 * the cabinet — at 0.70 m by 1.7 mm, which is nothing and is still inside the
 * charger. Above 0.80 m it can no longer reach the bottom corners at all.
 *
 * 0.80 m is the only height that clears both, and it still reads as
 * cabinet-mounted — 48% of the way up a 1.723 m DCFC cabinet, not sitting on
 * the deck and not on the roof. armClearance.test.ts re-measures the car
 * column; pedestalClearance.test.ts re-measures the charger column.
 */
export const MOUNT_HEIGHT_M = 0.80;

/**
 * The plate that bolts the arm to the charger, metres.
 *
 * Authored here rather than in buildCobot.ts, which draws it, because
 * ARM_MOUNT_OFFSET_M is derived from its depth: the plate's back edge is the
 * face that lands on the cabinet, so the plate's size decides where the whole
 * machine stands.
 */
export const MOUNT_PLATE = { width: 0.30, thickness: 0.026, depth: 0.30 } as const;

/**
 * The collar that clamps the arm's base to that plate, metres.
 *
 * NEITHER OF THESE SCALES WITH ARM_SCALE, deliberately: the mount is depot
 * hardware, not part of the machine. A larger or smaller arm still bolts to the
 * same cabinet, through the same face, with the same fasteners. That makes the
 * collar the FATTEST-per-facet primitive on the whole rig once ARM_SCALE drops
 * below about 1.0, which is why armClearance.ts's sampling bound reads it.
 */
export const MOUNT_COLLAR = {
  rTop: 0.135, rBottom: 0.155, height: 0.055, segments: 24,
} as const;

/**
 * How far toward the car the arm's J1 axis stands off the PEDESTAL AXIS, metres.
 *
 * ═════════════════════ THE ARM USED TO BE INSIDE THE CHARGER ════════════════
 * This was 0. placeArm() put the J1 axis on the pedestal's centre, and the DCFC
 * cabinet was drawn 1.5 plan units — 0.718 m — DEEP TOWARD THE CAR. Measured
 * over the full duty cycle against the drawn boxes, Mount_Collar, Mount_Bolts,
 * Mount_CableGland, Base_Housing, Shoulder_Yoke and the lower UpperArm all sat
 * 0.1675 m INSIDE the cabinet, in every pose, at every stall. The comment below
 * said the arm was "mounted on a plinth on the pedestal's car-facing flank"; it
 * was mounted in the middle of the pedestal. Nothing caught it because nothing
 * had ever compared the arm to the charger — the same hole vehicleEnvelope.ts
 * exists to close for the car, and pedestalEnvelope.ts now closes for this.
 *
 * So the mount moves out onto the face it always claimed to be on: half the
 * cabinet's DEPTH, plus the mount plate's own half-depth, which puts the plate's
 * back edge flat on the cabinet and the whole machine in front of it.
 *
 * ONLY THE DEPTH IS IN THAT SUM, which is why the cabinet was also turned to
 * face the car with its 1.5-unit frontage rather than its depth (see
 * pedestalGeometry.ts). Off the old orientation this offset came to 0.509 m and
 * left the arm 0.640 m of working span; off the turned one it is 0.317 m and
 * leaves 0.831 m. Same cabinet, same plinth, 0.191 m of span — the difference
 * between an arm at ARM_SCALE 0.50 serving +/-0.42 m of the flank and one at
 * 0.72 serving +/-0.70 m.
 */
export const ARM_MOUNT_OFFSET_M =
  (pedestalBoxes(true).cabinet.size[0] / 2) * METRES_PER_PLAN_UNIT + MOUNT_PLATE.depth / 2;

/** Lateral distance from the DCFC pedestal AXIS to the parked car centreline, metres. */
export const PEDESTAL_TO_CAR_CENTRE_M = PEDESTAL_OFFSET_PU * METRES_PER_PLAN_UNIT; // 2.153

/**
 * Lateral distance from the ARM'S BASE AXIS to the car centreline, metres.
 *
 * NOT the same as PEDESTAL_TO_CAR_CENTRE_M any more, and the distinction is the
 * whole point of this change: the arm stands ARM_MOUNT_OFFSET_M in front of the
 * pedestal axis. Every frame the arm package works in — the car solid, the port
 * target, the flank plane — is measured from HERE, not from the pedestal.
 */
export const ARM_BASE_TO_CAR_CENTRE_M = PEDESTAL_TO_CAR_CENTRE_M - ARM_MOUNT_OFFSET_M;

/**
 * Where the near flank actually is, metres from the arm's base axis.
 *
 * DERIVED FROM THE CAR AND FROM THE MOUNT, never restated. It was a hard-coded
 * 1.348 in SERVICE_WINDOW below while vehicleBody built a 1.611 m wide car and
 * the traffic model steered a 2.010 m one; the constant agreed with the mesh, the
 * mesh disagreed with everything else, and the arm aimed at a flank plane no
 * drawn car had. Reading the width from traffic.ts means the standoff moves
 * when the car does, and reading the base offset from the drawn cabinet means it
 * moves when the mount does. The clearance tests notice when either is a problem.
 */
export const FLANK_STANDOFF_M = ARM_BASE_TO_CAR_CENTRE_M - (CAR_WIDTH * METRES_PER_PLAN_UNIT) / 2;

/**
 * Service window on the vehicle's near flank — the region where a charge port
 * is guaranteed reachable AND the robot is guaranteed to clear the bodywork.
 *
 * This is a rectangle inside the largest fully-safe region, not the bounding
 * box of it. The distinction is load-bearing and cost a test failure to find:
 * the reachable set is lens-shaped, so its bounding box has unsafe CORNERS.
 * Clamping a port into that box and calling it safe would have been wrong.
 *
 * THREE conditions now, where there used to be one. "Reachable" was never
 * enough: an IK solution says the connector can be placed on the inlet, it says
 * nothing about what the elbow does on the way — and since the arm is bolted to
 * the charger, it says nothing about what the elbow does BEHIND it either. A
 * port is in the window when the whole duty cycle for it is reachable, at least
 * 0.10 m clear of the drawn car, AND entirely outside the drawn pedestal.
 *
 * The window below is stated because THE WHOLE OF IT WAS MEASURED, not its
 * corners: a 21 x 17 grid over the rectangle, 357 ports, 22848 poses.
 *
 *      0 refused
 *      worst clearance to the CAR      +0.1205 m  (dead abeam, at the 0.49 m
 *                                                  floor, connector fully mated)
 *      worst clearance to the CHARGER  +0.0437 m  (dead abeam, at the 1.11 m
 *                                                  ceiling, end of 'approach')
 *
 * Measuring the whole rectangle rather than its corners is the point — the
 * reachable set is lens-shaped, so its bounding box has unsafe CORNERS, and
 * both worst cases above turn out to be in the MIDDLE of an edge rather than at
 * a corner. Four corner probes would have missed both.
 *
 * There is real headroom around it: +/-0.73 x 0.48-1.12 still measures 0
 * refused, +0.1159 m and +0.0385 m. +/-0.75 x 0.47-1.13 refuses 2 of 357, so
 * the edge of the safe region is between them and the shipped window is inside
 * it on every side.
 *
 * ═══════════════════════ WHAT MOVED, AND WHAT IT COSTS ══════════════════════
 * It was +/-1.00 m x 0.48-1.44 m. Both ends changed for different reasons.
 *
 * HEIGHT lost its top and that costs nothing: no OEM in chargePort.ts presents
 * an inlet above 1.05 m, so 1.44 m was reach the depot advertised and never
 * used. Height is also the one axis that CANNOT be clamped — a van's inlet is
 * 1.05 m off the ground wherever it parks — so the window is sized so it never
 * has to be. chargePort clamps into [min + 0.06, max - 0.06] and the OEM band
 * is 0.55-1.05 m, so this window has to reach 0.49 m and 1.11 m, and does.
 *
 * ALONG lost 0.30 m at each end, and that is a real reduction: the arm is
 * shorter because its mount moved onto the cabinet face. THE CLAMP IN
 * chargePort.ts IS NOW PARTLY LOAD-BEARING. The Tesla, Waymo and Motional bands
 * all extend past -0.64 m (the window less the clamp margin), so the aft half
 * of each is pulled to the window edge; the near half passes through untouched.
 * That is the documented model — "the AV stops so the inlet lands inside the
 * arm's service window" — but it is now a parking requirement of up to 0.31 m
 * rather than a formality, and chargePort.ts says so.
 *
 * Re-measure with armClearance.test.ts and pedestalClearance.test.ts after
 * changing any link length, the mount height or offset, the standoff, or the
 * car.
 */
export const SERVICE_WINDOW = {
  /** Longitudinal, metres from the arm's base axis along the car. */
  alongMin: -0.70, alongMax: 0.70,
  /** Charge-port height above grade, metres. */
  heightMin: 0.49, heightMax: 1.11,
  /** Flank standoff this window was derived at, metres. */
  flankStandoff: FLANK_STANDOFF_M,
} as const;

/**
 * Named joints, in kinematic order. These strings are written into the .glb as
 * node names, so a consumer can look them up and drive the arm directly.
 *
 * They describe a SPHERICAL WRIST: J4 rolls the forearm, J5 pitches, J6 rolls
 * the tool, and all three axes intersect at one point. (An earlier revision
 * named these J4_WristPitch / J5_WristRoll, from a three-parallel-pitch layout
 * that could not aim the connector off the arm's plane.)
 */
export const JOINT_NAMES = [
  'J1_BaseYaw',
  'J2_Shoulder',
  'J3_Elbow',
  'J4_ForearmRoll',
  'J5_WristPitch',
  'J6_ToolRoll',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];

/** The empty node marking the connector tip — the point that must land on the port. */
export const TCP_NODE_NAME = 'TCP_ConnectorTip';
