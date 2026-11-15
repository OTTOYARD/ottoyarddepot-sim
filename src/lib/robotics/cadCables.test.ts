// ============================================================================
// cadCables.test.ts — the cable schedule (cad/otto_cad/cables.py), as cad/build.py writes it into each robot's bill of
// materials and its <robot>.cables.csv.
//
// Chase, 2026-11-15: "I know the exact pieces and length of certain cables and exact routing of electrical wire and
// distances of machinery and parts that I will need." The parts list counts a line only in the pieces the CAD draws (a
// DC core read 'D 15 x 1822', its piece in the trench, of a 7.3 m run). These hold:
//   1. Every robot has a schedule, and each line's lengths add up: its route is the sum of its pieces, its order length
//      covers its route, its tolerance and its 2 tails, rounded up to 0.1 m.
//   2. Every piece runs in something the model has: a part in the parts list, or a line the GLB carries.
//   3. Every part that is a piece of a line says so in the parts list, and every line a chain carries is in the schedule.
//   4. No line bends tighter than it may, where it lies still or where it moves.
//   5. The charge arm's DC cores run their whole way: the trench piece the parts list showed is under a third of it.
// No network: the files are read from disk.
// ============================================================================
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { PUBLIC_CAD, depotSceneFromDisk } from '@/test/cadDisk';
import { flexDefs } from './flexLines';
import { ROBOT_KEYS, type Bom, type Manifest, type RobotKey } from './catalog';

const manifest = JSON.parse(readFileSync(`${PUBLIC_CAD}/manifest.json`, 'utf8')) as Manifest;
const bomOf = (k: RobotKey) => JSON.parse(readFileSync(`${PUBLIC_CAD}/${k}.bom.json`, 'utf8')) as Bom;
const flexIds = new Map<RobotKey, Set<string>>();
const contents = new Map<RobotKey, { chain: string; id: string }[]>();
beforeAll(async () => {
  for (const k of ROBOT_KEYS) {
    const defs = flexDefs(await depotSceneFromDisk(k));
    flexIds.set(k, new Set(defs.map((d) => d.id)));
    contents.set(k, defs.flatMap((d) => (d.contents ?? []).map((c) => ({ chain: d.id, id: c.id }))));
  }
});

describe.each(ROBOT_KEYS)('%s: the cable schedule', (k) => {
  const bom = bomOf(k);
  const cables = bom.cables ?? [];
  const ids = new Set(bom.lines.map((l) => l.id));

  it('lists its lines, and each one\'s lengths add up', () => {
    expect(cables.length, 'lines').toBeGreaterThan(10);
    expect(new Set(cables.map((c) => c.id)).size).toBe(cables.length);
    for (const c of cables) {
      expect(c.runs.length, c.id).toBeGreaterThan(0);
      const route = c.runs.reduce((a, r) => a + r.mm, 0), tol = c.runs.reduce((a, r) => a + r.tol, 0);
      expect(Math.abs(route - c.routeMm), `${c.id} route`).toBeLessThan(0.6);
      expect(Math.abs(tol - c.tolMm), `${c.id} tolerance`).toBeLessThan(0.6);
      const need = c.routeMm + c.tolMm + c.tails.a + c.tails.b;
      expect(c.orderMm, `${c.id} order`).toBeGreaterThanOrEqual(need - 0.6);
      expect(c.orderMm - need, `${c.id} rounds up to 0.1 m, no more`).toBeLessThan(100.6);
      expect(c.orderMm % 100, `${c.id} order`).toBe(0);
      expect(c.from.length * c.to.length, `${c.id} ends`).toBeGreaterThan(0);
      for (const r of c.runs) expect(r.mm, `${c.id} ${r.where}`).toBeGreaterThanOrEqual(0);
    }
    const m = manifest.robots.find((r) => r.key === k)!;
    expect(m.cables?.lines).toBe(cables.length);
    expect(m.files.cables && existsSync(`${PUBLIC_CAD}/${m.files.cables}`), 'its CSV').toBeTruthy();
    const csv = readFileSync(`${PUBLIC_CAD}/${m.files.cables!}`, 'utf8').trim().split('\n');
    expect(csv[0]).toMatch(/^id,name,kind/);
  });

  it('runs each piece in something the model has', () => {
    const flex = flexIds.get(k)!;
    for (const c of cables) for (const r of c.runs) {
      if (r.via) expect(ids.has(r.via) || flex.has(r.via), `${c.id}: ${r.via}`).toBe(true);
      if (['drawn', 'conduit', 'chain', 'boot', 'reel', 'loop'].includes(r.kind)) expect(r.via, `${c.id}: ${r.where}`).not.toBe('');
    }
  });

  it('names its line in each part that is a piece of one, and leaves out no line a chain carries', () => {
    for (const c of cables) for (const r of c.runs.filter((x) => x.kind === 'drawn' || x.kind === 'conduit')) {
      const line = bom.lines.find((l) => l.id === r.via);
      if (!line) continue;                        // a line drawn as a flex line: its row is the line's
      expect(line.spec['in the cable schedule'] ?? '', `${r.via} names ${c.id}`).toContain(c.id);
    }
    const listed = new Set(cables.map((c) => c.id));
    for (const x of contents.get(k)!) expect(listed.has(x.id), `${x.chain} carries ${x.id}`).toBe(true);
  });

  it('bends no line tighter than it may', () => {
    for (const c of cables) {
      if (c.bendMm.tightestFixed != null && c.bendMm.fixed > 0) expect(c.bendMm.tightestFixed, `${c.id} still`).toBeGreaterThanOrEqual(c.bendMm.fixed);
      if (c.bendMm.tightestMoving != null && c.bendMm.moving > 0) expect(c.bendMm.tightestMoving, `${c.id} moving`).toBeGreaterThanOrEqual(c.bendMm.moving);
    }
  });
});

