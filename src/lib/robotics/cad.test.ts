// ============================================================================
// cad.test.ts — the built robot CAD (public/cad, cad/build.py) is the twin's robots, part for part.
//
// The CAD is a separate program (Python, CadQuery), so the risk is drift: a CAD that draws a different arm from the
// one the twin moves and measures. This reads the committed GLBs and bills of materials and holds them to the twin's
// own specs:
//   1. Every bill-of-materials line is placed in the GLB exactly as many times as it is counted, under a subsystem the
//      bill names, and the manifest's totals are the bills' totals.
//   2. The joints are the twin's joints: the charge arm's J1..J6 stand where cobotSpec puts them, its tool's face is the
//      TCP, and each joint carries the twin's STOWED angle; the clean arm's nodes are buildCleanArm's, at cleanArmSpec's
//      offsets, with the twin's home pose; the wash machine stands on washSpec's rails and stows at the twin's home.
//   3. Every screw has a tightening torque, and the GLB is in metres with the quantised normals it declares.
//   4. Every joint's limits are in the viewer's units (radians, metres), and every pose the tab offers and every frame
//      of every cycle it plays lies inside them: the twin never asks the CAD machine for a move it cannot make.
//   5. The clash check (cad/clash.py) ran on the committed CAD (its GLB digest), at the stowed pose and every twin pose
//      in cad/spec/poses.json, and found no more clashes or floating parts than cad/clash_baseline.json allows.
// No network: the files are read from disk.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { OTTO_CHARGE_ARM, JOINT_NAMES, METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { STOWED } from '@/lib/ottoChargeArm/cobotIK';
import { CLEAN_ARM } from '@/lib/ottoCleanArm/cleanArmSpec';
import { CLEAN_ARM_NODES } from '@/lib/ottoCleanArm/buildCleanArm';
import { cleanJointsAt, sidesFor } from '@/lib/ottoCleanArm/cleanArmPose';
import { WASH_GANTRY, WASH_HOME_DY } from '@/lib/ottoWash/washSpec';
import { WASH_SHELL } from '@/lib/structurePlan';
import { cleanAngles, cycleScript, posePresets, type Bom, type Manifest, type RobotKey } from './catalog';

const PUB = resolve(__dirname, '../../../public/cad');
const manifest = JSON.parse(readFileSync(`${PUB}/manifest.json`, 'utf8')) as Manifest;
const bomOf = (k: RobotKey) => JSON.parse(readFileSync(`${PUB}/${k}.bom.json`, 'utf8')) as Bom;

interface GNode { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; mesh?: number; extras?: Record<string, unknown> }
interface Gltf {
  nodes: GNode[]; meshes: { name: string; primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min?: number[]; max?: number[] }[]; extensionsUsed?: string[]; scenes: { nodes: number[] }[];
}
function glbOf(k: RobotKey): Gltf {
  const b = readFileSync(`${PUB}/${k}.glb`);
  expect(b.readUInt32LE(0)).toBe(0x46546c67);                 // 'glTF'
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as Gltf;
}
const byName = (g: Gltf, name: string) => g.nodes.find((n) => n.name === name || (n.extras?.joint as { name?: string })?.name === name);
const t = (n: GNode | undefined) => n?.translation ?? [0, 0, 0];
const jointOf = (n: GNode | undefined) => n?.extras?.joint as { name: string; axis: number[]; stowed: number; kind: string } | undefined;

