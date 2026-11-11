// ============================================================================
// cadFlex.test.ts — the robots' flexible lines: the charge cable, the clean arm's coil, reel cable and nozzle air
// loop, the wash machine's drag chain, ducts, chains and reel cables (cad/otto_cad/flex.py, flexLines.ts).
//
// A line that crosses a moving joint has no fixed shape: the CAD gives each one its anchors, its length rule and its
// tightest allowed bend, and the shape is solved at each pose. These hold:
//   1. The viewer solves every line as the CAD did, point for point (the GLB carries the CAD's own solutions at the
//      stowed pose and the first twin poses, as `flexCheck`).
//   2. Through each robot's whole duty cycle, as the twin plays it, every line keeps its bend radius and its length
//      limits: the charge cable at every inlet the fleet presents and every corner of the advertised window, the clean
//      arm through both sides of its cleaning cycle, the wash machine through every program.
//   3. The yard's skeletons keep every node a line hangs from, so the yard can draw the lines it is given.
// No network: the models are read from disk.
// ============================================================================
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { depotSceneFromDisk, fullSceneFromDisk } from '@/test/cadDisk';
import { buildDepotCad, poseSkeleton, type DepotCad } from './cadDepot';
import { indexCad, poseCad, stowedAngles } from './cadModel';
import { flexDefs, solveFlex, type FlexDefJson } from './flexLines';
import { makeFlexFleet } from './flexMesh';
import { DEPOT_CAD_OPTIONS } from '@/components/canvas/three/cadFleet';
import { poseFor } from '@/lib/ottoChargeArm/armMotion';
import { OTTO_CHARGE_ARM } from '@/lib/ottoChargeArm/cobotSpec';
import { PHASES, portVariants, target, windowVariants } from '@/lib/ottoChargeArm/armSweeps';
import { carSolidInArmFrame, clearanceToCar } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { cleanJointsAt, sidesFor } from '@/lib/ottoCleanArm/cleanArmPose';
import type { CleanPhase } from '@/lib/ottoCleanArm/cleanArmSpec';
import { cleanAngles, cycleSteps, washAngles, ROBOT_KEYS, type RobotKey } from './catalog';
import type { WashPhase } from '@/lib/ottoWash/washSpec';

interface FlexSample { id: string; angles: Record<string, number>; lines: Record<string, number[][]> }

const cads = new Map<RobotKey, DepotCad>();
beforeAll(async () => {
  for (const k of ROBOT_KEYS) cads.set(k, buildDepotCad(k, await depotSceneFromDisk(k), DEPOT_CAD_OPTIONS[k]));
});

/** Solve every line of a posed skeleton (world matrices current, root at rest). */
function solveAll(cad: DepotCad, skel: ReturnType<DepotCad['skeleton']>) {
  skel.root.updateMatrixWorld(true);
  const m = (n: string) => skel.node(n).matrixWorld;
  return cad.flex.map((d) => ({ d, s: solveFlex(d, m(d.a.node), m(d.b.node), m) }));
}

/** The worst of each line over a set of poses: its tightest bend, its length range, and the poses where it fails. */
function sweepLines(cad: DepotCad, poses: Iterable<{ label: string; angles: Record<string, number> }>) {
  const skel = cad.skeleton();
  const worst = new Map<string, { def: FlexDefJson; minR: number; lmin: number; lmax: number; fails: string[] }>();
  let n = 0;
  for (const p of poses) {
    n++;
    poseSkeleton(skel, p.angles);
    for (const { d, s } of solveAll(cad, skel)) {
      const w = worst.get(d.id) ?? { def: d, minR: Infinity, lmin: Infinity, lmax: -Infinity, fails: [] };
      if (s.minRadius !== undefined) w.minR = Math.min(w.minR, s.minRadius);
      if (s.length !== undefined) { w.lmin = Math.min(w.lmin, s.length); w.lmax = Math.max(w.lmax, s.length); }
      if (!s.ok && w.fails.length < 5) w.fails.push(p.label);
      worst.set(d.id, w);
    }
  }
  return { n, worst };
}