describe('OTTO-CHARGE ARM: the charge current\'s whole path', () => {
  const bom = bomOf('charge_arm');
  const cables = bom.cables ?? [];
  it('runs each DC core from the cabinet to the riser\'s terminal box, through both chains and the 3 ducts', () => {
    const cores = cables.filter((c) => /^CHG-LD[PN]\d$/.test(c.id));
    expect(cores.length).toBe(8);
    for (const c of cores) {
      const trench = c.runs.find((r) => r.kind === 'drawn')!;
      expect(trench.via).toBe(c.id);
      expect(c.runs.map((r) => r.via)).toEqual(expect.arrayContaining(['CHG-BCN', 'CHG-BCA', 'CHG-BZN', 'CHG-BZD', 'CHG-RSR', 'CHG-PB0']));
      expect(trench.mm / c.routeMm, `${c.id}: the parts list's piece of it`).toBeLessThan(1 / 3);
      expect(c.to).toMatch(/CHG-PB0/);
    }
  });

  it('carries the current up the arm in 4 booted links of 2 braids and 2 pairs of bars, box to box', () => {
    for (const f of ['CHG-FL1', 'CHG-FL2', 'CHG-FL3', 'CHG-FL4']) {
      for (const p of ['P', 'N']) {
        const b = cables.find((c) => c.id === `${f}${p}`);
        expect(b, `${f}${p}`).toBeTruthy();
        const boot = b!.runs.find((r) => r.kind === 'boot')!;
        expect(boot.via).toBe(f);
        expect(boot.bend!, `${f}: its tightest bend`).toBeGreaterThanOrEqual(80);
      }
    }
    expect(cables.filter((c) => /^CHG-BB[UF][PN]$/.test(c.id)).length).toBe(4);
  });

  it('feeds the 6 joints: the joint supply cable to J1, and a joint cable from each drive to the next', () => {
    const js = cables.find((c) => c.id === 'CHG-LJS')!;
    expect(js.to).toMatch(/J1/);
    for (let k = 1; k <= 5; k++) expect(cables.find((c) => c.id === `CHG-JC${k}`), `CHG-JC${k}`).toBeTruthy();
  });

  it('says what it does not yet route', () => {
    const open = cables.filter((c) => c.open.length > 0).map((c) => c.id);
    // the status light rings' supply, the coolant and air couplings in CHG-PB0, the bars that are not drawn
    expect(open).toEqual(expect.arrayContaining(['CHG-LSF', 'CHG-LCS', 'CHG-BBUP']));
  });
});