describe.each(['charge_arm', 'clean_arm', 'wash_gantry'] as RobotKey[])('%s: files', (k) => {
  const bom = bomOf(k);
  const g = glbOf(k);
  const entry = manifest.robots.find((r) => r.key === k)!;

  it('is in the manifest, with the bill of materials totals', () => {
    expect(entry).toBeTruthy();
    expect(entry.totals).toEqual(bom.totals);
    expect(entry.subsystems.map((s) => s.id)).toEqual(bom.subsystems.map((s) => s.id));
  });

  it('places every bill-of-materials line exactly as many times as it counts it, under a named subsystem', () => {
    const placed = new Map<string, number>();
    const subs = new Set(bom.subsystems.map((s) => s.id));
    for (const n of g.nodes) {
      const part = n.extras?.part as string | undefined;
      if (!part) continue;
      placed.set(part, (placed.get(part) ?? 0) + 1);
      expect(subs.has(n.extras!.sub as string), `${n.name} in ${String(n.extras!.sub)}`).toBe(true);
      expect(n.mesh).toBeTypeOf('number');
    }
    for (const l of bom.lines) expect(placed.get(l.id), l.id).toBe(l.qty);
    expect([...placed.keys()].sort()).toEqual(bom.lines.map((l) => l.id).sort());
    const real = bom.lines.filter((l) => !l.reference);
    expect(real.reduce((a, l) => a + l.qty, 0)).toBe(bom.totals.parts);
  });

  it('gives every screw a tightening torque, and draws in metres with quantised normals', () => {
    for (const l of bom.lines) {
      if (/^ISO (4762|7380-1|10642|4017)$/.test(l.standard)) expect(l.torqueNm, l.id).toBeGreaterThan(0);
    }
    expect(g.extensionsUsed).toContain('KHR_mesh_quantization');
    // a robot is metres tall, not millimetres: every mesh's extent is under 12 (m)
    for (const m of g.meshes) {
      const a = g.accessors[m.primitives[0].attributes.POSITION];
      for (let i = 0; i < 3; i++) expect(Math.abs((a.max![i] - a.min![i]))).toBeLessThan(12);
    }
  });
});

describe('charge arm: the twin\'s kinematics', () => {
  const g = glbOf('charge_arm');
  const s = OTTO_CHARGE_ARM;
  it('names J1..J6 as the twin does and stows at the twin\'s STOWED pose', () => {
    const names = JOINT_NAMES.map((n) => n.slice(0, 2));
    for (const [i, name] of names.entries()) {
      const j = jointOf(byName(g, name));
      expect(j, name).toBeTruthy();
      expect(j!.stowed).toBeCloseTo(Object.values(STOWED)[i], 4);
    }
    expect(jointOf(byName(g, 'J1'))!.axis).toEqual([0, 1, 0]);
    expect(jointOf(byName(g, 'J2'))!.axis).toEqual([1, 0, 0]);
    expect(jointOf(byName(g, 'J4'))!.axis).toEqual([0, 1, 0]);
  });
  it('stands each joint where cobotSpec puts it (zero pose, metres)', () => {
    expect(t(byName(g, 'J1'))[1]).toBeCloseTo(0, 6);
    expect(t(byName(g, 'J2'))[1]).toBeCloseTo(s.shoulderHeight, 4);
    expect(t(byName(g, 'J3'))[1]).toBeCloseTo(s.upperArm, 4);
    // J4 sits below the wrist centre; J5 is the wrist centre: J4's offset + J5's offset = the forearm
    expect(t(byName(g, 'J4'))[1] + t(byName(g, 'J5'))[1]).toBeCloseTo(s.forearm, 4);
    expect(t(byName(g, 'J6'))[1]).toBeCloseTo(s.wrist, 4);
    for (const n of ['J2', 'J3', 'J5', 'J6']) { expect(t(byName(g, n))[0]).toBeCloseTo(0, 6); expect(t(byName(g, n))[2]).toBeCloseTo(0, 6); }
  });
  it('puts the connector face at the twin\'s TCP: `tool` metres past the J6 flange', () => {
    const nose = g.nodes.find((n) => n.extras?.part === 'CHG-NOS')!;
    const acc = g.accessors[g.meshes[nose.mesh!].primitives[0].attributes.POSITION];
    expect(acc.max![1] + t(nose)[1]).toBeCloseTo(s.tool, 3);
  });
});