describe.each(ROBOT_KEYS)('%s: the flexible lines', (k) => {
  it('solves every line as the CAD did, point for point', async () => {
    const scene = await fullSceneFromDisk(k);
    const model = indexCad(scene);
    const defs = flexDefs(scene);
    expect(defs.length).toBeGreaterThan(0);
    let samples: FlexSample[] = [];
    scene.traverse((o) => {
      const fc = (o.userData as { flexCheck?: FlexSample[] }).flexCheck;
      if (fc && !samples.length) samples = fc;
    });
    expect(samples.length).toBeGreaterThanOrEqual(2);
    const byName = new Map<string, THREE.Object3D>();
    scene.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
    const m = (n: string) => byName.get(n)!.matrixWorld;
    let worst = 0, compared = 0;
    for (const smp of samples) {
      // flex.py takes a joint the sample does not name at its stowed value, and clamps every joint to its limits
      poseCad(model, { ...stowedAngles(model), ...smp.angles });
      scene.updateMatrixWorld(true);
      for (const d of defs) {
        const s = solveFlex(d, m(d.a.node), m(d.b.node), m);
        const ref = smp.lines[d.id];
        expect(ref, `${d.id} at ${smp.id}`).toBeTruthy();
        expect(s.points.length / 3, `${d.id} at ${smp.id}`).toBe(ref.length);
        ref.forEach((p, i) => {
          worst = Math.max(worst, Math.hypot(s.points[3 * i] - p[0], s.points[3 * i + 1] - p[1], s.points[3 * i + 2] - p[2]));
          compared++;
        });
      }
    }
    expect(compared).toBeGreaterThan(0);
    // the GLB rounds anchors to 1 µm; the two solvers agree to well under a millimetre
    expect(worst, `the viewer's line strays ${(worst * 1000).toFixed(3)} mm from the CAD's`).toBeLessThan(0.0005);
  });

  it('keeps every node a line hangs from in the yard\'s skeleton', () => {
    const cad = cads.get(k)!;
    expect(cad.flex.length).toBeGreaterThan(0);
    const skel = cad.skeleton();
    for (const d of cad.flex) for (const n of [d.a.node, d.b.node]) expect(() => skel.node(n), `${d.id}: ${n}`).not.toThrow();
  });

  it('draws every line into its slot, and clears it', () => {
    const cad = cads.get(k)!;
    const fleet = makeFlexFleet(cad.flex, 2);
    const skel = cad.skeleton();
    // at the stowed pose (rest, every joint at zero, is outside some joints' limits)
    poseSkeleton(skel, Object.fromEntries([...skel.joints].map(([n, j]) => [n, j.info.stowed ?? 0])));
    skel.root.updateMatrixWorld(true);
    expect(fleet.write(1, skel)).toBe(true);
    expect(fleet.write(1, skel)).toBe(false);          // nothing moved: not solved again
    for (const d of cad.flex) expect(fleet.last(1).get(d.id)?.ok, d.id).toBe(true);
    const pos = (fleet.meshes.find((x) => x.mesh instanceof THREE.Mesh && !(x.mesh instanceof THREE.InstancedMesh))?.mesh.geometry
      .getAttribute('position') as THREE.BufferAttribute | undefined);
    if (pos) {
      const half = pos.count / 2;
      let filled = 0;
      for (let i = half; i < pos.count; i++) if (pos.getX(i) !== 0 || pos.getY(i) !== 0 || pos.getZ(i) !== 0) filled++;
      expect(filled).toBeGreaterThan(0);
      fleet.clear(1);
      let left = 0;
      for (let i = half; i < pos.count; i++) if (pos.getX(i) !== 0 || pos.getY(i) !== 0 || pos.getZ(i) !== 0) left++;
      expect(left).toBe(0);
    }
    fleet.dispose();
  });
});

