// Zoox purpose-built robotaxi. Bidirectional: "front" here is one end only by convention.
// Sources and what is assumed: docs/FLEET-MODELS.md.
import type { Pt } from '../surface';
import type { SensorSpec, VehicleSpec } from '../spec';

const L = 3.63;
const HW = 0.915;
const FA = 0.42;
const WB = 2.79;

// One sensor cluster on a stalk at each roof corner.
function corner(name: string, xr: number, side: -1 | 1, fwd: 1 | -1): SensorSpec[] {
  const z = side * 0.9;
  const yaw = fwd > 0 ? side * 45 : side * 135;
  return [
    { id: `arm_${name}`, type: 'pod', shape: 'box', pos: [xr, 1.74, side * 0.84], size: [0.09, 0.07, 0.2], note: 'Corner sensor pod: lidar, radar, cameras and long-wave infrared, about 270 degrees of view' },
    { id: `pod_${name}`, type: 'pod', shape: 'box', pos: [xr, 1.72, z + side * 0.04], size: [0.14, 0.11, 0.14], yawDeg: yaw },
    { id: `lidar_${name}_top`, type: 'lidar', shape: 'spinLidar', pos: [xr, 1.775, z + side * 0.04], size: [0.05, 0.13] },
    { id: `lidar_${name}_low`, type: 'lidar', shape: 'puckLidar', pos: [xr, 1.66, z + side * 0.04], size: [0.035, 0.04], yawDeg: yaw },
    { id: `cam_${name}_a`, type: 'camera', shape: 'camera', pos: [xr - fwd * 0.07, 1.72, z + side * 0.04], size: [0.016, 0.02], yawDeg: fwd > 0 ? 0 : 180 },
    { id: `cam_${name}_b`, type: 'camera', shape: 'camera', pos: [xr, 1.72, z + side * 0.115], size: [0.016, 0.02], yawDeg: side * 90 },
    { id: `cam_${name}_c`, type: 'camera', shape: 'camera', pos: [xr - fwd * 0.05, 1.7, z + side * 0.09], size: [0.016, 0.02], yawDeg: yaw },
    { id: `thermal_${name}`, type: 'thermal', shape: 'camera', pos: [xr - fwd * 0.05, 1.745, z + side * 0.09], size: [0.012, 0.02], yawDeg: yaw },
    { id: `radar_${name}`, type: 'radar', shape: 'radar', pos: [xr - fwd * 0.05, 1.655, z + side * 0.085], size: [0.012, 0.04, 0.06], yawDeg: yaw },
  ];
}

