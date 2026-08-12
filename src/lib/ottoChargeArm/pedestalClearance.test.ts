/**
 * THE OTHER TEST THAT WAS MISSING: the robot against the thing it is BOLTED TO.
 *
 * armClearance.test.ts closed the hole on one side — nothing had ever compared
 * the arm to the car. The same hole was open on the other side, and it was
 * worse, because there the arm was not nearly touching the obstacle: it was
 * INSIDE it, in every pose, at every stall, on every branch back to main.
 *
 * placeArm() put the J1 axis on the DCFC pedestal's CENTRE. ChargingField.tsx
 * drew that cabinet as a box 1.5 x 3.6 x 0.7 plan units — and its 1.5 ran
 * TOWARD THE CAR, so the cabinet was 0.718 m deep along the arm's own working
 * direction and only 0.335 m wide across it. Posed over the full duty cycle,
 * Mount_Collar, Mount_Bolts, Mount_CableGland, Base_Housing, Shoulder_Yoke and
 * the lower UpperArm all measured -0.1675 m against the drawn boxes. The arm
 * grew out of the middle of the charger.
 *
 * Measuring it changed two things. The mount moved out onto the cabinet's
 * car-facing face, and the cabinet TURNED 90 degrees to present its 1.5-unit
 * frontage to the car rather than its depth — a charger drawn deeper than it is
 * wide was spending the arm's entire working span on nothing. The depth that
 * still costs the arm anything is 0.7 plan units, and this file is what holds
 * both facts in place.
 *
 *     NOTHING THAT MOVES MAY ENTER THE CHARGER, AND THE MOUNT MUST BE ON IT.
 *
 * Two claims, because they pull in opposite directions and a test that made
 * only the first would pass by parking the arm in the next county.
 *
 * ───────────────────────────────────────────────────── HOW IT MEASURES ──────
 * The arm is the DRAWN arm (buildCobot's meshes, posed by the real joint
 * chain). The pedestal is the DRAWN pedestal: pedestalEnvelope.ts converts
 * ChargingField's own box table into the arm's base frame, so the boxes here
 * and the boxes on screen are the same numbers and cannot drift. The clearance
 * is an exact analytic distance from every arm vertex to those boxes.
 *
 * ────────────────────────────────────────────── WHAT IS EXEMPT, AND WHY ─────
 * The PLINTH. It is bolted to the cabinet: its plate lands flat on the face and
 * its cable gland passes through the wall, which is what a cable gland is for.
 * Holding the mount to "never touches the charger" would assert that the arm
 * must not be attached to anything. The exemption is not a hole — the second
 * describe block below measures the plinth against the same boxes and pins
 * every part of it to a stated number, the same way armClearance.test.ts pins
 * the charge-port trim it deliberately leaves outside the car.
 *
 * ─────────────────────────────────────────── TIMEOUT, AND WHY IT IS 300 s ───
 * The full sweep runs in a few seconds standalone. It is given 300 s for the
 * same reason armClearance.test.ts is: inside the whole suite these sweeps
 * compete for workers, and that contention — measured on this repo at a 28%
 * spread across nine runs with no code change between them — is not
 * reproducible to three digits. On a shared CI runner it is worse again. The
 * cap is a guard against a hang, not a performance budget, so it is set well
 * clear of the worst observation rather than near the typical one.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeArmClearanceRig } from './armClearance';
import { buildCobot } from './buildCobot';
import {
  pedestalSolidInArmFrame, clearanceToPedestal, nearestPedestalBox,
} from './pedestalEnvelope';
import {
  OTTO_CHARGE_ARM, MOUNT_HEIGHT_M, SERVICE_WINDOW, ARM_MOUNT_OFFSET_M, ARM_SCALE,
  METRES_PER_PLAN_UNIT, MOUNT_PLATE, MOUNT_COLLAR, PEDESTAL_TO_CAR_CENTRE_M,
  ARM_BASE_TO_CAR_CENTRE_M,
} from './cobotSpec';
import { pedestalBoxes } from '@/components/canvas/three/pedestalGeometry';
import { DECK_Y } from '@/components/canvas/three/coordUtils';
import { poseFor, STANDOFF_M } from './armMotion';
import { NOMINAL_SEQUENCE, type ArmPhase } from './armStateMachine';
import { portFor } from './chargePort';
import { nearFlankZ } from './vehicleEnvelope';
import { placeArm, ARM_MOUNT_OFFSET_PU, PEDESTAL_OFFSET_PU } from './depotPlacement';
import { generateStallsV2 } from '@/lib/sitePlan';

const spec = OTTO_CHARGE_ARM;
const FLANK = nearFlankZ();
const PHASES = NOMINAL_SEQUENCE.filter((p) => p !== 'stowed') as ArmPhase[];

function target(along: number, height: number) {
  return { port: { x: along, y: height - MOUNT_HEIGHT_M, z: FLANK }, normal: { x: 0, y: 0, z: -1 } };
}

/**
 * Ports to sweep: the OEM fleet as chargePort actually resolves it, plus the
 * corners and edge midpoints of the advertised window.
 *
 * Mirrored fore/aft for the same reason armClearance.test.ts mirrors — the two
 * pedestal sides of a canopy present the same port at opposite base-frame x —
 * though the pedestal is very nearly symmetric in x, so this buys less here
 * than it does against the car. It costs nothing and the premise is asserted
 * at the bottom of the file rather than assumed.
 */
