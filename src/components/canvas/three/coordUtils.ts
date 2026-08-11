/**
 * 2D: x=0..300 (west→east), y=0..220 (north=0, south=220).
 * 3D: east = -X, west = +X, north = +Z, south = -Z, y = up.
 *
 * X IS NEGATED (worldX = 150 - x2d). The naive worldX = x2d-150 made the
 * 2D→worldXZ map orientation-REVERSING (determinant -1), so the 3D was a
 * MIRROR of the 2D. Negating X makes it orientation-preserving; the CAMERA
 * presets + default camera were re-tuned to view from the SOUTH so the
 * primary top-down (Bird Eye) is north-up / east-right, matching the 2D.
 */
export function toWorld(
  pos2d: { x: number; y: number },
  height: number = 0.5
): [number, number, number] {
  const x3d = 150 - pos2d.x;
  const z3d = 110 - pos2d.y;
  return [x3d, height, z3d];
}

/**
 * Plan-frame heading θ (radians, 0 = +x = EAST, CCW positive, y-DOWN — the
 * KinematicCar / poseStore convention) → the three.js Y-rotation for a model
 * whose forward axis is +Z.
 *
 * This lives HERE, beside toWorld, because it is only correct for toWorld's
 * exact signs — and it must be the only place any yaw is derived. Derivation:
 * plan travel is (cos θ, sin θ); toWorld negates BOTH axes (Δwx = −Δx2d,
 * Δwz = −Δy2d), so world travel is (−cos θ, −sin θ) in (x, z); Ry(a) sends the
 * model's +Z to (sin a, cos a); therefore a = atan2(−cos θ, −sin θ).
 *
 * WHY THIS EXISTS: d879a23 negated toWorld's X but left three call sites
 * (Vehicle3D, Lanes3D, DriveAisles) on the pre-flip atan2(cos θ, −sin θ). That
 * mirrors yaw about the north–south axis — north and south stayed right, so it
 * went unnoticed, while everything travelling or parked EAST/WEST rendered
 * facing the opposite way. Perimeter staging parks cars at heading 0/π
 * (TwinMotionDriver.parkedHeading), i.e. the whole perimeter faced backwards.
 */
export function yawFromHeading2D(heading: number): number {
  return Math.atan2(-Math.cos(heading), -Math.sin(heading));
}

/**
 * Compass BEARING in degrees (0 = north, 90 = east) → the same Y-rotation.
 * Plan θ is measured from EAST and runs the other way round the clock, so
 * θ = bearing − 90°. Used by the painted lane arrows, which are authored in
 * compass terms because that is how a site plan reads.
 */
export function yawFromCompassDeg(bearingDeg: number): number {
  return yawFromHeading2D(((bearingDeg - 90) * Math.PI) / 180);
}

/**
 * Y of the DRIVABLE SURFACE — the asphalt overlay DepotGround lays over the
 * perimeter curb slab (curb top 0.24 + 0.02 of paving). Plan units.
 *
 * This is the depot's GRADE, and it has to be stated once rather than guessed
 * per component. Vehicle3D rests its tyres here and hangs the visible charge
 * port off it; depotPlacement mounts the OTTO-CHARGE ARM off the same datum.
 * When those two disagreed, the arm's connector arrived 0.26 units (12 cm)
 * below the port ring — nearly two ring radii, i.e. plainly wrong on camera.
 */
export const DECK_Y = 0.26;

// Verification (post-flip): east = -X, so viewed north-up east falls on the right.
// INGRESS {200,215} east => [-50, h, -105]
// EGRESS  {100,215} west => [ 50, h, -105]
// BESS_YARD ~{37,30} NW  => [ 113, h,  80]   (west+north)
// TEMP block ~{247,100}E => [-97, h,  10]    (east)
//
// Yaw verification (heading θ -> Ry, model forward +Z):
// θ=0     east  => -pi/2 => forward (-1, 0) = -X = east   OK
// θ=pi/2  south =>  pi   => forward ( 0,-1) = -Z = south  OK
// θ=pi    west  =>  pi/2 => forward (+1, 0) = +X = west   OK
// θ=-pi/2 north =>  0    => forward ( 0,+1) = +Z = north  OK
