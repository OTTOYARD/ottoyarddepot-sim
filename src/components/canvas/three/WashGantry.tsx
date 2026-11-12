import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import { WASH_SHELL } from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';
import { washPoseAt, type WashPose } from '@/lib/ottoWash/washPose';
import { IDLE_WASH } from '@/lib/ottoWash/washSession';
import { WASH_GANTRY as G } from '@/lib/ottoWash/washSpec';
import { DECK_Y } from './coordUtils';
import { StaticBatch } from './staticBatch';
import { galvanizedSteel, darkSteel, safetyYellowPaint, rubberBlack, statusLamp } from './buildingSkin';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { poseSkeleton, type DepotCad } from '@/lib/robotics/cadDepot';
import { washJoints } from '@/lib/robotics/catalog';
import { makeInstancedFleet, writeFleetSlot, writeFleetLight, clearFleetSlot, type InstancedFleet } from './instancedFleet';
import { makeFlexFleet, type FlexFleet } from '@/lib/robotics/flexMesh';

/**
 * OTTO-WASH — the touchless wash machine in each wash bay (docs/OTTO-WASH.md).
 *
 * This component DRAWS; it decides nothing. The machine's session is stepped once, in the
 * motion driver (engine/motion/washGate.ts), from what the twin publishes (the car's seat in
 * the bay and when it ends, otto-q-core 0762) and what the motion layer knows (the car standing
 * on the bay's pose). The same session holds the car until the machine is home, so the drawn
 * machine and the car's right to move are one evaluation. No door opens in a wash bay.
 *
 * FRAME: each bay's group stands on the bay's drive line at the parked car's centre, on the deck.
 * The bay frame of washSpec.ts maps to it as local x = -x (plan x runs east, world x west),
 * local z = -dy (plan y runs south, world z north), local y = height.
 *
 * THE MACHINE IS THE ENGINEERING CAD (cad/ wash_gantry.py, robotics/cadDepot.ts): its rails and end
 * stops, trolleys and drives, portal, spray arch, air knives, the two sensor-wipe arms on their cross
 * rail, cabinet and drag chain, at the depot's level of detail, in the same bay frame (metres: scaled
 * to plan units here). The twin's pose drives its slides and wrists through catalog.washJoints, and
 * its beacon and stop lamps show the program. Nothing on it turns against the car. Every bay's
 * machine is one instance of one set of meshes (instancedFleet.ts). robotics/cadYard.test.ts holds it
 * to the car, the doors and the wash hall's walls. Until the CAD has loaded, or if it cannot, each bay
 * draws the simple machine below. The spray and the air are drawn on both.
 */

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
  // the wipe arms' cross rail under the beam
  b.box('dark', 0, G.beam.y0 - 0.12, z(G.wipe.dy), 2 * (G.legX - 0.6), 0.24, 0.28);
  // the stop light's housing, facing south toward an arriving car
  b.box('dark', G.light.x, G.light.y, z(G.beam.dy1) - 0.12, 1.5, 0.75, 0.24);
  return b.build();
}

/** One bay's moving parts. */
interface Rig {
  gantry: THREE.Group;
  knifeTop: THREE.Mesh;
  knifeSide: THREE.Mesh[];
  duct: THREE.Mesh;            // the top knife's duct up to the beam
  carriage: THREE.Mesh[];      // the wipe arms' carriages on the cross rail
  mast: THREE.Mesh[];          // their masts, from the carriage down to the pad
  pad: THREE.Mesh[];           // the soft pads
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
  jet: { color: 0x9fd2ff, opacity: 0.42, speed: 2.2 },    // the wash jets
  rinse: { color: 0xd8f1ff, opacity: 0.36, speed: 1.6 },  // clear rinse water
};

/** DEV-ONLY: each bay's machine as drawn, for the playback scripts (the R3F scene graph is not reachable from the DOM). */
const washDebug: Map<string, { phase: string; t: number; vehicleId: string | null; dy: number; padX: number; padY: number; station: string | null }> | null =
  import.meta.env.DEV ? new Map() : null;
if (washDebug && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__washGantries = washDebug;
}

