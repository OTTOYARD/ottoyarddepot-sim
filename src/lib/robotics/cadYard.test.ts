// ============================================================================
// cadYard.test.ts — THE ROBOTS THE YARD DRAWS ARE THE ENGINEERING CAD, SO THE CAD IS HELD TO EVERYTHING THE
// PROCEDURAL ROBOTS WERE HELD TO.
//
// The depot draws every OTTO-CHARGE ARM, OTTO-CLEAN ARM and OTTO-WASH from its depot model
// (public/cad/<robot>.depot.glb, cadDepot.ts, cadFleet.ts), posed by the twin's own joints. The CAD is bigger
// than the procedural robots in places (its actuators are as long as real ones, the charge arm's forearm jogs
// out along the elbow axis, the clean arm's wand has 3 sliding tubes, the wash machine has drives, a cabinet
// and a drag chain), so the clearance tests that held the procedural robots (armClearance, cabinetClearance,
// cleanArmClearance, washPose) are run here again on the DRAWN CAD geometry, against the same solids and at
// the same poses:
//   - the charge arm: every part but the connector 0.10 m off the car at every inlet and every corner of the
//     service window, all cycle; the connector into the car only through the inlet the car draws; touching
//     it at mate; everything J1 turns clear of the cabinet, the riser and bridge solid, and the fault beacon;
//   - the clean arm: every part outside the wand 0.10 m off the car and the open doors; the wand into the car
//     only through the door, into the cabin's free space, off the seats; parked 2 m above the car; 0.10 m
//     from the charge arm working the same car;
//   - the wash machine: inside every bay of the wash hall; the frame 1.0 u off the car; a brush pressed in no
//     deeper than its bristles give, every other moving part 0.2 u off the car; 0.25 u off an open door; the
//     wands into the car only through an open door; a car driving under the retracted machine clears it.
// Vertices are sampled (the depot model's own), as armClearance samples the procedural arm's. No network: the
// models are read from disk.
// ============================================================================
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { depotSceneFromDisk } from '@/test/cadDisk';
import { armClearanceRig, type ArmClearanceRig } from '@/lib/ottoChargeArm/armClearance';
import {
  STRUCTURAL_MARGIN_M, PHASES, portVariants, windowVariants, sweep, target, dutyCyclePoses, lerpAngles,
} from '@/lib/ottoChargeArm/armSweeps';
import { poseFor } from '@/lib/ottoChargeArm/armMotion';
import { STOWED, type JointAngles } from '@/lib/ottoChargeArm/cobotIK';
import { OTTO_CHARGE_ARM, MOUNT_HEIGHT_M, PEDESTAL_TO_CAR_CENTRE_M, METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import {
  carSolidInArmFrame, clearanceToCar, clearanceToDoor, CABIN_VOID, DOOR, seatBoxes, GLASS_PROUD_M, BODY_BEVEL_M,
  SIDE_PANEL_M, CAR_WIDTH_M,
} from '@/lib/ottoChargeArm/vehicleEnvelope';
import { cabinetSolidInArmFrame, faultBeaconSolidInArmFrame, mountSolidInArmFrame } from '@/lib/ottoChargeArm/cabinetEnvelope';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { portInArmFrame } from '@/lib/ottoChargeArm/depotPlacement';
import type { ArmPhase } from '@/lib/ottoChargeArm/armStateMachine';
import { PORT_RECESS_M } from '@/components/canvas/three/vehicleBody';
import { CLEAN_CHAIN, FLANK_PAINT_Z, type CleanPhase } from '@/lib/ottoCleanArm/cleanArmSpec';
import { cleanJointsAt, sidesFor, doorsAt, type CleanSides } from '@/lib/ottoCleanArm/cleanArmPose';
import { carClearance, cabinRoom, seatClearance } from '@/lib/ottoCleanArm/cleanArmClearance';
import { advanceWashSession, IDLE_WASH, type WashSession } from '@/lib/ottoWash/washSession';
import { washPoseAt, type WashPose } from '@/lib/ottoWash/washPose';
import { WASH_GANTRY as G, WASH_TRAVEL } from '@/lib/ottoWash/washSpec';
import { CAR_HALF_WIDTH_U, CAR_TOP_U } from '@/lib/ottoWash/carShape';
import { WASH_SHELL, PARTITION_T } from '@/lib/structurePlan';
import { cadArmRigSource, partOfMesh, subOf } from './cadClearance';
import { indexCad, poseCad, type CadModel } from './cadModel';
import { cleanAngles, washJoints } from './catalog';

const M = METRES_PER_PLAN_UNIT;

/** A CAD mesh, sampled: its vertices, its part and subsystem, its bounding sphere in its own frame. */
interface Sampled { mesh: THREE.Mesh; part: string; sub: string; verts: Float32Array; c: THREE.Vector3; r: number }

function sampled(root: THREE.Object3D, keep: (m: THREE.Mesh) => boolean = () => true): Sampled[] {
  const out: Sampled[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !keep(m)) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const bs = m.geometry.boundingSphere!;
    out.push({
      mesh: m, part: partOfMesh(m) ?? m.name, sub: subOf(m) ?? '',
      verts: new Float32Array((m.geometry.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>),
      c: bs.center.clone(), r: bs.radius,
    });
  });
  return out;
}