describe('OTTO-CHARGE ARM: the power path\'s flex links through the duty cycle', () => {
  /** every phase of the nominal cycle, 9 steps each (the charge itself once), at a set of ports */
  function* cyclePoses(ports: { label: string; along: number; height: number }[]) {
    for (const v of ports) {
      const t = target(v.along, v.height);
      for (const phase of PHASES) {
        const steps = phase === 'charging' ? 0 : 8;
        for (let i = 0; i <= steps; i++) {
          const u = steps ? i / steps : 0;
          const p = poseFor({ phase, t: u }, t, OTTO_CHARGE_ARM);
          if (!p.ok) continue;
          const a = p.angles;
          yield { label: `${v.label} (${v.along.toFixed(2)}, ${v.height.toFixed(2)}) ${phase}@${u.toFixed(2)}`,
            angles: { J1: a.j1, J2: a.j2, J3: a.j3, J4: a.j4, J5: a.j5, J6: a.j6 } };
        }
      }
    }
  }

  // Chase, 2026-11-11: no exposed cable pulled from a pulley. The current runs in the arm: copper bars in each link and a
  // short booted link of braided copper at each joint (cad/otto_cad/robots/charge_arm.py, POWER PATH).
  const LINKS = ['CHG-FL1', 'CHG-FL2', 'CHG-FL3', 'CHG-FL4', 'CHG-FL5'];

  it('has a booted flex link at each joint, and no take-up wheel or free span', () => {
    const cad = cads.get('charge_arm')!;
    expect(cad.flex.map((f) => f.id).sort()).toEqual(LINKS);
    for (const f of cad.flex) expect(f.length, f.id).toBeLessThanOrEqual(1.0);
  });

  it('bends no flex link tighter than its boot allows, at every inlet and every corner of the window', () => {
    const cad = cads.get('charge_arm')!;
    const { n, worst } = sweepLines(cad, cyclePoses([...portVariants(), ...windowVariants()]));
    expect(n).toBeGreaterThan(5000);
    for (const id of LINKS) {
      const c = worst.get(id);
      expect(c, id).toBeTruthy();
      expect(c!.fails, `${id} fails at ${c!.fails.slice(0, 4).join('; ')} (${c!.fails.length} poses), tightest ${c!.minR.toFixed(4)} m`).toEqual([]);
      expect(c!.minR, id).toBeGreaterThanOrEqual(c!.def.minBend ?? 0);
    }
  });

  it('never lays a flex link on the car: 0.10 m off the bodywork, connector end included, all cycle', () => {
    const cad = cads.get('charge_arm')!;
    const skel = cad.skeleton();
    const car = carSolidInArmFrame();               // the GLB's root is the arm's base frame, in metres
    const v = new THREE.Vector3();
    let worst = Infinity, at = '';
    for (const p of cyclePoses([...portVariants(), ...windowVariants()])) {
      poseSkeleton(skel, p.angles);
      skel.root.updateMatrixWorld(true);
      const m = (n: string) => skel.node(n).matrixWorld;
      for (const d of cad.flex) {
        const s = solveFlex(d, m(d.a.node), m(d.b.node), m);
        for (let k = 0; k < s.points.length / 3; k++) {
          const c = clearanceToCar(v.set(s.points[3 * k], s.points[3 * k + 1], s.points[3 * k + 2]), car) - d.r;
          if (c < worst) { worst = c; at = `${d.id} ${p.label}`; }
        }
      }
    }
    expect(worst, `a flex link comes ${worst.toFixed(4)} m from the car at ${at}`).toBeGreaterThanOrEqual(0.1);
  });
});

describe('OTTO-CLEAN ARM: its lines through both sides of the cleaning cycle', () => {
  it('keeps every line inside its bend radius and its length limits', () => {
    const cad = cads.get('clean_arm')!;
    const phases = cycleSteps('clean_arm').map((s) => s.id as CleanPhase);
    function* poses() {
      for (const dir of [1, -1] as const) {
        const sides = sidesFor(dir);
        for (const ph of phases) for (let i = 0; i <= 40; i++) {
          yield { label: `${ph}@${(i / 40).toFixed(3)} dir ${dir}`, angles: cleanAngles(cleanJointsAt(ph, i / 40, sides)) };
        }
      }
    }
    const { n, worst } = sweepLines(cad, poses());
    expect(n).toBeGreaterThan(400);
    for (const w of worst.values()) expect(w.fails, `${w.def.id} fails at ${w.fails.join('; ')}`).toEqual([]);
  });
});

describe('OTTO-WASH: its lines through every program', () => {
  it('keeps every line inside its bend radius, its length limits and its chain travel', () => {
    const cad = cads.get('wash_gantry')!;
    const phases = cycleSteps('wash_gantry').map((s) => s.id as WashPhase);
    function* poses() {
      for (const ph of phases) for (let i = 0; i <= 40; i++) yield { label: `${ph}@${(i / 40).toFixed(3)}`, angles: washAngles(ph, i / 40) };
    }
    const { n, worst } = sweepLines(cad, poses());
    expect(n).toBeGreaterThan(200);
    for (const w of worst.values()) expect(w.fails, `${w.def.id} fails at ${w.fails.join('; ')}`).toEqual([]);
  });
});
