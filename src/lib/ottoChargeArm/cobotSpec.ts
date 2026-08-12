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
 *   - The rendered car body is 4.2 plan units wide (2.010 m), so its flank is
 *     1.005 m from its own centreline.
 *   - Clear span from the pedestal centre to the car flank is therefore
 *     2.153 - 1.005 = 1.148 m.
 *   - A charge port sits roughly 0.55-1.05 m above grade across the fleet.
 *
 * ═══════════════ THAT CLEAR SPAN USED TO BE 1.347 m, AND IT SHRANK ══════════
 * The 3D car was built at 3.367 plan units wide while the cockpit drew, and the
 * traffic model budgeted, 4.2. Unifying them onto the real robotaxi width moved
 * the flank plane 0.199 m closer to the pedestal — 15% of the arm's entire
 * working span, taken away.
 *
 * A previous attempt resized the car and left the arm alone, on the strength of
 * all 26 arm tests passing unmodified. They passed because every one of them
 * measured the arm against a PLANE, a POINT or the DECK; none measured it
 * against the CAR. Measured properly, the two-link chain folded tighter to
 * reach the closer flank and swung the elbow housing 173 mm THROUGH the
 * bodywork, at 1098 of the 9922 poses that still solved at all — and 1148 more
 * would not solve. armClearance.test.ts is that measurement, its header states
 * the whole sweep, and it is why the numbers below moved.
 *
 * The arm is mounted on a plinth on the pedestal's car-facing flank at
 * MOUNT_HEIGHT_M, NOT on the cabinet roof at ~2.05 m — reaching down 1.4 m and
 * out 1.15 m from a roof mount needs a far larger, and far less believable,
 * arm. A higher mount is also strictly WORSE for clearance now: reaching down
 * to a low port drives the shoulder toward 90 deg, which is exactly the pose
 * that throws the elbow forward into the car.
 *
 * Maximum reach at scale 1.0 = upperArm + forearm + wrist + tool
 *               = 0.80 + 0.68 + 0.16 + 0.22 = 1.86 m, against a worst-case
 * required reach of ~1.29 m to a near-flank port.
 */