describe('clean arm: the twin\'s nodes', () => {
  const g = glbOf('clean_arm');
  it('carries every buildCleanArm node as a joint, at cleanArmSpec\'s offsets', () => {
    for (const n of CLEAN_ARM_NODES) expect(jointOf(byName(g, n)), n).toBeTruthy();
    expect(t(byName(g, 'CA_J1'))).toEqual([CLEAN_ARM.mountX, CLEAN_ARM.link1Y, 0].map((v) => expect.closeTo(v, 4)));
    expect(t(byName(g, 'CA_J2'))[0]).toBeCloseTo(CLEAN_ARM.link1.len, 4);
    expect(t(byName(g, 'CA_J3'))[0]).toBeCloseTo(CLEAN_ARM.link2.len, 4);
    expect(t(byName(g, 'CA_J3'))[1]).toBeCloseTo(-CLEAN_ARM.link2Drop, 4);
    expect(t(byName(g, 'CA_Pitch'))[1]).toBeCloseTo(-CLEAN_ARM.mast.outerBelow - CLEAN_ARM.pivotBelowFoot, 4);
    expect(t(byName(g, 'CA_Nozzle'))[0]).toBeCloseTo(CLEAN_ARM.wand.base, 4);
  });
  it('stows at the twin\'s home pose, through the twin\'s own node mapping', () => {
    const home = cleanAngles(cleanJointsAt('home', 0, sidesFor(1)));
    for (const [name, v] of Object.entries(home)) expect(jointOf(byName(g, name))!.stowed, name).toBeCloseTo(v, 3);
  });
});

describe('wash machine: the twin\'s machine', () => {
  const g = glbOf('wash_gantry');
  const bom = bomOf('wash_gantry');
  it('stows at the north end, the twin\'s home, and drives every tool the twin drives', () => {
    expect(jointOf(byName(g, 'GANTRY'))!.stowed).toBeCloseTo(-WASH_HOME_DY * METRES_PER_PLAN_UNIT, 4);
    for (const n of ['TOP_BRUSH1', 'TOP_BRUSH2', 'TOP_BRUSH3', 'SIDE_BRUSH_L', 'SIDE_BRUSH_R', 'DRYER_TOP1', 'DRYER_TOP2', 'DRYER_TOP3',
      'DRYER_SIDE_L', 'DRYER_SIDE_R',
      'WAND_L_DROP1', 'WAND_L_DROP2', 'WAND_L_DROP3', 'WAND_L_REACH1', 'WAND_L_REACH2',
      'WAND_R_DROP1', 'WAND_R_DROP2', 'WAND_R_DROP3', 'WAND_R_REACH1', 'WAND_R_REACH2']) {
      expect(jointOf(byName(g, n)), n).toBeTruthy();
    }
  });
  it('stows its wand and lift columns under the wash hall roof (structurePlan.WASH_SHELL)', () => {
    const top = Math.max(...g.nodes.filter((n) => ['WSH-WS1', 'WSH-TH0', 'WSH-KH0'].includes(String(n.extras?.part))).map((n) => {
      const acc = g.accessors[g.meshes[n.mesh!].primitives[0].attributes.POSITION];
      return acc.max![1] + t(n)[1];
    }));
    expect(top).toBeLessThan(WASH_SHELL.height * METRES_PER_PLAN_UNIT - 0.3);
  });
  it('stands its rails where washSpec does', () => {
    const rails = g.nodes.filter((n) => n.extras?.part === 'WSH-RAIL').map((n) => t(n)[0]).sort((a, b) => a - b);
    const x = WASH_GANTRY.legX * METRES_PER_PLAN_UNIT;
    expect(rails).toEqual([expect.closeTo(-x, 4), expect.closeTo(x, 4)]);
    expect(bom.lines.find((l) => l.id === 'WSH-RAIL')!.qty).toBe(2);
  });
});

