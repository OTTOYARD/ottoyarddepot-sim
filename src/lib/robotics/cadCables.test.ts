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
//   6. What the schedule left open on 2026-11-15 is routed: the charge arm's copper in its links (drawn), its coolant (one
//      line each way, cabinet to head), its status rings' supply; the wash knives' conduits; the wash arms' pure water.
//   7. The charge arm takes no air (2026-11-16): its head's plunge actuators and float lock are electric.
//   8. The clean arm's supply and network come from its canopy's board (2026-11-16), their runs measured by arm on the
//      site plan (siteCanopy.ts), so no robot's schedule has an open line.
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
      // since 2026-11-15 the drawn piece starts at its output block in the cabinet (finding 22): about a third of the route
      expect(trench.mm / c.routeMm, `${c.id}: the parts list's piece of it`).toBeLessThan(0.4);
      expect(c.to).toMatch(/CHG-PB0/);
    }
  });

  it('carries the current up the arm in 4 booted links of 2 braids, and in each link a drawn pair, box to box', () => {
    for (const f of ['CHG-FL1', 'CHG-FL2', 'CHG-FL3', 'CHG-FL4']) {
      for (const p of ['P', 'N']) {
        const b = cables.find((c) => c.id === `${f}${p}`);
        expect(b, `${f}${p}`).toBeTruthy();
        const boot = b!.runs.find((r) => r.kind === 'boot')!;
        expect(boot.via).toBe(f);
        expect(boot.bend!, `${f}: its tightest bend`).toBeGreaterThanOrEqual(80);
      }
    }
    // 2026-11-15: the upper arm's 2 bars and the forearm's 2 flexible conductors are drawn and in the parts list (they
    // were named by the terminal boxes only), each run 'drawn' in its own part, from one box through the casting to the next
    for (const [id, from, to] of [['CHG-BBUP', 'CHG-PB2', 'CHG-PB3'], ['CHG-BBUN', 'CHG-PB2', 'CHG-PB3'],
      ['CHG-FCFP', 'CHG-PB4', 'CHG-PB5'], ['CHG-FCFN', 'CHG-PB4', 'CHG-PB5']]) {
      const c = cables.find((x) => x.id === id)!;
      expect(c, id).toBeTruthy();
      const drawn = c.runs.find((r) => r.kind === 'drawn')!;
      expect(drawn.via, id).toBe(id);
      expect(bom.lines.some((l) => l.id === id), `${id} in the parts list`).toBe(true);
      expect(c.from).toContain(from);
      expect(c.to).toContain(to);
      expect(c.open, id).toEqual([]);
    }
  });

  it('runs the coolant and the tool cable each as one line from the cabinet to the head', () => {
    // 2026-11-15: the chains carried a 12 x 8 hose and the boots an 8 mm tube, joined by a reducing coupling the model
    // did not have; now each runs through both chains and all 4 boots, unbroken
    for (const id of ['CHG-LCS', 'CHG-LCR', 'CHG-LTL']) {
      const c = cables.find((x) => x.id === id)!;
      const via = c.runs.map((r) => r.via);
      expect(via, id).toEqual(expect.arrayContaining(['CHG-BCN', 'CHG-BZN', 'CHG-FL1', 'CHG-FL2', 'CHG-FL3', 'CHG-FL4', 'CHG-COH']));
      expect(c.to, id).toMatch(/head/);
    }
    expect(cables.find((c) => c.id === 'CHG-LCS')!.od).toBe(8);
    expect(cables.some((c) => /^CHG-L(CS|CR)A$/.test(c.id)), 'no separate line from a coupling').toBe(false);
  });

  it('takes no air: the head is electric (Chase, 2026-11-16)', () => {
    // the head's 2 plunge cylinders and its float lock ran on 6 bar from the cabinet through a 6 x 4 tube; now the 2
    // plunge actuators and the lock are electric and the tool cable powers them, so no air line reaches the arm
    expect(cables.filter((c) => c.kind === 'air').map((c) => c.id)).toEqual([]);
    for (const id of ['CHG-LAR', 'CHG-SAR', 'CHG-CAV', 'CHG-CAS6', 'CHG-CAS12', 'CHG-CST']) {
      expect(cables.some((c) => c.id === id) || bom.lines.some((l) => l.id === id), `${id} is gone`).toBe(false);
    }
    const plunge = bom.lines.find((l) => l.id === 'CHG-HPC')!;
    expect(plunge.qty, 'one actuator a connector').toBe(2);
    expect(String(plunge.spec.drive)).toMatch(/24 V/);
    // it holds its connector against the insertion force, which a CCS1 connector's maker gives as under 100 N
    expect(String(plunge.spec.force)).toMatch(/at least 100 N/);
    expect(String(bom.lines.find((l) => l.id === 'CHG-CMP')!.spec.lock)).toMatch(/24 V/);
    for (const l of bom.lines) expect(`${l.name} ${l.function} ${JSON.stringify(l.spec)}`, l.id).not.toMatch(/pneumatic/i);
    expect(cables.find((c) => c.id === 'CHG-LTL')!.to).toMatch(/plunge actuators/);
    // what still said it carried air after the line went (the wrist link: "the tool's signals and air"; the pad's site
    // shaft: "the network and the air"), and every part the air passed through. The charger's own cooling air is not this.
    for (const id of ['CHG-FL1', 'CHG-FL2', 'CHG-FL3', 'CHG-FL4', 'CHG-BFT', 'CHG-PAD', 'CHG-CMP', 'CHG-CHL']) {
      const l = bom.lines.find((x) => x.id === id);
      expect(l, id).toBeTruthy();
      expect(`${l!.name} ${l!.function} ${JSON.stringify(l!.spec)}`, id).not.toMatch(/\bair\b/i);
    }
  });

  it('lights the status rings from the joints\' drives: a lead and a jumper for J2, a receptacle for the wrist', () => {
    const rl = cables.find((c) => c.id === 'CHG-RL2')!, rj = cables.find((c) => c.id === 'CHG-RJ2')!;
    expect(rl.runs.find((r) => r.kind === 'drawn')!.via).toBe('CHG-RL2');
    expect(rl.to).toMatch(/CHG-J2-RINGL/);
    expect(rj.from).toMatch(/CHG-J2-RINGL/);
    expect(rj.to).toMatch(/CHG-J2-RINGR/);
    expect(bom.lines.some((l) => l.id === 'CHG-RRC6'), 'the wrist ring\'s receptacle').toBe(true);
    expect(cables.find((c) => c.id === 'CHG-LSF')!.to).not.toMatch(/ring/i);
  });

  it('feeds the 6 joints: the joint supply cable to J1, and a joint cable from each drive to the next', () => {
    const js = cables.find((c) => c.id === 'CHG-LJS')!;
    expect(js.to).toMatch(/J1/);
    for (let k = 1; k <= 5; k++) expect(cables.find((c) => c.id === `CHG-JC${k}`), `CHG-JC${k}`).toBeTruthy();
  });

  it('has no open item at all', () => {
    // 2026-11-15: the charger is a whole charger, fed from its transformer, so each site feed's run in the duct bank is
    // measured on the site plan (siteFeeders.ts) and quoted per post. 2026-11-16: the head is electric, so the one open
    // line, the site's air, is gone.
    expect(cables.filter((c) => c.open.length > 0).map((c) => c.id)).toEqual([]);
  });
});

