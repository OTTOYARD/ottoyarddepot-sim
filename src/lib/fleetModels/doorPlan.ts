// A fleet vehicle's doors seen from above, for the 2D plan: each door as one line at mid body side, from its leading
// edge to its trailing edge, where its own rig puts it (doorRigs.ts, the rig the 3D yard and the robots' clearance
// use). PURE and light: two surface points a door, made once a model.
//
// Frame: the car's own, metres: x along the car + toward the nose from its middle, z across + toward the right flank.
import { doorPointAt, doorRigOf, DOOR_PIVOT_TT, type DoorRig } from './doorRigs';
import { fleetSpec } from './fleet';
import { makeSurface, polyline } from './surface';

export interface DoorPlanLine { a: { x: number; z: number }; b: { x: number; z: number } }

interface ShutDoor { rig: DoorRig; lead: [number, number, number]; trail: [number, number, number] }

const cache = new Map<string, ShutDoor[]>();

function doorsOf(key: string): ShutDoor[] {
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = fleetSpec(key);
  const made: ShutDoor[] = [];
  if (spec) {
    const s = makeSurface(spec.curves);
    for (const d of spec.doors(s)) {
      const xf = polyline(d.front)(DOOR_PIVOT_TT), xb = polyline(d.rear)(DOOR_PIVOT_TT);
      made.push({ rig: doorRigOf(d, s), lead: s.point(xf, DOOR_PIVOT_TT, d.side), trail: s.point(xb, DOOR_PIVOT_TT, d.side) });
    }
  }
  cache.set(key, made);
  return made;
}

/**
 * The doors of one flank of a fleet vehicle, open `open01` (0 shut .. 1 open), as plan lines. Empty for an unknown key.
 * `each` gives each door of the flank its own opening, front to rear in the vehicle's own door order; a door it
 * leaves shut is not drawn.
 */
export function fleetDoorPlanLines(key: string, side: 1 | -1, open01: number, each?: readonly number[]): DoorPlanLine[] {
  const out: DoorPlanLine[] = [];
  const flank = doorsOf(key).filter((d) => d.rig.side === side);
  for (const d of flank) {
    // which door of its flank, front to rear: the doors whose pivot is nearer the nose
    const f = each?.[flank.filter((o) => o.rig.pivot[0] > d.rig.pivot[0]).length] ?? open01;
    if (each && !(f > 0)) continue;
    const a = doorPointAt(d.rig, f, d.lead), b = doorPointAt(d.rig, f, d.trail);
    out.push({ a: { x: a[0], z: a[2] }, b: { x: b[0], z: b[2] } });
  }
  return out;
}
