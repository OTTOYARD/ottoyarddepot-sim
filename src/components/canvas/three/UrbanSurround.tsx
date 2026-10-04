import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '@/store/simulationStore';
import { buildCityPlan, FACADE_SPEC, type Facade, type Tree, type StreetLight, type Signal } from './cityPlan';
import { buildCityGeometry, type CityMaterialKey } from './cityMesh';
import { facadeTextures, roofTexture } from './cityTextures';
import { asphaltTexture, concreteTexture, skyTexture } from './textures';
import { MATERIALS } from './materials';
import { nightLevel } from './dayNight';

/**
 * THE CITY AROUND THE DEPOT (founder, 2026-10-04): streets, blocks, a skyline, street
 * trees and lamps, a river under its bridges. Scenery only: it reads nothing but the
 * sim clock (windows and lamps light up after dark) and nothing reads it.
 *
 * The layout is cityPlan.ts and the geometry cityMesh.ts: one merged buffer per
 * material plus six instanced meshes (tree trunks and crowns, lamp poles, arms and
 * heads), so the whole city is a few dozen draw calls. It casts and receives no
 * shadows: the sun's shadow camera covers the fenced lot and nothing beyond it.
 */

const FACADE_FINISH: Record<Facade, { roughness: number; metalness: number; glow: number }> = {
  glass: { roughness: 0.22, metalness: 0.35, glow: 1.15 },
  office: { roughness: 0.55, metalness: 0.1, glow: 1.05 },
  brick: { roughness: 0.92, metalness: 0, glow: 1.0 },
  stucco: { roughness: 0.88, metalness: 0, glow: 1.0 },
  storefront: { roughness: 0.5, metalness: 0.08, glow: 1.3 },
  industrial: { roughness: 0.6, metalness: 0.25, glow: 0.9 },
};

/**
 * The sky as this material's OWN environment map. With only scene.environment, three
 * lights every standard material at scene.environmentIntensity and ignores the
 * material's envMapIntensity, so the city could not dim its daylight reflections after
 * dark without dimming the depot's too. Same texture as scene.environment, so the same
 * prefiltered map and, by day, the same look.
 */