/**
 * Sizing multiplier on the whole machine — links AND housings.
 *
 * At 1.0 the arm is sized to the job and nothing more, and it reads at depot
 * camera range as an indistinct grey blob on top of a cabinet. Anything above
 * 1.0 is a DELIBERATE oversize for legibility, not a reach requirement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT WAS 1.5. IT CANNOT BE ANY MORE, AND THE REASON IS THE CAR.
 *
 * The binding constraint used to be the far-flank exclusion (a ceiling at
 * 1.5908, see below). It is now the near flank: at the real 2.010 m car width
 * the pedestal is 1.148 m from the bodywork, and a bigger arm has to fold
 * harder to reach an inlet that close. Measured over the whole duty cycle
 * against the drawn body:
 *
 *      ARM_SCALE   worst structural clearance   ports the arm REFUSES
 *        1.15          +0.1703 m                  0 of 9
 *        1.20          +0.1440 m   <- shipped     0 of 9
 *        1.25          +0.0885 m                  0 of 9
 *        1.30          +0.0335 m                  0 of 9
 *        1.40          -0.0730 m                  1 of 9   elbow in the bodywork
 *        1.50          -0.1706 m                  2 of 9   elbow deep inside it
 *
 * ONE sweep, ONE band, and both columns come out of it: mount 0.55 m, standoff
 * 0.30 m, studio LOD, the 9 ports on the corners and centre of along +/-1.00 m
 * x height 0.54-1.10 m, the whole duty cycle at 8 steps per phase, structure
 * only. Read the refusal column as "of these 9", not as a fleet figure — over
 * the full 126-port matrix the same two rows refuse 4 and 16.
 *
 * Over that full matrix — every OEM band corner plus the advertised window
 * corners — the shipped configuration measures +0.1206 m, and
 * armClearance.test.ts asserts >= 0.10 m and names the offending part when it
 * does not.
 *
 * So 1.20. The arm is visibly smaller than it was. That is the price of the
 * car being the size it always claimed to be, and it is the right way round:
 * an oversized robot that passes through the vehicle is not more legible, it
 * is wrong.
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
export const ARM_SCALE = 1.68;

/**
 * Lateral offset from the parked car's centreline to the pedestal, PLAN UNITS.
 *
 * THE ONE HOME for this number. It used to be stated twice — here as a `4.5`
 * baked into PEDESTAL_TO_CAR_CENTRE_M, and again in depotPlacement.ts, which
 * now imports it. Two homes for one physical distance is the same defect the
 * arm's motion timings had.
 *
 * ═══════════════════════════════════════════ WHY IT MOVED, 4.5 -> 6.0 ═══════
 * The founder asked for a 30-40% larger arm, for a more legible mate on screen.
 * At the old 4.5 pu it is not possible: the elbow drum fouls the CAR long
 * before then, because a long arm reaching a NEAR port has to fold, and folding
 * throws the elbow toward the bodywork. Measured over the duty cycle, worst
 * structural clearance to the drawn car at 4.5 pu:
 *
 *      ARM_SCALE 1.20   +0.1221 m   <- the old arm, and only 0.02 m of headroom
 *      ARM_SCALE 1.40   -0.0711 m
 *      ARM_SCALE 1.56   -0.2242 m
 *      ARM_SCALE 1.68   -0.3235 m   the requested +40%, a third of a metre
 *                                   INSIDE the car
 *
 * A bigger arm therefore needs MORE standoff, not less. Sweeping both together:
 *
 *      offset 5.25 pu, scale 1.68   CAR +0.0998 m   (on the 0.10 m margin)
 *      offset 6.00 pu, scale 1.68   CAR +0.3504 m   CABINET +0.2169 m, 0 refused
 *      offset 6.00 pu, scale 1.20   CAR +0.2640 m   but 2 ports UNREACHABLE
 *
 * The last line is the point: at 6.0 pu the OLD arm can no longer reach the
 * service window. The two changes are not independent tweaks that happen to
 * combine — each one requires the other. Together they give the arm nearly
 * three times its previous clearance to the car while making it 40% larger.
 *
 * Re-derive with `npx vitest run cabinetClearance` after touching either.
 */
export const PEDESTAL_OFFSET_PU = 6.0;

/** Depot-derived sizing at scale 1.0, metres. ARM_SCALE multiplies all of it. */
const BASE_LINKS = {
  shoulderHeight: 0.26,
  upperArm: 0.80,
  forearm: 0.68,
  wrist: 0.16,
  tool: 0.22,
  radii: { base: 0.115, shoulder: 0.095, upper: 0.070, elbow: 0.080, fore: 0.058, wristR: 0.050 },
} as const;

/**
 * The arm at an arbitrary scale.
 *
 * Exported so a test can MEASURE a candidate size instead of a human reading a
 * table and hoping it is still true. Every clearance figure in this file was
 * produced by sweeping this factory, and re-deriving them after a geometry
 * change is `armScaleSweep` in cabinetClearance.test.ts rather than a rewrite.
 */
