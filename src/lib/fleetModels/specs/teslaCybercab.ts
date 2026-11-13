// Tesla Cybercab. Sources and what is assumed: docs/FLEET-MODELS.md.
import type { Pt } from '../surface';
import type { VehicleSpec } from '../spec';

const L = 4.445;
const HW = 0.8765;
const FA = 0.79;
const WB = 2.84;

export const teslaCybercab: VehicleSpec = {
  key: 'tesla_cybercab',
  name: 'Tesla Cybercab',
  operator: 'Tesla Robotaxi',
  maker: 'Tesla',
  provenance: {
    dimensions: "Reported height 1.407 m and width 1.753 m (a second source says 1.60 m); length about 4.445 m is an estimate from a drone photograph. Wheelbase is not published: 2.84 m is measured off a side photograph.",
    doors: "Two powered butterfly doors, no handles. Hinge line and 78 degree swing are fitted to a photograph of the open door.",
    sensors: "Reported: eight outward cameras, no lidar or radar. Positions follow Tesla's usual layout and are an assumption.",
    chargePort: "Tesla describes inductive charging under the car as the main method; no plug location is published, so none is drawn.",
  },
  dims: { length: L, width: 1.753, height: 1.407, wheelbase: WB, frontAxle: FA, track: 1.5, tyreRadius: 0.385, tyreWidth: 0.235, rimRadius: 0.28 },
  finish: 'satin',
  curves: {
    length: L,
    top: [[0, 0.66], [0.3, 0.8], [0.9, 0.96], [1.5, 1.24], [2.0, 1.38], [2.4, 1.407], [3.0, 1.36], [3.7, 1.2], [4.3, 1.04], [L, 1.0]],
    bottom: [[0, 0.24], [0.5, 0.15], [4.0, 0.15], [L, 0.36]],
    plan: [[0, 0.72], [0.5, 0.85], [1.1, HW], [3.6, HW], [4.2, 0.84], [L, 0.77]],
    belt: [[0, 0.62], [0.9, 0.9], [1.5, 0.97], [3.2, 1.01], [4.0, 0.98], [L, 0.92]],
    rail: [[0, 0.64], [0.9, 0.94], [1.2, 1.04], [1.9, 1.32], [2.4, 1.365], [3.0, 1.32], [3.7, 1.17], [L, 0.97]],
    railPlan: [[0, 0.58], [1.0, 0.74], [2.2, 0.6], [3.2, 0.6], [L, 0.66]],
    cap: { front: { y: 0.6, plan: 0.5, elev: 0.26, p: 2.4 }, rear: { y: 0.78, plan: 0.3, elev: 0.14, p: 3.2 } },
    style: { tuck: 0.07, barrel: 0.05, crown: 0.28, glassBow: 0.012 },
  },
  colors: { paint: 0xb59a5c, interior: 0x1f2022, rim: 0xb59a5c },
  wheelStyle: 'disc',
  archRadius: 0.43,
  doors: () => {
    const a: Pt[] = [[2.6, 1.34], [6, 1.34], [8, 1.86], [9.4, 1.96]];
    const b: Pt[] = [[2.6, 2.86], [6, 2.86], [8, 2.76], [9.4, 2.72]];
    return ([-1, 1] as const).map((side) => ({
      id: side < 0 ? 'L' : 'R', side, kind: 'butterfly' as const, front: a, rear: b, ttLow: 2.95, ttHigh: 9.3,
      axis: [[1.36, 0.93, 0.06], [1.92, 1.34, 0.26]] as [[number, number, number], [number, number, number]], swingDeg: 78,
    }));
  },
  regions: (_s, h) => [
    { material: 'glass', fields: h.topGlass([[1.22, 0.14], [1.06, 1], [2.02, 1], [2.02, 0.14]], 0.05) },
    { material: 'glassBlack', fields: h.topGlass([[2.1, 0.62], [2.1, 1], [3.0, 1], [3.0, 0.62]], 0.05) },
    { material: 'glass', fields: h.sideGlass([[1.66, 0.14], [2.72, 0.14], [2.62, 0.84], [2.02, 0.84]], 0.03) },
    { material: 'glassDark', fields: h.sideGlass([[2.92, 0.18], [3.5, 0.18], [3.0, 0.78]], 0.025) },
    { material: 'glassBlack', fields: h.sideGlass([[1.52, 0.07], [2.8, 0.07], [2.7, 0.92], [1.98, 0.92]], 0.03) },
    { material: 'lampHead', fields: h.endPatch('front', [[-0.2, 0.69], [0.78, 0.71], [0.78, 0.725], [-0.2, 0.705]], 0.004, 0.5) },
    { material: 'lampTail', fields: h.endPatch('rear', [[-0.2, 0.9], [0.8, 0.9], [0.8, 0.925], [-0.2, 0.925]], 0.004, 0.3) },
    { material: 'cladding', fields: h.endPatch('rear', [[-0.2, 0.2], [0.9, 0.2], [0.9, 0.86], [-0.2, 0.86]], 0.02, 0.22) },
    { material: 'cladding', fields: h.endPatch('front', [[-0.2, 0.2], [0.9, 0.2], [0.9, 0.44], [-0.2, 0.44]], 0.02, 0.3) },
    { material: 'cladding', fields: h.below([[0, 0.34], [1.3, 0.34], [3.0, 0.35], [L, 0.5]]) },
  ],
  sensors: [
    { id: 'cam_ws_main', type: 'camera', shape: 'camera', pos: [1.9, 1.33, -0.03], size: [0.016, 0.02], note: 'Windscreen camera, main' },
    { id: 'cam_ws_wide', type: 'camera', shape: 'camera', pos: [1.9, 1.33, 0.03], size: [0.016, 0.02], note: 'Windscreen camera, wide' },
    { id: 'cam_bumper', type: 'camera', shape: 'camera', pos: [0.0, 0.5, 0], size: [0.016, 0.02], note: 'Front bumper camera' },
    { id: 'cam_wing_l', type: 'camera', shape: 'camera', on: { xr: 1.28, tt: 5.2, side: -1, lift: 0.006 }, size: [0.014, 0.02], yawDeg: -150, note: 'Front wing camera, looking back' },
    { id: 'cam_wing_r', type: 'camera', shape: 'camera', on: { xr: 1.28, tt: 5.2, side: 1, lift: 0.006 }, size: [0.014, 0.02], yawDeg: 150, note: 'Front wing camera, looking back' },
    { id: 'cam_pillar_l', type: 'camera', shape: 'camera', on: { xr: 2.8, tt: 7.1, side: -1, lift: 0.004 }, size: [0.014, 0.02], yawDeg: -60, note: 'Door pillar camera, looking forward and out' },
    { id: 'cam_pillar_r', type: 'camera', shape: 'camera', on: { xr: 2.8, tt: 7.1, side: 1, lift: 0.004 }, size: [0.014, 0.02], yawDeg: 60, note: 'Door pillar camera, looking forward and out' },
    { id: 'cam_rear', type: 'camera', shape: 'camera', pos: [L, 0.97, 0], size: [0.016, 0.02], yawDeg: 180, note: 'Rear camera' },
  ],
  seats: [{ xr: 2.5, z: -0.36, facing: 1 }, { xr: 2.5, z: 0.36, facing: 1 }],
  steeringWheel: false,
};
