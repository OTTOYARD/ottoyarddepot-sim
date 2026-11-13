// Tesla Model Y (2025 onward) as run in Tesla's Robotaxi service. Sources and what is assumed: docs/FLEET-MODELS.md.
import type { Pt } from '../surface';
import type { VehicleSpec } from '../spec';

const L = 4.79;
const HW = 0.96;
const FA = 0.87;
const WB = 2.89;

export const teslaModelY: VehicleSpec = {
  key: 'tesla_model_y',
  name: 'Tesla Model Y Robotaxi',
  operator: 'Tesla Robotaxi',
  maker: 'Tesla',
  provenance: {
    dimensions: "Tesla's published length, width, height and wheelbase for the 2025-on car. Axle position, track and tyres are estimated.",
    doors: "Four conventional front-hinged doors.",
    sensors: "Eight outward cameras in Tesla's usual positions; no lidar or radar.",
    chargePort: "Left rear, in the tail-lamp cluster.",
  },
  dims: { length: L, width: 1.92, height: 1.624, wheelbase: WB, frontAxle: FA, track: 1.64, tyreRadius: 0.356, tyreWidth: 0.255, rimRadius: 0.245 },
  finish: 'metallic',
  curves: {
    length: L,
    top: [[0, 0.72], [0.2, 0.81], [0.7, 0.94], [1.15, 1.03], [1.7, 1.36], [2.15, 1.56], [2.7, 1.624], [3.4, 1.59], [4.1, 1.42], [4.5, 1.2], [4.7, 1.09], [L, 1.02]],
    bottom: [[0, 0.27], [0.5, 0.19], [4.3, 0.2], [L, 0.38]],
    plan: [[0, 0.8], [0.5, 0.93], [1.1, HW], [3.9, HW], [4.4, 0.93], [L, 0.84]],
    belt: [[0, 0.68], [0.7, 0.9], [1.2, 0.97], [2.6, 1.03], [3.9, 1.12], [L, 1.0]],
    rail: [[0, 0.7], [1.1, 1.0], [1.35, 1.09], [2.1, 1.5], [2.7, 1.565], [3.4, 1.53], [4.1, 1.38], [4.6, 1.12], [L, 0.98]],
    railPlan: [[0, 0.62], [1.1, 0.8], [2.2, 0.67], [3.9, 0.65], [L, 0.7]],
    cap: { front: { y: 0.56, plan: 0.5, elev: 0.3, p: 2.5 }, rear: { y: 0.74, plan: 0.42, elev: 0.26, p: 2.7 } },
    style: { tuck: 0.07, barrel: 0.05, crown: 0.3, glassBow: 0.015 },
  },
  colors: { paint: 0x8d949b, interior: 0x242528, rim: 0x2a2c30 },
  wheelStyle: 'aero',
  archRadius: 0.4,
  doors: () => {
    const a: Pt[] = [[2.6, 1.34], [6, 1.34], [8, 2.14]];
    const b: Pt[] = [[2.6, 2.5], [8, 2.5]];
    const c: Pt[] = [[2.6, 3.56], [6, 3.56], [8, 3.34]];
    return ([-1, 1] as const).flatMap((side) => [
      { id: side < 0 ? 'FL' : 'FR', side, kind: 'hinge' as const, front: a, rear: b, ttLow: 2.75, ttHigh: 7.9, swingDeg: 65 },
      { id: side < 0 ? 'RL' : 'RR', side, kind: 'hinge' as const, front: b, rear: c, ttLow: 2.75, ttHigh: 7.9, swingDeg: 65 },
    ]);
  },
  regions: (_s, h) => [
    { material: 'glass', fields: h.topGlass([[1.37, 0.12], [1.2, 1], [2.1, 1], [2.2, 0.12]], 0.05) },
    { material: 'glassBlack', fields: h.topGlass([[2.26, 0.16], [2.26, 1], [3.66, 1], [3.66, 0.16]], 0.05) },
    { material: 'glassDark', fields: h.topGlass([[3.78, 0.2], [3.78, 1], [4.4, 1], [4.4, 0.2]], 0.04) },
    { material: 'glass', fields: h.sideGlass([[1.72, 0.13], [2.44, 0.13], [2.44, 0.86], [2.18, 0.86]], 0.03) },
    { material: 'glassDark', fields: h.sideGlass([[2.57, 0.13], [3.44, 0.13], [3.28, 0.86], [2.57, 0.86]], 0.03) },
    { material: 'glassDark', fields: h.sideGlass([[3.6, 0.16], [4.06, 0.16], [3.64, 0.74]], 0.025) },
    { material: 'glassBlack', fields: h.sideGlass([[1.62, 0.06], [4.16, 0.06], [3.56, 0.93], [2.12, 0.93]], 0.035) },
    { material: 'lampHead', fields: h.endPatch('front', [[-0.2, 0.815], [0.82, 0.83], [0.82, 0.845], [-0.2, 0.83]], 0.004, 0.5) },
    { material: 'lampHead', fields: h.endPatch('front', [[0.56, 0.7], [0.82, 0.71], [0.82, 0.76], [0.56, 0.75]], 0.01, 0.4) },
    { material: 'cladding', fields: h.endPatch('front', [[-0.2, 0.3], [0.66, 0.3], [0.7, 0.46], [-0.2, 0.46]], 0.02, 0.3) },
    { material: 'lampTail', fields: h.endPatch('rear', [[-0.2, 1.0], [0.86, 1.0], [0.86, 1.035], [-0.2, 1.035]], 0.006, 0.5) },
    { material: 'plate', fields: h.endPatch('rear', [[-0.16, 0.74], [0.16, 0.74], [0.16, 0.87], [-0.16, 0.87]], 0.004, 0.3, false) },
    { material: 'cladding', fields: h.endPatch('rear', [[-0.2, 0.3], [0.8, 0.3], [0.8, 0.56], [-0.2, 0.56]], 0.02, 0.3) },
    { material: 'trim', fields: h.sidePatch([[2.3, 0.9], [2.46, 0.9], [2.46, 0.912], [2.3, 0.912]], 0.008), on: 'doors' },
    { material: 'trim', fields: h.sidePatch([[3.34, 0.96], [3.5, 0.96], [3.5, 0.972], [3.34, 0.972]], 0.008), on: 'doors' },
    { material: 'cladding', fields: h.below([[0, 0.33], [L, 0.36]]) },
  ],
  sensors: [
    { id: 'cam_ws_main', type: 'camera', shape: 'camera', pos: [2.04, 1.5, -0.03], size: [0.016, 0.02], note: 'Windscreen camera, main' },
    { id: 'cam_ws_wide', type: 'camera', shape: 'camera', pos: [2.04, 1.5, 0.03], size: [0.016, 0.02], note: 'Windscreen camera, wide' },
    { id: 'cam_bumper', type: 'camera', shape: 'camera', pos: [0.0, 0.52, 0], size: [0.016, 0.02], note: 'Front bumper camera' },
    { id: 'cam_wing_l', type: 'camera', shape: 'camera', on: { xr: 1.22, tt: 5.3, side: -1, lift: 0.006 }, size: [0.014, 0.02], yawDeg: -150, note: 'Front wing camera, looking back' },
    { id: 'cam_wing_r', type: 'camera', shape: 'camera', on: { xr: 1.22, tt: 5.3, side: 1, lift: 0.006 }, size: [0.014, 0.02], yawDeg: 150, note: 'Front wing camera, looking back' },
    { id: 'cam_pillar_l', type: 'camera', shape: 'camera', on: { xr: 2.5, tt: 7.0, side: -1, lift: 0.004 }, size: [0.014, 0.02], yawDeg: -60, note: 'Door pillar camera, looking forward and out' },
    { id: 'cam_pillar_r', type: 'camera', shape: 'camera', on: { xr: 2.5, tt: 7.0, side: 1, lift: 0.004 }, size: [0.014, 0.02], yawDeg: 60, note: 'Door pillar camera, looking forward and out' },
    { id: 'cam_rear', type: 'camera', shape: 'camera', pos: [L - 0.01, 0.93, 0], size: [0.016, 0.02], yawDeg: 180, note: 'Rear camera, above the number plate' },
  ],
  seats: [
    { xr: 2.42, z: -0.38, facing: 1 }, { xr: 2.42, z: 0.38, facing: 1 },
    { xr: 3.3, z: 0, facing: 1, width: 1.3 },
  ],
  steeringWheel: true,
  mirrors: { xr: 1.76, y: 1.07 },
  chargePort: { side: -1, xr: 4.56, y: 1.0, note: 'Left rear, in the tail-lamp cluster (NACS).' },
};
