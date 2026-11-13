// Waymo Jaguar I-PACE, 5th-generation Waymo Driver. Sources and what is assumed: docs/FLEET-MODELS.md.
import type { Pt } from '../surface';
import type { SensorSpec, VehicleSpec } from '../spec';

const L = 4.682;
const HW = 0.9475;
const FA = 0.845;
const WB = 2.99;

// The roof dome carries a ring of cameras under the 360 lidar.
const domeCams: SensorSpec[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return { id: `cam_dome_${i}`, type: 'camera' as const, shape: 'camera' as const, pos: [2.3 - Math.cos(a) * 0.3, 1.66, Math.sin(a) * 0.3] as [number, number, number], size: [0.02, 0.02], yawDeg: (a * 180) / Math.PI };
});

export const waymoIpace: VehicleSpec = {
  key: 'waymo_ipace',
  name: 'Waymo Jaguar I-PACE',
  operator: 'Waymo',
  maker: 'Jaguar',
  provenance: {
    dimensions: "Jaguar's published length, body width, height and wheelbase. Axle position, track and tyres are estimated.",
    doors: "Four conventional front-hinged doors.",
    sensors: "Published: one 360 degree roof lidar and four perimeter lidars, 29 cameras. Six radars is reported, not confirmed by Waymo. This model draws 5 lidars, 6 radars and 10 camera positions; placement is read off photographs.",
    chargePort: "Left front wing (Jaguar I-PACE).",
  },
  dims: { length: L, width: 1.895, height: 1.565, wheelbase: WB, frontAxle: FA, track: 1.64, tyreRadius: 0.376, tyreWidth: 0.245, rimRadius: 0.262 },
  finish: 'solid',
  curves: {
    length: L,
    top: [[0, 0.78], [0.15, 0.85], [0.6, 0.96], [1.05, 1.04], [1.5, 1.3], [1.95, 1.5], [2.5, 1.565], [3.3, 1.54], [4.1, 1.43], [4.45, 1.16], [L, 0.98]],
    bottom: [[0, 0.27], [0.5, 0.2], [4.2, 0.21], [L, 0.35]],
    plan: [[0, 0.8], [0.5, 0.925], [1.0, HW], [3.8, HW], [4.3, 0.92], [L, 0.83]],
    belt: [[0, 0.74], [0.6, 0.9], [1.1, 0.97], [2.5, 1.02], [3.8, 1.09], [L, 1.0]],
    rail: [[0, 0.76], [1.0, 1.0], [1.25, 1.08], [1.95, 1.44], [2.5, 1.5], [3.3, 1.47], [4.0, 1.37], [4.4, 1.14], [L, 0.96]],
    railPlan: [[0, 0.62], [1.0, 0.8], [2.0, 0.69], [3.8, 0.67], [L, 0.7]],
    cap: { front: { y: 0.58, plan: 0.5, elev: 0.3, p: 2.5 }, rear: { y: 0.7, plan: 0.42, elev: 0.3, p: 2.6 } },
    style: { tuck: 0.07, barrel: 0.05, crown: 0.3, glassBow: 0.015 },
  },
  colors: { paint: 0xf4f5f6, interior: 0x2b2c2f, rim: 0x1d1e21 },
  wheelStyle: 'spoke',
  archRadius: 0.415,
  doors: () => {
    const a: Pt[] = [[2.6, 1.3], [6, 1.3], [8, 2.02]];
    const b: Pt[] = [[2.6, 2.42], [8, 2.42]];
    const c: Pt[] = [[2.6, 3.56], [6, 3.56], [8, 3.36]];
    return ([-1, 1] as const).flatMap((side) => [
      { id: side < 0 ? 'FL' : 'FR', side, kind: 'hinge' as const, front: a, rear: b, ttLow: 2.75, ttHigh: 7.9, swingDeg: 62 },
      { id: side < 0 ? 'RL' : 'RR', side, kind: 'hinge' as const, front: b, rear: c, ttLow: 2.75, ttHigh: 7.9, swingDeg: 62 },
    ]);
  },
  regions: (_s, h) => [
    { material: 'glass', fields: h.topGlass([[1.27, 0.12], [1.1, 1], [1.92, 1], [2.0, 0.12]], 0.05) },
    { material: 'glassBlack', fields: h.topGlass([[2.06, 0.2], [2.06, 1], [3.7, 1], [3.7, 0.2]], 0.05) },
    { material: 'glassDark', fields: h.topGlass([[4.14, 0.18], [4.14, 1], [4.42, 1], [4.42, 0.18]], 0.03) },
    { material: 'glass', fields: h.sideGlass([[1.6, 0.13], [2.36, 0.13], [2.36, 0.86], [2.05, 0.86]], 0.03) },
    { material: 'glassDark', fields: h.sideGlass([[2.49, 0.13], [3.34, 0.13], [3.26, 0.86], [2.49, 0.86]], 0.03) },
    { material: 'glassDark', fields: h.sideGlass([[3.5, 0.15], [3.98, 0.15], [3.56, 0.78]], 0.025) },
    { material: 'glassBlack', fields: h.sideGlass([[1.5, 0.06], [4.08, 0.06], [3.5, 0.93], [2.0, 0.93]], 0.035) },
    { material: 'lampHead', fields: h.endPatch('front', [[0.5, 0.74], [0.82, 0.8], [0.84, 0.85], [0.5, 0.8]], 0.01, 0.45) },
    { material: 'cladding', fields: h.endPatch('front', [[-0.2, 0.5], [0.38, 0.5], [0.42, 0.62], [0.4, 0.78], [-0.2, 0.78]], 0.03, 0.3) },
    { material: 'cladding', fields: h.endPatch('front', [[0.5, 0.34], [0.78, 0.36], [0.78, 0.6], [0.56, 0.6]], 0.02, 0.4) },
    { material: 'lampTail', fields: h.endPatch('rear', [[0.4, 0.93], [0.9, 0.95], [0.9, 1.01], [0.4, 0.99]], 0.01, 0.5) },
    { material: 'plate', fields: h.endPatch('rear', [[-0.16, 0.74], [0.16, 0.74], [0.16, 0.87], [-0.16, 0.87]], 0.004, 0.3, false) },
    { material: 'plate', fields: h.endPatch('front', [[-0.15, 0.36], [0.15, 0.36], [0.15, 0.47], [-0.15, 0.47]], 0.004, 0.3, false) },
    { material: 'trim', fields: h.sidePatch([[2.18, 0.9], [2.36, 0.9], [2.36, 0.915], [2.18, 0.915]], 0.008), on: 'doors' },
    { material: 'trim', fields: h.sidePatch([[3.2, 0.95], [3.38, 0.95], [3.38, 0.965], [3.2, 0.965]], 0.008), on: 'doors' },
    { material: 'cladding', fields: h.below([[0, 0.36], [L, 0.38]]) },
  ],
  sensors: [
    { id: 'roof_base', type: 'pod', shape: 'box', pos: [2.3, 1.59, 0], size: [0.95, 0.07, 0.8], note: 'Roof sensor tray' },
    { id: 'roof_dome', type: 'pod', shape: 'dome', pos: [2.3, 1.6, 0], size: [0.34, 0.12], note: 'Roof dome: camera ring and long-range cameras' },
    { id: 'lidar_roof', type: 'lidar', shape: 'spinLidar', pos: [2.3, 1.72, 0], size: [0.12, 0.2], note: '360 degree roof lidar' },
    ...domeCams,
    { id: 'pod_front', type: 'pod', shape: 'windowLidar', pos: [0.0, 0.83, 0], size: [0.1, 0.1, 0.24], note: 'Front perimeter lidar and camera, above the grille' },
    { id: 'lidar_front', type: 'lidar', shape: 'puckLidar', pos: [-0.02, 0.83, 0], size: [0.04, 0.04] },
    { id: 'pod_fl', type: 'pod', shape: 'windowLidar', on: { xr: 1.02, tt: 5.3, side: -1, lift: 0.035 }, size: [0.11, 0.16, 0.3], material: 'sensorWhite', note: 'Front wing pod: perimeter lidar and camera' },
    { id: 'pod_fr', type: 'pod', shape: 'windowLidar', on: { xr: 1.02, tt: 5.3, side: 1, lift: 0.035 }, size: [0.11, 0.16, 0.3], material: 'sensorWhite', note: 'Front wing pod: perimeter lidar and camera' },
    { id: 'lidar_fl', type: 'lidar', shape: 'puckLidar', on: { xr: 0.96, tt: 5.3, side: -1, lift: 0.08 }, size: [0.045, 0.05] },
    { id: 'lidar_fr', type: 'lidar', shape: 'puckLidar', on: { xr: 0.96, tt: 5.3, side: 1, lift: 0.08 }, size: [0.045, 0.05] },
    { id: 'cam_fl', type: 'camera', shape: 'camera', on: { xr: 1.08, tt: 5.3, side: -1, lift: 0.085 }, size: [0.02, 0.02] },
    { id: 'cam_fr', type: 'camera', shape: 'camera', on: { xr: 1.08, tt: 5.3, side: 1, lift: 0.085 }, size: [0.02, 0.02] },
    { id: 'pod_rear', type: 'pod', shape: 'windowLidar', pos: [L - 0.02, 1.02, 0], size: [0.1, 0.1, 0.24], yawDeg: 180, note: 'Rear perimeter lidar and camera' },
    { id: 'lidar_rear', type: 'lidar', shape: 'puckLidar', pos: [L, 1.02, 0], size: [0.04, 0.04], yawDeg: 180 },
    { id: 'pod_rl', type: 'pod', shape: 'box', on: { xr: 4.42, tt: 5.4, side: -1, lift: 0.03 }, size: [0.09, 0.1, 0.12], note: 'Rear corner radar and camera' },
    { id: 'pod_rr', type: 'pod', shape: 'box', on: { xr: 4.42, tt: 5.4, side: 1, lift: 0.03 }, size: [0.09, 0.1, 0.12], note: 'Rear corner radar and camera' },
    { id: 'radar_fl', type: 'radar', shape: 'radar', on: { xr: 0.28, tt: 4.4, side: -1, lift: 0.004 }, size: [0.012, 0.07, 0.1] },
    { id: 'radar_fr', type: 'radar', shape: 'radar', on: { xr: 0.28, tt: 4.4, side: 1, lift: 0.004 }, size: [0.012, 0.07, 0.1] },
    { id: 'radar_rl', type: 'radar', shape: 'radar', on: { xr: 4.44, tt: 5.4, side: -1, lift: 0.085 }, size: [0.012, 0.06, 0.08] },
    { id: 'radar_rr', type: 'radar', shape: 'radar', on: { xr: 4.44, tt: 5.4, side: 1, lift: 0.085 }, size: [0.012, 0.06, 0.08] },
    { id: 'radar_roof_f', type: 'radar', shape: 'radar', pos: [1.82, 1.6, 0], size: [0.012, 0.05, 0.12] },
    { id: 'radar_roof_r', type: 'radar', shape: 'radar', pos: [2.78, 1.6, 0], size: [0.012, 0.05, 0.12], yawDeg: 180 },
  ],
  seats: [
    { xr: 2.22, z: -0.38, facing: 1 }, { xr: 2.22, z: 0.38, facing: 1 },
    { xr: 3.12, z: 0, facing: 1, width: 1.3 },
  ],
  steeringWheel: true,
  mirrors: { xr: 1.6, y: 1.06 },
  chargePort: { side: -1, xr: 1.14, y: 0.9, note: 'Left front wing, above and behind the wheel arch (CCS1).' },
};
