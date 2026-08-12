/**
 * Visual check harness for the OTTO-CHARGE ARM and its cabinet. See
 * /arm-check.html for what it is and why it exists.
 *
 * EVERYTHING IS DERIVED. The arm comes from buildCobot(), the cabinet from
 * cabinetEnvelope's dimensions, the car from PEDESTAL_TO_CAR_CENTRE_M and the
 * traffic model's width. A harness that restated any of those could show a
 * clean picture of geometry that does not ship.
 *
 * Scene frame = the ARM BASE FRAME, in metres: +Z toward the car, +X fore/aft,
 * +Y up, origin on the J1 axis at the mount plate. That is the same frame
 * cabinetClearance.test.ts measures in, so a number in the HUD and a number in
 * CI mean the same thing.
 */
import * as THREE from 'three';
import { buildCobot } from '@/lib/ottoChargeArm/buildCobot';
import {
  ARM_SCALE, MOUNT_HEIGHT_M, METRES_PER_PLAN_UNIT, SERVICE_WINDOW,
  PEDESTAL_TO_CAR_CENTRE_M, cobotSpecAtScale,
} from '@/lib/ottoChargeArm/cobotSpec';
import { solveIK, STOWED, type JointAngles } from '@/lib/ottoChargeArm/cobotIK';
import { clearanceToCar } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { DCFC_CABINET_PU, CABINET_BACKSET_PU, cabinetSolidInArmFrame } from '@/lib/ottoChargeArm/cabinetEnvelope';
import { CAR_WIDTH } from '@/engine/motion/traffic';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);

const scale = num('scale', ARM_SCALE);
const backset = num('backset', CABINET_BACKSET_PU);
const rotated = num('rot', 1) === 1;
const poseName = q.get('pose') ?? 'stowed';
const view = q.get('view') ?? 'side';

const spec = cobotSpecAtScale(scale);
const CAR_HALF_W = (CAR_WIDTH * METRES_PER_PLAN_UNIT) / 2;

// ── scene ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141a);
scene.add(new THREE.HemisphereLight(0xbfd8e6, 0x1b2129, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(2.5, 4, 3);
scene.add(key);

// deck
const deckY = -MOUNT_HEIGHT_M;
const deck = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 12),
  new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 1 }),
);
deck.rotation.x = -Math.PI / 2;
deck.position.y = deckY;
scene.add(deck);

// ── the cabinet, exactly as ChargingField draws it ─────────────────────────
// Rotated: the WIDE face runs fore/aft (scene X), the SHALLOW depth faces the
// car (scene Z). `rot=0` restores the old edge-on orientation for the before-shot.
const cabW = DCFC_CABINET_PU.width * METRES_PER_PLAN_UNIT;
const cabH = DCFC_CABINET_PU.height * METRES_PER_PLAN_UNIT;
const cabD = DCFC_CABINET_PU.depth * METRES_PER_PLAN_UNIT;
const padH = DCFC_CABINET_PU.padHeight * METRES_PER_PLAN_UNIT;
const alongExt = rotated ? cabW : cabD;   // scene X
const faceExt = rotated ? cabD : cabW;    // scene Z, the axis that matters
const cabinet = new THREE.Mesh(
  new THREE.BoxGeometry(alongExt, cabH, faceExt),
  new THREE.MeshStandardMaterial({ color: 0x46596b, roughness: 0.65, metalness: 0.15 }),
);
cabinet.position.set(0, deckY + padH + cabH / 2, -backset * METRES_PER_PLAN_UNIT);
scene.add(cabinet);

// ── the car's near flank, as a slab ────────────────────────────────────────
const flankZ = PEDESTAL_TO_CAR_CENTRE_M - CAR_HALF_W;
const car = new THREE.Mesh(
  new THREE.BoxGeometry(4.8, 1.55, CAR_HALF_W * 2),
  new THREE.MeshStandardMaterial({ color: 0x1d5f7a, roughness: 0.5, transparent: true, opacity: 0.55 }),
);
car.position.set(0, deckY + 0.775, PEDESTAL_TO_CAR_CENTRE_M);
scene.add(car);