describe.each(['charge_arm', 'clean_arm', 'wash_gantry'] as RobotKey[])('%s: the twin\'s moves fit the CAD\'s joints', (k) => {
  const g = glbOf(k);
  const joints = new Map(g.nodes.map(jointOf).filter((j): j is NonNullable<typeof j> => !!j).map((j) => [j.name, j as typeof j & { limits: [number, number] }]));
  const inside = (where: string, angles: Record<string, number>) => {
    for (const [name, v] of Object.entries(angles)) {
      const j = joints.get(name);
      expect(j, `${where}: ${name} is a joint of the CAD`).toBeTruthy();
      expect(v, `${where}: ${name} = ${v} inside [${j!.limits}]`).toBeGreaterThanOrEqual(j!.limits[0] - 1e-6);
      expect(v, `${where}: ${name} = ${v} inside [${j!.limits}]`).toBeLessThanOrEqual(j!.limits[1] + 1e-6);
    }
  };

  it('keeps every limit in the viewer\'s units: radians for a turn, metres for a slide', () => {
    expect(joints.size).toBeGreaterThan(0);
    for (const j of joints.values()) {
      const [lo, hi] = j.limits;
      expect(hi, j.name).toBeGreaterThan(lo);
      if (j.kind === 'revolute') expect(Math.max(Math.abs(lo), Math.abs(hi)), j.name).toBeLessThanOrEqual(2 * Math.PI + 1e-9);
      else expect(Math.max(Math.abs(lo), Math.abs(hi)), `${j.name} (metres)`).toBeLessThan(10);
      expect(j.stowed, `${j.name} stows inside its limits`).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(j.stowed, `${j.name} stows inside its limits`).toBeLessThanOrEqual(hi + 1e-6);
    }
  });

  it('holds every pose the tab offers inside the limits', () => {
    for (const p of posePresets(k)) inside(`pose ${p.id}`, p.angles);
  });

  it('holds every frame of the cycle the tab plays inside the limits', () => {
    const s = cycleScript(k);
    const n = 600;
    for (let i = 0; i <= n; i++) {
      const at = s.at((i / n) * s.total * 0.999999);
      inside(`cycle ${s.steps[at.step].id} at ${((i / n) * s.total).toFixed(1)} s`, at.angles);
    }
  });
});

const baseline = JSON.parse(readFileSync(resolve(__dirname, '../../../cad/clash_baseline.json'), 'utf8')) as
  Record<RobotKey, { clashes: number; floatingGroups: number }>;
const posesFile = JSON.parse(readFileSync(resolve(__dirname, '../../../cad/spec/poses.json'), 'utf8')) as
  { robots: Record<RobotKey, { id: string }[]> };

describe.each(['charge_arm', 'clean_arm', 'wash_gantry'] as RobotKey[])('%s: clash check', (k) => {
  const rep = JSON.parse(readFileSync(`${PUB}/${k}.clash.json`, 'utf8')) as {
    glbSha256: string; poses: string[]; clashes: unknown[]; floating: unknown[]; counts: Record<string, number>;
  };
  const entry = manifest.robots.find((r) => r.key === k)! as unknown as { glbSha256: string };

  it('ran on the committed CAD, at the stowed pose and at every twin pose', () => {
    expect(createHash('sha256').update(readFileSync(`${PUB}/${k}.glb`)).digest('hex').slice(0, 16)).toBe(entry.glbSha256);
    expect(rep.glbSha256).toBe(entry.glbSha256);
    expect(rep.poses).toEqual(['stowed', ...posesFile.robots[k].map((p) => p.id)]);
  });

  it('finds no more clashes or floating parts than the baseline allows (it only goes down)', () => {
    expect(rep.clashes.length).toBeLessThanOrEqual(baseline[k].clashes);
    expect(rep.floating.length).toBeLessThanOrEqual(baseline[k].floatingGroups);
  });
});

it.each(['wash_gantry', 'clean_arm', 'charge_arm'] as RobotKey[])('%s: no clash and no floating part at any pose', (k) => {
  expect(baseline[k]).toEqual({ clashes: 0, floatingGroups: 0 });
});
