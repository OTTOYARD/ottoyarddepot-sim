import * as THREE from 'three';
import { doorPose, type DoorRig } from '@/lib/fleetModels/rig';
import { paintFinishOf } from '@/lib/fleetModels/materials';
import { toYardFrame, YARD_FROM_MODEL, type YardModel, type YardPartKind } from '@/lib/fleetModels/yardLod';

/**
 * EVERY CAR OF ONE VEHICLE MODEL, INSTANCED: the yard's light model of a fleet vehicle (lib/fleetModels/yardLod.ts)
 * drawn for every car of that model in a fixed number of draw calls, whatever the number of cars. No React.
 *
 *   static body   one InstancedMesh per finish (paint, gloss, matte, rim, lamps: at most five), all on ONE
 *                 instance-matrix buffer, the car's own pose
 *   doors         each door its own geometry (panel, and window where it has one) on its own buffer: the car's pose
 *                 times the door's rig pose (rig.doorPose), so a door opens as the full model's does
 *   status        the light strips, on their own buffer and colour (hidden for a car that is not being worked on)
 *   shadow        the closed body on a very coarse grid, the only part that casts: the shadow pass draws about 600
 *                 triangles a car, not the model
 *
 * This draws, and nothing else: the traffic model's car, every clearance and every robot still read the one generic
 * car (traffic.CAR_LENGTH / CAR_WIDTH, vehicleEnvelope). A model is centred on the same point, at the same heading.
 */

/** A finish whose panels are one skin thick: the back of a panel is drawn, dark, so an open door shows a cabin side
 *  and a door's inner face without a second skin. */
function darkBack<M extends THREE.Material>(m: M, key: string): M {
  m.side = THREE.DoubleSide;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\nif (!gl_FrontFacing) gl_FragColor.rgb *= 0.07;',
    );
  };
  m.customProgramCacheKey = () => key;
  return m;
}

const paints = new Map<string, THREE.MeshPhysicalMaterial>();
/** Clear-coated paint in a model's finish. The colour is per vertex (the spec's paint, second colour and accent). */
function paintMaterial(finish: YardModel['finish']): THREE.MeshPhysicalMaterial {
  let m = paints.get(finish);
  if (!m) {
    m = darkBack(new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, ...paintFinishOf(finish) }), `otto-yard-paint-${finish}`);
    paints.set(finish, m);
  }
  return m;
}

const SHARED = {
  // Glass is opaque in the yard, as the generic car's is: nothing is drawn behind it, and it sorts for free.
  gloss: darkBack(new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.08, metalness: 0.3 }), 'otto-yard-gloss'),
  matte: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.75, metalness: 0.1, side: THREE.DoubleSide }),
  rim: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.32, metalness: 0.85, side: THREE.DoubleSide }),
  // Lamps are their own light: unlit, coloured per vertex, over 1.0 where the bloom pass should catch them.
  lamps: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  // Colour per car through instanceColor, as the generic car's strips.
  status: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, side: THREE.DoubleSide }),
  // Seen only by the shadow pass: it writes no colour and no depth in the picture.
  shadow: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
};

function materialFor(kind: YardPartKind, finish: YardModel['finish']): THREE.Material {
  return kind === 'paint' ? paintMaterial(finish) : SHARED[kind];
}

/** A model's geometries in the yard's frame, converted once per page. */
interface YardGeometry {
  body: { kind: YardPartKind; geometry: THREE.BufferGeometry }[];
  status: THREE.BufferGeometry;
  shadow: THREE.BufferGeometry;
}
const converted = new Map<string, YardGeometry>();
function yardGeometry(model: YardModel): YardGeometry {
  let g = converted.get(model.key);
  if (!g) {
    g = {
      body: model.body.map((p) => ({ kind: p.kind, geometry: toYardFrame(p.geometry) })),
      status: toYardFrame(model.status),
      shadow: toYardFrame(model.shadow),
    };
    converted.set(model.key, g);
  }
  return g;
}

function matrixBuffer(capacity: number): THREE.InstancedBufferAttribute {
  const b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
  b.setUsage(THREE.DynamicDrawUsage);
  return b;
}

/** The fleet spans the lot and its cars move: a bounding sphere three computes once would go stale. */
const EVERYWHERE = new THREE.Sphere(new THREE.Vector3(), 1e6);