// ── the arm ────────────────────────────────────────────────────────────────
const rig = buildCobot(spec, { withPlinth: true, lod: 'studio' });
scene.add(rig.root);

function poseFor(name: string): JointAngles {
  if (name === 'stowed') return STOWED;
  // a mid-window port; 'approach' backs off along the port normal
  const back = name === 'approach' ? 0.25 : 0;
  const s = solveIK({ x: 0, y: 0.9 - MOUNT_HEIGHT_M, z: flankZ - back }, { x: 0, y: 0, z: -1 }, spec);
  return s.reachable
    ? { j1: s.j1, j2: s.j2, j3: s.j3, j4: s.j4, j5: s.j5, j6: s.j6 }
    : STOWED;
}
const a = poseFor(poseName);
rig.j1.rotation.set(0, a.j1, 0);
rig.j2.rotation.set(a.j2, 0, 0);
rig.j3.rotation.set(a.j3, 0, 0);
rig.j4.rotation.set(0, a.j4, 0);
rig.j5.rotation.set(a.j5, 0, 0);
rig.j6.rotation.set(0, a.j6, 0);
scene.updateMatrixWorld(true);

// ── measure the drawn arm against the drawn cabinet, right here ────────────
// Same exclusion set as cabinetClearance.test.ts: the plinth and base cluster
// are bolted to the cabinet on purpose.
const MOUNTED = new Set(['Mount_Plinth', 'Base_Housing', 'Base_Band', 'Shoulder_Yoke']);
const CAB_SOLID = cabinetSolidInArmFrame(
  rotated ? DCFC_CABINET_PU
          : { ...DCFC_CABINET_PU, width: DCFC_CABINET_PU.depth, depth: DCFC_CABINET_PU.width },
  MOUNT_HEIGHT_M, backset,
);
let worst = Infinity;
let worstPart = '';
const v = new THREE.Vector3();
rig.root.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !m.geometry) return;
  for (let n: THREE.Object3D | null = m; n; n = n.parent) if (MOUNTED.has(n.name || '')) return;
  const attr = m.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < attr.count; i++) {
    v.fromBufferAttribute(attr, i).applyMatrix4(m.matrixWorld);
    const d = clearanceToCar({ x: v.x, y: v.y, z: v.z }, CAB_SOLID);
    if (d < worst) { worst = d; worstPart = m.name; }
  }
});

// ── camera ─────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 100);
const target = new THREE.Vector3(0, 0.35, 0.9);
if (view === 'front') camera.position.set(0, 0.9, 5.2);
else if (view === 'iso') camera.position.set(3.6, 2.6, 4.2);
else camera.position.set(6.0, 1.1, 0.6); // side-on: the axis the intrusion is along
camera.lookAt(target);

renderer.render(scene, camera);

const hud = document.getElementById('hud')!;
const cls = worst > 0 ? 'good' : 'bad';
hud.innerHTML =
  `<b>OTTO-CHARGE ARM</b>  pose=${poseName}  view=${view}\n` +
  `ARM_SCALE      ${scale.toFixed(2)}   reach ${(spec.upperArm + spec.forearm + spec.wrist + spec.tool).toFixed(3)} m\n` +
  `pedestal→car   ${PEDESTAL_TO_CAR_CENTRE_M.toFixed(3)} m   near flank ${flankZ.toFixed(3)} m\n` +
  `cabinet        ${rotated ? 'wide face fore/aft' : 'EDGE-ON (old)'}, backset ${backset.toFixed(2)} pu\n` +
  `arm↔cabinet    <span class="${cls}">${worst >= 0 ? '+' : ''}${worst.toFixed(4)} m</span> on ${worstPart || '—'}`;
// Playwright waits on this rather than a timeout.
document.title = `arm-check ready ${worst.toFixed(4)}`;
