/**
 * The OTTO-CLEAN ARM sandbox (see /clean-check.html). Scene frame = the authored CAR
 * frame, metres: x along the car (+ nose), y up from grade, z across (+ = the right
 * flank) — the frame cleanArmPose and the clearance tests use, so a number on the HUD
 * and a number in CI mean the same thing.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { VEHICLE_GEO, DOOR_GEO, DOOR_HINGE_PU, PORT_GEO, CAR_W_PU } from '@/components/canvas/three/vehicleBody';
import { cabinMaterial } from '@/components/canvas/three/Vehicle3D';
import { PLAN_UNITS_PER_METRE, OTTO_CHARGE_ARM, MOUNT_HEIGHT_M, PEDESTAL_TO_CAR_CENTRE_M } from '@/lib/ottoChargeArm/cobotSpec';
import { CAR_WIDTH_M, doorSwing } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { portInArmFrame, portInVehicleFrame } from '@/lib/ottoChargeArm/depotPlacement';
import { buildCobot } from '@/lib/ottoChargeArm/buildCobot';
import { poseFor } from '@/lib/ottoChargeArm/armMotion';
import { DCFC_CABINET_PU, CABINET_BACKSET_PU } from '@/lib/ottoChargeArm/cabinetEnvelope';
import { buildCleanArm, poseCleanArm } from '@/lib/ottoCleanArm/buildCleanArm';
import { CLEAN_ARM } from '@/lib/ottoCleanArm/cleanArmSpec';
import { cleanArmPoints, doorsAt, sidesFor, strokeAt } from '@/lib/ottoCleanArm/cleanArmPose';
import { advanceCleanSession, cleanSessionJoints, IDLE_CLEAN, type CleanSession } from '@/lib/ottoCleanArm/cleanSession';
import {
  cleanArmCapsules, capsuleMin, carClearance, apertureMargin, doorsClearance,
} from '@/lib/ottoCleanArm/cleanArmClearance';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const TOTAL = num('total', 348);
const toward = (num('toward', 1) >= 0 ? 1 : -1) as 1 | -1;
const view = q.get('view') ?? 'iso';
const oem = q.get('oem') ?? 'tesla';
const play = q.get('play') === '1';
const speed = num('speed', 4);
const sides = sidesFor(toward);
const M = 1 / PLAN_UNITS_PER_METRE;

// ── renderer, scene, light ─────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f141b);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xcfe3f0, 0x1a2027, 0.55));
const sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
sun.position.set(-4, 9, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 30 });
sun.shadow.bias = -0.0004;
scene.add(sun);
// (no point light under the canopy: unshadowed, it lit the cabin through the roof)

// ── the deck and the stall paint ───────────────────────────────────────────
const deck = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshStandardMaterial({ color: 0x23282f, roughness: 0.94 }));
deck.rotation.x = -Math.PI / 2;
deck.receiveShadow = true;
scene.add(deck);
const paint = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.7 });
for (const s of [-1, 1]) {
  const line = new THREE.Mesh(new THREE.PlaneGeometry(5.9, 0.1), paint);
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.002, s * 1.72);
  scene.add(line);
}

// ── the canopy over the stall: roof deck, two purlins, the arm's header beam ──
const steel = new THREE.MeshStandardMaterial({ color: 0x8b949e, metalness: 0.75, roughness: 0.35 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.2, roughness: 0.8, side: THREE.DoubleSide });
const ROOF_Y = 5.62;
const roof = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 9), roofMat);
roof.position.set(0, ROOF_Y + 0.25, 0);
scene.add(roof);
const purlins: THREE.Mesh[] = [];
for (const z of [-1.6, 1.6]) {
  const purlin = new THREE.Mesh(new THREE.BoxGeometry(9, 0.2, 0.18), steel);
  purlin.position.set(0, ROOF_Y, z);
  purlin.castShadow = true;
  scene.add(purlin);
  purlins.push(purlin);
}
const headerY = ROOF_Y - 0.2;
const header = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 3.6), steel);
header.position.set(CLEAN_ARM.mountX, headerY, 0);
header.castShadow = true;
scene.add(header);
const columnTop = headerY - 0.11;
const columnBottom = CLEAN_ARM.link1Y + CLEAN_ARM.j1.h / 2 + 0.05;
const column = new THREE.Mesh(new THREE.BoxGeometry(CLEAN_ARM.column.w, columnTop - columnBottom, CLEAN_ARM.column.w),
  new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.34 }));
column.position.set(CLEAN_ARM.mountX, (columnTop + columnBottom) / 2, 0);
column.castShadow = true;
scene.add(column);
const led = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 3.2),
  new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe6f7ff, emissiveIntensity: 2.4 }));
led.position.set(CLEAN_ARM.mountX, headerY - 0.12, 0);
scene.add(led);

// ── the car, from the fleet's own buffers (plan units -> metres, nose on +x) ──
const car = new THREE.Group();
car.rotation.y = Math.PI / 2; // local nose +Z -> +x, local -X (right) -> +z
car.scale.setScalar(M);
scene.add(car);
const paintColor = new THREE.Color(q.get('paint') ?? '#e9eaec');
const MAT = {
  paint: new THREE.MeshPhysicalMaterial({ color: paintColor, roughness: 0.42, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.06 }),
  doorPaint: new THREE.MeshPhysicalMaterial({ color: paintColor, roughness: 0.42, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.06, vertexColors: true }),
  glass: new THREE.MeshStandardMaterial({ color: '#0d1418', roughness: 0.1, metalness: 0.25 }),
  trim: new THREE.MeshStandardMaterial({ color: '#171b21', roughness: 0.55, metalness: 0.45 }),
  tyre: new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: '#6a7280', roughness: 0.3, metalness: 0.9 }),
  lamps: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  status: new THREE.MeshBasicMaterial({ color: new THREE.Color('#00d2c0').multiplyScalar(1.8), toneMapped: false }),
  interior: cabinMaterial(),
  socket: new THREE.MeshStandardMaterial({ color: '#3a4048', roughness: 0.35, metalness: 0.9 }),
  ring: new THREE.MeshStandardMaterial({ color: '#00e5ff', emissive: '#00e5ff', emissiveIntensity: 2.2, toneMapped: false }),
};
const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = car, cast = true) => {
  const x = new THREE.Mesh(g, m);
  x.castShadow = cast;
  x.receiveShadow = true;
  parent.add(x);
  return x;
};
add(VEHICLE_GEO.body, MAT.paint);
add(VEHICLE_GEO.glass, MAT.glass);
add(VEHICLE_GEO.trim, MAT.trim);
add(VEHICLE_GEO.tyres, MAT.tyre);
add(VEHICLE_GEO.rims, MAT.rim);
add(VEHICLE_GEO.lamps, MAT.lamps, car, false);
add(VEHICLE_GEO.status, MAT.status, car, false);
add(VEHICLE_GEO.interior, MAT.interior, car, false);
// doors: each turned about its own hinge
const doorPivots: Record<'right' | 'left', THREE.Group> = { right: new THREE.Group(), left: new THREE.Group() };
for (const k of ['right', 'left'] as const) {
  const h = DOOR_HINGE_PU[k];
  const pivot = doorPivots[k];
  pivot.position.set(h.x, 0, h.z);
  car.add(pivot);
  const inner = new THREE.Group();
  inner.position.set(-h.x, 0, -h.z);
  pivot.add(inner);
  add(DOOR_GEO[k].panel, MAT.doorPaint, inner);
  add(DOOR_GEO[k].glass, MAT.glass, inner);
  add(DOOR_GEO[k].status, MAT.status, inner, false);
}
// the charge port, on the flank the charger stands on (local -toward)
const port = portFor('sandbox-car', oem);
const portSide = (-toward) as 1 | -1;
const pv = portInVehicleFrame(port.along, port.height, CAR_W_PU / 2, portSide);
const portG = new THREE.Group();
portG.position.set(pv.x, pv.y - 0.26, pv.z); // portInVehicleFrame adds DECK_Y; the sandbox deck is at 0
portG.rotation.y = portSide > 0 ? 0 : Math.PI;
car.add(portG);
add(PORT_GEO.socket, MAT.socket, portG, false);
add(PORT_GEO.ring, MAT.ring, portG, false);

// ── the OTTO-CHARGE ARM on its pedestal, mated to that port ────────────────
const cobot = buildCobot(OTTO_CHARGE_ARM, { withPlinth: true, lod: 'studio' });
const armBase = new THREE.Group();
armBase.position.set(0, MOUNT_HEIGHT_M, toward * PEDESTAL_TO_CAR_CENTRE_M);
armBase.rotation.y = toward > 0 ? Math.PI : 0; // arm +Z at the car, arm +X = -toward * along
armBase.add(cobot.root);
scene.add(armBase);
cobot.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
const target = { port: portInArmFrame(port.along, port.height, CAR_WIDTH_M / 2, toward), normal: { x: 0, y: 0, z: -1 } };
const mated = poseFor({ phase: 'charging', t: 1 }, target, OTTO_CHARGE_ARM);
const ang = mated.angles;
cobot.j1.rotation.set(0, ang.j1, 0); cobot.j2.rotation.set(ang.j2, 0, 0); cobot.j3.rotation.set(ang.j3, 0, 0);
cobot.j4.rotation.set(0, ang.j4, 0); cobot.j5.rotation.set(ang.j5, 0, 0); cobot.j6.rotation.set(0, ang.j6, 0);
// the DCFC cabinet behind it
const cab = new THREE.Mesh(
  new THREE.BoxGeometry(DCFC_CABINET_PU.width * 0.4785, DCFC_CABINET_PU.height * 0.4785, DCFC_CABINET_PU.depth * 0.4785),
  new THREE.MeshStandardMaterial({ color: 0x2b333d, metalness: 0.4, roughness: 0.5 }),
);
cab.position.set(0, (DCFC_CABINET_PU.padHeight + DCFC_CABINET_PU.height / 2) * 0.4785,
  toward * (PEDESTAL_TO_CAR_CENTRE_M + CABINET_BACKSET_PU * 0.4785));
cab.castShadow = true;
scene.add(cab);

// ── the OTTO-CLEAN ARM ─────────────────────────────────────────────────────
const clean = buildCleanArm();
clean.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
scene.add(clean.root);
const hoseMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.75 });
const hose = new THREE.Mesh(new THREE.BufferGeometry(), hoseMat);
hose.castShadow = true;
scene.add(hose);
const workLight = new THREE.PointLight(0xbff3ff, 0, 1.6, 2);
scene.add(workLight);

// ── the session, stepped from the cycle's start to ?t ──────────────────────
let session: CleanSession = IDLE_CLEAN;
let simT = 0;
function step(to: number) {
  while (simT < to) {
    const dt = Math.min(0.05, to - simT);
    simT += dt;
    session = advanceCleanSession(session, {
      dt, vehicleId: 'sandbox-car', active: simT < TOTAL, endsInS: Math.max(0, TOTAL - simT), sides,
    });
  }
}

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.05, 120);
function placeCamera() {
  const far = sides.a; // the flank cleaned first
  const views: Record<string, [THREE.Vector3, THREE.Vector3]> = {
    iso: [new THREE.Vector3(5.2, 3.6, far * 5.4), new THREE.Vector3(0.1, 1.5, 0)],
    far: [new THREE.Vector3(0.6, 1.6, far * 5.6), new THREE.Vector3(0.1, 1.4, 0)],
    port: [new THREE.Vector3(-0.6, 1.8, toward * 6.4), new THREE.Vector3(-0.1, 1.3, 0)],
    top: [new THREE.Vector3(0.2, 9.5, 0.01), new THREE.Vector3(0.2, 0, 0)],
    front: [new THREE.Vector3(6.4, 2.2, 0.3), new THREE.Vector3(0, 1.6, 0)],
    inside: [new THREE.Vector3(-1.05, 1.55, far * 2.9), new THREE.Vector3(0.2, 0.85, 0)],
    low: [new THREE.Vector3(2.6, 0.7, far * 3.4), new THREE.Vector3(0, 1.2, 0)],
    wide: [new THREE.Vector3(9.5, 5.5, far * 9.5), new THREE.Vector3(0, 2.2, 0)],
  };
  const [p, t] = views[view] ?? views.iso;
  camera.position.copy(p);
  camera.lookAt(t);
  // from above, the roof is all there is to see: lift it off
  roof.visible = view !== 'top';
  for (const o of purlins) o.visible = view !== 'top';
}
placeCamera();

const hud = document.getElementById('hud')!;
function frame() {
  const j = cleanSessionJoints(session, sides);
  poseCleanArm(clean.nodes, j);
  const open = doorsAt(session.phase, session.t);
  doorPivots.right.rotation.y = doorSwing(1, open);
  doorPivots.left.rotation.y = doorSwing(-1, open);
  scene.updateMatrixWorld(true);

  // the hose: from the carriage, bowed outboard, down beside the mast to the wrist
  const a = clean.hoseRoot.getWorldPosition(new THREE.Vector3());
  const w = clean.nodes.CA_Pitch.getWorldPosition(new THREE.Vector3());
  const mid1 = new THREE.Vector3((a.x * 2 + w.x) / 3, (a.y * 2 + w.y) / 3 + 0.05, (a.z * 2 + w.z) / 3);
  const out = new THREE.Vector3(w.x - CLEAN_ARM.mountX, 0, w.z).normalize().multiplyScalar(0.12);
  mid1.add(out);
  const mid2 = new THREE.Vector3((a.x + w.x * 2) / 3, (a.y + w.y * 2) / 3, (a.z + w.z * 2) / 3).add(out.multiplyScalar(0.8));
  hose.geometry.dispose();
  hose.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid1, mid2, w]), 28, 0.022, 8, false);

  // the work light at the nozzle while it cleans
  const working = session.phase.startsWith('clean') || session.phase.startsWith('enter') || session.phase.startsWith('exit');
  clean.mouth.getWorldPosition(workLight.position);
  workLight.intensity = working ? 1.4 : 0;

  // clearances at this pose, as the tests measure them
  const pt = cleanArmPoints(j);
  const caps = cleanArmCapsules(pt, columnTop);
  let carC = Infinity, doorC = Infinity;
  for (const c of caps.outside) { carC = Math.min(carC, capsuleMin(c, carClearance)); doorC = Math.min(doorC, doorsClearance(c, open)); }
  const side = session.phase.endsWith('_b') ? sides.b : sides.a;
  const am = apertureMargin(pt, side);
  const fmt = (v: number) => (Number.isFinite(v) ? `<span class="${v >= 0.03 ? 'good' : 'bad'}">${v >= 0 ? '+' : ''}${v.toFixed(3)} m</span>` : '—');
  const stroke = session.phase.startsWith('clean') ? strokeAt(session.t, side).what : '';
  hud.innerHTML =
    `<b>OTTO-CLEAN ARM</b>  t=${simT.toFixed(1)} s of ${TOTAL} s  view=${view}  column ${toward > 0 ? 'west' : 'east'}\n` +
    `phase          ${session.phase}  ${(session.t * 100).toFixed(0)}%${stroke ? `  (${stroke})` : ''}\n` +
    `sides          A = ${sides.a > 0 ? 'right' : 'left'} flank (far), B = ${sides.b > 0 ? 'right' : 'left'} (port, ${port.family})\n` +
    `clean A / B    ${session.cleanA.toFixed(0)} s / ${session.cleanB.toFixed(0)} s   doors ${(open * 100).toFixed(0)}%\n` +
    `links ↔ car    ${fmt(carC)}\n` +
    `links ↔ doors  ${fmt(doorC)}\n` +
    `wand in door   ${am && working ? fmt(am.margin) : '—'}`;
  renderer.render(scene, camera);
  document.title = `clean-check ready ${session.phase} ${simT.toFixed(1)}`;
}

step(num('t', 0));
frame();
if (play) {
  let last = performance.now();
  const loop = (now: number) => {
    const d = Math.min(0.1, (now - last) / 1000);
    last = now;
    step(simT + d * speed);
    frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
