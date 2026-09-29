/**
 * Instance-matrix maths for the instanced fleet (Vehicle3D.VehicleFleet), pure
 * so it can be pinned against three's own Object3D composition — the car used
 * to be a <group position rotation-y> with the port a nested group, and what
 * the instanced version writes must be that same transform (fleetMath.test.ts).
 */

/** Column-major Ry(yaw) then translate, written straight into a matrix array. */
export function writeYaw(a: Float32Array, i: number, x: number, y: number, z: number, yaw: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw), o = i * 16;
  a[o] = c; a[o + 1] = 0; a[o + 2] = -s; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
export function writeZero(a: Float32Array, i: number): void { a.fill(0, i * 16, i * 16 + 16); }

/**
 * The charge port's world pose: the car at (x, 0, z) turned `yaw`, the port
 * group at `pos` in the car's frame turned `portYaw` about Y. Writes into `out`.
 */
export function portWorld(
  x: number, z: number, yaw: number, pos: readonly [number, number, number], portYaw: number,
  out: { x: number; y: number; z: number; yaw: number },
): { x: number; y: number; z: number; yaw: number } {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const [px, py, pz] = pos;
  out.x = x + c * px + s * pz;
  out.y = py;
  out.z = z - s * px + c * pz;
  out.yaw = yaw + portYaw;
  return out;
}