export function cobotSpecAtScale(s: number): CobotSpec {
  return {
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
}

export const OTTO_CHARGE_ARM: CobotSpec = cobotSpecAtScale(ARM_SCALE);

/** Total kinematic reach from the shoulder axis to the connector tip, metres. */
export function maxReach(s: CobotSpec = OTTO_CHARGE_ARM): number {
  return s.upperArm + s.forearm + s.wrist + s.tool;
}

/**
 * Height of the arm's mount plate above grade, metres — a plinth on the
 * charger cabinet's car-facing flank.
 *
 * It was 0.70 m, chosen as the HIGHEST mount that still covered the service box
 * at the old 1.348 m flank standoff. Reach is no longer what decides it.
 *
 * At the real car width the deciding constraint is the elbow. A high mount and
 * a low port make the shoulder reach DOWN, which drives J2 toward 90 deg and
 * throws the elbow forward into the flank; a lower mount reaches slightly UP
 * and folds the elbow back. Measured over the whole duty cycle at ARM_SCALE
 * 1.2, worst structural clearance to the drawn body:
 *
 *      mount 0.45 m   +0.191 m
 *      mount 0.50 m   +0.166 m
 *      mount 0.55 m   +0.144 m   <- shipped
 *      mount 0.60 m   +0.124 m
 *      mount 0.70 m   +0.097 m   the old height
 *
 * (Same sweep as the ARM_SCALE table above, at scale 1.20.)
 *
 * The binding case is not in that band at all — it is the LOWEST corner of the
 * advertised service window, a 0.48 m port dead abeam the base, which no OEM
 * presents but which chargePort.ts promises. Measured over the full test
 * matrix there: 0.50 m -> +0.1397, 0.55 m -> +0.1206, 0.60 m -> +0.1071,
 * 0.70 m -> +0.0833.
 *
 * 0.55 m is the highest mount that keeps that corner above 0.12 m, and it
 * still reads as cabinet-mounted — a third of the way up a 1.72 m DCFC
 * cabinet, not sitting on the deck. armClearance.test.ts re-measures it.
 */
export const MOUNT_HEIGHT_M = 0.55;

/** Lateral distance from the DCFC pedestal centre to the parked car centreline, metres. */
export const PEDESTAL_TO_CAR_CENTRE_M = PEDESTAL_OFFSET_PU * METRES_PER_PLAN_UNIT; // 2.871 at 6.0 pu

/**
 * Where the near flank actually is, metres from the arm's base axis.
 *
 * DERIVED FROM THE CAR, never restated. It was a hard-coded 1.348 in
 * SERVICE_WINDOW below while vehicleBody built a 1.611 m wide car and the
 * traffic model steered a 2.010 m one; the constant agreed with the mesh, the
 * mesh disagreed with everything else, and the arm aimed at a flank plane no
 * drawn car had. Reading the width from traffic.ts means the standoff moves
 * when the car does, and the clearance test notices when that is a problem.
 */
export const FLANK_STANDOFF_M = PEDESTAL_TO_CAR_CENTRE_M - (CAR_WIDTH * METRES_PER_PLAN_UNIT) / 2;

/**
 * Service window on the vehicle's near flank — the region where a charge port
 * is guaranteed reachable AND the robot is guaranteed to clear the bodywork.
 *
 * This is a rectangle inside the largest fully-safe region, not the bounding
 * box of it. The distinction is load-bearing and cost a test failure to find:
 * the reachable set is lens-shaped, so its bounding box has unsafe CORNERS.
 * Clamping a port into that box and calling it safe would have been wrong.
 *
 * TWO conditions now, where there used to be one. "Reachable" was never enough:
 * an IK solution says the connector can be placed on the inlet, it says nothing
 * about what the elbow does on the way. At the real 2.010 m car width the
 * measured safe region — reachable at every point of the duty cycle AND at
 * least 0.10 m clear of the drawn body throughout — is
 *
 *              along +/-1.25 m   x   height 0.42-1.56 m
 *
 * and that rectangle is stated because the WHOLE of it was measured: a 51 x 41
 * grid, 2091 ports, each one a full duty-cycle sweep. 0 refused, worst 0.1007 m.
 *
 * Measuring the whole rectangle rather than its corners is the point. The lens
 * warning above says the corners can be the unsafe part, and they are at the
 * top — (+/-1.25, 1.56) is the 0.1007 m — but at the BOTTOM the worst point is
 * not a corner at all. Dead abeam the base a 0.40 m port measures 0.0995 m,
 * while the same height out at +/-1.25 m measures 0.1153 m, so the floor is set
 * by the middle of the edge and sits at 0.42 m. Four corner probes would have
 * put it at 0.40 and been wrong.
 *
 * This used to read +/-1.25 x 0.46-1.60, whose top corners measure 0.0931 m —
 * under the 0.10 m the sentence itself defines as safe.
 *
 * The window below sits comfortably inside the measured region, and comfortably
 * outside every OEM band in chargePort.ts, so the clamp there is not doing any
 * load-bearing work.
 *
 * Re-measure with armClearance.test.ts after changing any link length, the
 * mount height, the standoff, or the car.
 */
export const SERVICE_WINDOW = {
  /** Longitudinal, metres from the arm's base axis along the car. */
  alongMin: -1.00, alongMax: 1.00,
  /** Charge-port height above grade, metres. */
  heightMin: 0.48, heightMax: 1.44,
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
