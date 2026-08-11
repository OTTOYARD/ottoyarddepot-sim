/**
 * DOES THE ROBOT TOUCH THE CAR?
 *
 * The question no test in this package asked. Every existing kinematics check
 * measures the arm against a PLANE (the flank), a POINT (the port) or the
 * DECK. A plane is not a car: it says nothing about an elbow riding over the
 * roofline, a forearm cutting the corner of the greenhouse, or a wrist housing
 * clipping the sill on the way out. A resize that did exactly that passed all
 * 26 arm tests unmodified.
 *
 * ─────────────────────────────────────────────────────────────── METHOD ─────
 * The arm is measured as DRAWN — buildCobot's actual meshes, posed by the
 * actual joint chain — against the car solid from vehicleEnvelope.ts, which is
 * a superset of the drawn body. For each pose we take the minimum signed
 * clearance over every surface vertex of every mesh.
 *
 * Vertex sampling can in principle miss a face that passes between two
 * vertices. The worst case is bounded and small: the coarsest curved part is a
 * 20-segment cylinder, whose chord sags r*(1-cos(pi/20)) = 0.0123*r below the
 * true surface — under 1 mm on the largest housing. `SAMPLING_SAG_M` states
 * that bound, and the test requires a margin an order of magnitude larger, so
 * the result cannot be an artefact of how finely the meshes are tessellated.
 *
 * Meshes are culled by bounding sphere before their vertices are touched. Most
 * of the arm (base, plinth, shoulder) is nowhere near the car for the entire
 * cycle, and skipping it whole is what keeps this affordable on a CI runner.
 */

import * as THREE from 'three';
import { buildCobot, type CobotLOD } from './buildCobot';
import { OTTO_CHARGE_ARM, type CobotSpec } from './cobotSpec';
import { type JointAngles } from './cobotIK';
import { clearanceToCar, type CarSolid } from './vehicleEnvelope';

/**
 * Largest distance a mesh face can bulge past the vertices we sample, metres.
 *
 * Driven by the coarsest CURVED primitive in buildCobot at the sizes it is
 * built at: a 20-segment cylinder of radius r sags r*(1 - cos(pi/20)). The
 * biggest such radius on the arm is the base housing at 0.115 * ARM_SCALE.
 * Boxes and planes are flat, so they contribute nothing.
 */
export const SAMPLING_SAG_M =
  (1 - Math.cos(Math.PI / 20)) * OTTO_CHARGE_ARM.radii.base; // ~1.7 mm at ARM_SCALE 1.2

interface SampledMesh {
  name: string;
  mesh: THREE.Mesh;
  verts: Float32Array;
  /** True for the end effector — the only part ALLOWED to reach the bodywork. */
  isTool: boolean;
  /** Local-space bounding sphere, for culling before the vertex loop. */
  cx: number; cy: number; cz: number; r: number;
}

/**
 * Which parts of the arm are the connector, and which are structure.
 *
 * The distinction is the whole basis of the clearance rule. STRUCTURE — every
 * link, housing and the plinth — has no business anywhere near the car and is
 * held to a real margin. The END EFFECTOR is supposed to arrive at the inlet
 * and touch it; holding it to the same margin would be asserting that a
 * charging robot must never make contact with the vehicle it charges.
 */
function isToolPart(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name === 'EndEffector') return true;
  }
  return false;
}

export interface ArmClearanceRig {
  root: THREE.Group;
  pose(a: JointAngles): void;
  /**
   * Minimum signed clearance to the car, metres.
   * @param which 'structure' = everything but the connector; 'tool' = the
   *              connector only; 'all' = the whole arm.
   */
  clearance(car: CarSolid, which?: 'structure' | 'tool' | 'all'): { min: number; part: string };
  /** World position of a named node — used to check the connector reaches the port. */
  nodeWorld(name: string): THREE.Vector3;
  /**
   * How far the DRAWN connector reaches past the TCP, along the tool axis.
   *
   * Signed, metres. Negative means the meshes stop SHORT of the working point
   * the IK drives onto the charge port — i.e. the connector does not actually
   * arrive at the inlet, however exact the empty is.
   */
  drawnTipVsTcp(): number;
  meshCount: number;
  vertexCount: number;
}

/**
 * Build a posable arm whose distance to a car solid can be measured.
 *
 * The rig is placed at the ARM BASE FRAME origin with no rotation, which is
 * exactly the frame carSolidInArmFrame() and portInArmFrame() use, so no
 * transform sits between the two things being compared.
 */
