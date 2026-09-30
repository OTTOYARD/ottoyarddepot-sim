import { create } from 'zustand';

// toWorld negates X (east=-X) to un-mirror the scene. Bird Eye views from the
// SOUTH (z<0) so it is north-up / east-right, matching the 2D. Oblique presets
// negate their X so they frame the same physical subject in the flipped world.
// (Tuned + live-verified per camera 2026-07-22.)
export const CAMERA_PRESETS = {
  'Bird Eye': { position: [0, 210, -60] as [number, number, number], target: [0, 0, -4] as [number, number, number] },
  'Entrance': { position: [50, 6, -135] as [number, number, number], target: [50, 3, -70] as [number, number, number] },
  'Canopy': { position: [75, 7, -50] as [number, number, number], target: [47, 5, 30] as [number, number, number] },
  'Operator': { position: [170, 90, -120] as [number, number, number], target: [0, 0, 20] as [number, number, number] },
  'Service': { position: [10, 9, 30] as [number, number, number], target: [25, 6, 75] as [number, number, number] },
  'Hero': { position: [-95, 14, -75] as [number, number, number], target: [-47, 6, 25] as [number, number, number] },
  // The pull-through bays from the forecourt (south), and their exits from the
  // rear apron (north): the two views that show a car driving THROUGH a building.
  'Bays': { position: [-70, 10, 38] as [number, number, number], target: [5, 3.5, 66] as [number, number, number] },
  'Rear': { position: [-30, 12, 108] as [number, number, number], target: [-10, 4, 70] as [number, number, number] },
};

export type CameraPreset = keyof typeof CAMERA_PRESETS;
export const CAMERA_PRESET_NAMES = Object.keys(CAMERA_PRESETS) as CameraPreset[];

/**
 * A camera preset asked for from OUTSIDE the 3D view (the phone cockpit's camera
 * menu). A counter, not just the name, so asking for the same preset twice
 * frames it twice. A view choice only: nothing in the world reads it.
 */
interface CameraCommands {
  request: { preset: CameraPreset; n: number } | null;
  frame: (preset: CameraPreset) => void;
}
export const useCameraCommands = create<CameraCommands>((set) => ({
  request: null,
  frame: (preset) => set((s) => ({ request: { preset, n: (s.request?.n ?? 0) + 1 } })),
}));