function portVariants(): { label: string; along: number; height: number }[] {
  const oems = ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null];
  const out: { label: string; along: number; height: number }[] = [];
  for (const oem of oems) {
    let aLo = Infinity, aHi = -Infinity, hLo = Infinity, hHi = -Infinity;
    for (let i = 0; i < 200; i++) {
      const p = portFor(`probe-${i}`, oem);
      aLo = Math.min(aLo, p.along); aHi = Math.max(aHi, p.along);
      hLo = Math.min(hLo, p.height); hHi = Math.max(hHi, p.height);
    }
    const name = oem ?? 'generic';
    for (const a of [aLo, (aLo + aHi) / 2, aHi]) {
      for (const h of [hLo, (hLo + hHi) / 2, hHi]) {
        out.push({ label: name, along: a, height: h });
        out.push({ label: `${name}/mirrored`, along: -a, height: h });
      }
    }
  }
  const W = SERVICE_WINDOW;
  for (const a of [W.alongMin, 0, W.alongMax]) {
    for (const h of [W.heightMin, (W.heightMin + W.heightMax) / 2, W.heightMax]) {
      out.push({ label: 'service-window', along: a, height: h });
    }
  }
  return out;
}

/** Sweep the duty cycle for one port, returning the worst pedestal clearance. */
function sweep(
  rig: ReturnType<typeof makeArmClearanceRig>,
  ped: ReturnType<typeof pedestalSolidInArmFrame>,
  along: number, height: number,
  which: 'moving' | 'all',
  stepsPerPhase = 8,
): { min: number; part: string; box: string; where: string; refused: boolean } {
  const t = target(along, height);
  let min = Infinity, part = '', box = '', where = '', refused = false;
  const probe = new THREE.Vector3();
  for (const phase of PHASES) {
    const steps = phase === 'charging' ? 0 : stepsPerPhase;
    for (let k = 0; k <= steps; k++) {
      const u = steps === 0 ? 0 : k / steps;
      const p = poseFor({ phase, t: u }, t, spec);
      if (!p.ok) { refused = true; continue; }
      rig.pose(p.angles);
      const c = rig.clearanceTo((v) => clearanceToPedestal(v, ped), which);
      if (c.min < min) {
        min = c.min; part = c.part; where = `${phase} t=${u.toFixed(2)}`;
        // name the box only when the minimum improves — one extra scan per
        // improvement rather than one per vertex
        box = worstBoxFor(rig, ped, c.part, which, probe);
      }
    }
  }
  return { min, part, box, where, refused };
}