/** The spray curtain across the arch and the air knives' blast: drawn on the machine, not parts of it (plan units). */
interface WashEffects { curtain: THREE.Mesh; air: THREE.Mesh[] }

function addWashEffects(gantry: THREE.Group, spray: THREE.Material, air: THREE.Material): WashEffects {
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(2 * (G.arch.x - 0.3), G.arch.top - 0.5), spray);
  curtain.position.set(0, 0.35 + (G.arch.top - 0.5) / 2, -G.arch.dy - 0.02);
  curtain.rotation.y = Math.PI; // the curtain is drawn from both sides anyway; keep its uv the right way up
  curtain.visible = false;
  curtain.renderOrder = 2;
  gantry.add(curtain);
  const airGeo = new THREE.PlaneGeometry(1, 1);
  const blast = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(airGeo, air);
    m.visible = false;
    m.renderOrder = 2;
    gantry.add(m);
    return m;
  });
  return { curtain, air: blast };
}

/** Show the spray and the air as the pose has them, scrolling their streaks by the frame's time. */
function poseWashEffects(fx: WashEffects, p: WashPose, delta: number, mats: {
  spray: THREE.MeshBasicMaterial; streak: THREE.Texture; airTex: THREE.Texture;
}): void {
  if (p.spray !== 'none') {
    const c = SPRAY_COLOR[p.spray];
    mats.spray.color.setHex(c.color);
    mats.spray.opacity = c.opacity;
    mats.streak.offset.y += Math.min(delta, 0.1) * c.speed;
    fx.curtain.visible = true;
  } else fx.curtain.visible = false;
  if (p.air) {
    mats.airTex.offset.y -= Math.min(delta, 0.1) * 2.4;
    const topY = p.dryerTopY;
    const [a, b, c] = fx.air;
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
  } else for (const m of fx.air) m.visible = false;
}

/** Each bay's own spray, air and beacon materials (they change per bay), cloned from the shared set. */
function useBayMats(shared: ReturnType<typeof useMats>) {
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
  return mats;
}

