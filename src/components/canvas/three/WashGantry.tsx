import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import { WASH_SHELL } from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';
import { washPoseAt, type WashPose } from '@/lib/ottoWash/washPose';
import { IDLE_WASH } from '@/lib/ottoWash/washSession';
import { BRUSH_SPIN_RAD_S, WASH_GANTRY as G } from '@/lib/ottoWash/washSpec';
import { DECK_Y } from './coordUtils';
import { StaticBatch } from './staticBatch';
import { galvanizedSteel, darkSteel, safetyYellowPaint, rubberBlack, statusLamp } from './buildingSkin';

/**
 * OTTO-WASH — the robotic rollover gantry in each wash bay (docs/OTTO-WASH.md).
 *
 * This component DRAWS; it decides nothing. The machine's session is stepped once, in the
 * motion driver (engine/motion/washGate.ts), from what the twin publishes (the car's seat in
 * the bay and when it ends, otto-q-core 0762) and what the motion layer knows (the car standing
 * on the bay's pose). The same session opens a detail seat's doors (doorStore) and holds the car
 * until the machine is home, so the drawn machine, the drawn doors and the car's right to move
 * are one evaluation.
 *
 * FRAME: each bay's group stands on the bay's drive line at the parked car's centre, on the deck.
 * The bay frame of washSpec.ts maps to it as local x = -x (plan x runs east, world x west),
 * local z = -dy (plan y runs south, world z north), local y = height.
 */

/** Two-tone foam stripes, so a turning brush reads as turning. */
function stripeTexture(a: string, b: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * 8, 0, 8, 8); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Falling streaks with soft edges: the spray curtain, scrolled each frame. */
function streakTexture(seed: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 260; i++) {
    const x = r() * 128, y = r() * 128, len = 6 + r() * 26, a = 0.15 + r() * 0.45;
    const grad = g.createLinearGradient(x, y, x, y + len);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 1 + r() * 1.5, len);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The parts that move with the gantry and never move relative to it: legs, trolleys, beam, arch, ducts. */
function buildFrame(): Map<string, THREE.BufferGeometry> {
  const b = new StaticBatch();
  const z = (dy: number) => -dy; // bay dy -> the gantry group's local z
  for (const side of [-1, 1]) {
    const x = side * G.legX;
    // trolley on its rail, with a wheel housing at each end
    b.box('dark', x, G.trolley.h / 2, z(G.leg.dy), G.trolley.w, G.trolley.h, G.trolley.d);
    for (const e of [-1, 1]) b.hCylinder('rubber', x, 0.28, z(G.leg.dy) + e * (G.trolley.d / 2 - 0.45), 0.28, G.trolley.w + 0.08, 'x', 14);
    // leg: a deep plate, tapered at its foot by a gusset
    b.box('yellow', x, (G.trolley.h + G.leg.top) / 2, z(G.leg.dy), G.leg.w, G.leg.top - G.trolley.h, G.leg.d);
    b.box('galv', x, G.trolley.h + 0.6, z(G.leg.dy), G.leg.w + 0.2, 1.2, G.leg.d + 0.5);
  }
  // the beam, and its cap
  const beamLen = 2 * G.legX + G.leg.w;
  b.box('yellow', 0, (G.beam.y0 + G.beam.y1) / 2, z((G.beam.dy0 + G.beam.dy1) / 2), beamLen, G.beam.y1 - G.beam.y0, G.beam.dy1 - G.beam.dy0);
  b.box('dark', 0, G.beam.y1 + 0.18, z((G.beam.dy0 + G.beam.dy1) / 2) , beamLen - 1.2, 0.36, 0.9);
  // the machine's cabinet and blower on the beam
  b.box('galv', -3.6, G.beam.y1 + 0.55, z(G.dryer.dy), 2.4, 1.1, 1.3);
  b.hCylinder('dark', 3.4, G.beam.y1 + 0.6, z(G.dryer.dy), 0.55, 1.8, 'x', 18);
  // the spray arch: two uprights, a crossbar, a feed from the beam
  for (const side of [-1, 1]) b.cylinder('galv', side * G.arch.x, 0.35, z(G.arch.dy), G.arch.r, G.arch.top - 0.35, 10);
  b.hCylinder('galv', 0, G.arch.top, z(G.arch.dy), G.arch.r, 2 * G.arch.x + 2 * G.arch.r, 'x', 10);
  b.box('galv', 0, (G.arch.top + G.beam.y0) / 2, z(G.arch.dy), 0.2, G.beam.y0 - G.arch.top, 0.2);
  // nozzles down the uprights and along the crossbar, aimed in at the car
  for (let k = 0; k < G.arch.nozzles; k++) {
    const f = (k + 0.5) / G.arch.nozzles;
    for (const side of [-1, 1]) b.box('dark', side * (G.arch.x - 0.2), 0.7 + f * (G.arch.top - 1.2), z(G.arch.dy), 0.22, 0.12, 0.12);
    b.box('dark', (f - 0.5) * 2 * (G.arch.x - 0.6), G.arch.top - 0.2, z(G.arch.dy), 0.12, 0.22, 0.12);
  }
  // the side brushes' and the wands' carriage tracks under the beam
  for (const dy of [G.sideBrush.dy, G.wand.dy]) b.box('dark', 0, G.beam.y0 - 0.12, z(dy), 2 * (G.legX - 0.6), 0.24, 0.28);
  // the top brush's slides
  for (const side of [-1, 1]) b.box('dark', side * G.topBrush.hangerX, G.beam.y0 - 0.5, z(G.topBrush.dy), 0.24, 1.0, 0.3);
  // the stop light's housing, facing south toward an arriving car
  b.box('dark', G.light.x, G.light.y, z(G.beam.dy1) - 0.12, 1.5, 0.75, 0.24);
  return b.build();
}