describe('OTTO-CHARGE ARM: the charger drawn, wired and fed (2026-11-15)', () => {
  const bom = bomOf('charge_arm');
  const cables = bom.cables ?? [];
  const has = (id: string) => bom.lines.some((l) => l.id === id);

  it('draws the charger as the whole 350 kW charger it is (Chase, 2026-11-15: "All-in-one posts")', () => {
    expect(has('CHG-CAB'), 'the envelope is gone').toBe(false);
    for (const id of ['CHG-CPL', 'CHG-CBD', 'CHG-CRF', 'CHG-CDL', 'CHG-CDR', 'CHG-CMT', 'CHG-BGP', 'CHG-BGL',
      // the AC input: phase bars, lugs, links, the main breaker, risers, the distribution block
      'CHG-CAT', 'CHG-CLA', 'CHG-CAL', 'CHG-CMC', 'CHG-CAR', 'CHG-CAD',
      // the power: the rack and its modules, and the DC from the rack to the column
      'CHG-RKS', 'CHG-RKP', 'CHG-RKH', 'CHG-CPM', 'CHG-CRT', 'CHG-CDLP', 'CHG-CDLN',
      // the DC column and the output
      'CHG-CBI', 'CHG-CFU', 'CHG-CKM', 'CHG-CBL1', 'CHG-CBL2', 'CHG-CBL3P', 'CHG-CBL3N', 'CHG-CBA', 'CHG-COB', 'CHG-COS1', 'CHG-COS2',
      // the rest
      'CHG-CAX', 'CHG-CCU', 'CHG-CCS', 'CHG-CPE', 'CHG-CIM', 'CHG-CDM', 'CHG-CAC', 'CHG-CSD', 'CHG-CSF', 'CHG-CWR']) {
      expect(has(id), id).toBe(true);
    }
    // the split charger's post had a DC input from a power unit and an auxiliary supply; a whole charger has neither
    for (const id of ['CHG-CLG', 'CHG-SDP1', 'CHG-SAX']) expect(has(id), `${id} is gone`).toBe(false);
    expect(bom.lines.find((l) => l.id === 'CHG-CPM')!.qty, '12 power modules of 30 kW').toBe(12);
    expect(bom.subsystems.some((s) => s.id === 'CABINET')).toBe(true);
  });

  it('ends each supply line at what it serves in the cabinet: no 1.5 m tail left', () => {
    const sup = cables.filter((c) => /^CHG-L/.test(c.id) && c.sub === 'SUPPLY');
    expect(sup.length).toBe(15);
    for (const c of sup) {
      expect(c.tails.a, `${c.id}: its tail in the cabinet`).toBeLessThanOrEqual(100);
      expect(c.tails.basis, c.id).not.toMatch(/envelope/);
    }
    for (const c of sup.filter((x) => /^CHG-LD[PN]\d$/.test(x.id))) expect(c.from, c.id).toMatch(/CHG-COB/);
    expect(cables.find((c) => c.id === 'CHG-LCS')!.from).toMatch(/CHG-CCS/);
    expect(cables.find((c) => c.id === 'CHG-LCR')!.from).toMatch(/CHG-CCS/);
    for (const id of ['CHG-LJS', 'CHG-LTL', 'CHG-LSF', 'CHG-LMX', 'CHG-LMZ']) {
      const c = cables.find((x) => x.id === id)!;
      expect(c.runs[0].kind, `${id}: its run in the cabinet's ducts comes first`).toBe('duct');
      expect(c.runs[0].via, id).toBe('CHG-CWR');
    }
  });

  it('takes the site\'s 480 V feed, its earths and the network fibre up through its 2 gland plates', () => {
    const ac = ['CHG-SL1A', 'CHG-SL1B', 'CHG-SL2A', 'CHG-SL2B', 'CHG-SL3A', 'CHG-SL3B'];
    for (const id of [...ac, 'CHG-SEG', 'CHG-SPE', 'CHG-SNW']) {
      const c = cables.find((x) => x.id === id)!;
      expect(c, id).toBeTruthy();
      expect(c.runs.some((r) => r.kind === 'drawn' && r.via === id), `${id} is drawn`).toBe(true);
      expect(c.runs.some((r) => r.kind === 'site'), `${id}: its run to the charger is the site's`).toBe(true);
      expect(c.sub, id).toBe('CABINET');
    }
    for (const id of ac) {
      const c = cables.find((x) => x.id === id)!;
      expect(c.to, id).toMatch(/CHG-CAT/);
      expect(c.from, id).toMatch(/transformer/);
      expect(c.notes.join(' '), `${id}: its run quoted by post`).toMatch(/m by post/);
    }
    expect(cables.find((c) => c.id === 'CHG-SNW')!.spec).toMatch(/fibre/);
  });
});