const vs = new THREE.Vector3();
const vw = new THREE.Vector3();
/** World centre (into `out`) and radius of a sampled mesh's bounding sphere, at the scene's current pose. */
function sphere(s: Sampled, out: THREE.Vector3): number {
  const e = s.mesh.matrixWorld.elements;
  out.copy(s.c).applyMatrix4(s.mesh.matrixWorld);
  return s.r * Math.hypot(e[0], e[1], e[2]);
}
/** Visit every vertex of a sampled mesh in world space, at the scene's current pose. */
function eachVertex(s: Sampled, visit: (p: THREE.Vector3) => void): void {
  const mw = s.mesh.matrixWorld;
  const a = s.verts;
  for (let j = 0; j < a.length; j += 3) visit(vw.set(a[j], a[j + 1], a[j + 2]).applyMatrix4(mw));
}
/** Is `node` the ancestor of (or is) `o`? */
const under = (o: THREE.Object3D, node: THREE.Object3D): boolean => {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n === node) return true;
  return false;
};
/** Is `o` carried by a joint whose name matches? */
const onJoint = (o: THREE.Object3D, re: RegExp): boolean => {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const j = (n.userData as { joint?: { name?: string } }).joint;
    if (j?.name && re.test(j.name)) return true;
  }
  return false;
};

// ════════════════════════════════════════════════════════════ OTTO-CHARGE ARM ═══

describe('OTTO-CHARGE ARM, as the yard draws it (its CAD), and the car it charges', () => {
  let rig: ArmClearanceRig;
  beforeAll(async () => { rig = armClearanceRig(cadArmRigSource(await depotSceneFromDisk('charge_arm'))); });

  it('keeps every part but the connector 0.10 m off the car, at every inlet and every corner of the window, all cycle', () => {
    const car = carSolidInArmFrame();
    // nothing past 0.20 m is looked at: the result is exact below that, and "at least 0.20 m" above it
    const stopAt = 2 * STRUCTURAL_MARGIN_M;
    let worst = Infinity, detail = '', checked = 0;
    for (const v of [...portVariants(), ...windowVariants()]) {
      const r = sweep(rig, car, v.along, v.height, 'structure', 8, stopAt);
      expect(r.refused, `${v.label} along=${v.along.toFixed(2)} h=${v.height.toFixed(2)}: the arm refused the mate`).toBe(false);
      if (r.min < worst) { worst = r.min; detail = `${v.label} along=${v.along.toFixed(2)} h=${v.height.toFixed(2)} ${r.where} ${r.part}`; }
      checked++;
    }
    expect(checked).toBe(135);
    // measured 0.3696 m (the J6 output flange, inserting at a Tesla inlet), when this was written
    expect(worst, `the CAD arm comes within ${worst.toFixed(4)} m of the car at ${detail}`).toBeGreaterThan(STRUCTURAL_MARGIN_M);
  }, 300_000);

  it('puts the connector into the car only through the inlet the car draws: inside its recess, never into the panel', () => {
    // The connector's latch hook reaches 14 mm past its face (cad charge_arm.py CHG-LAT: it hooks the inlet's
    // catch), so at full insertion it is 14 mm past the flank. It may be: but only inside the inlet's recess
    // (vehicleBody PORT_RECESS_M, the opening the car draws), never into the bodywork round it.
    const car = carSolidInArmFrame();
    let radial = 0, depth = 0, inside = 0;
    const near: ArmPhase[] = ['align', 'insert', 'latch', 'charging', 'unlatch', 'extract'];
    for (const v of portVariants()) {
      const t = target(v.along, v.height);
      for (const phase of near) {
        const steps = phase === 'charging' ? 0 : 8;
        for (let k = 0; k <= steps; k++) {
          const p = poseFor({ phase, t: steps ? k / steps : 0 }, t, OTTO_CHARGE_ARM);
          rig.pose(p.angles);
          rig.inside(car, 'all', (q, d) => {
            inside++;
            radial = Math.max(radial, Math.hypot(q.x - t.port.x, q.y - t.port.y));
            depth = Math.max(depth, -d);
          });
        }
      }
    }
    expect(inside, 'the latch does reach into the inlet').toBeGreaterThan(0);
    expect(radial, `a vertex inside the car ${radial.toFixed(4)} m from the inlet's axis`).toBeLessThan(PORT_RECESS_M.radius);
    expect(depth, `a vertex ${depth.toFixed(4)} m inside the car`).toBeLessThan(PORT_RECESS_M.depth);
  }, 300_000);

  it('lands the connector on the inlet at full mate, for every inlet the fleet presents', () => {
    const car = carSolidInArmFrame();
    let worst = -Infinity, detail = '';
    for (const v of portVariants()) {
      const p = poseFor({ phase: 'charging', t: 0 }, target(v.along, v.height), OTTO_CHARGE_ARM);
      rig.pose(p.angles);
      const c = rig.clearance(car, 'tool');
      if (c.min > worst) { worst = c.min; detail = `${v.label} along=${v.along.toFixed(2)} ${c.part}`; }
    }
    expect(worst, `the connector stands ${worst.toFixed(4)} m off the inlet at ${detail}`).toBeLessThan(0.02);
  });
});