/** One bay's moving parts. */
interface Rig {
  gantry: THREE.Group;
  side: THREE.Mesh[];          // the two side brushes (spin about their axis)
  sideHub: THREE.Mesh[];       // their motors and shafts
  top: THREE.Group;            // the top brush's axle frame (moves in y)
  topBrush: THREE.Mesh;        // spins about x
  hangers: THREE.Mesh[];       // from the top brush up to its slides
  knifeTop: THREE.Mesh;
  knifeSide: THREE.Mesh[];
  duct: THREE.Mesh;            // the top knife's duct up to the beam
  mast: THREE.Mesh[];          // the wands' vertical stages
  arm: THREE.Mesh[];           // the wands' horizontal stages
  head: THREE.Mesh[];          // the vacuum heads
  curtain: THREE.Mesh;         // the arch's spray
  air: THREE.Mesh[];           // the air knives' blast
  beacon: THREE.Mesh;
  stopRed: THREE.Mesh;
  stopGreen: THREE.Mesh;
}

const STATUS_COLOR: Record<WashPose['status'], number> = {
  home: 0x00e5ff, working: 0x35d07f, moving: 0xffb020, finishing: 0xffb020,
};
const SPRAY_COLOR: Record<Exclude<WashPose['spray'], 'none'>, { color: number; opacity: number; speed: number }> = {
  soak: { color: 0xffd9f0, opacity: 0.55, speed: 0.6 },   // pre-soak foam
  foam: { color: 0x9fd2ff, opacity: 0.42, speed: 0.8 },   // the brushes' foam
  rinse: { color: 0xd8f1ff, opacity: 0.36, speed: 1.6 },  // clear rinse water
};

/** DEV-ONLY: each bay's machine as drawn, for the playback scripts (the R3F scene graph is not reachable from the DOM). */
const washDebug: Map<string, { phase: string; t: number; vehicleId: string | null; dy: number; brushX: number; topY: number; doors: number }> | null =
  import.meta.env.DEV ? new Map() : null;
if (washDebug && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__washGantries = washDebug;
}

