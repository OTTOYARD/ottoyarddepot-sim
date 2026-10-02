// ============================================================================
// The live view's cameras: the depot from each corner of the lot, from a mast at its middle, and from overhead.
//
// World frame (src/components/canvas/three/coordUtils.ts): east = -X, north = +Z, south = -Z, up = +Y, one unit ≈ 0.46 m
// (a 10 ft stall is 6.7 units). The fenced lot spans x ±144 and z -96..104, so each corner camera stands just outside
// its corner at roughly a light pole's height and looks across the whole site. The pole camera stands on a mast at the
// middle of the lot and looks around from it: its target sits one unit in front of the lens, so turning the view
// turns the camera on the mast instead of carrying it round the depot.
// Tuned against screenshots of the empty depot and of a live run (scripts/viewerShots.mjs).
// ============================================================================
import type { ViewerCamId } from "./protocol";

export type V3 = [number, number, number];

export interface ViewerCam {
  id: ViewerCamId;
  label: string;
  /** What the shot shows, for the button's title. */
  hint: string;
  position: V3;
  target: V3;
  kind: "orbit" | "pole";
}

/** A point one unit from `from`, at compass bearing `bearing` (0 = north, 90 = east) and `pitch` degrees below level. */
export function lookFrom(from: V3, bearing: number, pitch: number): V3 {
  const b = (bearing * Math.PI) / 180, p = (pitch * Math.PI) / 180;
  // north is +Z and east is -X in this world
  return [from[0] - Math.sin(b) * Math.cos(p), from[1] - Math.sin(p), from[2] + Math.cos(b) * Math.cos(p)];
}

const POLE: V3 = [0, 84, -6];

export const VIEWER_CAMS: Record<ViewerCamId, ViewerCam> = {
  se: { id: "se", label: "SE", hint: "From the south-east corner, over the east gate", position: [-150, 96, -132], target: [-4, 0, 16], kind: "orbit" },
  sw: { id: "sw", label: "SW", hint: "From the south-west corner", position: [150, 96, -132], target: [4, 0, 16], kind: "orbit" },
  ne: { id: "ne", label: "NE", hint: "From the north-east corner, over the service building", position: [-150, 96, 140], target: [-4, 0, -6], kind: "orbit" },
  nw: { id: "nw", label: "NW", hint: "From the north-west corner", position: [150, 96, 140], target: [4, 0, -6], kind: "orbit" },
  pole: { id: "pole", label: "Pole", hint: "From a mast at the middle of the lot, looking around", position: POLE, target: lookFrom(POLE, 315, 38), kind: "pole" },
  top: { id: "top", label: "Top", hint: "Straight down, north up", position: [0, 252, -50], target: [0, 0, -6], kind: "orbit" },
};

/** Lot bounds the corner cameras stand just outside of (coordUtils + the perimeter planting in DepotScene3D). */
export const LOT = { xMin: -144, xMax: 144, zMin: -96, zMax: 104 } as const;