function ownSky(m: THREE.Material) {
  if (!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  const s = m as THREE.MeshStandardMaterial;
  s.envMap = skyTexture();
  s.envMapIntensity = 1;
}

/** Ground textures re-used from the depot's own, repeating on the city's world-unit UVs. */
function worldTex(src: THREE.Texture): THREE.Texture {
  const t = src.clone();
  t.repeat.set(1, 1);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function cityMaterials(): Record<CityMaterialKey, THREE.Material> {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const facades = Object.fromEntries((Object.keys(FACADE_SPEC) as Facade[]).map((f) => {
    const { map, emissive } = facadeTextures(f);
    const fin = FACADE_FINISH[f];
    return [`f:${f}`, std({
      map, emissiveMap: emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0,
      vertexColors: true, roughness: fin.roughness, metalness: fin.metalness,
    })];
  })) as Record<`f:${Facade}`, THREE.MeshStandardMaterial>;
  const asphalt = worldTex(asphaltTexture());
  const concrete = worldTex(concreteTexture());
  const paint = (color: string) => std({ color, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const amber = MATERIALS.amberIndicator().clone();
  amber.polygonOffset = true;
  amber.polygonOffsetFactor = -2;
  amber.polygonOffsetUnits = -4;
  const all = {
    ...facades,
    street: std({ map: asphalt, color: '#bcbcc4', roughness: 0.92 }),
    yard: std({ map: asphalt, color: '#dadae0', roughness: 0.9 }),
    plaza: std({ map: concrete, color: '#d9d6cf', roughness: 0.8 }),
    path: std({ map: concrete, color: '#e6e2da', roughness: 0.8 }),
    sidewalk: std({ map: concrete, color: '#d0cec8', roughness: 0.82 }),
    lawn: std({ color: '#4a7a36', roughness: 0.95 }),
    far: std({ color: '#66745f', roughness: 1 }),
    'paint:white': paint('#e8e8e0'),
    'paint:yellow': paint('#e3b23c'),
    'paint:amber': amber,
    roof: std({ map: roofTexture(), vertexColors: true, roughness: 0.9 }),
    plain: std({ vertexColors: true, roughness: 0.8, metalness: 0.05 }),
    skylight: std({ color: '#c6d6e4', roughness: 0.2, metalness: 0.3 }),
    solar: MATERIALS.solarPanelGlass().clone(), // a copy: its night dimming must not reach the depot's canopies
    glassCrown: std({ vertexColors: true, roughness: 0.18, metalness: 0.6 }),
    beacon: std({ color: '#ff2a1a', emissive: new THREE.Color('#ff2a1a'), emissiveIntensity: 1.5, toneMapped: false }),
    water: std({ color: '#3f6075', roughness: 0.06, metalness: 0.15 }),
  };
  for (const m of Object.values(all)) ownSky(m);
  return all;
}

const GREENS = ['#2f5a24', '#3b6b2c', '#27491f', '#46783a'].map((c) => new THREE.Color(c));
/** Trees this close to the lot get the depot ring's fuller crowns; the rest a lighter one. */
const NEAR_TREE = 330;

function treeMeshes(trees: Tree[]) {
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1, 6, 1, true).translate(0, 0.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3726', roughness: 0.9 });
  const crownMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true });
  ownSky(trunkMat); ownSky(crownMat);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, trees.length));
  const near = trees.filter((t) => Math.hypot(t.x, t.z - 4) < NEAR_TREE);
  const far = trees.filter((t) => Math.hypot(t.x, t.z - 4) >= NEAR_TREE);
  const crownsNear = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), crownMat, Math.max(1, near.length * 3));
  const crownsFar = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), crownMat, Math.max(1, far.length * 2));
  const o = new THREE.Object3D();
  let seed = 1;
  const rnd = () => { const x = Math.sin(seed++ * 127.1) * 43758.5453; return x - Math.floor(x); };
  trees.forEach((t, i) => {
    const trunkH = t.h * 0.55;
    o.position.set(t.x, 0, t.z); o.rotation.set(0, 0, 0); o.scale.set(1, trunkH, 1); o.updateMatrix();
    trunks.setMatrixAt(i, o.matrix);
  });
  const crowns = (list: Tree[], mesh: THREE.InstancedMesh, blobs: number) => {
    list.forEach((t, i) => {
      const trunkH = t.h * 0.55;
      for (let b = 0; b < blobs; b++) {
        const a = rnd() * Math.PI * 2;
        const off = b === 0 ? 0 : t.r * 0.45;
        const s = t.r * (b === 0 ? 1 : 0.62 + rnd() * 0.25);
        o.position.set(t.x + Math.cos(a) * off, trunkH + t.r * (b === 0 ? 0.75 : 0.45 + rnd() * 0.5), t.z + Math.sin(a) * off);
        o.rotation.set(rnd() * 3, rnd() * 3, 0);
        o.scale.set(s, s * 0.85, s);
        o.updateMatrix();
        mesh.setMatrixAt(i * blobs + b, o.matrix);
        mesh.setColorAt(i * blobs + b, GREENS[(t.tone + b) % GREENS.length]);
      }
    });
  };
  crowns(near, crownsNear, 3);
  crowns(far, crownsFar, 2);
  for (const m of [trunks, crownsNear, crownsFar]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }
  return [trunks, crownsNear, crownsFar];
}

function lampMeshes(lights: StreetLight[], headMat: THREE.Material) {
  const steel = MATERIALS.structuralSteel().clone(); // a copy, as above
  ownSky(steel); ownSky(headMat);
  const n = Math.max(1, lights.length);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.26, 16, 6, 1, true).translate(0, 8, 0), steel, n);
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 0.22, 0.22), steel, n);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.35, 0.8), headMat, n);
  const o = new THREE.Object3D();
  lights.forEach((l, i) => {
    const rot = Math.atan2(-l.dz, l.dx); // the box's +X along the arm
    o.position.set(l.x, 0, l.z); o.rotation.set(0, rot, 0); o.scale.set(1, 1, 1); o.updateMatrix();
    poles.setMatrixAt(i, o.matrix);
    o.position.set(l.x + l.dx * 2.4, 15.85, l.z + l.dz * 2.4); o.updateMatrix();
    arms.setMatrixAt(i, o.matrix);
    o.position.set(l.x + l.dx * 4.7, 15.6, l.z + l.dz * 4.7); o.updateMatrix();
    heads.setMatrixAt(i, o.matrix);
  });
  for (const m of [poles, arms, heads]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  return [poles, arms, heads];
}

/** Traffic signals: pole, mast arm, head, and a lit lamp on each face (one phase for the
 *  whole town: green for the north-south streets, red for the east-west ones). */
