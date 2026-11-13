// The yard's light model of a fleet vehicle: built once, baked to a few merged geometries, drawn instanced.
//
// buildVehicle(spec) is a close-up model (115,000 to 145,000 triangles, some forty meshes). The yard draws up to 116
// cars, so it draws each vehicle model from this bake instead:
//   - the same surface and the same cuts, on a coarser grid, outer skin only (build.ts `yard`);
//   - everything that does not move merged BY KIND OF FINISH into at most five geometries, coloured per vertex, so a
//     model's static body is at most five draw calls for every car of that model together;
//   - each door kept as its own part in its own node's frame, with its rig, so doorPose() still moves it;
//   - a status light strip and a coarse closed body for the shadow pass.
// Pure: no React, no renderer. Everything is in the model's own frame (metres, +X nose, +Y up, +Z right) until
// toYardFrame / YARD_FROM_MODEL turn it into the yard's.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { buildVehicle, YARD_DETAIL } from './build';
import { doorNodes, setDoors, type DoorRig } from './rig';
import { K_SILL, makeSurface, type SurfVertex, type Tri } from './surface';
import type { VehicleSpec } from './spec';

/** The finishes a yard model is merged into. One material each in the renderer. */
export type YardPartKind = 'paint' | 'gloss' | 'matte' | 'rim' | 'lamps';
export const YARD_PART_KINDS: readonly YardPartKind[] = ['paint', 'gloss', 'matte', 'rim', 'lamps'];

/** Which finish each of materials.ts's materials is drawn with in the yard. */
const KIND_OF: Readonly<Record<string, YardPartKind>> = {
  paint: 'paint', paint2: 'paint', accent: 'paint', sensorWhite: 'paint',
  glass: 'gloss', glassDark: 'gloss', glassBlack: 'gloss', sensorGloss: 'gloss', lens: 'gloss',
  trim: 'matte', cladding: 'matte', rubber: 'matte', rimDark: 'matte', interior: 'matte', seat: 'matte',
  cavity: 'matte', sensorBody: 'matte', plate: 'matte',
  rim: 'rim',
  lampHead: 'lamps', lampTail: 'lamps', lampAmber: 'lamps',
};

export interface YardPart {
  kind: YardPartKind;
  /** position, normal and color (linear RGB; a lamp's is its light, and may pass 1). Indexed. */
  geometry: THREE.BufferGeometry;
}

export interface YardDoor {
  id: string;
  /** The door's motion, as build.ts wrote it: doorPose(rig, t) is its node's pose in the model's frame. */
  rig: DoorRig;
  /** In the door node's own frame. At most two: the panel ('paint') and its window ('gloss'). */
  parts: YardPart[];
}

export interface YardModel {
  key: string;
  finish: 'solid' | 'metallic' | 'satin';
  /** Everything that does not move, doors shut or open: at most one part per kind. */
  body: YardPart[];
  doors: YardDoor[];
  /** Light strips along both sills and both roof edges, clear of every door. Position and normal only. */
  status: THREE.BufferGeometry;
  /** The closed body on a very coarse grid, for the shadow pass. Position only. */
  shadow: THREE.BufferGeometry;
  /** Bounds of the body skin and the shut doors, without wheels, mirrors or sensors. */
  bodyBox: THREE.Box3;
  /** Triangles drawn per car: body, doors and status strips. */
  triangles: number;
}

export const triangleCount = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/**
 * The model's frame to the yard's: metres to plan units, and the nose from +X to +Z. The yard's cars face local +Z at
 * rotation 0 (vehicleBody.planUnits does the same to the one generic car), and Ry(-PI/2) maps +X to +Z, so the nose
 * stays the nose and the car's right (+Z here) lands on -X there.
 */
export const YARD_FROM_MODEL: THREE.Matrix4 = new THREE.Matrix4()
  .makeRotationY(-Math.PI / 2)
  .multiply(new THREE.Matrix4().makeScale(PLAN_UNITS_PER_METRE, PLAN_UNITS_PER_METRE, PLAN_UNITS_PER_METRE));

/** A copy of a model-frame geometry in the yard's frame. */
export function toYardFrame(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  return geo.clone().applyMatrix4(YARD_FROM_MODEL);
}

const scratch = new THREE.Color();

/** What a material looks like as one vertex colour. */
function colourOf(m: THREE.Material, kind: YardPartKind): THREE.Color {
  const std = m as THREE.MeshStandardMaterial;
  if (kind === 'lamps') return scratch.copy(std.emissive).multiplyScalar(Math.max(1, std.emissiveIntensity)).clone();
  return std.color.clone();
}

/** One mesh's geometry in `frame`, stripped to position, normal and one colour. */
function coloured(mesh: THREE.Mesh, frame: THREE.Matrix4, kind: YardPartKind): THREE.BufferGeometry {
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  g.setAttribute('normal', src.getAttribute('normal').clone());
  const n = g.getAttribute('position').count;
  if (src.index) g.setIndex(src.index.clone());
  else g.setIndex(Array.from({ length: n }, (_, i) => i));
  g.applyMatrix4(frame);
  const c = colourOf(mesh.material as THREE.Material, kind);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function merged(kind: YardPartKind, list: THREE.BufferGeometry[]): YardPart {
  const geometry = list.length === 1 ? list[0] : mergeGeometries(list, false);
  if (!geometry) throw new Error(`yardLod: could not merge the ${kind} parts`);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { kind, geometry };
}

function collect(meshes: THREE.Mesh[], toFrame: THREE.Matrix4, kindFor: (k: YardPartKind) => YardPartKind): YardPart[] {
  const by = new Map<YardPartKind, THREE.BufferGeometry[]>();
  const rel = new THREE.Matrix4();
  for (const mesh of meshes) {
    const name = (mesh.material as THREE.Material).name;
    const kind = kindFor(KIND_OF[name] ?? 'matte');
    rel.multiplyMatrices(toFrame, mesh.matrixWorld);
    const list = by.get(kind) ?? [];
    list.push(coloured(mesh, rel, kind));
    by.set(kind, list);
  }
  return YARD_PART_KINDS.filter((k) => by.has(k)).map((k) => merged(k, by.get(k)!));
}

const meshesUnder = (root: THREE.Object3D, skip?: (o: THREE.Object3D) => boolean): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (skip?.(o)) return;
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    for (const c of o.children) walk(c);
  };
  walk(root);
  return out;
};

