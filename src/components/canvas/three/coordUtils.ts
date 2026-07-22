/**
 * 2D: x=0..300 (left-right), y=0..220 (north=0, south=220)
 * 3D: centered at origin. x=left/right, z=north(+)/south(-), y=up
 *
 * NOTE (2026-07-22): the 2D→worldXZ map has determinant -1 (orientation-
 * reversing), so a clean north-up top-down of the 3D is a MIRROR of the 2D.
 * The correct fix is to negate X here AND re-tune every CAMERA_PRESET's
 * viewpoint so all views stay consistent + north-up matches the 2D — a
 * verified pass, not a blind flip. Left un-flipped until that pass.
 */
export function toWorld(
  pos2d: { x: number; y: number },
  height: number = 0.5
): [number, number, number] {
  const x3d = pos2d.x - 150;
  const z3d = 110 - pos2d.y;
  return [x3d, height, z3d];
}

// Verification:
// INGRESS {200,215} => [50, h, -105]
// EGRESS  {100,215} => [-50, h, -105]
// QUEUE_Y 185       => z = -75
// Building y~20     => z = 90