describe('OTTO-CHARGE ARM, as the yard draws it: its cabinet, riser and the fault beacon', () => {
  let rig: ArmClearanceRig;
  let turned: Sampled[];
  let carried: Sampled[];
  beforeAll(async () => {
    rig = armClearanceRig(cadArmRigSource(await depotSceneFromDisk('charge_arm')));
    const j1 = rig.root.getObjectByName('J1_BaseYaw')!;
    const j2 = rig.root.getObjectByName('J2_Shoulder')!;
    turned = sampled(rig.root, (m) => under(m, j1));
    carried = turned.filter((s) => under(s.mesh, j2));
  });

  /** The worst clearance of some parts from a solid, over the duty-cycle poses and the transit from stowed to each. */
  function worstFrom(parts: Sampled[], solid: ReturnType<typeof cabinetSolidInArmFrame>): { min: number; at: string } {
    let min = Infinity, at = '';
    for (const p of dutyCyclePoses()) {
      for (let i = 0; i <= 12; i++) {
        rig.pose(lerpAngles(STOWED, p.angles, i / 12));
        for (const s of parts) {
          const r = sphere(s, vs);
          if (clearanceToCar(vs, solid) - r >= min) continue;
          eachVertex(s, (q) => {
            const d = clearanceToCar(q, solid);
            if (d < min) { min = d; at = `${s.part} at ${p.label} @${i}/12`; }
          });
        }
      }
    }
    return { min, at };
  }

  it('keeps everything J1 turns 0.15 m off the cabinet (the procedural arm: 0.2169 m)', () => {
    const w = worstFrom(turned, cabinetSolidInArmFrame());
    // measured 0.1818 m (the cable over the turret, stowed), when this was written
    expect(w.min, `${w.min.toFixed(4)} m at ${w.at}`).toBeGreaterThan(0.15);
  });
  it('keeps everything J2 carries 0.05 m off the riser and the cable trunk (the arm\'s own mount, drawn with it)', () => {
    const w = worstFrom(carried, mountSolidInArmFrame());
    expect(w.min, `${w.min.toFixed(4)} m at ${w.at}`).toBeGreaterThan(0.05);
  });
  it('keeps everything J1 turns 0.20 m off the fault beacon', () => {
    const w = worstFrom(turned, faultBeaconSolidInArmFrame());
    expect(w.min, `${w.min.toFixed(4)} m at ${w.at}`).toBeGreaterThan(0.2);
  });
});

// ═════════════════════════════════════════════════════════════ OTTO-CLEAN ARM ═══

