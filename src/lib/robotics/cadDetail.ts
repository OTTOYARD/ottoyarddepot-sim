/**
 * THE ROBOTS NEAR THE CAMERA ARE DRAWN AS THE ENGINEERING CAD (Chase, 2026-11-15: "when I click on the robotics tab, I
 * see super high-level detail. But then when I'm watching the overall replay ... it looks much cheaper ... I need super
 * high-level 4K detail when it comes to some of these integrations from a robotic standpoint").
 *
 * The yard draws every robot of a kind from one light model (`<robot>.depot.glb`: no fasteners, coarse curves), which
 * is right from across the depot and wrong up close. So each kind has a second, detail model (`<robot>.near.glb`: every
 * part you can see on the assembled robot, to the last screw, washer and nut, curves fine enough for a 4K close-up, its
 * chains link by link with every cable in its lane), and the robots nearest the camera are drawn from it.
 *
 * This file decides WHICH robots: the ones whose bounding sphere is in the camera's view and within `enterM` metres of
 * it (measured to the sphere, not its centre), nearest first, at most `capacity` of a kind. A robot already drawn in
 * detail keeps its slot until it is `leaveM` away or out of view, so nothing flickers at the edge. The swap is a
 * renderer's choice made from the camera alone: never from a frame time (there is one picture quality, High), and the
 * robot's pose, its session and the twin's world are the same whichever model draws it.
 *
 * Pure, so the tests drive it with a camera of their own.
 */
import * as THREE from 'three';
import type { RobotKey } from './catalog';

export interface DetailRule {
  /** robots of the kind drawn in detail at once */
  capacity: number;
  /** a robot enters detail when its bounding sphere comes this near the camera, metres */
  enterM: number;
  /** and leaves it when it is this far, metres (more than enterM: no flicker at the edge) */
  leaveM: number;
}

/**
 * Up close a robot fills the view; from 16 m a charge arm is a sixth of a 45-degree view's height, and its depot model's
 * facets and missing screws start to show on a 4K screen. Each arm is about 0.8 million triangles in detail (the charge
 * arm) and 0.24 million (the cleaning arm), a wash machine 1.7 million, so the capacity bounds what the detail adds to a
 * frame: at most 4 + 4 arms and 2 wash machines, and only those in view.
 */
export const DETAIL_RULES: Readonly<Record<RobotKey, DetailRule>> = {
  charge_arm: { capacity: 4, enterM: 16, leaveM: 19 },
  clean_arm: { capacity: 4, enterM: 16, leaveM: 19 },
  wash_gantry: { capacity: 2, enterM: 22, leaveM: 26 },
};

interface Placed { x: number; y: number; z: number; r: number }

const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();

/** Which robots of each kind the yard draws in detail now, and in which slot of the kind's detail fleet. */
export class DetailDirector {
  /** world units a metre (the yard is in plan units) */
  private readonly unitsPerMetre: number;
  private readonly rules: Readonly<Record<RobotKey, DetailRule>>;
  private readonly placed = new Map<RobotKey, Map<number, Placed>>();
  /** robot index -> detail slot, per kind */
  private readonly slots = new Map<RobotKey, Map<number, number>>();
  /** detail slot -> robot index, per kind (-1 free) */
  private readonly owners = new Map<RobotKey, number[]>();
  /** detail slots whose owner changed this update: the caller clears them before the robots draw */
  private readonly released = new Map<RobotKey, number[]>();
  private readonly wantedOnce = new Set<RobotKey>();
  /** called the first time a kind has a robot in detail range (the yard fetches that kind's detail model then) */
  onFirstWant: ((kind: RobotKey) => void) | null = null;

  constructor(unitsPerMetre: number, rules: Readonly<Record<RobotKey, DetailRule>> = DETAIL_RULES) {
    this.unitsPerMetre = unitsPerMetre;
    this.rules = rules;
    for (const k of Object.keys(rules) as RobotKey[]) {
      this.placed.set(k, new Map());
      this.slots.set(k, new Map());
      this.owners.set(k, Array.from({ length: rules[k].capacity }, () => -1));
      this.released.set(k, []);
    }
  }

  /** Where a robot stands: its bounding sphere in world units (the yard's frame). Call when it moves. */
  place(kind: RobotKey, index: number, x: number, y: number, z: number, r: number): void {
    this.placed.get(kind)?.set(index, { x, y, z, r });
  }

  /** A robot leaves the yard (its component unmounts). */
  remove(kind: RobotKey, index: number): void {
    this.placed.get(kind)?.delete(index);
    const s = this.slots.get(kind)?.get(index);
    if (s !== undefined) {
      this.slots.get(kind)!.delete(index);
      this.owners.get(kind)![s] = -1;
      this.released.get(kind)!.push(s);
    }
  }

  /**
   * Choose the detail robots for this camera. `ready(kind)`: the kind's detail model has loaded (until then none of its
   * robots takes a slot, but a robot in range still asks for the model). Returns the slots to clear, per kind.
   */
  update(camera: THREE.Camera, ready: (kind: RobotKey) => boolean): ReadonlyMap<RobotKey, number[]> {
    camera.updateMatrixWorld();
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const cam = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    for (const [kind, rule] of Object.entries(this.rules) as [RobotKey, DetailRule][]) {
      const slots = this.slots.get(kind)!;
      const owners = this.owners.get(kind)!;
      const released = this.released.get(kind)!;
      const placed = this.placed.get(kind)!;
      const enter = rule.enterM * this.unitsPerMetre, leave = rule.leaveM * this.unitsPerMetre;
      const cands: { index: number; d: number; held: boolean }[] = [];
      for (const [index, p] of placed) {
        _sphere.center.set(p.x, p.y, p.z);
        _sphere.radius = p.r;
        if (!_frustum.intersectsSphere(_sphere)) continue;
        const d = Math.max(0, cam.distanceTo(_sphere.center) - p.r);
        const held = slots.has(index);
        if (d <= (held ? leave : enter)) cands.push({ index, d, held });
      }
      if (cands.length && !this.wantedOnce.has(kind)) {
        this.wantedOnce.add(kind);
        this.onFirstWant?.(kind);
      }
      const want = ready(kind) ? cands.sort((a, b) => a.d - b.d).slice(0, rule.capacity) : [];
      const keep = new Set(want.map((c) => c.index));
      // free the slots of robots that left
      for (const [index, s] of [...slots]) {
        if (!keep.has(index)) {
          slots.delete(index);
          owners[s] = -1;
          released.push(s);
        }
      }
      // give each new robot a free slot
      for (const c of want) {
        if (slots.has(c.index)) continue;
        const s = owners.indexOf(-1);
        if (s < 0) break;
        owners[s] = c.index;
        slots.set(c.index, s);
        if (!released.includes(s)) released.push(s);
      }
    }
    const out = new Map<RobotKey, number[]>();
    for (const [k, r] of this.released) { out.set(k, [...r]); r.length = 0; }
    return out;
  }

  /** The robot's detail slot, or -1 when the depot model draws it. */
  slotOf(kind: RobotKey, index: number): number {
    return this.slots.get(kind)?.get(index) ?? -1;
  }

  /** How many robots of a kind are in detail now. */
  count(kind: RobotKey): number {
    return this.slots.get(kind)?.size ?? 0;
  }
}