/** A triangle list from the surface as an indexed position-only geometry. */
function skinGeometry(tris: Tri[]): THREE.BufferGeometry {
  const ids = new Map<number, number>();
  const pos: number[] = [];
  const idx: number[] = [];
  const at = (v: SurfVertex) => {
    let i = ids.get(v.id);
    if (i === undefined) { i = pos.length / 3; pos.push(v.x, v.y, v.z); ids.set(v.id, i); }
    return i;
  };
  for (const [a, b, c] of tris) idx.push(at(a), at(b), at(c));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

/** Stations and ring samples of the shadow body: the silhouette, nothing more. */
const SHADOW_DETAIL = 14;
const SHADOW_RING: readonly number[] = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

/** Metres the status strips stand off the skin, and their half-width in ring parameter. */
const STRIP_LIFT_M = 0.008;
const STRIP_HALF_TT = 0.07;
const STRIP_STEPS = 12;

/**
 * The status light: a strip along each sill between the wheel arches, and one along each roof edge above the doors.
 * Both are on the body, never on a door, so an open door leaves no strip standing in the air.
 */
function statusStrips(spec: VehicleSpec): THREE.BufferGeometry {
  const s = makeSurface(spec.curves);
  const d = spec.dims;
  const doors = spec.doors(s);
  const sillTt = Math.min(...doors.map((x) => x.ttLow)) - 0.3;
  const roofTt = Math.max(...doors.map((x) => x.ttHigh)) + 0.3;
  const x0 = d.frontAxle + spec.archRadius + 0.08;
  const x1 = d.frontAxle + d.wheelbase - spec.archRadius - 0.08;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const strip = (tt: number, side: number) => {
    const base = pos.length / 3;
    for (let i = 0; i <= STRIP_STEPS; i++) {
      const xr = x0 + ((x1 - x0) * i) / STRIP_STEPS;
      for (const t of [tt - STRIP_HALF_TT, tt + STRIP_HALF_TT]) {
        const p = s.point(xr, t, side);
        const n = s.normalAt(xr, t, side);
        pos.push(p[0] + n[0] * STRIP_LIFT_M, p[1] + n[1] * STRIP_LIFT_M, p[2] + n[2] * STRIP_LIFT_M);
        nor.push(n[0], n[1], n[2]);
      }
    }
    for (let i = 0; i < STRIP_STEPS; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  for (const side of [-1, 1]) { strip(Math.max(K_SILL + 0.15, sillTt), side); strip(roofTt, side); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

export interface YardBakeOptions { /** Stations along the body (default build.YARD_DETAIL). */ detail?: number }

/** Build one vehicle's light model and bake it for instanced drawing. */
export function bakeYardModel(spec: VehicleSpec, opts: YardBakeOptions = {}): YardModel {
  const car = buildVehicle(spec, { detail: opts.detail ?? YARD_DETAIL, yard: true });
  setDoors(car, 0);
  car.updateMatrixWorld(true);
  const doorSet = new Set(doorNodes(car));

  const identity = new THREE.Matrix4();
  const body = collect(meshesUnder(car, (o) => doorSet.has(o)), identity, (k) => k);

  const doors: YardDoor[] = [];
  const inv = new THREE.Matrix4();
  for (const node of doorSet) {
    const rig = node.userData.door as DoorRig;
    inv.copy(node.matrixWorld).invert();
    // A door is its panel and its window: anything else on it (a handle, cladding, a mirror) rides with the panel.
    doors.push({ id: rig.id, rig, parts: collect(meshesUnder(node), inv, (k) => (k === 'gloss' ? 'gloss' : 'paint')) });
  }

  const bodyBox = new THREE.Box3();
  for (const root of [car.getObjectByName('body')!, ...doorSet]) {
    for (const m of meshesUnder(root, (o) => o.name.startsWith('mirror') || o.name === 'arch_liner')) {
      bodyBox.union(new THREE.Box3().setFromObject(m));
    }
  }

  const status = statusStrips(spec);
  const shadow = skinGeometry(makeSurface(spec.curves).grid(SHADOW_DETAIL, SHADOW_RING));
  shadow.computeBoundingSphere();

  const triangles = body.reduce((n, p) => n + triangleCount(p.geometry), 0)
    + doors.reduce((n, dr) => n + dr.parts.reduce((k, p) => k + triangleCount(p.geometry), 0), 0)
    + triangleCount(status);

  return { key: spec.key, finish: spec.finish ?? 'solid', body, doors, status, shadow, bodyBox, triangles };
}

const baked = new Map<string, YardModel>();
/** bakeYardModel, once per vehicle model per page. */
export function yardModel(spec: VehicleSpec): YardModel {
  let m = baked.get(spec.key);
  if (!m) { m = bakeYardModel(spec); baked.set(spec.key, m); }
  return m;
}
/** A model that yardModel has already baked, or undefined. */
export const bakedYardModel = (key: string): YardModel | undefined => baked.get(key);
