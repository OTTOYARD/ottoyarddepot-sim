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
 * vertices. The worst case is bounded and small: a curved primitive drawn with
 * n segments has a chord that sags r*(1-cos(pi/n)) off the true surface, and
 * `SAMPLING_SAG_M` bounds that over every primitive actually drawn, giving
 * 1.326 mm at ARM_SCALE 0.72. The test requires a margin 75.4x that, so the
 * result cannot be an artefact of how finely the meshes are tessellated.
 *
 * Meshes are culled by bounding sphere before their vertices are touched. Most
 * of the arm (base, plinth, shoulder) is nowhere near the car for the entire
 * cycle, and skipping it whole is what keeps this affordable on a CI runner.
 */

import * as THREE from 'three';
import { buildCobot, type CobotLOD } from './buildCobot';
import { OTTO_CHARGE_ARM, MOUNT_COLLAR, type CobotSpec } from './cobotSpec';
import { type JointAngles } from './cobotIK';
import { clearanceToCar, type CarSolid } from './vehicleEnvelope';

/**
 * Largest distance a mesh face can bulge past the vertices we sample, metres.
 *
 * A curved primitive drawn with n segments has a chord that sags r*(1-cos(pi/n))
 * off the true surface. Sag needs a coarse tessellation AND a big radius, so the
 * bound has to be taken over the two families on this rig SEPARATELY, because
 * only one of them scales:
 *
 *   THE MACHINE scales with ARM_SCALE. Its big parts (base housing, link spines,
 *   the shoulder yoke) are drawn at 20-24 segments and its coarse parts
 *   (6-segment bolt heads, the 6- and 8-segment torus cross-sections, the
 *   7-segment dress pack) are all small. Pairing 20 segments with the largest
 *   radius on it — the base housing at 0.115 * ARM_SCALE — is a pair nothing
 *   actually is, and it bounds all of them.
 *
 *   THE MOUNT does not scale: it is depot hardware bolted to a fixed cabinet.
 *   Its collar is a 24-segment cylinder of radius MOUNT_COLLAR.rBottom whatever
 *   the arm is, so below about ARM_SCALE 1.0 the mount, not the machine, is what
 *   sags most. That is a real crossover and not a hypothetical: at the shipped
 *   0.72 the collar sags 1.326 mm against the machine's 1.019 mm.
 *
 * Boxes and planes are flat and contribute nothing.
 *
 * 1.326 mm at ARM_SCALE 0.72, set by the collar. armClearance.test.ts walks
 * every geometry's own parameters and asserts none exceeds this, so the bound
 * cannot quietly stop being one — and it is what caught the dress pack, which
 * was authored at a fixed 0.014 m radius while the links around it scaled.
 */
const chordSag = (r: number, n: number) => (1 - Math.cos(Math.PI / n)) * r;
export const SAMPLING_SAG_M = Math.max(
  chordSag(OTTO_CHARGE_ARM.radii.base, 20),           // the machine, which scales
  chordSag(MOUNT_COLLAR.rBottom, MOUNT_COLLAR.segments), // the mount, which does not
);

interface SampledMesh {
  name: string;
  mesh: THREE.Mesh;
  verts: Float32Array;
  /** True for the end effector — the only part ALLOWED to reach the bodywork. */
  isTool: boolean;
  /** True for the static plinth — the only part ALLOWED to reach the charger. */
  isMount: boolean;
  /** Local-space bounding sphere, for culling before the vertex loop. */
  cx: number; cy: number; cz: number; r: number;
}

/** Which selection of the machine a clearance query covers. */
export type ArmParts =
  /** everything but the connector */
  | 'structure'
  /** the connector only */
  | 'tool'
  /** every mesh on the machine */
  | 'all'
  /** everything that MOVES — i.e. all of it except the bolted-down plinth */
  | 'moving';

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
  return hasAncestor(o, 'EndEffector');
}