/** The clean arm's cycle on both stall columns: each clean step at 1/120, each move at 1/30. */
function* cleanCycle(): Generator<{ phase: CleanPhase; t: number; sides: CleanSides }> {
  for (const sides of [sidesFor(1), sidesFor(-1)]) {
    for (const phase of CLEAN_CHAIN) {
      const n = phase.startsWith('clean') ? 120 : 30;
      for (let i = 0; i <= n; i++) yield { phase, t: i / n, sides };
    }
  }
}
/**
 * The wand and what it carries may enter the car (through the door): its tubes and the nozzle (WAND, NOZZLE), and
 * what rides its last tube, the knuckle, the nozzle's gearmotor and the light ring at its tip. Nothing else may.
 */
const WAND_SUBS = new Set(['WAND', 'NOZZLE']);
const mayEnter = (s: Sampled): boolean => WAND_SUBS.has(s.sub) || onJoint(s.mesh, /^CA_(Wand\d|Nozzle)$/);

describe('OTTO-CLEAN ARM, as the yard draws it (its CAD), and the car it cleans', () => {
  let model: CadModel;
  let parts: Sampled[];
  beforeAll(async () => {
    const scene = await depotSceneFromDisk('clean_arm');
    model = indexCad(scene);
    // the canopy steel is drawn by the canopy (cadFleet CLEAN_CANOPY_STEEL), not with the arm: it is not measured here
    parts = sampled(scene, (m) => !['CLN-HDR', 'CLN-COL', 'CLN-CLP'].includes(partOfMesh(m) ?? ''));
  });
  const poseAt = (phase: CleanPhase, t: number, sides: CleanSides) => {
    poseCad(model, cleanAngles(cleanJointsAt(phase, t, sides)));
    model.root.updateMatrixWorld(true);
  };

  it('keeps every part outside the wand 0.10 m off the car and off both open doors, all cycle, both columns', () => {
    let car = Infinity, door = Infinity, at = '';
    for (const { phase, t, sides } of cleanCycle()) {
      poseAt(phase, t, sides);
      const open = doorsAt(phase, t);
      for (const s of parts) {
        if (mayEnter(s)) continue;
        const r = sphere(s, vs);
        if (carClearance(vs) - r < car) {
          eachVertex(s, (q) => { const d = carClearance(q); if (d < car) { car = d; at = `${s.part} ${phase}@${t.toFixed(2)}`; } });
        }
        if (open > 0) {
          const dl = Math.min(clearanceToDoor(vs, 1, open), clearanceToDoor(vs, -1, open)) - r;
          if (dl < door) eachVertex(s, (q) => { door = Math.min(door, clearanceToDoor(q, 1, open), clearanceToDoor(q, -1, open)); });
        }
      }
    }
    expect(car, `a part comes ${car.toFixed(4)} m from the car (${at})`).toBeGreaterThanOrEqual(0.1);
    expect(door, `a part comes ${door.toFixed(4)} m from an open door`).toBeGreaterThanOrEqual(0.1);
  }, 120_000);

  it('puts the wand into the car only through the door, into the cabin\'s free space, off the seats', () => {
    const outer = FLANK_PAINT_Z + GLASS_PROUD_M, inner = FLANK_PAINT_Z - SIDE_PANEL_M;
    const m = 0.03;
    let outCar = Infinity, aperture = Infinity, room = Infinity, seat = Infinity, door = Infinity, crossings = 0, at = '';
    for (const { phase, t, sides } of cleanCycle()) {
      poseAt(phase, t, sides);
      const open = doorsAt(phase, t);
      for (const s of parts) {
        if (!mayEnter(s)) continue;
        eachVertex(s, (q) => {
          const az = Math.abs(q.z);
          const cc = carClearance(q);
          if (open > 0) door = Math.min(door, clearanceToDoor(q, 1, open), clearanceToDoor(q, -1, open));
          if (az >= FLANK_PAINT_Z + 0.1) { outCar = Math.min(outCar, cc); return; }
          if (cc >= m) return;                                     // clear of the body: nothing to hold it to
          if (az > inner - 1e-9) {                                 // in the body side: through the door's opening
            crossings++;
            const y0 = az >= FLANK_PAINT_Z ? DOOR.sill : DOOR.sill + BODY_BEVEL_M;
            const y1 = az >= FLANK_PAINT_Z ? DOOR.top : DOOR.top - BODY_BEVEL_M;
            const a = Math.min(q.x - DOOR.alongMin, DOOR.alongMax - q.x, q.y - y0, y1 - q.y);
            if (a < aperture) { aperture = a; at = `${s.part} ${phase}@${t.toFixed(2)}`; }
            if (az < outer) return;
          }
          if (az < CAR_WIDTH_M / 2 - 0.08) {                       // in the cabin
            room = Math.min(room, cabinRoom(q));
            seat = Math.min(seat, seatClearance(q));
          }
        });
      }
    }
    expect(crossings, 'the wand does go through the door').toBeGreaterThan(100);
    expect(aperture, `the wand comes ${aperture.toFixed(4)} m from the door opening's edge (${at})`).toBeGreaterThanOrEqual(m);
    expect(room, `the wand stands ${room.toFixed(4)} m inside the cabin's free space`).toBeGreaterThanOrEqual(0);
    expect(seat, `the wand comes ${seat.toFixed(4)} m from a seat`).toBeGreaterThanOrEqual(0.01);
    expect(outCar, `outside the door the wand comes ${outCar.toFixed(4)} m from the car`).toBeGreaterThanOrEqual(m);
    expect(door, `the wand comes ${door.toFixed(4)} m from an open door`).toBeGreaterThanOrEqual(m);
  }, 120_000);

  it('parks above every car: at home and swinging, nothing comes below 2 m over the car', () => {
    let low = Infinity;
    for (const { phase, t, sides } of cleanCycle()) {
      if (!['home', 'doors_open', 'swing_a', 'swing_b', 'return', 'doors_close'].includes(phase)) continue;
      poseAt(phase, t, sides);
      for (const s of parts) eachVertex(s, (q) => { if (Math.abs(q.z) < CAR_WIDTH_M / 2 + 0.3) low = Math.min(low, q.y); });
    }
    expect(low, `${low.toFixed(3)} m above grade`).toBeGreaterThan(2.0);
  }, 60_000);
});

