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