/**
 * Which parts are the MOUNT, and which are the machine.
 *
 * The same distinction the tool needs, at the other end and against the other
 * solid. The plinth is BOLTED TO the charger cabinet — its plate lands flat on
 * the cabinet's face and its cable gland passes through the wall, which is what
 * a cable gland is for. Holding it to "never touches the pedestal" would be
 * asserting that the arm must not be attached to anything. Everything else on
 * the machine moves, and none of it has any business inside the charger.
 */
function isMountPart(o: THREE.Object3D): boolean {
  return hasAncestor(o, 'Mount_Plinth');
}

function hasAncestor(o: THREE.Object3D, name: string): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name === name) return true;
  }
  return false;
}

export interface ArmClearanceRig {
  root: THREE.Group;
  pose(a: JointAngles): void;
  /**
   * Minimum signed clearance to the car, metres.
   * @param which which selection of the machine to measure — see ArmParts.
   */
  clearance(car: CarSolid, which?: ArmParts): { min: number; part: string };
  /**
   * Minimum signed clearance to ANY solid, metres.
   *
   * The car is not the only thing the arm can hit. `clearance` above is this
   * with the car's distance function bound; the pedestal check passes its own.
   * Taking a plain distance function rather than a union of solid types is what
   * keeps the culling, the nearest-first ordering and the pruning in ONE place
   * — the parts of this file that make a 10,000-pose sweep affordable.
   *
   * @param dist  signed distance from a point in the ARM BASE frame, metres,
   *              negative inside. Called once per bounding sphere and then once
   *              per vertex of whatever survives, so it must be cheap.
   */
  clearanceTo(dist: (p: THREE.Vector3) => number, which?: ArmParts): { min: number; part: string };
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
      name: m.name || '(unnamed)', mesh: m, verts,
      isTool: isToolPart(m), isMount: isMountPart(m),
      cx: bs.center.x, cy: bs.center.y, cz: bs.center.z, r: bs.radius,
    });
  });

  const v = new THREE.Vector3();
  // scratch buffers, reused across calls — this runs tens of thousands of times
  const order: SampledMesh[] = new Array(parts.length);
  const bound = new Float64Array(parts.length);
  const indices = new Int32Array(parts.length);

  /** See ArmClearanceRig.clearanceTo. Hoisted so `clearance` can bind the car. */
  function clearanceTo(dist: (p: THREE.Vector3) => number, which: ArmParts = 'all') {
    let min = Infinity;
    let part = '';

    // PASS 1 — bounding-sphere lower bound for every candidate mesh. Cheap:
    // one distance evaluation each, against thousands for a vertex scan.
    let n = 0;
    for (const p of parts) {
      if (which === 'structure' && p.isTool) continue;
      if (which === 'tool' && !p.isTool) continue;
      if (which === 'moving' && p.isMount) continue;
      const mw = p.mesh.matrixWorld;
      // The end-effector group carries a uniform scale (it is normalised so
      // the drawn connector tip lands on the TCP), so the cull radius has to
      // be scaled too — reading it off the matrix rather than assuming 1.
      const sx = Math.hypot(mw.elements[0], mw.elements[1], mw.elements[2]);
      v.set(p.cx, p.cy, p.cz).applyMatrix4(mw);
      order[n] = p;
      bound[n] = dist(v) - p.r * sx;
      n++;
    }

    // PASS 2 — NEAREST FIRST. The order matters more than it looks: the
    // running minimum is what prunes, and walking the arm base-to-tip scans
    // parts that are nowhere near the solid before the running minimum is
    // small enough to reject anything. Sorting by the lower bound first turns
    // almost every mesh into a single distance evaluation.
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
        const d = dist(v);
        if (d < min) { min = d; part = p.name; }
      }
    }
    return { min, part };
  }

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

    clearance(car: CarSolid, which: ArmParts = 'all') {
      return clearanceTo((p) => clearanceToCar(p, car), which);
    },

    clearanceTo,

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