export function makeArmClearanceRig(
  spec: CobotSpec = OTTO_CHARGE_ARM,
  lod: CobotLOD = 'studio',
): ArmClearanceRig {
  const rig = buildCobot(spec, { withPlinth: true, lod });
  const scene = new THREE.Scene();
  scene.add(rig.root);
  scene.updateMatrixWorld(true);

  const parts: SampledMesh[] = [];
  const cache = new Map<string, Float32Array>();
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const key = m.geometry.uuid;
    let verts = cache.get(key);
    if (!verts) {
      const attr = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      verts = new Float32Array(attr.array as ArrayLike<number>);
      cache.set(key, verts);
    }
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const bs = m.geometry.boundingSphere!;
    parts.push({
      name: m.name || '(unnamed)', mesh: m, verts, isTool: isToolPart(m),
      cx: bs.center.x, cy: bs.center.y, cz: bs.center.z, r: bs.radius,
    });
  });

  const v = new THREE.Vector3();
  // scratch buffers, reused across calls — this runs tens of thousands of times
  const order: SampledMesh[] = new Array(parts.length);
  const bound = new Float64Array(parts.length);
  const indices = new Int32Array(parts.length);

  return {
    root: rig.root,
    meshCount: parts.length,
    vertexCount: parts.reduce((n, p) => n + p.verts.length / 3, 0),

    pose(a: JointAngles) {
      rig.j1.rotation.set(0, a.j1, 0);
      rig.j2.rotation.set(a.j2, 0, 0);
      rig.j3.rotation.set(a.j3, 0, 0);
      rig.j4.rotation.set(0, a.j4, 0);
      rig.j5.rotation.set(a.j5, 0, 0);
      rig.j6.rotation.set(0, a.j6, 0);
      scene.updateMatrixWorld(true);
    },

    clearance(car: CarSolid, which: 'structure' | 'tool' | 'all' = 'all') {
      let min = Infinity;
      let part = '';

      // PASS 1 — bounding-sphere lower bound for every candidate mesh. Cheap:
      // one distance evaluation each, against thousands for a vertex scan.
      let n = 0;
      for (const p of parts) {
        if (which === 'structure' && p.isTool) continue;
        if (which === 'tool' && !p.isTool) continue;
        const mw = p.mesh.matrixWorld;
        // The end-effector group carries a uniform scale (it is normalised so
        // the drawn connector tip lands on the TCP), so the cull radius has to
        // be scaled too — reading it off the matrix rather than assuming 1.
        const sx = Math.hypot(mw.elements[0], mw.elements[1], mw.elements[2]);
        v.set(p.cx, p.cy, p.cz).applyMatrix4(mw);
        order[n] = p;
        bound[n] = clearanceToCar(v, car) - p.r * sx;
        n++;
      }

      // PASS 2 — NEAREST FIRST. The order matters more than it looks: the
      // running minimum is what prunes, and walking the arm base-to-tip scans
      // the plinth (which is never anywhere near the car) before the running
      // minimum is small enough to reject anything. Sorting by the lower bound
      // first turns almost every mesh into a single distance evaluation.
      const idx = indices.subarray(0, n);
      for (let i = 0; i < n; i++) idx[i] = i;
      idx.sort((a, b) => bound[a] - bound[b]);

      for (let k = 0; k < n; k++) {
        const i = idx[k];
        if (bound[i] >= min) break; // sorted: nothing after this can win either
        const p = order[i];
        const mw = p.mesh.matrixWorld;
        const a = p.verts;
        for (let j = 0; j < a.length; j += 3) {
          v.set(a[j], a[j + 1], a[j + 2]).applyMatrix4(mw);
          const d = clearanceToCar(v, car);
          if (d < min) { min = d; part = p.name; }
        }
      }
      return { min, part };
    },

    nodeWorld(name: string) {
      const n = rig.root.getObjectByName(name);
      if (!n) throw new Error(`armClearance: no node named ${name}`);
      return n.getWorldPosition(new THREE.Vector3());
    },

    drawnTipVsTcp() {
      const ee = rig.root.getObjectByName('EndEffector');
      if (!ee) throw new Error('armClearance: no EndEffector group');
      // tool axis = the end effector's own +Y, in world
      const axis = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(ee.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const tcp = rig.tcp.getWorldPosition(new THREE.Vector3());
      let furthest = -Infinity;
      for (const p of parts) {
        if (!p.isTool) continue;
        const mw = p.mesh.matrixWorld;
        const a = p.verts;
        for (let i = 0; i < a.length; i += 3) {
          v.set(a[i], a[i + 1], a[i + 2]).applyMatrix4(mw).sub(tcp);
          furthest = Math.max(furthest, v.dot(axis));
        }
      }
      return furthest;
    },
  };
}
