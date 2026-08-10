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

/** Site-plan yardstick: 1 plan unit = 0.4785 m. */
export const METRES_PER_PLAN_UNIT = 0.4785;
/** Multiply metres by this to get depot plan units. */
export const PLAN_UNITS_PER_METRE = 1 / METRES_PER_PLAN_UNIT; // 2.08986...

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
 *   - The rendered car body is 2.2 * (7.5/4.9) = 3.367 plan units wide
 *     (1.611 m), so its flank is 0.806 m from its own centreline.
 *   - Clear span from the pedestal face to the car flank is therefore
 *     2.153 - 0.806 = 1.347 m.
 *   - A charge port sits roughly 0.55-0.90 m above grade across the fleet.
 *
 * The arm is mounted on a plinth on the pedestal's car-facing flank at
 * MOUNT_HEIGHT_M (0.70 m), NOT on the cabinet roof at ~2.05 m — reaching down
 * 1.4 m and out 1.35 m from a roof mount needs a far larger, and far less
 * believable, arm. That height is swept and verified, not chosen by eye.
 *
 * Maximum reach = upperArm + forearm + wrist + tool = 0.80 + 0.68 + 0.16 + 0.22
 *               = 1.86 m, against a worst-case required reach of ~1.42 m to a
 * near-flank port. That leaves ~0.44 m of margin to work fore/aft along the
 * car and to approach on the port normal rather than straight-on.
 */
export const OTTO_CHARGE_ARM: CobotSpec = {
  shoulderHeight: 0.26,
  shoulderOffset: 0.0,
  upperArm: 0.80,
  forearm: 0.68,
  wrist: 0.16,
  tool: 0.22,
  radii: { base: 0.115, shoulder: 0.095, upper: 0.070, elbow: 0.080, fore: 0.058, wristR: 0.050 },
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
 * Height of the arm's mount plate above grade, metres — a plinth on the
 * charger cabinet's car-facing flank.
 *
 * NOT a guess. scripts/verifyIK.mts sweeps 0.35-1.15 m and reports, for each,
 * whether the arm covers the whole required service box (along-car +/-1.00 m
 * x port height 0.50-1.10 m at a 1.348 m flank standoff). 0.70 m is the
 * HIGHEST mount that still covers the box completely, which is what we want:
 * it reads as cabinet-mounted rather than sitting on the deck, without giving
 * up any of the envelope. Re-run the verifier after changing any link length.
 */
export const MOUNT_HEIGHT_M = 0.70;

/**
 * Service window on the vehicle's near flank — the region where a charge port
 * is GUARANTEED reachable.
 *
 * This is the largest fully-reachable RECTANGLE, not the bounding box of the
 * reachable set. The distinction is load-bearing and cost a test failure to
 * find: the reachable set is lens-shaped, so its bounding box (+/-1.10 m x
 * 0.30-1.48 m) has unreachable CORNERS. Clamping a port into that box and
 * calling it safe would have been wrong. Every point in the rectangle below is
 * verified reachable — 5,151 samples, zero misses.
 *
 * Derived by scripts/window.mts. Re-run it after changing any link length.
 */
export const SERVICE_WINDOW = {
  /** Longitudinal, metres from the arm's base axis along the car. */
  alongMin: -1.00, alongMax: 1.00,
  /** Charge-port height above grade, metres. */
  heightMin: 0.48, heightMax: 1.44,
  /** Flank standoff this window was derived at, metres. */
  flankStandoff: 1.348,
} as const;

/** Lateral distance from the DCFC pedestal centre to the parked car centreline, metres. */
export const PEDESTAL_TO_CAR_CENTRE_M = 4.5 * METRES_PER_PLAN_UNIT; // 2.153

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
