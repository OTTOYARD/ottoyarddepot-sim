import * as THREE from 'three';

/**
 * A FLEET OF RIGID-SEGMENT ROBOTS, INSTANCED: every robot of one kind on the site in a fixed number of draw calls,
 * whatever their number. Each robot is cut into rigid segments (the parts that move together) and each
 * (segment, material, shadow) group is one InstancedMesh holding every robot; each robot keeps a skeleton, poses
 * it, and writes each segment's world matrix into its slot.
 *
 *   draw calls = parts + shadow-casting parts, whatever the robot count
 *
 * The procedural arms (armInstances.ts, cleanArmInstances.ts) and the engineering CAD robots (robotics/cadDepot.ts)
 * are drawn by the same code: a part list in, a fleet out.
 */

/**
 * The status LED material, instanced: diffuse colour from instanceColor (as
 * statusMaterial.color was per arm) and EMISSIVE = that colour x a per-instance
 * glow (as emissive + emissiveIntensity were), so the LED keeps its exact
 * look and its charging pulse.
 */
export function statusMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.color.set(0xffffff);
  m.emissive.set(0xffffff);
  m.emissiveIntensity = 1;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vColor.rgb * vGlow;');
  };
  m.customProgramCacheKey = () => 'otto-arm-status-instanced';
  return m;
}

export interface RigidPart {
  /** index into the robot's segment nodes (0 is its root) */
  segment: number;
  /** in the segment's frame */
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  /** a status light: colour and glow per robot (light channel 0) */
  status: boolean;
  /** a light on another channel (1, 2, ...), with its own colour and glow per robot: a wash machine's stop lamps */
  light?: number;
}

/** The light channel a part is drawn on, or -1 for an ordinary part. */
const channelOf = (p: RigidPart): number => (p.light !== undefined ? p.light : p.status ? 0 : -1);

export interface InstancedFleet {
  capacity: number;
  /** what meshes[i] draws */
  parts: readonly RigidPart[];
  meshes: THREE.InstancedMesh[];
  /** shared by every status-light part (channel 0) */
  statusColor: THREE.InstancedBufferAttribute;
  glow: THREE.InstancedBufferAttribute;
  /** every light channel's colour and glow, channel 0 first (statusColor and glow) */
  lights: { color: THREE.InstancedBufferAttribute; glow: THREE.InstancedBufferAttribute }[];
  dispose(): void;
}

export function makeInstancedFleet(parts: readonly RigidPart[], capacity: number, opts: { receiveShadow?: boolean } = {}): InstancedFleet {
  const channels = Math.max(1, ...parts.map((p) => channelOf(p) + 1));
  const lights = Array.from({ length: channels }, () => {
    const color = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    color.setUsage(THREE.DynamicDrawUsage);
    const glow = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    glow.setUsage(THREE.DynamicDrawUsage);
    return { color, glow };
  });
  const owned: { dispose(): void }[] = [];
  const ledMaterials = new Map<number, THREE.MeshStandardMaterial>();
  const meshes = parts.map((p) => {
    let geometry = p.geometry;
    let material = p.material;
    const ch = channelOf(p);
    if (ch >= 0) {
      geometry = p.geometry.clone();
      geometry.setAttribute('aGlow', lights[ch].glow);
      owned.push(geometry);
      let led = ledMaterials.get(ch);
      if (!led) { led = statusMaterial(p.material as THREE.MeshStandardMaterial); ledMaterials.set(ch, led); owned.push(led); }
      material = led;
    }
    const im = new THREE.InstancedMesh(geometry, material, capacity);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = p.castShadow;
    if (opts.receiveShadow) im.receiveShadow = true;
    im.frustumCulled = false;
    // every slot starts hidden (zero scale) until its robot writes it
    (im.instanceMatrix.array as Float32Array).fill(0);
    if (ch >= 0) im.instanceColor = lights[ch].color;
    return im;
  });
  return {
    capacity,
    parts,
    meshes,
    statusColor: lights[0].color,
    glow: lights[0].glow,
    lights,
    dispose() {
      for (const m of meshes) m.dispose();
      for (const o of owned) o.dispose();
    },
  };
}

const scratch = new THREE.Color();

/**
 * Write one robot's segments and status light into its slot. Call after its joints are set and its skeleton's world
 * matrices updated; `segments[i]` is segment i's node.
 */
export function writeFleetSlot(fleet: InstancedFleet, slot: number, segments: readonly THREE.Object3D[], statusHex: number, glow: number): void {
  for (let i = 0; i < fleet.parts.length; i++) {
    const im = fleet.meshes[i];
    im.setMatrixAt(slot, segments[fleet.parts[i].segment].matrixWorld);
    im.instanceMatrix.needsUpdate = true;
  }
  scratch.setHex(statusHex).toArray(fleet.statusColor.array as Float32Array, slot * 3);
  fleet.statusColor.needsUpdate = true;
  fleet.glow.setX(slot, glow);
  fleet.glow.needsUpdate = true;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Set one robot's light on a channel other than its status light (writeFleetSlot sets channel 0). */
export function writeFleetLight(fleet: InstancedFleet, slot: number, channel: number, hex: number, glow: number): void {
  const l = fleet.lights[channel];
  if (!l) return;
  scratch.setHex(hex).toArray(l.color.array as Float32Array, slot * 3);
  l.color.needsUpdate = true;
  l.glow.setX(slot, glow);
  l.glow.needsUpdate = true;
}

/** Hide a slot (its robot unmounted). */
export function clearFleetSlot(fleet: InstancedFleet, slot: number): void {
  for (const im of fleet.meshes) { im.setMatrixAt(slot, ZERO); im.instanceMatrix.needsUpdate = true; }
}