function WashGantryBay({ bayId, planX, shared, frame }: {
  bayId: string;
  planX: number;
  shared: ReturnType<typeof useMats>;
  frame: Map<string, THREE.BufferGeometry>;
}) {
  // each bay's beacon, spray and air change on their own, so each bay has its own of those
  const mats = useBayMats(shared);
  const rig = useMemo<Rig>(() => {
    const gantry = new THREE.Group();
    for (const [k, g] of frame) {
      const m = new THREE.Mesh(g, mats[k as keyof typeof mats] as THREE.Material);
      m.castShadow = true; m.receiveShadow = true;
      gantry.add(m);
    }
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
    // the wipe arms: a carriage on the cross rail, a mast down from it, and the pad (a disc whose axis is its face)
    const W = G.wipe;
    const carGeo = new THREE.BoxGeometry(W.carriage.w, W.carriage.h, W.carriage.d);
    const carriage = [-1, 1].map(() => {
      const m = new THREE.Mesh(carGeo, mats.dark);
      m.position.set(0, G.beam.y0 - 0.24 - W.carriage.h / 2, -W.dy);
      gantry.add(m);
      return m;
    });
    const mastGeo = new THREE.CylinderGeometry(W.mastR, W.mastR, 1, 10);
    mastGeo.translate(0, 0.5, 0);
    const mast = [-1, 1].map(() => {
      const m = new THREE.Mesh(mastGeo, mats.galv);
      m.position.z = -W.dy;
      gantry.add(m);
      return m;
    });
    const padGeo = new THREE.CylinderGeometry(W.padR, W.padR, W.padT, 20);
    const pad = [-1, 1].map(() => {
      const m = new THREE.Mesh(padGeo, mats.pad);
      m.position.z = -W.dy;
      gantry.add(m);
      return m;
    });
    // the spray curtain across the arch, and the air knives' blast
    const { curtain, air } = addWashEffects(gantry, mats.spray, mats.air);
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
    return { gantry, knifeTop, knifeSide, duct, carriage, mast, pad, curtain, air, beacon, stopRed, stopGreen };
  }, [frame, mats]);

  useEffect(() => () => {
    rig.gantry.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && ![...frame.values()].includes(m.geometry)) m.geometry.dispose();
    });
  }, [rig, frame]);

  useFrame((_state, delta) => {
    const s = twinMotionDriver.washSessionAt(bayId) ?? IDLE_WASH;
    const p = washPoseAt(s);
    rig.gantry.position.z = -p.dy;
    rig.knifeTop.position.y = p.dryerTopY + G.dryer.top.h / 2;
    rig.duct.position.y = p.dryerTopY + G.dryer.top.h;
    rig.duct.scale.y = Math.max(0.05, G.beam.y0 - (p.dryerTopY + G.dryer.top.h));
    rig.knifeSide.forEach((m, i) => { const sgn = i === 0 ? -1 : 1; m.position.x = -sgn * (p.dryerSideX + G.dryer.side.w / 2); });
    // the wipe arms: east (bay +x) is local -x. The pad's disc turns to face the car: down when stowed, in toward
    // the drive line on the flanks and the roof pod, along the bay on the nose and the tail.
    const padZ = -(p.padDy - p.dy);
    rig.carriage.forEach((m, i) => { const sgn = i === 0 ? -1 : 1; m.position.x = -sgn * p.mastX; });
    rig.mast.forEach((m, i) => {
      const sgn = i === 0 ? -1 : 1;
      m.position.set(-sgn * p.mastX, p.padY, -G.wipe.dy);
      m.scale.y = Math.max(0.05, G.beam.y0 - 0.24 - p.padY);
    });
    rig.pad.forEach((m, i) => {
      const sgn = i === 0 ? -1 : 1;
      m.position.set(-sgn * p.padX, p.padY, padZ);
      m.rotation.set(p.padFace === 'aft' || p.padFace === 'fore' ? Math.PI / 2 : 0, 0, p.padFace === 'in' ? Math.PI / 2 : 0);
    });
    // spray and air
    poseWashEffects(rig, p, delta, mats);
    // lights
    (rig.beacon.material as THREE.MeshStandardMaterial).emissive.setHex(STATUS_COLOR[p.status]);
    rig.stopRed.material = p.stop ? mats.lampRed : mats.lampOff;
    rig.stopGreen.material = p.stop ? mats.lampOff : mats.lampGreen;
    if (washDebug) {
      washDebug.set(bayId, {
        phase: s.phase, t: Math.round(s.t * 1000) / 1000, vehicleId: s.vehicleId, dy: Math.round(p.dy * 1000) / 1000,
        padX: Math.round(p.padX * 1000) / 1000, padY: Math.round(p.padY * 1000) / 1000, station: p.station,
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

/** One bay's machine as the engineering CAD: a skeleton posed from the twin, drawn into its slot of the shared meshes. */
function CadWashBay({ bayId, planX, cad, fleet, flex, slot, shared }: {
  bayId: string;
  planX: number;
  cad: DepotCad;
  fleet: InstancedFleet;
  flex: FlexFleet | null;
  slot: number;
  shared: ReturnType<typeof useMats>;
}) {
  const machineRef = useRef<THREE.Group>(null);
  const mats = useBayMats(shared);
  const rig = useMemo(() => {
    const skel = cad.skeleton();
    const effects = new THREE.Group();
    const fx = addWashEffects(effects, mats.spray, mats.air);
    return { skel, effects, fx };
  }, [cad, mats]);
  useEffect(() => () => clearFleetSlot(fleet, slot), [fleet, slot]);
  useEffect(() => () => flex?.clear(slot), [flex, slot]);
  useEffect(() => () => {
    rig.fx.curtain.geometry.dispose();
    rig.fx.air[0].geometry.dispose();
  }, [rig]);

  useFrame((_state, delta) => {
    const s = twinMotionDriver.washSessionAt(bayId) ?? IDLE_WASH;
    const p = washPoseAt(s);
    poseSkeleton(rig.skel, washJoints(p));
    machineRef.current?.updateWorldMatrix(true, true);
    // the beacon shows the program's state; the stop lamps face the arriving car (red while it runs)
    writeFleetSlot(fleet, slot, rig.skel.segments, STATUS_COLOR[p.status], 2.2);
    writeFleetLight(fleet, slot, 1, p.stop ? 0xff2a2a : 0x2a1214, p.stop ? 2.4 : 0);
    writeFleetLight(fleet, slot, 2, p.stop ? 0x122a16 : 0x2aff6a, p.stop ? 0 : 2.4);
    // its lines: the drag chain in its trench, the knives' ducts and chains, the wipe arms' cables and pad-rinse lines
    flex?.write(slot, rig.skel);
    rig.effects.position.z = -p.dy;
    poseWashEffects(rig.fx, p, delta, mats);
    if (washDebug) {
      washDebug.set(bayId, {
        phase: s.phase, t: Math.round(s.t * 1000) / 1000, vehicleId: s.vehicleId, dy: Math.round(p.dy * 1000) / 1000,
        padX: Math.round(p.padX * 1000) / 1000, padY: Math.round(p.padY * 1000) / 1000, station: p.station,
      });
    }
  });

  return (
    <group position={[150 - planX, DECK_Y, 110 - BAY_STALL_Y]}>
      {/* the CAD is in metres, in this same bay frame: scale it to plan units */}
      <group ref={machineRef} scale={PLAN_UNITS_PER_METRE}>
        <primitive object={rig.skel.root} />
      </group>
      <primitive object={rig.effects} />
    </group>
  );
}

/** Every bay's machine as one instance of the CAD's meshes. */
function CadWashGantries({ cad, bays, shared }: {
  cad: DepotCad;
  bays: readonly { id: string; x: number }[];
  shared: ReturnType<typeof useMats>;
}) {
  const fleet = useMemo(() => makeInstancedFleet(cad.parts, WASH_SHELL.bays.length, { receiveShadow: true }), [cad]);
  useEffect(() => () => fleet.dispose(), [fleet]);
  const flex = useMemo(() => (cad.flex.length ? makeFlexFleet(cad.flex, WASH_SHELL.bays.length) : null), [cad]);
  useEffect(() => () => flex?.dispose(), [flex]);
  useEffect(() => { for (const m of fleet.meshes) m.count = bays.length; }, [fleet, bays.length]);
  return (
    <group name="washGantries">
      {fleet.meshes.map((m, i) => <primitive key={`washpart-${i}`} object={m} />)}
      {flex && <primitive object={flex.group} />}
      {bays.map((b, i) => <CadWashBay key={b.id} bayId={b.id} planX={b.x} cad={cad} fleet={fleet} flex={flex} slot={i} shared={shared} />)}
    </group>
  );
}

function useMats() {
  return useMemo(() => {
    const streak = streakTexture(7);
    streak.repeat.set(4, 2);
    const air = streakTexture(31);
    air.repeat.set(3, 1);
    const beacon = new THREE.MeshStandardMaterial({ color: 0x223038, emissive: new THREE.Color(0x00e5ff), emissiveIntensity: 2.2, toneMapped: false });
    return {
      textures: { streak, air },
      galv: galvanizedSteel(),
      dark: darkSteel(),
      yellow: safetyYellowPaint(),
      rubber: rubberBlack(),
      pad: new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 1, metalness: 0 }),
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

/** The wash hall's machines: one gantry in each open bay; the engineering CAD once it has loaded (cadFleet.ts). */
export function WashGantries({ count, cad }: { count: number; cad: DepotCad | null }) {
  const all = useMats();
  const frame = useMemo(() => buildFrame(), []);
  useEffect(() => () => {
    for (const g of frame.values()) g.dispose();
    for (const t of Object.values(all.textures)) t.dispose();
    all.pad.dispose(); all.spray.dispose(); all.air.dispose(); all.beacon.dispose(); all.lampOff.dispose();
  }, [frame, all]);
  // a bay's machine is named by the bay's own id, which is the renderer stall the car parks on (WASH-01 ..)
  const bays = WASH_SHELL.bays.slice(0, count);
  if (cad) return <CadWashGantries cad={cad} bays={bays} shared={all} />;
  return (
    <group name="washGantries">
      {bays.map((b) => <WashGantryBay key={b.id} bayId={b.id} planX={b.x} shared={all} frame={frame} />)}
    </group>
  );
}
