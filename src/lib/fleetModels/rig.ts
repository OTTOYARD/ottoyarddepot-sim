// Door motion. A door node carries userData.door, written by build.ts; this is the only code that moves one.
import * as THREE from 'three';

import type { DoorRig } from './doorRigs';
export type { DoorRig } from './doorRigs';

const smooth = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

/** Where a door is at `t` (0 shut, 1 open): its node position and rotation. */
export function doorPose(rig: DoorRig, t: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const position = new THREE.Vector3(...rig.pivot);
  const quaternion = new THREE.Quaternion();
  if (rig.kind === 'slide') {
    // A sliding door steps clear of the body first, then runs along it.
    const o = smooth(0, 0.3, t);
    const a = smooth(0.15, 1, t);
    position.x += rig.out![0] * o + rig.along![0] * a;
    position.y += rig.out![1] * o + rig.along![1] * a;
    position.z += rig.out![2] * o + rig.along![2] * a;
  } else {
    quaternion.setFromAxisAngle(new THREE.Vector3(...rig.axis!), rig.angle! * smooth(0, 1, t));
  }
  return { position, quaternion };
}

export function doorNodes(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.userData.door) out.push(o); });
  return out;
}

/** Open every door to `t`, or each door to its own value by id. */
export function setDoors(root: THREE.Object3D, t: number | Record<string, number>): void {
  for (const n of doorNodes(root)) {
    const rig = n.userData.door as DoorRig;
    const v = typeof t === 'number' ? t : t[rig.id] ?? 0;
    const p = doorPose(rig, v);
    n.position.copy(p.position);
    n.quaternion.copy(p.quaternion);
  }
}

/** One clip that opens every door over `seconds`, for exported files and for players that cannot run setDoors. */
export function doorClip(root: THREE.Object3D, seconds = 2): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const steps = 8;
  for (const n of doorNodes(root)) {
    const rig = n.userData.door as DoorRig;
    const times: number[] = [];
    const pos: number[] = [];
    const rot: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const p = doorPose(rig, i / steps);
      times.push((i / steps) * seconds);
      pos.push(p.position.x, p.position.y, p.position.z);
      rot.push(p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w);
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${n.name}.position`, times, pos));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${n.name}.quaternion`, times, rot));
  }
  return new THREE.AnimationClip('doors_open', seconds, tracks);
}