/** Which pedestal box the named part comes closest to, in the CURRENT pose. */
function worstBoxFor(
  rig: ReturnType<typeof makeArmClearanceRig>,
  ped: ReturnType<typeof pedestalSolidInArmFrame>,
  partName: string, which: 'moving' | 'all', v: THREE.Vector3,
): string {
  let best = Infinity, box = '';
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry || m.name !== partName) return;
    if (which === 'moving' && isUnderPlinth(m)) return;
    const attr = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < attr.count; i++) {
      v.set(attr.getX(i), attr.getY(i), attr.getZ(i)).applyMatrix4(m.matrixWorld);
      const d = clearanceToPedestal(v, ped);
      if (d < best) { best = d; box = nearestPedestalBox(v, ped); }
    }
  });
  return box;
}

function isUnderPlinth(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n.name === 'Mount_Plinth') return true;
  return false;
}

describe('the pedestal solid the arm is measured against', () => {
  it('is the cabinet the renderer draws, transformed by the two facts that relate the frames', () => {
    const box = pedestalBoxes(true);
    const ped = pedestalSolidInArmFrame();
    const cabinet = ped.boxes.find((b) => b.name === 'cabinet')!;
    const M = METRES_PER_PLAN_UNIT;

    // size[0] is the cabinet's DEPTH toward the car, and it is the only
    // dimension of the charger that costs the arm any span — asserted rather
    // than described, because getting it the other way round is exactly the
    // defect this file exists for
    expect(cabinet.hz).toBeCloseTo((box.cabinet.size[0] / 2) * M, 12);
    expect(cabinet.hz).toBeCloseTo(0.167475, 9);
    // size[2] is its WIDTH along the car — the frontage, which costs nothing
    expect(cabinet.hx).toBeCloseTo((box.cabinet.size[2] / 2) * M, 12);
    expect(cabinet.hx).toBeCloseTo(0.358875, 9);
    // and the frontage is WIDER than the depth. A charger is not a fin.
    expect(cabinet.hx).toBeGreaterThan(cabinet.hz);

    // it sits BEHIND the arm, by exactly the offset placeArm() moved the arm by
    expect(cabinet.cz).toBeCloseTo(-ARM_MOUNT_OFFSET_M, 12);
    expect(ARM_MOUNT_OFFSET_PU * METRES_PER_PLAN_UNIT).toBeCloseTo(ARM_MOUNT_OFFSET_M, 12);

    // and the height maps through the deck datum, not through world zero
    expect(cabinet.cy).toBeCloseTo((box.cabinet.centreY - DECK_Y) * M - MOUNT_HEIGHT_M, 12);
    expect(cabinet.cy - cabinet.hy).toBeCloseTo((0.16 - DECK_Y) * M - MOUNT_HEIGHT_M, 12);

    // every drawn solid part is modelled — a part added to the renderer and not
    // to the table would otherwise be invisible to this whole file
    expect(new Set(ped.boxes.map((b) => b.name)))
      .toEqual(new Set(['pad', 'cabinet', 'led', 'cap']));
  });

  /**
   * THE OFFSET IS THE FIX, SO IT IS DERIVED AND NOT TYPED.
   *
   * Half the cabinet's depth puts the base on the face; half the mount plate's
   * own depth puts the PLATE on the face, which is what "bolted to it" means.
   * Both halves come from the drawings they belong to.
   */
  it('stands the arm off the pedestal by half the cabinet plus half the plate', () => {
    const halfCabinet = (pedestalBoxes(true).cabinet.size[0] / 2) * METRES_PER_PLAN_UNIT;
    expect(ARM_MOUNT_OFFSET_M).toBeCloseTo(halfCabinet + MOUNT_PLATE.depth / 2, 12);
    expect(ARM_MOUNT_OFFSET_M).toBeCloseTo(0.317475, 9);
    // and it comes straight off the car's centreline distance
    expect(ARM_BASE_TO_CAR_CENTRE_M).toBeCloseTo(PEDESTAL_TO_CAR_CENTRE_M - ARM_MOUNT_OFFSET_M, 12);
  });

  it('reports points inside the cabinet as inside, and outside as outside', () => {
    const ped = pedestalSolidInArmFrame();
    // dead inside the cabinet, level with the mount
    expect(clearanceToPedestal({ x: 0, y: 0, z: -ARM_MOUNT_OFFSET_M }, ped))
      .toBeCloseTo(-0.167475, 9);
    // just in front of its face
    expect(clearanceToPedestal({ x: 0, y: 0, z: -0.10 }, ped)).toBeCloseTo(0.05, 9);
    // out where the car is: nothing of the charger there
    expect(clearanceToPedestal({ x: 0, y: 0, z: FLANK }, ped)).toBeGreaterThan(0.7);
    // the power cap OVERHANGS the cabinet, so high and just behind is inside it
    const cap = ped.boxes.find((b) => b.name === 'cap')!;
    expect(clearanceToPedestal({ x: 0, y: cap.cy, z: -0.20 }, ped)).toBeLessThan(0);
  });
});