export const zoox: VehicleSpec = {
  key: 'zoox_robotaxi',
  name: 'Zoox robotaxi',
  operator: 'Zoox',
  maker: 'Zoox',
  provenance: {
    dimensions: "Published length 3.63 m and height 1.936 m. Width (about 1.83 m, \"nearly six feet\"), wheelbase, track and tyres are estimated from photographs.",
    doors: "Two glass sliding panels a side that part from the middle. Travel is estimated.",
    sensors: "Published: a sensor pod at each of the four roof corners with lidar, radar, cameras and long-wave infrared, about 270 degrees each. Counts per pod are not published; what is drawn is illustrative.",
    chargePort: "Not published; none is drawn.",
  },
  dims: { length: L, width: 1.83, height: 1.936, bodyHeight: 1.885, wheelbase: WB, frontAxle: FA, track: 1.6, tyreRadius: 0.37, tyreWidth: 0.225, rimRadius: 0.27 },
  finish: 'metallic',
  curves: {
    length: L,
    top: [[0, 1.0], [0.08, 1.3], [0.34, 1.78], [0.7, 1.87], [L / 2, 1.885], [L - 0.7, 1.87], [L - 0.34, 1.78], [L - 0.08, 1.3], [L, 1.0]],
    bottom: [[0, 0.32], [0.4, 0.22], [L - 0.4, 0.22], [L, 0.32]],
    plan: [[0, 0.7], [0.35, 0.86], [0.8, HW], [L - 0.8, HW], [L - 0.35, 0.86], [L, 0.7]],
    belt: [[0, 0.6], [0.3, 0.62], [L - 0.3, 0.62], [L, 0.6]],
    rail: [[0, 0.98], [0.1, 1.24], [0.4, 1.72], [0.78, 1.82], [L - 0.78, 1.82], [L - 0.4, 1.72], [L - 0.1, 1.24], [L, 0.98]],
    railPlan: [[0, 0.6], [0.4, 0.75], [0.8, 0.81], [L - 0.8, 0.81], [L - 0.4, 0.75], [L, 0.6]],
    cap: { front: { y: 0.62, plan: 0.3, elev: 0.16, p: 3 }, rear: { y: 0.62, plan: 0.3, elev: 0.16, p: 3 } },
    style: { tuck: 0.04, barrel: 0.02, crown: 0.35, glassBow: 0.03 },
  },
  colors: { paint: 0x86a79f, paint2: 0x0c0d0f, interior: 0x3a3c3f, rim: 0xc9cdd0 },
  wheelStyle: 'paddle',
  archRadius: 0.405,
  doors: () => {
    const a: Pt[] = [[2.6, 1.2], [9, 1.2]];
    const m: Pt[] = [[2.6, L / 2], [9, L / 2]];
    const c: Pt[] = [[2.6, L - 1.2], [9, L - 1.2]];
    return ([-1, 1] as const).flatMap((side) => [
      { id: side < 0 ? 'FL' : 'FR', side, kind: 'slide' as const, front: a, rear: m, ttLow: 2.8, ttHigh: 8.25, travel: 0.6, slideDir: 1 as const, popOut: 0.1 },
      { id: side < 0 ? 'RL' : 'RR', side, kind: 'slide' as const, front: m, rear: c, ttLow: 2.8, ttHigh: 8.25, travel: 0.6, slideDir: -1 as const, popOut: 0.1 },
    ]);
  },
  regions: (_s, h) => [
    // Each door is almost all glass.
    { material: 'glassDark', fields: h.sideGlass([[1.26, 0.07], [1.79, 0.07], [1.79, 0.95], [1.26, 0.95]], 0.02) },
    { material: 'glassDark', fields: h.sideGlass([[1.84, 0.07], [L - 1.26, 0.07], [L - 1.26, 0.95], [1.84, 0.95]], 0.02) },
    { material: 'glassBlack', fields: h.sideGlass([[1.18, 0.0], [L - 1.18, 0.0], [L - 1.18, 1.04], [1.18, 1.04]], 0.03) },
    // End glass and the dark fascia under it, both ends.
    { material: 'lampHead', fields: h.endPatch('front', [[-0.2, 1.66], [0.6, 1.66], [0.6, 1.685], [-0.2, 1.685]], 0.004, 0.5) },
    { material: 'lampTail', fields: h.endPatch('rear', [[-0.2, 1.66], [0.6, 1.66], [0.6, 1.685], [-0.2, 1.685]], 0.004, 0.5) },
    { material: 'glassDark', fields: h.endPatch('front', [[-0.2, 1.0], [0.7, 1.0], [0.64, 1.76], [-0.2, 1.76]], 0.04, 0.6) },
    { material: 'glassDark', fields: h.endPatch('rear', [[-0.2, 1.0], [0.7, 1.0], [0.64, 1.76], [-0.2, 1.76]], 0.04, 0.6) },
    { material: 'lampHead', fields: h.endPatch('front', [[0.44, 0.66], [0.62, 0.66], [0.62, 0.84], [0.44, 0.84]], 0.02, 0.4) },
    { material: 'lampTail', fields: h.endPatch('rear', [[0.44, 0.66], [0.62, 0.66], [0.62, 0.84], [0.44, 0.84]], 0.02, 0.4) },
    { material: 'cladding', fields: h.endPatch('front', [[-0.2, 0.2], [0.8, 0.2], [0.8, 0.95], [-0.2, 0.95]], 0.03, 0.34) },
    { material: 'cladding', fields: h.endPatch('rear', [[-0.2, 0.2], [0.8, 0.2], [0.8, 0.95], [-0.2, 0.95]], 0.03, 0.34) },
    // Black wheel housings.
    { material: 'cladding', fields: [(p) => Math.hypot(p.xr - FA, p.y - 0.37) - 0.56, (p) => p.tt - 6.6] },
    { material: 'cladding', fields: [(p) => Math.hypot(p.xr - (FA + WB), p.y - 0.37) - 0.56, (p) => p.tt - 6.6] },
    { material: 'cladding', fields: h.below([[0, 0.3], [L, 0.3]], 6) },
  ],
  sensors: [
    ...corner('fl', 0.4, -1, 1), ...corner('fr', 0.4, 1, 1), ...corner('rl', L - 0.4, -1, -1), ...corner('rr', L - 0.4, 1, -1),
    { id: 'roof_f', type: 'pod', shape: 'box', pos: [0.72, 1.906, 0], size: [0.22, 0.06, 0.16], note: 'Roof antenna and sensor housing' },
    { id: 'roof_r', type: 'pod', shape: 'box', pos: [L - 0.72, 1.906, 0], size: [0.22, 0.06, 0.16], note: 'Roof antenna and sensor housing' },
  ],
  seats: [
    { xr: 0.98, z: 0, facing: -1, width: 1.2 },
    { xr: L - 0.98, z: 0, facing: 1, width: 1.2 },
  ],
  steeringWheel: false,
};