function signalMeshes(signals: Signal[], steel: THREE.Material) {
  const n = Math.max(1, signals.length);
  const head = new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.6 });
  ownSky(head);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.26, 9, 6, 1, true).translate(0, 4.5, 0), steel, n);
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.24, 0.24), steel, n);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 2.3, 0.8), head, n);
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), lampMat, n * 2);
  const o = new THREE.Object3D();
  const green = new THREE.Color('#38ff7a'), red = new THREE.Color('#ff3b2f');
  signals.forEach((g, i) => {
    const rot = Math.atan2(-g.dz, g.dx);
    o.rotation.set(0, rot, 0);
    o.position.set(g.x, 0, g.z); o.scale.set(1, 1, 1); o.updateMatrix(); poles.setMatrixAt(i, o.matrix);
    o.position.set(g.x + (g.dx * g.reach) / 2, 8.75, g.z + (g.dz * g.reach) / 2); o.scale.set(g.reach, 1, 1); o.updateMatrix();
    arms.setMatrixAt(i, o.matrix);
    const hx = g.x + g.dx * g.reach * 0.8, hz = g.z + g.dz * g.reach * 0.8;
    o.position.set(hx, 7.45, hz); o.scale.set(1, 1, 1); o.updateMatrix(); heads.setMatrixAt(i, o.matrix);
    const goes = g.dx !== 0; // the arm over a north-south street shows that street green
    for (const side of [-1, 1]) {
      // the faces across the arm: perpendicular to it, both ways
      o.position.set(hx + -g.dz * side * 0.43, goes ? 6.75 : 8.15, hz + g.dx * side * 0.43);
      o.updateMatrix();
      lamps.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), o.matrix);
      lamps.setColorAt(i * 2 + (side > 0 ? 1 : 0), goes ? green : red);
    }
  });
  for (const m of [poles, arms, heads, lamps]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }
  return [poles, arms, heads, lamps];
}

/**
 * Built a beat after the depot mounts (~0.1-0.3 s of geometry on a laptop, more on a
 * phone), so the depot's first frame never waits for the city behind it.
 */
export function UrbanSurround() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(id);
  }, []);
  return ready ? <City /> : null;
}

function City() {
  const plan = useMemo(() => buildCityPlan(), []);
  const geos = useMemo(() => buildCityGeometry(plan), [plan]);
  const mats = useMemo(() => cityMaterials(), []);
  const headMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#f2efe6', emissive: new THREE.Color('#fff1d6'), emissiveIntensity: 0.25, toneMapped: false,
  }), []);
  const trees = useMemo(() => treeMeshes(plan.trees), [plan]);
  const lamps = useMemo(() => lampMeshes(plan.lights, headMat), [plan, headMat]);
  const signals = useMemo(() => signalMeshes(plan.signals, lamps[0].material as THREE.Material), [plan, lamps]);

  useEffect(() => () => {
    for (const g of geos.values()) g.dispose();
    for (const m of [...trees, ...lamps, ...signals]) m.geometry.dispose();
  }, [geos, trees, lamps, signals]);

  // The scene's environment map is the DAY sky at every hour, so after dark the city
  // would still glow with daylight reflections. Its own materials take less of it as
  // night falls (the depot's are untouched), and the windows and lamps light up instead.
  const dayEnv = useMemo(() => {
    const all = [...Object.values(mats), ...[...trees, ...lamps, ...signals].map((m) => m.material)] as THREE.MeshStandardMaterial[];
    return [...new Set(all)].filter((m) => m.isMeshStandardMaterial && m.envMap).map((m) => [m, m.envMapIntensity] as const);
  }, [mats, trees, lamps, signals]);
  const lit = useRef(-1);
  useFrame(() => {
    const n = nightLevel(useSimulationStore.getState().simTime);
    if (Math.abs(n - lit.current) < 0.01) return;
    lit.current = n;
    for (const [m, day] of dayEnv) m.envMapIntensity = day * (1 - 0.82 * n);
    for (const f of Object.keys(FACADE_FINISH) as Facade[]) {
      (mats[`f:${f}`] as THREE.MeshStandardMaterial).emissiveIntensity = n * FACADE_FINISH[f].glow;
    }
    headMat.emissiveIntensity = 0.25 + 2.2 * n;
    (mats.beacon as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 + 2.5 * n;
  });

  return (
    <group name="city">
      {[...geos.entries()].map(([key, g]) => (
        <mesh key={key} name={`city:${key}`} geometry={g} material={mats[key as CityMaterialKey]} matrixAutoUpdate={false} />
      ))}
      {[...trees, ...lamps, ...signals].map((m, i) => <primitive key={`inst${i}`} object={m} />)}
    </group>
  );
}