describe('the OTTO-CHARGE ARM never enters the charger it is mounted on', () => {
  /**
   * THE ONE THAT WOULD HAVE CAUGHT THE ORIGINAL PLACEMENT.
   *
   * Everything that moves, over every port the depot serves, over the whole
   * duty cycle. On the placement this replaces it fails immediately and by a
   * wide margin: Base_Housing alone sits 0.1675 m inside `cabinet` at the
   * stowed pose, before the arm has moved at all.
   */
  it('keeps every MOVING part outside the drawn cabinet, pad, LED and cap', () => {
    const rig = makeArmClearanceRig(spec, 'studio');
    const ped = pedestalSolidInArmFrame();
    let worst = Infinity, detail = '';
    let checked = 0;
    for (const v of portVariants()) {
      const r = sweep(rig, ped, v.along, v.height, 'moving');
      expect(
        r.refused,
        `${v.label} along=${v.along.toFixed(2)} h=${v.height.toFixed(2)}: the arm REFUSED the mate`,
      ).toBe(false);
      if (r.min < worst) {
        worst = r.min;
        detail = `${v.label} along=${v.along.toFixed(2)} h=${v.height.toFixed(2)} ` +
          `${r.where} part=${r.part} box=${r.box}`;
      }
      checked++;
    }
    expect(checked).toBe(135);
    expect(
      worst,
      `arm enters the charger by ${(-worst).toFixed(4)} m at ${detail}` +
      ` — ARM_SCALE=${ARM_SCALE}, MOUNT_HEIGHT_M=${MOUNT_HEIGHT_M},` +
      ` STANDOFF_M=${STANDOFF_M}, ARM_MOUNT_OFFSET_M=${ARM_MOUNT_OFFSET_M.toFixed(6)}`,
    ).toBeGreaterThan(0);
  }, 300_000);

  /**
   * THE POSE THE ARM SPENDS MOST OF ITS LIFE IN, called out separately.
   *
   * Ten arms are stowed almost all of the time, so the stowed pose is what a
   * viewer actually sees, and it is the pose the old placement was most obviously
   * wrong in — the whole base was buried. A sweep that averaged this away would
   * be measuring the wrong thing.
   */
  it('is clear of the charger in the STOWED pose, before any port exists', () => {
    const rig = makeArmClearanceRig(spec, 'studio');
    const ped = pedestalSolidInArmFrame();
    rig.pose(poseFor({ phase: 'stowed', t: 0 }, target(0, 0.8), spec).angles);
    const c = rig.clearanceTo((v) => clearanceToPedestal(v, ped), 'moving');
    expect(c.min, `${c.part} is ${(-c.min).toFixed(4)} m inside the charger when stowed`)
      .toBeGreaterThan(0);
  });
});