describe('OTTO-CLEAN ARM and OTTO-CHARGE ARM, both as the yard draws them, at one car', () => {
  /**
   * The two robots work the same car: the charge arm at its inlet, the clean arm through the doors. The twin
   * keeps them in turn (cleanGate.mayEnter and blocksMate): the clean arm goes out over the car only while the
   * charge arm is stowed or latched in its inlet, and the charge arm moves only while the clean arm is home. So
   * the pairs measured here are the pairs that can happen: every pose of the clean arm's cycle against the
   * charge arm stowed and latched at the corner inlets of every family, and the clean arm at home against the
   * charge arm's whole duty cycle at those inlets, on both stall columns. The distance is triangle to triangle
   * (three-mesh-bvh), with part spheres to cull the far pairs.
   */
  it('keeps the two robots 0.10 m apart in every pose the twin lets them share', async () => {
    const { MeshBVH } = await import('three-mesh-bvh');
    const cleanScene = await depotSceneFromDisk('clean_arm');
    const clean = indexCad(cleanScene);
    const cleanParts = sampled(cleanScene, (m) => !['CLN-HDR', 'CLN-COL', 'CLN-CLP'].includes(partOfMesh(m) ?? ''));
    const chargeScene = await depotSceneFromDisk('charge_arm');
    const holder = new THREE.Group();
    const src = cadArmRigSource(chargeScene);
    holder.add(chargeScene);
    const charge = armClearanceRig({ ...src, root: holder });
    const j1 = chargeScene.getObjectByName('J1_BaseYaw')!;
    const chargeParts = sampled(chargeScene, (m) => under(m, j1));
    const bvh = new Map<string, InstanceType<typeof MeshBVH>>();
    for (const s of chargeParts) if (!bvh.has(s.mesh.geometry.uuid)) bvh.set(s.mesh.geometry.uuid, new MeshBVH(s.mesh.geometry));

    const ports: { along: number; height: number }[] = [];
    for (const oem of ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null]) {
      let aLo = Infinity, aHi = -Infinity, hLo = Infinity, hHi = -Infinity;
      for (let i = 0; i < 200; i++) {
        const p = portFor(`probe-${i}`, oem);
        aLo = Math.min(aLo, p.along); aHi = Math.max(aHi, p.along); hLo = Math.min(hLo, p.height); hHi = Math.max(hHi, p.height);
      }
      for (const along of [aLo, aHi]) for (const height of [hLo, hHi]) ports.push({ along, height });
    }
    const duty: ArmPhase[] = ['unstow', 'approach', 'align', 'insert', 'latch', 'charging', 'unlatch', 'extract', 'retract'];
    const bar = 0.1;
    const exactBelow = 0.3;                       // pairs whose spheres stand further apart than this are not measured
    let worst = Infinity, at = '';
    const cs = new THREE.Vector3();
    const toBvh = new THREE.Matrix4();
    const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    const hit2 = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    /** A part's world box at the current pose (the box round its own box, turned and placed). */
    const worldBox = (m: THREE.Mesh, out: THREE.Box3) => {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      return out.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
    };
    const bc = new THREE.Box3();
    const chS = chargeParts.map((e) => ({ e, c: new THREE.Vector3(), r: 0, box: new THREE.Box3() }));
    /** The two robots as they stand now: their closest parts, triangle to triangle. */
    const measure = (label: string) => {
      for (const x of chS) { x.r = sphere(x.e, x.c); worldBox(x.e.mesh, x.box); }
      for (const s of cleanParts) {
        const r = sphere(s, cs);
        worldBox(s.mesh, bc);
        for (const { e, c, r: rc, box } of chS) {
          // two lower bounds: the spheres', and the world boxes' (tighter for a long part)
          const lower = Math.max(cs.distanceTo(c) - r - rc, Math.hypot(
            Math.max(0, bc.min.x - box.max.x, box.min.x - bc.max.x),
            Math.max(0, bc.min.y - box.max.y, box.min.y - bc.max.y),
            Math.max(0, bc.min.z - box.max.z, box.min.z - bc.max.z)));
          if (lower >= Math.min(worst, exactBelow)) continue;
          // the clean part's triangles in the charge part's frame (the query's own threshold does not prune in this
          // version, so the result is compared here)
          toBvh.copy(e.mesh.matrixWorld).invert().multiply(s.mesh.matrixWorld);
          const got = bvh.get(e.mesh.geometry.uuid)!.closestPointToGeometry(s.mesh.geometry, toBvh, hit, hit2, 0, Math.min(worst, exactBelow));
          // the distance is in the charge part's frame: the CAD is unscaled, so it is metres
          if (got && got.distance < worst) { worst = got.distance; at = `${s.part} vs ${e.part}, ${label}`; }
        }
      }
    };
    for (const toward of [1, -1] as const) {
      // the charge arm's base in the car frame: on its pedestal at the port flank, its +Z at the car
      holder.position.set(0, MOUNT_HEIGHT_M, toward * PEDESTAL_TO_CAR_CENTRE_M);
      holder.rotation.set(0, toward > 0 ? Math.PI : 0, 0);
      const sides = sidesFor(toward);
      const targets = ports.map((port) => ({ port: portInArmFrame(port.along, port.height, CAR_WIDTH_M / 2, toward), normal: { x: 0, y: 0, z: -1 } }));
      // (A) the clean arm out over the car, the charge arm stowed or latched
      const still: { label: string; a: JointAngles }[] = [{ label: 'stowed', a: STOWED }];
      targets.forEach((tgt, i) => still.push({ label: `latched at inlet ${i}`, a: poseFor({ phase: 'charging', t: 0 }, tgt, OTTO_CHARGE_ARM).angles }));
      for (const c of still) {
        charge.pose(c.a);
        for (const phase of CLEAN_CHAIN) {
          if (phase === 'home') continue;
          const n = phase.startsWith('clean') ? 24 : 6;
          for (let i = 0; i <= n; i++) {
            poseCad(clean, cleanAngles(cleanJointsAt(phase, i / n, sides)));
            clean.root.updateMatrixWorld(true);
            measure(`clean ${phase}@${(i / n).toFixed(2)}, charge ${c.label}, toward ${toward}`);
          }
        }
      }
      // (B) the clean arm home, the charge arm through its duty cycle
      poseCad(clean, cleanAngles(cleanJointsAt('home', 0, sides)));
      clean.root.updateMatrixWorld(true);
      targets.forEach((tgt, k) => {
        for (const phase of duty) {
          for (let i = 0; i <= 6; i++) {
            charge.pose(poseFor({ phase, t: i / 6 }, tgt, OTTO_CHARGE_ARM).angles);
            measure(`clean home, charge ${phase}@${(i / 6).toFixed(2)} at inlet ${k}, toward ${toward}`);
          }
        }
      });
    }
    // the procedural pair kept 0.148 m over every combination (held at 0.10 m). Below exactBelow the worst is exact;
    // above it the test knows only that the robots stand at least that far apart.
    expect(Math.min(worst, exactBelow), `${worst.toFixed(4)} m: ${at}`).toBeGreaterThanOrEqual(bar);
  }, 600_000);
});

