/**
 * 2D: x=0..300 (left-right), y=0..220 (north=0, south=220)
 * 3D: centered at origin. x=left/right, z=north(+)/south(-), y=up
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
// INGRESS {100,215} => [-50, h, -105] (south-left)
// EGRESS  {200,215} => [50, h, -105]  (south-right)
// QUEUE_Y 185       => z = -75
// Building y~20     => z = 90