function WashGantryBay({ bayId, planX, shared, frame }: {
  bayId: string;
  planX: number;
  shared: ReturnType<typeof useMats>;
  frame: Map<string, THREE.BufferGeometry>;
}) {
  // each bay's beacon, spray and air change on their own, so each bay has its own of those
  const mats = useMemo(() => {
    const streak = shared.textures.streak.clone(); streak.needsUpdate = true;
    const air = shared.textures.air.clone(); air.needsUpdate = true;
    const spray = shared.spray.clone(); spray.map = streak;
    const blast = shared.air.clone(); blast.map = air;
    return { ...shared, beacon: shared.beacon.clone(), spray, air: blast, streak, airTex: air };
  }, [shared]);
  useEffect(() => () => {
    mats.beacon.dispose(); mats.spray.dispose(); mats.air.dispose(); mats.streak.dispose(); mats.airTex.dispose();
  }, [mats]);
  const rig = useMemo<Rig>(() => {
    const gantry = new THREE.Group();
    for (const [k, g] of frame) {
      const m = new THREE.Mesh(g, mats[k as keyof typeof mats] as THREE.Material);
      m.castShadow = true; m.receiveShadow = true;
      gantry.add(m);
    }
    const brushH = G.sideBrush.y1 - G.sideBrush.y0;
    const sideGeo = new THREE.CylinderGeometry(G.sideBrush.r, G.sideBrush.r, brushH, 28, 1, false);
    const side = [-1, 1].map((sgn) => {
      const m = new THREE.Mesh(sideGeo, sgn < 0 ? mats.brushBlue : mats.brushRed);
      m.position.set(0, (G.sideBrush.y0 + G.sideBrush.y1) / 2, -G.sideBrush.dy);
      m.castShadow = true;
      gantry.add(m);
      return m;
    });
    const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.0, 10);
    hubGeo.translate(0, G.sideBrush.y1 + 0.5, 0);
    const sideHub = [-1, 1].map(() => {
      const m = new THREE.Mesh(hubGeo, mats.dark);
      m.position.set(0, 0, -G.sideBrush.dy);
      gantry.add(m);
      return m;
    });
    const top = new THREE.Group();
    top.position.set(0, G.topBrush.retractY, -G.topBrush.dy);
    gantry.add(top);
    const topGeo = new THREE.CylinderGeometry(G.topBrush.r, G.topBrush.r, 2 * G.topBrush.halfLen, 28, 1, false);
    const topAxle = new THREE.Group();
    topAxle.rotation.z = Math.PI / 2;
    top.add(topAxle);
    const topBrush = new THREE.Mesh(topGeo, mats.brushBlue);
    topBrush.castShadow = true;
    topAxle.add(topBrush);
    const capGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.2, 12);
    capGeo.rotateZ(Math.PI / 2);
    for (const sgn of [-1, 1]) {
      const cap = new THREE.Mesh(capGeo, mats.dark);
      cap.position.set(sgn * (G.topBrush.halfLen + 0.1), 0, 0);
      top.add(cap);
    }
    const hangerGeo = new THREE.BoxGeometry(0.16, 1, 0.16);
    hangerGeo.translate(0, 0.5, 0);
    const hangers = [-1, 1].map((sgn) => {
      const m = new THREE.Mesh(hangerGeo, mats.galv);
      m.position.set(sgn * G.topBrush.hangerX, 0, -G.topBrush.dy);
      gantry.add(m);
      return m;
    });
    const knifeTop = new THREE.Mesh(new THREE.BoxGeometry(2 * G.dryer.top.halfLen, G.dryer.top.h, G.dryer.top.d), mats.galv);
    knifeTop.position.z = -G.dryer.dy;
    knifeTop.castShadow = true;
    gantry.add(knifeTop);
    const ductGeo = new THREE.BoxGeometry(0.5, 1, 0.3);
    ductGeo.translate(0, 0.5, 0);
    const duct = new THREE.Mesh(ductGeo, mats.rubber);
    duct.position.z = -G.dryer.dy;
    gantry.add(duct);
    const knifeSideGeo = new THREE.BoxGeometry(G.dryer.side.w, G.dryer.side.y1 - G.dryer.side.y0, G.dryer.side.d);
    const knifeSide = [-1, 1].map(() => {
      const m = new THREE.Mesh(knifeSideGeo, mats.galv);
      m.position.set(0, (G.dryer.side.y0 + G.dryer.side.y1) / 2, -G.dryer.dy);
      m.castShadow = true;
      gantry.add(m);
      return m;
    });
    const mastGeo = new THREE.CylinderGeometry(G.wand.r, G.wand.r, 1, 10);
    mastGeo.translate(0, 0.5, 0);
    const mast = [-1, 1].map(() => {
      const m = new THREE.Mesh(mastGeo, mats.galv);
      m.position.z = -G.wand.dy;
      gantry.add(m);
      return m;
    });
    // the arm runs from its mast along local +x (scaled to its reach); the west arm is turned half round
    const armGeo = new THREE.CylinderGeometry(G.wand.r * 0.8, G.wand.r * 0.8, 1, 10);
    armGeo.rotateZ(Math.PI / 2);
    armGeo.translate(0.5, 0, 0);
    const arm = [-1, 1].map((sgn) => {
      const m = new THREE.Mesh(armGeo, mats.galv);
      m.position.z = -G.wand.dy;
      if (sgn < 0) m.rotation.y = Math.PI;
      gantry.add(m);
      return m;
    });
    const headGeo = new THREE.BoxGeometry(0.22, 0.14, 0.34);
    const head = [-1, 1].map(() => {
      const m = new THREE.Mesh(headGeo, mats.headLamp);
      m.position.z = -G.wand.dy;
      gantry.add(m);
      return m;
    });
    // the spray curtain across the arch, and the air knives' blast
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(2 * (G.arch.x - 0.3), G.arch.top - 0.5), mats.spray);
    curtain.position.set(0, 0.35 + (G.arch.top - 0.5) / 2, -G.arch.dy - 0.02);
    curtain.rotation.y = Math.PI; // the curtain is drawn from both sides anyway; keep its uv the right way up
    curtain.visible = false;
    curtain.renderOrder = 2;
    gantry.add(curtain);
    const airGeo = new THREE.PlaneGeometry(1, 1);
    const air = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(airGeo, mats.air);
      m.visible = false;
      m.renderOrder = 2;
      gantry.add(m);
      return m;
    });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.4, 14), mats.beacon);
    beacon.position.set(-3.6, G.beam.y1 + 1.3, -G.dryer.dy);
    gantry.add(beacon);
    const lampGeo = new THREE.CircleGeometry(0.22, 18);
    const stopRed = new THREE.Mesh(lampGeo, mats.lampOff);
    stopRed.position.set(G.light.x - 0.36, G.light.y, -G.beam.dy1 - 0.25);
    stopRed.rotation.y = Math.PI;
    gantry.add(stopRed);
    const stopGreen = new THREE.Mesh(lampGeo, mats.lampOff);
    stopGreen.position.set(G.light.x + 0.36, G.light.y, -G.beam.dy1 - 0.25);
    stopGreen.rotation.y = Math.PI;
    gantry.add(stopGreen);
    return { gantry, side, sideHub, top, topBrush, hangers, knifeTop, knifeSide, duct, mast, arm, head, curtain, air, beacon, stopRed, stopGreen };
  }, [frame, mats]);

  useEffect(() => () => {
    rig.gantry.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && ![...frame.values()].includes(m.geometry)) m.geometry.dispose();
    });
  }, [rig, frame]);

  const spin = useRef(0);
  useFrame((_state, delta) => {
    const s = twinMotionDriver.washSessionAt(bayId) ?? IDLE_WASH;
    const p = washPoseAt(s);
    rig.gantry.position.z = -p.dy;
    if (p.spinning) spin.current += Math.min(delta, 0.1) * BRUSH_SPIN_RAD_S;
    // the side brushes: east (bay +x) is local -x; they turn opposite ways, like a real pair
    rig.side.forEach((m, i) => {
      const sgn = i === 0 ? -1 : 1;
      m.position.x = -sgn * p.sideBrushX;
      m.rotation.y = sgn * spin.current;
      rig.sideHub[i].position.x = -sgn * p.sideBrushX;
    });
    rig.top.position.y = p.topBrushY;
    rig.topBrush.rotation.y = spin.current;
    for (const h of rig.hangers) { h.position.y = p.topBrushY; h.scale.y = Math.max(0.05, G.beam.y0 - p.topBrushY); }
    rig.knifeTop.position.y = p.dryerTopY + G.dryer.top.h / 2;
    rig.duct.position.y = p.dryerTopY + G.dryer.top.h;
    rig.duct.scale.y = Math.max(0.05, G.beam.y0 - (p.dryerTopY + G.dryer.top.h));
    rig.knifeSide.forEach((m, i) => { const sgn = i === 0 ? -1 : 1; m.position.x = -sgn * (p.dryerSideX + G.dryer.side.w / 2); });
    // the wands: the mast from under the beam down to its foot, the arm in through the door
    const foot = G.wand.topY + (G.wand.workY - G.wand.topY) * p.wandDrop;
    const tip = G.wand.x + (G.wand.reachX - G.wand.x) * p.wandReach;
    rig.mast.forEach((m, i) => {
      const sgn = i === 0 ? -1 : 1;
      m.position.set(-sgn * G.wand.x, foot, -G.wand.dy);
      m.scale.y = Math.max(0.05, G.beam.y0 - foot);
    });
    rig.arm.forEach((m, i) => {
      const sgn = i === 0 ? -1 : 1;
      m.visible = p.wandDrop > 0.02;
      m.position.set(-sgn * G.wand.x, foot, -G.wand.dy);
      // from the mast in toward the car's centreline (turned half round on the west side)
      m.scale.x = Math.max(0.05, G.wand.x - tip);
    });
    rig.head.forEach((m, i) => {
      const sgn = i === 0 ? -1 : 1;
      m.visible = p.wandDrop > 0.02;
      m.position.set(-sgn * tip, foot, -G.wand.dy);
    });
    // spray and air
    if (p.spray !== 'none') {
      const c = SPRAY_COLOR[p.spray];
      mats.spray.color.setHex(c.color);
      mats.spray.opacity = c.opacity;
      mats.streak.offset.y += Math.min(delta, 0.1) * c.speed;
      rig.curtain.visible = true;
    } else rig.curtain.visible = false;
    if (p.air) {
      mats.airTex.offset.y -= Math.min(delta, 0.1) * 2.4;
      const topY = p.dryerTopY;
      const [a, b, c] = rig.air;
      a.visible = b.visible = c.visible = true;
      // the top knife blows down onto the roof; the side knives blow in at the flanks
      a.scale.set(2 * G.dryer.top.halfLen, Math.max(0.2, topY - 3.2), 1);
      a.position.set(0, topY - a.scale.y / 2, -G.dryer.dy);
      a.rotation.set(0, 0, 0);
      for (const [m, sgn] of [[b, -1], [c, 1]] as const) {
        m.scale.set(Math.max(0.2, p.dryerSideX - 1.9), G.dryer.side.y1 - G.dryer.side.y0, 1);
        m.position.set(-sgn * (p.dryerSideX - m.scale.x / 2), (G.dryer.side.y0 + G.dryer.side.y1) / 2, -G.dryer.dy);
        m.rotation.set(0, 0, 0);
      }
    } else for (const m of rig.air) m.visible = false;
    // lights
    (rig.beacon.material as THREE.MeshStandardMaterial).emissive.setHex(STATUS_COLOR[p.status]);
    rig.stopRed.material = p.stop ? mats.lampRed : mats.lampOff;
    rig.stopGreen.material = p.stop ? mats.lampOff : mats.lampGreen;
    if (washDebug) {
      washDebug.set(bayId, {
        phase: s.phase, t: Math.round(s.t * 1000) / 1000, vehicleId: s.vehicleId, dy: Math.round(p.dy * 1000) / 1000,
        brushX: Math.round(p.sideBrushX * 1000) / 1000, topY: Math.round(p.topBrushY * 1000) / 1000, doors: p.doors,
      });
    }
  });

  // the bay's group stands still; the gantry inside it rides the rails
  return (
    <group position={[150 - planX, DECK_Y, 110 - BAY_STALL_Y]}>
      <primitive object={rig.gantry} />
    </group>
  );
}

