// Dev page for the robot CAD (cad-check.html). Draws one robot's GLB through cadModel.ts at a fixed camera,
// so scripts/cadShots.mjs can shoot it. Sets window.__cadReady when the frame is drawn.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { explodeCad, highlightCad, loadCad, poseCad, stowedAngles, visibleBounds, zeroAngles } from '@/lib/robotics/cadModel';

const q = new URLSearchParams(location.search);
const robot = q.get('robot') ?? 'charge_arm';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(4, 8, 6);
scene.add(sun, new THREE.HemisphereLight(0xdfe8ff, 0x20242a, 0.5));
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 200);

(async () => {
  const m = await loadCad(`/cad/${robot}.glb`);
  scene.add(m.root);
  poseCad(m, q.get('pose') === 'zero' ? zeroAngles(m) : stowedAngles(m));
  explodeCad(m, Number(q.get('explode') ?? 0));
  highlightCad(m, { isolate: q.get('sub'), ghostOthers: true, selected: q.get('part') });
  const box = visibleBounds(m);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() / Number(q.get('zoom') ?? 1);
  const dirs: Record<string, [number, number, number]> = {
    iso: [1, 0.55, 1.1], front: [0, 0.15, 1], side: [1, 0.15, 0], top: [0.001, 1, 0.02], back: [-1, 0.5, -1],
  };
  const d = new THREE.Vector3(...(dirs[q.get('view') ?? 'iso'] ?? dirs.iso)).normalize();
  camera.position.copy(c).addScaledVector(d, size * 1.25);
  camera.lookAt(c);
  renderer.render(scene, camera);
  (document.getElementById('hud') as HTMLElement).textContent =
    `${robot}  parts ${m.parts.length}  joints ${[...m.joints.keys()].join(',')}`;
  (window as unknown as { __cadReady: boolean }).__cadReady = true;
})().catch((e) => {
  (document.getElementById('hud') as HTMLElement).textContent = String(e);
  (window as unknown as { __cadError: string }).__cadError = String(e);
});
