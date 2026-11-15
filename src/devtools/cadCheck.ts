// Dev page for the robot CAD (cad-check.html). Draws one robot's GLB through cadModel.ts at a fixed camera,
// so scripts/cadShots.mjs can shoot it. Sets window.__cadReady when the frame is drawn.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { explodeCad, highlightCad, loadCad, poseCad, stowedAngles, visibleBounds, zeroAngles } from '@/lib/robotics/cadModel';
import { flexDefs } from '@/lib/robotics/flexLines';
import { makeFlexFleet } from '@/lib/robotics/flexMesh';

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
  // ?file=depot|near draws the yard's models instead of the full one
  const file = q.get('file') ? `${robot}.${q.get('file')}.glb` : `${robot}.glb`;
  const m = await loadCad(`/cad/${file}`);
  scene.add(m.root);
  poseCad(m, q.get('pose') === 'zero' ? zeroAngles(m) : stowedAngles(m));
  // ?angles=J1:0.3,CR_X:-1.2 sets joints on top of the pose
  const extra = Object.fromEntries((q.get('angles') ?? '').split(',').filter(Boolean).map((kv) => {
    const [k, v] = kv.split(':');
    return [k, Number(v)];
  }));
  poseCad(m, extra);
  explodeCad(m, Number(q.get('explode') ?? 0));
  highlightCad(m, { isolate: q.get('sub'), ghostOthers: true, selected: q.get('part') });
  m.root.updateMatrixWorld(true);
  // ?flex=1 draws the lines (cables, hoses, chains and what they carry), solved at this pose as the tab does
  const defs = flexDefs(m.root);
  if (q.get('flex') && defs.length) {
    const fleet = makeFlexFleet(defs, 1, { radial: 16, coilPerTurn: 16, links: m.root.userData.flexLinks });
    scene.add(fleet.group);
    const byName = new Map<string, THREE.Object3D>();
    m.root.traverse((o) => { if (o.name) byName.set(o.name, o); });
    fleet.write(0, { root: m.root, node: (n: string) => byName.get(n)! });
  }
  const box = visibleBounds(m);
  let c = box.getCenter(new THREE.Vector3());
  let size = box.getSize(new THREE.Vector3()).length() / Number(q.get('zoom') ?? 1);
  // ?end=CHG-FL4:b aims at a line's end; ?at=x,y,z (metres, robot frame) at a point; ?dist sets the distance (m)
  const end = q.get('end');
  let endDir: THREE.Vector3 | null = null;
  if (end) {
    const [id, which] = end.split(':');
    const d = defs.find((x) => x.id === id);
    const an = d ? (which === 'a' ? d.a : d.b) : null;
    let node: THREE.Object3D | null = null;
    if (an) m.root.traverse((o) => { if (!node && o.name === an.node) node = o; });
    if (an && node) {
      const M = (node as THREE.Object3D).matrixWorld;
      c = new THREE.Vector3(...an.p).applyMatrix4(M);
      // ?view=end looks at the line's end from beside the line, a quarter turn ?turn (degrees) round it
      const dir = new THREE.Vector3(...an.d).transformDirection(M);
      if (which === 'a') dir.negate();               // at a, d is the way the line LEAVES: the holder is behind it
      endDir = dir;
    }
    size = Number(q.get('dist') ?? 0.5);
  } else if (q.get('at')) {
    c = new THREE.Vector3(...(q.get('at') as string).split(',').map(Number));
    size = Number(q.get('dist') ?? 0.8);
  }
  const dirs: Record<string, [number, number, number]> = {
    iso: [1, 0.55, 1.1], front: [0, 0.15, 1], side: [1, 0.15, 0], top: [0.001, 1, 0.02], back: [-1, 0.5, -1],
    left: [-1, 0.15, 0], under: [0.3, -0.6, 1], isoback: [-1, 0.55, -1.1], isoleft: [-1, 0.55, 1.1],
  };
  let d = new THREE.Vector3(...(dirs[q.get('view') ?? 'iso'] ?? dirs.iso)).normalize();
  if (q.get('view') === 'end' && endDir) {
    // from the line's side of its end (where the line comes from), turned ?turn degrees round the line, lifted ?lift
    const back = endDir.clone().negate();
    const side = new THREE.Vector3(0, 1, 0).cross(back);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize().applyAxisAngle(back, (Number(q.get('turn') ?? 0) * Math.PI) / 180);
    d = back.multiplyScalar(0.55).addScaledVector(side, 0.8).add(new THREE.Vector3(0, Number(q.get('lift') ?? 0.35), 0)).normalize();
  }
  camera.position.copy(c).addScaledVector(d, end || q.get('at') ? size : size * 1.25);
  camera.lookAt(c);
  renderer.render(scene, camera);
  (document.getElementById('hud') as HTMLElement).textContent =
    `${robot}  parts ${m.parts.length}  joints ${[...m.joints.keys()].join(',')}`;
  (window as unknown as { __cadReady: boolean }).__cadReady = true;
})().catch((e) => {
  (document.getElementById('hud') as HTMLElement).textContent = String(e);
  (window as unknown as { __cadError: string }).__cadError = String(e);
});