describe('OTTO-CLEAN ARM: its supply and network from the canopy\'s board (2026-11-16)', () => {
  const bom = bomOf('clean_arm');
  const cables = bom.cables ?? [];
  it('runs each from the board under the canopy\'s south end, its run there measured by arm, and leaves nothing open', () => {
    for (const id of ['CLN-SPW', 'CLN-SNW']) {
      const c = cables.find((x) => x.id === id)!;
      expect(c.open, id).toEqual([]);
      expect(c.from, id).toMatch(/canopy's (board|network switch).*south end/);
      expect(c.runs.find((r) => r.kind === 'site')?.via, `${id}: along the canopy's tray`).toBe('CLN-CTY');
      expect(c.runs.find((r) => r.kind === 'conduit')?.via, id).toMatch(/^CLN-ECD/);
      expect(c.notes.join(' '), `${id}: its run quoted by arm`).toMatch(/m by arm, .* over the 30 arms/);
    }
    expect(cables.filter((c) => c.open.length > 0).map((c) => c.id)).toEqual([]);
  });
});

describe('every robot\'s cable schedule (2026-11-16)', () => {
  it.each(ROBOT_KEYS)('%s has no open line', (k) => {
    expect((bomOf(k).cables ?? []).filter((c) => c.open.length > 0).map((c) => c.id)).toEqual([]);
  });
});

describe('OTTO-WASH: the lines the schedule left open on 2026-11-15', () => {
  const bom = bomOf('wash_gantry');
  const cables = bom.cables ?? [];
  it('runs each side knife gearmotor\'s cable in its own conduit, down through the beam', () => {
    for (const s of ['L', 'R']) {
      const c = cables.find((x) => x.id === `WSH-SAMC${s}`)!;
      expect(c.runs.find((r) => r.kind === 'conduit')?.via, c.id).toBe(`WSH-ECA${s}`);
      expect(c.runs.some((r) => r.kind === 'site'), `${c.id}: no estimate left`).toBe(false);
      expect(c.open).toEqual([]);
    }
  });

  it('takes each detail arm\'s pure water up the arm, across the wrist and up the bracket to the mist nozzle', () => {
    for (const s of ['L', 'R']) {
      const up = cables.find((x) => x.id === `WSH-DA${s}-H2O`)!;
      expect(up.runs.filter((r) => r.kind === 'arm').length, `${up.id}: J1 to J3 and the links`).toBeGreaterThanOrEqual(6);
      expect(up.to).toMatch(/WSH-BHF/);
      expect(up.open).toEqual([]);
      const loop = cables.find((x) => x.id === `WSH-PW${s}`)!;
      expect(loop.runs.find((r) => r.kind === 'loop')?.via).toBe(`WSH-PWL${s}`);
      expect(loop.bendMm.tightestMoving!, `${loop.id}: its tightest bend over the poses`).toBeGreaterThanOrEqual(loop.bendMm.moving);
      const sup = cables.find((x) => x.id === `WSH-PS${s}`)!;
      expect(sup.runs.find((r) => r.kind === 'drawn')?.via).toBe('WSH-PST');
      expect(sup.to).toMatch(/nozzle/);
    }
  });
});