// ═══════════════════════════════════════════════════════════════════ OTTO-WASH ═══

/** The machine's poses: both programs and four early ends, stepped a frame at a time and kept every 2 sim seconds. */
function washPoses(interior: boolean, seat: number, endAt?: number, keep = 2): WashPose[] {
  const out: WashPose[] = [];
  let s: WashSession = IDLE_WASH;
  let next = 0;
  for (let t = 0; t < seat + 60; t += 0.1) {
    const on = endAt === undefined ? t < seat : t < endAt;
    s = advanceWashSession(s, { dt: 0.1, vehicleId: 'car', active: on, interior, endsInS: on ? seat - t : null });
    if (t >= next) { out.push(washPoseAt(s)); next = t + keep; }
  }
  return out;
}
const WASH_ALL: WashPose[] = [
  ...washPoses(false, 390, undefined, 1), ...washPoses(true, 1050),
  ...washPoses(false, 390, 120), ...washPoses(true, 1050, 300), ...washPoses(true, 1050, 8), ...washPoses(true, 1050, 990),
  // ended early through the detail arms' work, every 11 s of it (so at every zone, and at the wrist's turn-over)
  ...Array.from({ length: 14 }, (_, k) => washPoses(false, 390, 222 + 11 * k, 1).filter((_p, i) => i >= 220 + 11 * k)).flat(),
];

