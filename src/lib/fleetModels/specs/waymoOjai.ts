// Waymo Ojai (built by Zeekr), 6th-generation Waymo Driver. Sources and what is assumed: docs/FLEET-MODELS.md.
import type { Pt } from '../surface';
import type { VehicleSpec } from '../spec';

const L = 4.688;
const HW = 0.9975;
const WB = 3.008;
const FA = 0.80;

export const waymoOjai: VehicleSpec = {
  key: 'waymo_ojai',
  name: 'Waymo Ojai',
  operator: 'Waymo',
  maker: 'Zeekr',
  provenance: {
    dimensions: "Not published by Waymo. Length, width, height and wheelbase are the related Zeekr Mix's (same SEA-M platform); axle position, track and tyres are read off photographs.",
    doors: "Two sliding doors a side with no pillar between them: the front runs forward, the rear runs back. Travel is estimated.",
    sensors: "Published counts: 13 cameras, 4 lidar, 6 radar. Positions are read off photographs; per-sensor placement is not published.",
    chargePort: "Not published. Placed on the left rear quarter as an assumption.",
  },
  dims: { length: L, width: 1.995, height: 1.755, wheelbase: WB, frontAxle: FA, track: 1.70, tyreRadius: 0.365, tyreWidth: 0.245, rimRadius: 0.25 },
  curves: {
    length: L,
    top: [[0, 0.84], [0.12, 0.9], [0.7, 1.12], [1.2, 1.47], [1.62, 1.7], [2.1, 1.755], [3.7, 1.755], [4.3, 1.72], [4.56, 1.56], [L, 1.2]],
    bottom: [[0, 0.3], [0.45, 0.21], [4.25, 0.21], [L, 0.32]],
    plan: [[0, 0.87], [0.6, 0.985], [1.0, HW], [3.9, HW], [4.4, 0.98], [L, 0.9]],
    belt: [[0, 0.8], [0.5, 1.0], [0.95, 1.06], [4.0, 1.08], [L, 1.08]],
    rail: [[0, 0.82], [0.7, 1.1], [0.95, 1.16], [1.72, 1.65], [2.2, 1.7], [3.9, 1.7], [4.4, 1.6], [L, 1.2]],
    railPlan: [[0, 0.7], [0.8, 0.87], [1.9, 0.82], [4.2, 0.82], [L, 0.78]],
    cap: { front: { y: 0.56, plan: 0.5, elev: 0.3, p: 2.7 }, rear: { y: 0.66, plan: 0.36, elev: 0.26, p: 2.8 } },
    style: { tuck: 0.05, barrel: 0.035, crown: 0.3, glassBow: 0.012 },
  },
  finish: 'solid',
  colors: { paint: 0xcfdfee, paint2: 0x0d0f12, interior: 0x34363a },
  wheelStyle: 'aero',
  archRadius: 0.415,
  doors: () => {
    const fFront: Pt[] = [[2.6, 1.15], [6, 1.15], [8, 1.9]];
    const split: Pt[] = [[2.6, 2.38], [8, 2.38]];
    const rRear: Pt[] = [[2.6, 3.6], [6, 3.6], [8, 3.55]];
    return ([-1, 1] as const).flatMap((side) => [
      { id: side < 0 ? 'FL' : 'FR', side, kind: 'slide' as const, front: fFront, rear: split, ttLow: 2.75, ttHigh: 7.9, travel: 0.66, slideDir: 1 as const, popOut: 0.16 },
      { id: side < 0 ? 'RL' : 'RR', side, kind: 'slide' as const, front: split, rear: rRear, ttLow: 2.75, ttHigh: 7.9, travel: 0.82, slideDir: -1 as const, popOut: 0.16 },
    ]);
  },
  regions: (_s, h) => [
    // Glass.
    { material: 'glass', fields: h.topGlass([[0.92, 0.14], [0.78, 1], [1.62, 1], [1.72, 0.14]], 0.05) },
    { material: 'glassDark', fields: h.topGlass([[4.36, 0.16], [4.36, 1], [4.6, 1], [4.6, 0.16]], 0.03) },
    { material: 'glassDark', fields: h.sideGlass([[1.1, 0.14], [1.34, 0.14], [1.34, 0.5]], 0.02) },
    { material: 'glass', fields: h.sideGlass([[1.46, 0.13], [2.3, 0.13], [2.3, 0.86], [1.8, 0.86]], 0.03) },
    { material: 'glassDark', fields: h.sideGlass([[2.47, 0.13], [3.48, 0.13], [3.46, 0.86], [2.47, 0.86]], 0.03) },
    { material: 'glassDark', fields: h.sideGlass([[3.68, 0.13], [4.24, 0.13], [4.12, 0.86], [3.68, 0.86]], 0.03) },
    { material: 'glassBlack', fields: h.sideGlass([[1.0, 0.06], [4.3, 0.06], [4.16, 0.93], [1.74, 0.93]], 0.035) },
    // Lamps, then the black mask they sit in.
    { material: 'lampHead', fields: h.planPatch([[0.2, 0.52], [0.19, 0.78], [0.25, 0.82], [0.27, 0.52]], 0.01) },
    { material: 'glassBlack', fields: h.planPatch([[0.13, -0.1], [0.13, 0.82], [0.4, 0.92], [0.95, 0.9], [0.95, -0.1]], 0.02) },
    { material: 'cladding', fields: h.endPatch('front', [[-0.2, 0.34], [0.62, 0.34], [0.68, 0.45], [-0.2, 0.45]], 0.015, 0.5) },
    { material: 'lampTail', fields: h.endPatch('rear', [[0.84, 0.9], [0.9, 0.9], [0.9, 1.3], [0.84, 1.3]], 0.01, 0.3) },
    { material: 'plate', fields: h.endPatch('rear', [[-0.16, 0.56], [0.16, 0.56], [0.16, 0.7], [-0.16, 0.7]], 0.004, 0.3, false) },
    { material: 'plate', fields: h.endPatch('front', [[-0.16, 0.5], [0.16, 0.5], [0.16, 0.62], [-0.16, 0.62]], 0.004, 0.3, false) },
    // Door handles, side by side at the shut line.
    { material: 'trim', fields: h.sidePatch([[2.2, 0.985], [2.33, 0.985], [2.33, 1.0], [2.2, 1.0]], 0.008), on: 'doors' },
    { material: 'trim', fields: h.sidePatch([[2.43, 0.985], [2.56, 0.985], [2.56, 1.0], [2.43, 1.0]], 0.008), on: 'doors' },
    { material: 'cladding', fields: h.below([[0, 0.34], [L, 0.36]]) },
  ],
  sensors: [
    { id: 'roof_pod', type: 'pod', shape: 'box', pos: [1.78, 1.80, 0], size: [0.5, 0.11, 1.1], note: 'Roof sensor bar over the windscreen header: forward and side cameras' },
    { id: 'roof_plinth', type: 'pod', shape: 'box', pos: [2.3, 1.775, 0], size: [1.1, 0.07, 0.9], material: 'sensorWhite', note: 'Roof plinth' },
    { id: 'lidar_roof', type: 'lidar', shape: 'spinLidar', pos: [1.87, 1.84, 0], size: [0.105, 0.2], note: '360 degree roof lidar' },
    { id: 'cam_roof_f', type: 'camera', shape: 'camera', pos: [1.52, 1.80, 0], size: [0.022, 0.02], yawDeg: 0 },
    { id: 'cam_roof_fl', type: 'camera', shape: 'camera', pos: [1.54, 1.80, -0.42], size: [0.022, 0.02], yawDeg: -25 },
    { id: 'cam_roof_fr', type: 'camera', shape: 'camera', pos: [1.54, 1.80, 0.42], size: [0.022, 0.02], yawDeg: 25 },
    { id: 'cam_roof_l', type: 'camera', shape: 'camera', pos: [1.78, 1.80, -0.555], size: [0.022, 0.02], yawDeg: -90 },
    { id: 'cam_roof_r', type: 'camera', shape: 'camera', pos: [1.78, 1.80, 0.555], size: [0.022, 0.02], yawDeg: 90 },
    { id: 'pod_fl', type: 'pod', shape: 'windowLidar', on: { xr: 0.98, tt: 5.0, side: -1, lift: 0.03 }, size: [0.1, 0.17, 0.42], note: 'Front wing pod: perimeter lidar and camera' },
    { id: 'pod_fr', type: 'pod', shape: 'windowLidar', on: { xr: 0.98, tt: 5.0, side: 1, lift: 0.03 }, size: [0.1, 0.17, 0.42], note: 'Front wing pod: perimeter lidar and camera' },
    { id: 'lidar_fl', type: 'lidar', shape: 'puckLidar', on: { xr: 0.9, tt: 5.0, side: -1, lift: 0.07 }, size: [0.045, 0.05] },
    { id: 'lidar_fr', type: 'lidar', shape: 'puckLidar', on: { xr: 0.9, tt: 5.0, side: 1, lift: 0.07 }, size: [0.045, 0.05] },
    { id: 'cam_fl', type: 'camera', shape: 'camera', on: { xr: 1.06, tt: 5.0, side: -1, lift: 0.075 }, size: [0.02, 0.02] },
    { id: 'cam_fr', type: 'camera', shape: 'camera', on: { xr: 1.06, tt: 5.0, side: 1, lift: 0.075 }, size: [0.02, 0.02] },
    { id: 'pod_nose', type: 'pod', shape: 'box', pos: [0.03, 0.72, 0.52], size: [0.07, 0.2, 0.09], note: 'Nose pod: radar and camera' },
    { id: 'radar_f', type: 'radar', shape: 'radar', pos: [0.0, 0.6, 0], size: [0.012, 0.07, 0.12], note: 'Front radar' },
    { id: 'cam_nose', type: 'camera', shape: 'camera', pos: [-0.005, 0.76, 0.52], size: [0.018, 0.02] },
    { id: 'pod_rl', type: 'pod', shape: 'windowLidar', on: { xr: 4.42, tt: 7.6, side: -1, lift: 0.05 }, size: [0.2, 0.17, 0.13], yawDeg: 180, note: 'Rear corner pod: camera and radar' },
    { id: 'pod_rr', type: 'pod', shape: 'windowLidar', on: { xr: 4.42, tt: 7.6, side: 1, lift: 0.05 }, size: [0.2, 0.17, 0.13], yawDeg: 180, note: 'Rear corner pod: camera and radar' },
    { id: 'cam_rl', type: 'camera', shape: 'camera', on: { xr: 4.44, tt: 7.6, side: -1, lift: 0.12 }, size: [0.02, 0.02] },
    { id: 'cam_rr', type: 'camera', shape: 'camera', on: { xr: 4.44, tt: 7.6, side: 1, lift: 0.12 }, size: [0.02, 0.02] },
    { id: 'lidar_rear', type: 'lidar', shape: 'puckLidar', pos: [L + 0.005, 0.95, 0], size: [0.045, 0.05], yawDeg: 180, note: 'Rear perimeter lidar' },
    { id: 'cam_rear', type: 'camera', shape: 'camera', pos: [L - 0.06, 1.62, 0], size: [0.02, 0.02], yawDeg: 180 },
    { id: 'cam_roof_rl', type: 'camera', shape: 'camera', pos: [2.1, 1.80, -0.5], size: [0.022, 0.02], yawDeg: -150 },
    { id: 'cam_roof_rr', type: 'camera', shape: 'camera', pos: [2.1, 1.80, 0.5], size: [0.022, 0.02], yawDeg: 150 },
    { id: 'radar_fl', type: 'radar', shape: 'radar', on: { xr: 0.3, tt: 4.2, side: -1, lift: 0.004 }, size: [0.012, 0.07, 0.1] },
    { id: 'radar_fr', type: 'radar', shape: 'radar', on: { xr: 0.3, tt: 4.2, side: 1, lift: 0.004 }, size: [0.012, 0.07, 0.1] },
    { id: 'radar_rl', type: 'radar', shape: 'radar', on: { xr: L - 0.25, tt: 4.2, side: -1, lift: 0.004 }, size: [0.012, 0.07, 0.1] },
    { id: 'radar_rr', type: 'radar', shape: 'radar', on: { xr: L - 0.25, tt: 4.2, side: 1, lift: 0.004 }, size: [0.012, 0.07, 0.1] },
    { id: 'radar_r', type: 'radar', shape: 'radar', pos: [L, 0.62, 0.3], size: [0.012, 0.07, 0.12], yawDeg: 180 },
  ],
  seats: [
    { xr: 1.95, z: -0.42, facing: 1 }, { xr: 1.95, z: 0.42, facing: 1 },
    { xr: 3.2, z: 0, facing: 1, width: 1.4 },
  ],
  steeringWheel: true,
  mirrors: { xr: 1.36, y: 1.18 },
  chargePort: { face: 'left', xr: 4.2, y: 0.95, connector: 'CCS1', assumed: true, note: 'ASSUMPTION: left rear quarter, CCS1. Waymo has published neither the position nor the connector.' },
};
