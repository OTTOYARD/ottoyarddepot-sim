// Lucid Gravity with the Nuro Driver, for Uber. Sources and what is assumed: docs/FLEET-MODELS.md.
import type { Pt } from '../surface';
import type { VehicleSpec } from '../spec';

const L = 5.03;
const HW = 1.0;
const FA = 0.9;
const WB = 3.04;
const HX = 2.75; // station of the middle of the roof halo
const HY = 1.69;

export const lucidGravity: VehicleSpec = {
  key: 'lucid_gravity_nuro',
  name: 'Lucid Gravity (Nuro Driver)',
  operator: 'Uber',
  maker: 'Lucid',
  provenance: {
    dimensions: "Lucid's published length, width, height and wheelbase. Axle position, track and tyres are estimated. The roof halo adds height that is not published.",
    doors: "Four conventional front-hinged doors.",
    sensors: "Published: cameras, solid-state lidar and radar in the body and in a low roof halo with an LED rider display. Counts and positions are not published; what is drawn is illustrative.",
    chargePort: "Left rear quarter.",
  },
  dims: { length: L, width: 2.0, height: 1.66, wheelbase: WB, frontAxle: FA, track: 1.7, tyreRadius: 0.385, tyreWidth: 0.265, rimRadius: 0.27 },
  finish: 'metallic',
  curves: {
    length: L,
    top: [[0, 0.76], [0.15, 0.85], [0.7, 0.98], [1.2, 1.06], [1.75, 1.38], [2.25, 1.6], [2.9, 1.66], [3.8, 1.63], [4.5, 1.52], [4.85, 1.26], [L, 1.06]],
    bottom: [[0, 0.29], [0.5, 0.21], [4.5, 0.21], [L, 0.38]],
    plan: [[0, 0.84], [0.5, 0.97], [1.1, HW], [4.1, HW], [4.6, 0.97], [L, 0.88]],
    belt: [[0, 0.72], [0.7, 0.93], [1.25, 1.0], [2.8, 1.05], [4.2, 1.1], [L, 1.02]],
    rail: [[0, 0.74], [1.15, 1.03], [1.4, 1.12], [2.2, 1.54], [2.9, 1.6], [3.8, 1.57], [4.5, 1.46], [4.85, 1.2], [L, 1.0]],
    railPlan: [[0, 0.66], [1.15, 0.84], [2.3, 0.71], [4.2, 0.69], [L, 0.74]],
    cap: { front: { y: 0.6, plan: 0.52, elev: 0.3, p: 2.5 }, rear: { y: 0.74, plan: 0.42, elev: 0.28, p: 2.7 } },
    style: { tuck: 0.06, barrel: 0.045, crown: 0.3, glassBow: 0.015 },
  },
  colors: { paint: 0xdfe1e2, interior: 0x3b3936, rim: 0x9fa3a8 },
  wheelStyle: 'spoke',
  archRadius: 0.43,
  doors: () => {
    const a: Pt[] = [[2.6, 1.4], [6, 1.4], [8, 2.2]];
    const b: Pt[] = [[2.6, 2.6], [8, 2.6]];
    const c: Pt[] = [[2.6, 3.74], [6, 3.74], [8, 3.6]];
    return ([-1, 1] as const).flatMap((side) => [
      { id: side < 0 ? 'FL' : 'FR', side, kind: 'hinge' as const, front: a, rear: b, ttLow: 2.75, ttHigh: 7.9, swingDeg: 65 },
      { id: side < 0 ? 'RL' : 'RR', side, kind: 'hinge' as const, front: b, rear: c, ttLow: 2.75, ttHigh: 7.9, swingDeg: 68 },
    ]);
  },
  regions: (_s, h) => [
    { material: 'glass', fields: h.topGlass([[1.42, 0.12], [1.26, 1], [2.2, 1], [2.3, 0.12]], 0.05) },
    { material: 'glassBlack', fields: h.topGlass([[2.36, 0.16], [2.36, 1], [4.3, 1], [4.3, 0.16]], 0.05) },
    { material: 'glassDark', fields: h.topGlass([[4.52, 0.2], [4.52, 1], [4.82, 1], [4.82, 0.2]], 0.03) },
    { material: 'glass', fields: h.sideGlass([[1.78, 0.13], [2.54, 0.13], [2.54, 0.86], [2.24, 0.86]], 0.03) },
    { material: 'glassDark', fields: h.sideGlass([[2.67, 0.13], [3.62, 0.13], [3.56, 0.86], [2.67, 0.86]], 0.03) },
    { material: 'glassDark', fields: h.sideGlass([[3.82, 0.15], [4.6, 0.15], [4.4, 0.8], [3.82, 0.84]], 0.025) },
    { material: 'glassBlack', fields: h.sideGlass([[1.68, 0.06], [4.72, 0.06], [4.46, 0.93], [2.2, 0.93]], 0.035) },
    { material: 'lampHead', fields: h.endPatch('front', [[-0.2, 0.8], [0.88, 0.82], [0.88, 0.85], [-0.2, 0.83]], 0.005, 0.55) },
    { material: 'glassBlack', fields: h.endPatch('front', [[-0.2, 0.76], [0.9, 0.78], [0.9, 0.88], [-0.2, 0.86]], 0.01, 0.5) },
    { material: 'cladding', fields: h.endPatch('front', [[-0.2, 0.3], [0.74, 0.3], [0.78, 0.5], [-0.2, 0.5]], 0.02, 0.3) },
    { material: 'lampTail', fields: h.endPatch('rear', [[-0.2, 1.06], [0.92, 1.06], [0.92, 1.09], [-0.2, 1.09]], 0.005, 0.5) },
    { material: 'plate', fields: h.endPatch('rear', [[-0.16, 0.78], [0.16, 0.78], [0.16, 0.91], [-0.16, 0.91]], 0.004, 0.3, false) },
    { material: 'cladding', fields: h.endPatch('rear', [[-0.2, 0.3], [0.84, 0.3], [0.84, 0.58], [-0.2, 0.58]], 0.02, 0.3) },
    { material: 'trim', fields: h.sidePatch([[2.4, 0.93], [2.56, 0.93], [2.56, 0.942], [2.4, 0.942]], 0.008), on: 'doors' },
    { material: 'trim', fields: h.sidePatch([[3.54, 0.97], [3.7, 0.97], [3.7, 0.982], [3.54, 0.982]], 0.008), on: 'doors' },
    { material: 'cladding', fields: h.below([[0, 0.34], [L, 0.37]]) },
  ],
  sensors: [
    // The halo: a low rack-like frame on the roof with the rider display in its rim.
    { id: 'halo_front', type: 'pod', shape: 'box', pos: [HX - 0.62, HY, 0], size: [0.16, 0.075, 1.2], note: 'Roof halo: cameras, solid-state lidar and radar, with an LED rider display' },
    { id: 'halo_rear', type: 'pod', shape: 'box', pos: [HX + 0.62, HY, 0], size: [0.16, 0.075, 1.2] },
    { id: 'halo_left', type: 'pod', shape: 'box', pos: [HX, HY, -0.56], size: [1.2, 0.075, 0.1] },
    { id: 'halo_right', type: 'pod', shape: 'box', pos: [HX, HY, 0.56], size: [1.2, 0.075, 0.1] },
    { id: 'lidar_halo_f', type: 'lidar', shape: 'windowLidar', pos: [HX - 0.7, HY, 0], size: [0.05, 0.05, 0.22], note: 'Forward solid-state lidar in the halo' },
    { id: 'lidar_halo_l', type: 'lidar', shape: 'windowLidar', pos: [HX, HY, -0.61], size: [0.05, 0.05, 0.2], yawDeg: -90 },
    { id: 'lidar_halo_r', type: 'lidar', shape: 'windowLidar', pos: [HX, HY, 0.61], size: [0.05, 0.05, 0.2], yawDeg: 90 },
    { id: 'lidar_halo_b', type: 'lidar', shape: 'windowLidar', pos: [HX + 0.7, HY, 0], size: [0.05, 0.05, 0.22], yawDeg: 180 },
    { id: 'cam_halo_fl', type: 'camera', shape: 'camera', pos: [HX - 0.7, HY, -0.5], size: [0.018, 0.02], yawDeg: -30 },
    { id: 'cam_halo_fr', type: 'camera', shape: 'camera', pos: [HX - 0.7, HY, 0.5], size: [0.018, 0.02], yawDeg: 30 },
    { id: 'cam_halo_f', type: 'camera', shape: 'camera', pos: [HX - 0.7, HY, 0.2], size: [0.018, 0.02] },
    { id: 'cam_halo_l', type: 'camera', shape: 'camera', pos: [HX - 0.3, HY, -0.61], size: [0.018, 0.02], yawDeg: -90 },
    { id: 'cam_halo_r', type: 'camera', shape: 'camera', pos: [HX - 0.3, HY, 0.61], size: [0.018, 0.02], yawDeg: 90 },
    { id: 'cam_halo_bl', type: 'camera', shape: 'camera', pos: [HX + 0.7, HY, -0.5], size: [0.018, 0.02], yawDeg: -150 },
    { id: 'cam_halo_br', type: 'camera', shape: 'camera', pos: [HX + 0.7, HY, 0.5], size: [0.018, 0.02], yawDeg: 150 },
    { id: 'cam_halo_b', type: 'camera', shape: 'camera', pos: [HX + 0.7, HY, 0.2], size: [0.018, 0.02], yawDeg: 180 },
    { id: 'lidar_nose', type: 'lidar', shape: 'windowLidar', pos: [0.0, 0.62, 0], size: [0.04, 0.06, 0.2], note: 'Solid-state lidar in the front apron, under the light blade' },
    { id: 'radar_f', type: 'radar', shape: 'radar', pos: [0.0, 0.46, 0], size: [0.012, 0.07, 0.12] },
    { id: 'radar_fl', type: 'radar', shape: 'radar', on: { xr: 0.3, tt: 4.3, side: -1, lift: 0.004 }, size: [0.012, 0.07, 0.1] },
    { id: 'radar_fr', type: 'radar', shape: 'radar', on: { xr: 0.3, tt: 4.3, side: 1, lift: 0.004 }, size: [0.012, 0.07, 0.1] },
    { id: 'radar_rl', type: 'radar', shape: 'radar', on: { xr: L - 0.28, tt: 4.3, side: -1, lift: 0.004 }, size: [0.012, 0.07, 0.1] },
    { id: 'radar_rr', type: 'radar', shape: 'radar', on: { xr: L - 0.28, tt: 4.3, side: 1, lift: 0.004 }, size: [0.012, 0.07, 0.1] },
    { id: 'cam_wing_l', type: 'camera', shape: 'camera', on: { xr: 1.3, tt: 5.3, side: -1, lift: 0.006 }, size: [0.016, 0.02] },
    { id: 'cam_wing_r', type: 'camera', shape: 'camera', on: { xr: 1.3, tt: 5.3, side: 1, lift: 0.006 }, size: [0.016, 0.02] },
    { id: 'cam_rear', type: 'camera', shape: 'camera', pos: [L - 0.01, 0.98, 0], size: [0.016, 0.02], yawDeg: 180 },
  ],
  seats: [
    { xr: 2.5, z: -0.4, facing: 1 }, { xr: 2.5, z: 0.4, facing: 1 },
    { xr: 3.45, z: 0, facing: 1, width: 1.36 },
  ],
  steeringWheel: true,
  mirrors: { xr: 1.82, y: 1.1 },
  chargePort: { face: 'left', xr: 4.55, y: 1.02, connector: 'NACS', assumed: false, note: 'Left rear quarter (NACS).' },
};