/** The CAD's bay frame (metres: +X west, +Y up, +Z north) to the car frame (metres: +X forward, which is north). */
const carOf = (q: THREE.Vector3, out: THREE.Vector3) => out.set(q.z, q.y, -q.x);
const CAR = carSolidInArmFrame(0, 0);

describe('OTTO-WASH, as the yard draws it (its CAD): the bay and the car', () => {
  let model: CadModel;
  let parts: Sampled[];
  beforeAll(async () => {
    const scene = await depotSceneFromDisk('wash_gantry');
    model = indexCad(scene);
    parts = sampled(scene);
  });
  const poseAt = (p: WashPose) => { poseCad(model, washJoints(p)); model.root.updateMatrixWorld(true); };
  // the pad is the only part made to touch the car; the head behind it (on the arm's last joint) comes near; the
  // arm's links and every other tool stay off
  const kind = (s: Sampled): 'frame' | 'pad' | 'head' | 'arm' | 'tool' => {
    if (s.part === 'WSH-PAD') return 'pad';
    // the head: what turns with the pad, and the camera and mist nozzle that look at the pad's work from the wrist
    if (onJoint(s.mesh, /^DARM_[LR]_J6$/) || s.sub === 'POLISH') return 'head';
    if (onJoint(s.mesh, /^DARM_[LR]_J[1-5]$/)) return 'arm';
    return ['RAILS', 'TRAVEL', 'PORTAL', 'ARCH', 'CONTROL', 'TRACK', 'DOCK'].includes(s.sub) ? 'frame' : 'tool';
  };
  const cq = new THREE.Vector3();

  it('stands inside every bay of the wash hall: 30 mm or more from every wall and partition, at every pose', () => {
    // each bay's free half-width: to the outer wall's inner face, or to a partition's face
    const last = WASH_SHELL.bays.length - 1;
    let half = Infinity;
    WASH_SHELL.bays.forEach((b, i) => {
      const left = b.x - b.x0 - (i === 0 ? 0 : PARTITION_T / 2);
      const right = b.x1 - b.x - (i === last ? 0 : PARTITION_T / 2);
      half = Math.min(half, left, right);
    });
    let wide = 0, part = '';
    for (const p of WASH_ALL) {
      poseAt(p);
      for (const s of parts) eachVertex(s, (q) => { if (Math.abs(q.x) > wide) { wide = Math.abs(q.x); part = s.part; } });
    }
    // the end bays' outer walls are 7.4 u (3.541 m) from the drive line; the machine's widest part, its trolleys'
    // outer walls, 3.493 m (cad wash_gantry.py: nothing stands outboard of them, design finding 8)
    expect(half * M - wide, `${part} stands ${(half * M - wide).toFixed(4)} m from a wall`).toBeGreaterThanOrEqual(0.03);
  }, 120_000);

  it('never touches the car with the frame: rails, trolleys, legs, beam, arch, cabinet, 1.0 u off', () => {
    let worst = Infinity, at = '';
    for (const p of WASH_ALL) {
      poseAt(p);
      for (const s of parts) {
        if (kind(s) !== 'frame') continue;
        const r = sphere(s, vs);
        if (clearanceToCar(carOf(vs, cq), CAR) - r >= Math.min(worst, 2 * M)) continue;
        eachVertex(s, (q) => { const d = clearanceToCar(carOf(q, cq), CAR); if (d < worst) { worst = d; at = s.part; } });
      }
    }
    expect(worst / M, `${at} comes ${(worst / M).toFixed(3)} u from the car`).toBeGreaterThan(1.0);
  }, 120_000);

  it('touches the car with the soft pads only, no deeper than a pad gives, and keeps every rigid part off it', () => {
    const worst = { pad: Infinity, head: Infinity, arm: Infinity, tool: Infinity };
    const at = { pad: '', head: '', arm: '', tool: '' };
    for (const p of WASH_ALL) {
      poseAt(p);
      for (const s of parts) {
        const k = kind(s);
        if (k === 'frame') continue;
        const r = sphere(s, vs);
        if (clearanceToCar(carOf(vs, cq), CAR) - r >= Math.min(worst[k], 1.0)) continue;
        eachVertex(s, (q) => {
          const d = clearanceToCar(carOf(q, cq), CAR);
          if (d < worst[k]) { worst[k] = d; at[k] = `${s.part} (${p.station ?? 'no zone'}: ${p.arms.map((a) => a.sensor ?? '-').join(' ')})`; }
        });
      }
    }
    if (process.env.CAD_REPORT) console.log('wash clearances, m', JSON.stringify(worst), JSON.stringify(at));
    // the pad's face is on the car: its foam gives, and on the roof lidar's dome its flat face meets a round one
    expect(worst.pad).toBeGreaterThanOrEqual(-0.015);
    expect(worst.pad, 'the pads do reach the car').toBeLessThan(0.005);
    // the head behind the pad (its backing plate, floating joint, force sensor, camera, mist nozzle) stays off the car
    // by the pad's own thickness, 62 mm, or more
    expect(worst.head, `${at.head} comes ${worst.head.toFixed(3)} m from the car`).toBeGreaterThan(0.055);
    // every link and joint of the arm keeps 0.08 m, and every other moving part (the carriages, the air knives) 0.1 m
    expect(worst.arm, `${at.arm} comes ${worst.arm.toFixed(3)} m from the car`).toBeGreaterThan(0.08);
    expect(worst.tool, `${at.tool} comes ${worst.tool.toFixed(3)} m from the car`).toBeGreaterThan(0.1);
  }, 600_000);

  it('has no part that goes into the car, and two whole six-axis arms: no door opens in a wash bay', () => {
    expect([...model.joints.keys()].filter((k) => /BRUSH|WAND|WIPE/.test(k))).toEqual([]);
    expect([...model.joints.keys()].filter((k) => k.startsWith('DARM_')).sort()).toEqual([
      'DARM_L_J1', 'DARM_L_J2', 'DARM_L_J3', 'DARM_L_J4', 'DARM_L_J5', 'DARM_L_J6', 'DARM_L_RAIL',
      'DARM_R_J1', 'DARM_R_J2', 'DARM_R_J3', 'DARM_R_J4', 'DARM_R_J5', 'DARM_R_J6', 'DARM_R_RAIL',
    ]);
  });

  it('clears a car driving through the bay: under the stowed gantry wherever it stands, and between the docked arms', () => {
    const home = washPoseAt({ phase: 'home', t: 1, from: null });
    let worst = Infinity, at = '';
    for (const dy of [WASH_TRAVEL.north, -5, -2.5, 0, 2.5, 5, WASH_TRAVEL.south, WASH_TRAVEL.home]) {
      poseAt({ ...home, dy });
      for (const s of parts) {
        eachVertex(s, (q) => {
          const out = Math.max(Math.abs(q.x) / M - CAR_HALF_WIDTH_U, q.y / M - CAR_TOP_U);
          if (out < worst) { worst = out; at = s.part; }
        });
      }
    }
    expect(worst, `${at} stands ${worst.toFixed(3)} u from the car's swept box`).toBeGreaterThan(1.0);
  });
});

// ─── the phases the procedural tests sweep are the phases swept here ───
describe('the poses are the twin\'s', () => {
  it('sweeps the charge arm\'s whole nominal cycle', () => {
    expect(PHASES).toContain('insert');
    expect(PHASES).toContain('retract');
  });
});
