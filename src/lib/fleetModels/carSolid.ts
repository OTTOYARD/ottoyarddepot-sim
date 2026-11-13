// A fleet vehicle as the solid the robots measure their clearance against (vehicleEnvelope.CarSolid): its side
// silhouette, convex, across its whole width. Conservative: the body is taken at full width at every height, and
// roof equipment is one cylinder as tall as the tallest sensor.
import type { CarSolid } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { MOUNT_HEIGHT_M, PEDESTAL_TO_CAR_CENTRE_M } from '@/lib/ottoChargeArm/cobotSpec';
import { makeSurface } from './surface';
import type { VehicleSpec } from './spec';

function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The vehicle parked at a charger, in the ARM's base frame, with the arm's base where a mate puts it.
 * @param toward the stall's facing sign: the arm's +X is the car's tail where it is +1
 * @param slideM, crossM where the base stands (mateSolver.Mate): the car is that far the other way in the base's frame
 */
export function fleetCarSolid(spec: VehicleSpec, toward: 1 | -1, slideM = 0, crossM = 0): CarSolid {
  const s = makeSurface(spec.curves);
  const L = s.length;
  const x = (xr: number) => -toward * (L / 2 - xr) - slideM;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 80; i++) {
    const xr = (L * i) / 80;
    const st = s.at(xr);
    pts.push([x(xr), st.yt], [x(xr), st.yb]);
  }
  const centreZ = PEDESTAL_TO_CAR_CENTRE_M - crossM;
  const d = spec.dims;
  const roof = spec.sensors.filter((q) => q.pos && q.pos[1] > (d.bodyHeight ?? d.height) - 0.2 && Math.abs(q.pos[2]) < 0.7);
  const top = roof.length ? Math.max(...roof.map((q) => q.pos![1] + (q.size?.[1] ?? 0.1))) : d.height;
  const podXr = roof.length ? roof.reduce((a, q) => a + q.pos![0], 0) / roof.length : L / 2;
  return {
    profile: hull(pts),
    zMin: centreZ - d.width / 2,
    zMax: centreZ + d.width / 2,
    wheels: [d.frontAxle, d.frontAxle + d.wheelbase].map((xr) => ({ along: x(xr), height: d.tyreRadius, radius: d.tyreRadius })),
    pod: { along: x(podXr), z: centreZ, radius: roof.length ? 0.6 : 0.01, yMin: (d.bodyHeight ?? d.height) - 0.05, yMax: top },
    gradeY: -MOUNT_HEIGHT_M,
  };
}
