// What a fleet vehicle model is made from. One VehicleSpec per vehicle lives in specs/.
import type { BodyCurves, Field, Pt, Surface } from './surface';

export type DoorKind = 'hinge' | 'slide' | 'butterfly';

export interface DoorSpec {
  /** FL, FR, RL, RR (front/rear, left/right) or L, R for a two-door body. */
  id: string;
  /** -1 left, +1 right. */
  side: -1 | 1;
  kind: DoorKind;
  /** Leading and trailing cut lines, [tt, xr]: where the edge sits at each height round the section. */
  front: Pt[];
  rear: Pt[];
  /** Lower and upper cut, in ring parameter (2.6 is just above the sill, 8 the roof rail). */
  ttLow: number;
  ttHigh: number;
  /** hinge: swing in degrees, hinged on the leading edge unless `hingeAtRear`. */
  swingDeg?: number;
  hingeAtRear?: boolean;
  /** slide: metres the panel travels, +1 toward the nose or -1 toward the tail, after stepping `popOut` outboard. */
  travel?: number;
  slideDir?: 1 | -1;
  popOut?: number;
  /** butterfly: two points on the hinge line [xr, y, inboard metres from the door skin] and the swing in degrees. */
  axis?: [[number, number, number], [number, number, number]];
}

export type SensorType = 'lidar' | 'camera' | 'radar' | 'thermal' | 'audio' | 'pod';

export interface SensorSpec {
  id: string;
  type: SensorType;
  /** What is drawn. */
  shape: 'spinLidar' | 'puckLidar' | 'windowLidar' | 'camera' | 'radar' | 'box' | 'dome';
  /** Where it sits: on the body surface (station, ring parameter, side) lifted `lift` metres along the normal,
   *  or at an explicit point [xr, y, z]. */
  on?: { xr: number; tt: number; side: -1 | 0 | 1; lift?: number };
  pos?: [number, number, number];
  /** [length, height, width] metres for boxes; [radius, height] for cylinders. */
  size?: number[];
  /** Which way it looks, degrees from straight ahead, positive toward the right. */
  yawDeg?: number;
  /** A note for the facts sheet: what on the real vehicle this stands for. */
  note?: string;
  /** Material override for a box (default gloss black). */
  material?: string;
}

export interface RegionSpec {
  /** Material name from materials.ts. */
  material: string;
  /** The region is where every field is negative. */
  fields: Field[];
  /** Which panels it is painted on. Default: all. */
  on?: 'all' | 'body' | 'doors';
}

export interface SeatSpec { xr: number; z: number; facing: 1 | -1; width?: number }

export interface VehicleSpec {
  key: string;
  name: string;
  /** What is published and what is estimated, in one line each. The sources are in docs/FLEET-MODELS.md. */
  provenance: { dimensions: string; doors: string; sensors: string; chargePort: string };
  operator: string;
  maker: string;
  /** Published or estimated dimensions, metres. */
  dims: {
    length: number; width: number; height: number; wheelbase: number;
    /** Roof height of the body alone, where `height` includes roof equipment. */
    bodyHeight?: number;
    /** Front axle centre, metres back from the front bumper. */
    frontAxle: number;
    track: number; tyreRadius: number; tyreWidth: number; rimRadius: number;
  };
  curves: BodyCurves;
  finish?: 'solid' | 'metallic' | 'satin';
  colors: { paint: number; paint2?: number; trim?: number; interior?: number; rim?: number; accent?: number };
  wheelStyle: 'spoke' | 'disc' | 'aero' | 'paddle';
  /** Radius of the wheel-arch opening. */
  archRadius: number;
  doors: (s: Surface) => DoorSpec[];
  regions: (s: Surface, h: RegionHelpers) => RegionSpec[];
  sensors: SensorSpec[];
  seats: SeatSpec[];
  steeringWheel: boolean;
  /** Door mirrors [xr, y] of the mount, or none. */
  mirrors?: { xr: number; y: number };
  /** Charge port: side, station and height. */
  chargePort?: { side: -1 | 1; xr: number; y: number; note: string };
}

/** Field builders handed to a spec's `regions`. */
export interface RegionHelpers {
  /** A rounded polygon on the side glass band. Points are [xr, h], h = 0 at the belt, 1 at the roof rail. */
  sideGlass(poly: Pt[], r?: number, grow?: number): Field[];
  /** A rounded polygon over the roof, [xr, w], w = 0 at the roof rail, 1 at the centreline. Mirrored. */
  topGlass(poly: Pt[], r?: number, grow?: number): Field[];
  /** A rounded polygon in side view on the lower body, [xr, y]. Both sides unless `side` is given. */
  sidePatch(poly: Pt[], r?: number, side?: -1 | 1): Field[];
  /** A rounded polygon on the nose or tail seen end-on, [z, y], mirrored unless `oneSide`. */
  endPatch(end: 'front' | 'rear', poly: Pt[], r?: number, depth?: number, mirror?: boolean): Field[];
  /** A rounded polygon seen from above on the upper surfaces (bonnet, roof), [xr, z], mirrored. */
  planPatch(poly: Pt[], r?: number): Field[];
  /** Everything on the body side below a line y(xr). */
  below(line: Pt[], ttMax?: number): Field[];
  /** A band of `width` metres along a side-view line y(xr) between two stations. */
  stripe(line: Pt[], width: number, xr0: number, xr1: number): Field[];
}
