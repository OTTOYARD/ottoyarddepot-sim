// Dev page for the fleet vehicle models (fleet-check.html). One vehicle, fixed camera, so scripts/fleetShots.mjs
// can shoot it. Sets window.__fleetReady when the frame is drawn.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildVehicle, doorClip, fleetSpec, FLEET_SPECS, setDoors } from '@/lib/fleetModels';
import { bakeYardModel } from '@/lib/fleetModels/yardLod';
import { commitModelFleet, makeModelFleet, writeModelCar } from '@/components/canvas/three/fleetYard';
import { METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';

const q = new URLSearchParams(location.search);
const key = q.get('model') ?? FLEET_SPECS[0].key;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.66;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9ced4);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = 0.85;
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(5, 9, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
sun.shadow.bias = -0.0004;
scene.add(sun, new THREE.HemisphereLight(0xe8eefc, 0x4a4f57, 0.5));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x8f959c, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.05, 200);
const hud = document.getElementById('hud') as HTMLElement;
const w = window as unknown as { __fleetReady?: boolean; __fleetError?: string; __fleetStats?: unknown };

(async () => {
  const spec = fleetSpec(key);
  if (!spec) throw new Error(`no fleet model "${key}"`);
  const t0 = performance.now();
  let car: THREE.Object3D;
  let yardTris = 0;
  if (q.get('yard')) {
    // The yard's light model, drawn by the yard's own instanced path (fleetYard.ts), one car, turned back to this
    // page's frame (metres, +X nose). `status=1` lights its strips.
    const model = bakeYardModel(spec);
    const fleet = makeModelFleet(model, 1);
    const doors = Number(q.get('doors') ?? 0);
    writeModelCar(fleet, 0, 0, 0, 0, 0, doors, doors, q.get('status') === '1');
    commitModelFleet(fleet);
    fleet.setCount(1);
    fleet.status.instanceColor!.setXYZ(0, 0, 1.5, 1.4);
    yardTris = model.triangles;
    car = new THREE.Group();
    car.add(...fleet.meshes);
    car.scale.setScalar(METRES_PER_PLAN_UNIT);
    car.rotation.y = Math.PI / 2;
  } else if (q.get('glb')) car = (await new GLTFLoader().loadAsync(`/fleet/${key}.glb`)).scene;
  else car = buildVehicle(spec, q.get('detail') ? { detail: Number(q.get('detail')) } : {});
  if (q.get('export')) {
    // Hand the binary to scripts/exportFleetModels.mjs.
    const buf = (await new GLTFExporter().parseAsync(car, { binary: true, animations: [doorClip(car)] })) as ArrayBuffer;
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    (w as unknown as { __fleetGlb: string }).__fleetGlb = btoa(bin);
  }
  const ms = performance.now() - t0;
  if (!yardTris) car.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  scene.add(car);
  setDoors(car, Number(q.get('doors') ?? 0));
  car.updateMatrixWorld(true);
  // an instanced mesh's own bounds are its geometry's, so the yard model is framed by its stated size
  const box = yardTris
    ? new THREE.Box3(new THREE.Vector3(-spec.dims.length / 2, 0, -spec.dims.width / 2), new THREE.Vector3(spec.dims.length / 2, spec.dims.height, spec.dims.width / 2))
    : new THREE.Box3().setFromObject(car);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const dirs: Record<string, [number, number, number]> = {
    iso: [1, 0.42, 0.9], side: [0, 0.06, 1], left: [0, 0.06, -1], front: [1, 0.1, 0.0001], rear: [-1, 0.12, 0.0001],
    top: [0.0001, 1, 0], back: [-1, 0.45, 0.85], low: [1, 0.12, 0.55], backleft: [-1, 0.4, -0.9], isoleft: [1, 0.42, -0.9],
  };
  const d = new THREE.Vector3(...(dirs[q.get('view') ?? 'iso'] ?? dirs.iso)).normalize();
  camera.position.copy(c).addScaledVector(d, (size.length() * 1.75) / Number(q.get('zoom') ?? 1));
  camera.lookAt(c);
  renderer.render(scene, camera);
  let tris = 0;
  car.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
  if (yardTris) tris = yardTris;
  w.__fleetStats = { size: size.toArray(), tris, ms, draws: renderer.info.render.calls };
  hud.textContent = `${spec.name}   ${size.x.toFixed(3)} x ${size.z.toFixed(3)} x ${size.y.toFixed(3)} m   ${Math.round(tris).toLocaleString()} tris   ${ms.toFixed(0)} ms`;
  w.__fleetReady = true;
})().catch((e) => { hud.textContent = String(e); w.__fleetError = String(e?.stack ?? e); });
