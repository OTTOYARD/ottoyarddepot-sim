import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rect } from '@/lib/structurePlan';

/**
 * Static geometry batching for the built environment.
 *
 * A building is a few hundred boxes (wall runs, lintels, jamb guards, rails,
 * hoods, lift posts, gantry legs...). Drawn as individual meshes that is a few
 * hundred draw calls, twice (shadow pass). Batched here it is ONE merged buffer
 * per material — a building costs ~10 draw calls however much detail it carries.
 *
 * UVs are written in WORLD UNITS (1 texture repeat = 1 plan unit before the
 * material's own texture.repeat), so a ribbed-panel texture keeps the same rib
 * pitch on a 3u pier and a 40u wall instead of stretching per face.
 */
export class StaticBatch {
  private parts = new Map<string, THREE.BufferGeometry[]>();

  /** Axis-aligned box by world centre + size, optional Y rotation. */
  box(key: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0): this {
    const g = worldUvBox(sx, sy, sz);
    if (rotY) g.rotateY(rotY);
    g.translate(cx, cy, cz);
    return this.push(key, g);
  }

  /** Box over a PLAN rectangle (toWorld: x -> 150 - x, y -> 110 - y), from y0 to y1 up. */
  planBox(key: string, r: Rect, y0: number, y1: number): this {
    const cx = 150 - (r.x0 + r.x1) / 2;
    const cz = 110 - (r.y0 + r.y1) / 2;
    return this.box(key, cx, (y0 + y1) / 2, cz, r.x1 - r.x0, y1 - y0, r.y1 - r.y0);
  }

  /** Vertical cylinder at a world point (base at y0). */
  cylinder(key: string, cx: number, y0: number, cz: number, radius: number, height: number, seg = 16): this {
    const g = new THREE.CylinderGeometry(radius, radius, height, seg);
    g.translate(cx, y0 + height / 2, cz);
    return this.push(key, g);
  }

  /** Horizontal cylinder along world X or Z. */
  hCylinder(key: string, cx: number, cy: number, cz: number, radius: number, length: number, axis: 'x' | 'z', seg = 16): this {
    const g = new THREE.CylinderGeometry(radius, radius, length, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2); else g.rotateX(Math.PI / 2);
    g.translate(cx, cy, cz);
    return this.push(key, g);
  }

  /** Any prepared geometry, already positioned in world space. */
  geometry(key: string, g: THREE.BufferGeometry): this {
    return this.push(key, g);
  }

  private push(key: string, g: THREE.BufferGeometry): this {
    // normalise: non-indexed, position/normal/uv only — mergeGeometries needs agreement
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') n.deleteAttribute(name);
    }
    if (!n.attributes.uv) {
      n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((n.attributes.position.count) * 2), 2));
    }
    const list = this.parts.get(key) ?? [];
    list.push(n);
    this.parts.set(key, list);
    return this;
  }

  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      if (!merged) throw new Error(`StaticBatch: could not merge '${key}'`);
      merged.computeBoundingSphere();
      out.set(key, merged);
    }
    return out;
  }
}

/**
 * BoxGeometry whose UVs run in world units on every face. BoxGeometry's faces are
 * ordered +x, -x, +y, -y, +z, -z, four vertices each; the ±x faces span (depth,
 * height), ±y span (width, depth), ±z span (width, height).
 */
export function worldUvBox(sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * du, uv.getY(i) * dv);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** A thin round rod between two world points (tie rods, conduit). */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 8);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}