function useMats() {
  return useMemo(() => {
    const blue = stripeTexture('#2a6fd6', '#7fb3ff');
    const red = stripeTexture('#c8313f', '#ff8a96');
    blue.repeat.set(3, 1); red.repeat.set(3, 1);
    const streak = streakTexture(7);
    streak.repeat.set(4, 2);
    const air = streakTexture(31);
    air.repeat.set(3, 1);
    const beacon = new THREE.MeshStandardMaterial({ color: 0x223038, emissive: new THREE.Color(0x00e5ff), emissiveIntensity: 2.2, toneMapped: false });
    return {
      textures: { blue, red, streak, air },
      galv: galvanizedSteel(),
      dark: darkSteel(),
      yellow: safetyYellowPaint(),
      rubber: rubberBlack(),
      brushBlue: new THREE.MeshStandardMaterial({ map: blue, roughness: 0.95, metalness: 0 }),
      brushRed: new THREE.MeshStandardMaterial({ map: red, roughness: 0.95, metalness: 0 }),
      headLamp: statusLamp('#35d07f'),
      spray: new THREE.MeshBasicMaterial({
        map: streak, color: 0xd8f1ff, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
      air: new THREE.MeshBasicMaterial({
        map: air, color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
      beacon,
      lampRed: statusLamp('#ff2a2a'),
      lampGreen: statusLamp('#2aff6a'),
      lampOff: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.4 }),
    };
  }, []);
}

/** The wash hall's machines: one gantry in each open bay. */
export function WashGantries({ count }: { count: number }) {
  const all = useMats();
  const frame = useMemo(() => buildFrame(), []);
  useEffect(() => () => {
    for (const g of frame.values()) g.dispose();
    for (const t of Object.values(all.textures)) t.dispose();
    all.brushBlue.dispose(); all.brushRed.dispose(); all.spray.dispose(); all.air.dispose(); all.beacon.dispose(); all.lampOff.dispose();
  }, [frame, all]);
  // a bay's machine is named by the bay's own id, which is the renderer stall the car parks on (WASH-01 ..)
  const bays = WASH_SHELL.bays.slice(0, count);
  return (
    <group name="washGantries">
      {bays.map((b) => <WashGantryBay key={b.id} bayId={b.id} planX={b.x} shared={all} frame={frame} />)}
    </group>
  );
}