describe('the mount is ON the charger, and only the mount is', () => {
  /**
   * THE OTHER HALF OF THE CLAIM.
   *
   * "Nothing enters the charger" is trivially satisfiable by an arm bolted to
   * thin air, so the plinth is measured too — against the same boxes, with the
   * exemption spelled out as numbers rather than as a filter nobody re-reads.
   *
   * The plate is what defines ARM_MOUNT_OFFSET_M, so it lands exactly on the
   * face and reads 0. The collar's bottom rim is wider than the plate it sits
   * on and the cable gland is a fitting that passes THROUGH the wall, so both
   * cross it — by amounts this test states. If a future change makes the mount
   * float off the cabinet, or buries it, this is what says so.
   */
  it('lands the mount plate flat on the cabinet face, and nothing else deeper than the gland', () => {
    const rig = buildCobot(spec, { withPlinth: true, lod: 'studio' });
    const ped = pedestalSolidInArmFrame();
    const scene = new THREE.Scene();
    scene.add(rig.root);
    scene.updateMatrixWorld(true);

    const deepest = new Map<string, number>();
    const v = new THREE.Vector3();
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry || !isUnderPlinth(m)) return;
      const attr = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      let min = Infinity;
      for (let i = 0; i < attr.count; i++) {
        v.set(attr.getX(i), attr.getY(i), attr.getZ(i)).applyMatrix4(m.matrixWorld);
        min = Math.min(min, clearanceToPedestal(v, ped));
      }
      // bolt heads are drawn as eight separate meshes; report the family
      const family = m.name.replace(/_\d+$/, '');
      deepest.set(family, Math.min(deepest.get(family) ?? Infinity, min));
    });

    // THE PLATE IS THE MOUNTING FACE. Flat on the cabinet, to the float error
    // of a round trip through a Float32 position buffer.
    expect(deepest.get('Mount_Plate')!).toBeCloseTo(0, 6);

    // Everything else on the plinth, pinned. These are the ONLY parts of the
    // machine allowed to cross that face, and this is how far each one does.
    //
    //   Mount_Bolts       +20.000 mm  clear of the face, on the plate
    //   Mount_Plate        -0.000 mm  ON the face — it is the mounting surface
    //   Mount_Collar       -5.000 mm  its bottom rim is wider than the plate
    //   Mount_CableGland  -14.367 mm  a fitting THROUGH the wall, as intended
    expect(deepest.get('Mount_Bolts')!).toBeCloseTo(0.020, 6);
    // the collar's bottom rim is MOUNT_COLLAR.rBottom against the plate's
    // 0.150 m half-depth, so it overhangs by exactly the difference
    expect(deepest.get('Mount_Collar')!)
      .toBeCloseTo(-(MOUNT_COLLAR.rBottom - MOUNT_PLATE.depth / 2), 6);
    // the gland is the deepest thing on the machine, and it is the one part
    // whose whole purpose is to be on the far side of the panel
    expect(deepest.get('Mount_CableGland')!).toBeCloseTo(-0.014367, 5);

    // and the crossing stays small against the cabinet it crosses into: the
    // cabinet is 0.335 m deep, so nothing on the mount reaches a tenth of the
    // way through it
    const worst = Math.min(...deepest.values());
    expect(-worst).toBeLessThan((pedestalBoxes(true).cabinet.size[0] * METRES_PER_PLAN_UNIT) / 10);
  });
});

describe('the depot places every arm where this measurement applies', () => {
  it('gives all 10 DCFC arms the same relative geometry, so one sweep covers them', () => {
    // ONE sweep measures ONE arm against ONE pedestal. That generalises only if
    // every arm stands the same distance off its own cabinet and squares up to
    // it. The pedestal boxes are symmetric about their axis in both horizontal
    // directions, so `toward` cancels — but only if the offset went through it.
    const dcfc = generateStallsV2().filter((s) => s.type === 'dcfc');
    expect(dcfc).toHaveLength(10);
    const towards = new Set<number>();
    for (const s of dcfc) {
      const p = placeArm(s.id, s.position.x, s.position.y);
      // the arm stands off its stall by the pedestal offset LESS the mount
      // offset — i.e. it moved TOWARD the car, not away from it
      expect(Math.abs(p.carWorld[0] - p.world[0]))
        .toBeCloseTo(PEDESTAL_OFFSET_PU - ARM_MOUNT_OFFSET_PU, 9);
      expect(Math.abs(p.carWorld[0] - p.world[0])).toBeLessThan(PEDESTAL_OFFSET_PU);
      expect(p.carWorld[2]).toBeCloseTo(p.world[2], 9);
      towards.add(p.toward);
    }
    expect(towards).toEqual(new Set([1, -1]));
  });
});