export interface ModelFleetDoor {
  rig: DoorRig;
  /** The shut door's node in the car's yard frame: YARD_FROM_MODEL x doorPose(rig, 0). */
  shut: THREE.Matrix4;
  m: THREE.InstancedBufferAttribute;
  meshes: THREE.InstancedMesh[];
}

export interface ModelFleet {
  key: string;
  capacity: number;
  /** The car's pose, shared by the body parts and the shadow body. */
  carM: THREE.InstancedBufferAttribute;
  /** The painted body: it carries the pointer events. */
  pick: THREE.InstancedMesh;
  body: THREE.InstancedMesh[];
  doors: ModelFleetDoor[];
  status: THREE.InstancedMesh;
  shadow: THREE.InstancedMesh;
  /** Every mesh, the painted body first. */
  meshes: THREE.InstancedMesh[];
  /** Draw calls in the picture, and in the shadow pass. */
  draws: { main: number; shadow: number };
  setCount(n: number): void;
  dispose(): void;
}

const ONE = new THREE.Vector3(1, 1, 1);

/** A door node's matrix in the car's yard frame at opening `t` (0 shut .. 1 open). */
export function doorLocal(rig: DoorRig, t: number, out: THREE.Matrix4): THREE.Matrix4 {
  const p = doorPose(rig, t);
  return out.compose(p.position, p.quaternion, ONE).premultiply(YARD_FROM_MODEL);
}

export function makeModelFleet(model: YardModel, capacity: number): ModelFleet {
  const geo = yardGeometry(model);
  const carM = matrixBuffer(capacity);
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, m: THREE.InstancedBufferAttribute) => {
    const x = new THREE.InstancedMesh(g, mat, capacity);
    x.instanceMatrix = m;
    x.frustumCulled = false;
    x.count = 0;
    return x;
  };
  const body = geo.body.map((p) => mesh(p.geometry, materialFor(p.kind, model.finish), carM));
  const pick = body[0];
  pick.boundingSphere = EVERYWHERE;
  const doors: ModelFleetDoor[] = model.doors.map((d) => {
    const m = matrixBuffer(capacity);
    return {
      rig: d.rig,
      shut: doorLocal(d.rig, 0, new THREE.Matrix4()),
      m,
      meshes: d.parts.map((p) => mesh(p.geometry, materialFor(p.kind, model.finish), m)),
    };
  });
  const status = mesh(geo.status, SHARED.status, matrixBuffer(capacity));
  status.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const shadow = mesh(geo.shadow, SHARED.shadow, carM);
  shadow.castShadow = true;
  // the shadow body is not a thing to point at
  shadow.raycast = () => {};
  const meshes = [...body, ...doors.flatMap((d) => d.meshes), status, shadow];
  return {
    key: model.key,
    capacity,
    carM,
    pick,
    body,
    doors,
    status,
    shadow,
    meshes,
    draws: { main: meshes.length, shadow: 1 },
    setCount(n) { for (const x of meshes) x.count = n; },
    dispose() { for (const x of meshes) x.dispose(); },
  };
}

const carScratch = new THREE.Matrix4();
const doorScratch = new THREE.Matrix4();
const outScratch = new THREE.Matrix4();

/**
 * Write one car into its slot: the car at (x, y, z) turned `yaw` (the generic car's own transform, fleetMath.writeYaw),
 * each door at its opening. `right` and `left` are the door store's opening fractions for the two flanks; a door on the
 * car's right (rig.side +1) reads `right`.
 */
export function writeModelCar(fleet: ModelFleet, slot: number, x: number, y: number, z: number, yaw: number, right: number, left: number, lit: boolean): void {
  carScratch.makeRotationY(yaw).setPosition(x, y, z);
  carScratch.toArray(fleet.carM.array, slot * 16);
  const st = fleet.status.instanceMatrix.array as Float32Array;
  if (lit) carScratch.toArray(st, slot * 16); else st.fill(0, slot * 16, slot * 16 + 16);
  for (const d of fleet.doors) {
    const t = d.rig.side > 0 ? right : left;
    const local = t > 0 ? doorLocal(d.rig, t, doorScratch) : d.shut;
    outScratch.multiplyMatrices(carScratch, local).toArray(d.m.array, slot * 16);
  }
}

/** After a frame's writeModelCar calls. */
export function commitModelFleet(fleet: ModelFleet): void {
  fleet.carM.needsUpdate = true;
  fleet.status.instanceMatrix.needsUpdate = true;
  for (const d of fleet.doors) d.m.needsUpdate = true;
}
