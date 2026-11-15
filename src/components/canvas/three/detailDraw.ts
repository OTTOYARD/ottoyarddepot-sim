import type * as THREE from 'three';
import type { RobotKey } from '@/lib/robotics/catalog';
import type { DetailDirector } from '@/lib/robotics/cadDetail';
import type { FlexFleet, FlexSkeleton } from '@/lib/robotics/flexMesh';
import { writeFleetSlot, writeFleetLight, clearFleetSlot, type InstancedFleet } from './instancedFleet';

/**
 * ONE ROBOT, DRAWN BY THE MODEL THE CAMERA CALLS FOR (robotics/cadDetail.ts). Every robot of a kind has a slot in the
 * kind's depot fleet; the few nearest the camera are also given a slot in the kind's detail fleet, and while they have
 * it they draw there and their depot slot is empty. The robot's skeleton, pose, lights and lines are the same either
 * way: the two models have the same joints, so one skeleton's segments place both.
 *
 * The director frees a detail slot and clears it before the robots draw (DetailFrame, useFrame priority -1), so a robot
 * never clears a detail slot itself: it only writes the one it holds.
 */

/** One robot kind's detail fleets, shared by its robots. */
export interface DetailFleets {
  kind: RobotKey;
  director: DetailDirector;
  fleet: InstancedFleet;
  flex: FlexFleet | null;
}

/** A robot's own slot in its kind's depot fleets. */
export interface FarSlot {
  fleet: InstancedFleet;
  flex?: FlexFleet | null;
  slot: number;
}

/** Light channels past the status light: [channel, colour, glow] (a wash machine's stop lamps). */
export type ExtraLights = readonly (readonly [number, number, number])[];

/**
 * Draw one robot this frame. `seen` is the robot's own memory of where it drew last frame (true: in detail), so its
 * depot slot is emptied once when it goes to detail, not every frame.
 */
export function drawRobot(
  far: FarSlot, detail: DetailFleets | null | undefined, segments: readonly THREE.Object3D[], skel: FlexSkeleton | null,
  status: number, glow: number, lights: ExtraLights, seen: { detail: boolean },
): void {
  const ds = detail ? detail.director.slotOf(detail.kind, far.slot) : -1;
  if (detail && ds >= 0) {
    writeFleetSlot(detail.fleet, ds, segments, status, glow);
    for (const [ch, hex, g] of lights) writeFleetLight(detail.fleet, ds, ch, hex, g);
    if (detail.flex && skel) detail.flex.write(ds, skel);
    if (!seen.detail) {
      clearFleetSlot(far.fleet, far.slot);
      far.flex?.clear(far.slot);
      seen.detail = true;
    }
    return;
  }
  seen.detail = false;
  writeFleetSlot(far.fleet, far.slot, segments, status, glow);
  for (const [ch, hex, g] of lights) writeFleetLight(far.fleet, far.slot, ch, hex, g);
  if (far.flex && skel) far.flex.write(far.slot, skel);
}

/** Empty the detail slots the director freed this frame (call before the robots draw). */
export function clearReleased(detail: DetailFleets | null | undefined, slots: readonly number[] | undefined): void {
  if (!detail || !slots) return;
  for (const s of slots) {
    clearFleetSlot(detail.fleet, s);
    detail.flex?.clear(s);
  }
}
