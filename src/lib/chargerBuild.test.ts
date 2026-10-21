/**
 * The build-outs, as the renderer will draw them once otto-q-core applies them:
 *   dcfc20 (0759)          canopy B re-striped exactly as canopy A (DCFC-11..20), canopy C's
 *                          15 standard chargers as they are (L2-16..30);
 *   dcfc30 (0759 + 0763)   canopy C re-striped too (DCFC-21..30), and no standard charger.
 * The as-built layout must not move by a hair, and each new one must hold every rule the
 * as-built one is held to: no car on a car, no structure in a stall, columns clear of every
 * cabinet and car, and an OTTO-CLEAN ARM that hangs from steel it can reach.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CHARGER_BUILDS, chargerBuild, chargerBuildFor, chargerBuildVersion, setChargerBuild, canopyIsFast } from './chargerBuild';
import { CANOPIES, generateStallsV2, canopyKind, DCFC_ROW_PITCH, L2_ROW_PITCH, L2_WEST_Y0 } from './sitePlan';
import {
  allStructureSolids, boxesOverlap, boxGap, boxOf, cabinetFootprints, canopyColumnYs, parkedBox,
  CANOPY_COLUMN, CANOPY_MAX_SPAN,
} from './structurePlan';
import { placeCleanArm, fixtureHitsMount, HEADER_WIDTH_U } from './ottoCleanArm/cleanArmPlacement';
import { DECK_Y } from '@/components/canvas/three/coordUtils';

afterEach(() => { setChargerBuild('as_built'); });

const key = (s: { id: string; type: string; position: { x: number; y: number; angle: number } }) =>
  `${s.id}|${s.type}|${s.position.x}|${s.position.y}|${s.position.angle}`;

describe('the charger builds', () => {
  it('reads a twin census as one build or neither', () => {
    expect(chargerBuildFor({ dcfc: 10, l2: 30 })).toBe('as_built');
    expect(chargerBuildFor({ dcfc: 20, l2: 15 })).toBe('dcfc20');
    expect(chargerBuildFor({ dcfc: 30, l2: 0 })).toBe('dcfc30');
    expect(chargerBuildFor({ dcfc: 1, l2: 0 })).toBeNull();
    expect(chargerBuildFor({ dcfc: 40, l2: 0 })).toBeNull();
    // a half-converted canopy C is no build: the renderer must not draw a guess
    expect(chargerBuildFor({ dcfc: 25, l2: 7 })).toBeNull();
  });

  it('bumps the version on a change, and only then', () => {
    const v = chargerBuildVersion();
    expect(setChargerBuild('as_built')).toBe(false);
    expect(chargerBuildVersion()).toBe(v);
    expect(setChargerBuild('dcfc20')).toBe(true);
    expect(chargerBuild()).toBe('dcfc20');
    expect(chargerBuildVersion()).toBe(v + 1);
  });

  it('draws the as-built layout exactly as before: the defaults are the old explicit counts', () => {
    // the explicit call is the old default; the build's default must produce it, stall for stall
    expect(generateStallsV2().map(key)).toEqual(generateStallsV2(10, 30, 3, 113, 2).map(key));
    const ch = generateStallsV2().filter((s) => s.type === 'dcfc' || s.type === 'l2');
    expect(ch.filter((s) => s.type === 'dcfc').map((s) => s.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `DCFC-${String(i + 1).padStart(2, '0')}`));
    expect(ch.filter((s) => s.type === 'l2').map((s) => s.id)).toEqual(
      Array.from({ length: 30 }, (_, i) => `L2-${String(i + 1).padStart(2, '0')}`));
    // canopy A fast, B and C standard
    expect(CANOPIES.map(canopyKind)).toEqual(['dcfc', 'l2', 'l2']);
    expect([0, 1, 2].map(canopyIsFast)).toEqual([true, false, false]);
  });
});

describe('the 20-post build: canopy B as canopy A', () => {
  const stallsOf = () => { setChargerBuild('dcfc20'); return generateStallsV2(); };

  it('stands DCFC-11..20 on canopy B at canopy A’s rows and angles, and keeps canopy C’s L2-16..30 where they are', () => {
    const s = stallsOf();
    const asBuilt = generateStallsV2(10, 30, 3, 113, 2);
    const B = CANOPIES[1];
    const dc = s.filter((x) => x.type === 'dcfc');
    expect(dc.length).toBe(CHARGER_BUILDS.dcfc20.dcfc);
    for (let i = 0; i < 5; i++) {
      const w = dc.find((x) => x.id === `DCFC-${String(11 + i)}`)!;
      expect([w.position.x, w.position.y, w.position.angle]).toEqual([B.cx - 7, 88 + i * DCFC_ROW_PITCH, 60]);
      const e = dc.find((x) => x.id === `DCFC-${String(16 + i)}`)!;
      expect([e.position.x, e.position.y, e.position.angle]).toEqual([B.cx + 7, 88 + i * DCFC_ROW_PITCH, 300]);
    }
    // canopy A's ten are untouched
    expect(dc.filter((x) => Number(x.id.slice(5)) <= 10).map(key)).toEqual(asBuilt.filter((x) => x.type === 'dcfc').map(key));
    // canopy C's fifteen are the same stalls, ids and all
    const l2 = s.filter((x) => x.type === 'l2');
    expect(l2.length).toBe(CHARGER_BUILDS.dcfc20.l2);
    expect(l2.map(key)).toEqual(asBuilt.filter((x) => x.type === 'l2' && Math.abs(x.position.x - CANOPIES[2].cx) < 10).map(key));
    expect(l2[0].id).toBe('L2-16');
    expect(l2[0].position).toEqual({ x: CANOPIES[2].cx - 7, y: L2_WEST_Y0, angle: 60 });
    expect(l2[8].position).toEqual({ x: CANOPIES[2].cx + 7, y: L2_WEST_Y0 + L2_ROW_PITCH / 2, angle: 300 });
    // nothing else moved
    expect(s.filter((x) => x.type !== 'dcfc' && x.type !== 'l2').map(key))
      .toEqual(asBuilt.filter((x) => x.type !== 'dcfc' && x.type !== 'l2').map(key));
    expect(CANOPIES.map(canopyKind)).toEqual(['dcfc', 'dcfc', 'l2']);
  });
});

describe('the 30-post build: canopy C as canopies A and B, and no standard charger', () => {
  const stallsOf = () => { setChargerBuild('dcfc30'); return generateStallsV2(); };

  it('stands DCFC-21..30 on canopy C at canopy A’s rows and angles, keeps DCFC-01..20 where the 20-post build has them, and draws no L2', () => {
    const s = stallsOf();
    const asBuilt = generateStallsV2(10, 30, 3, 113, 2);
    setChargerBuild('dcfc20');
    const twenty = generateStallsV2();
    setChargerBuild('dcfc30');
    const C = CANOPIES[2];
    const dc = s.filter((x) => x.type === 'dcfc');
    expect(dc.length).toBe(CHARGER_BUILDS.dcfc30.dcfc);
    expect(dc.map((x) => x.id)).toEqual(Array.from({ length: 30 }, (_, i) => `DCFC-${String(i + 1).padStart(2, '0')}`));
    for (let i = 0; i < 5; i++) {
      const w = dc.find((x) => x.id === `DCFC-${String(21 + i)}`)!;
      expect([w.position.x, w.position.y, w.position.angle]).toEqual([C.cx - 7, 88 + i * DCFC_ROW_PITCH, 60]);
      const e = dc.find((x) => x.id === `DCFC-${String(26 + i)}`)!;
      expect([e.position.x, e.position.y, e.position.angle]).toEqual([C.cx + 7, 88 + i * DCFC_ROW_PITCH, 300]);
    }
    // canopies A and B are the 20-post build's, stall for stall
    expect(dc.filter((x) => Number(x.id.slice(5)) <= 20).map(key)).toEqual(twenty.filter((x) => x.type === 'dcfc').map(key));
    expect(s.filter((x) => x.type === 'l2')).toEqual([]);
    expect(CHARGER_BUILDS.dcfc30.l2).toBe(0);
    // nothing else moved
    expect(s.filter((x) => x.type !== 'dcfc' && x.type !== 'l2').map(key))
      .toEqual(asBuilt.filter((x) => x.type !== 'dcfc' && x.type !== 'l2').map(key));
    expect(CANOPIES.map(canopyKind)).toEqual(['dcfc', 'dcfc', 'dcfc']);
    expect([0, 1, 2].map(canopyIsFast)).toEqual([true, true, true]);
  });
});

describe.each(['dcfc20', 'dcfc30'] as const)('the %s build holds every rule the as-built layout is held to', (build) => {
  const stallsOf = () => { setChargerBuild(build); return generateStallsV2(); };

  it('parks no car on another, and stands no structure in any stall', () => {
    const s = stallsOf();
    const hits: string[] = [];
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        if (boxesOverlap(parkedBox(s[i].position), parkedBox(s[j].position))) hits.push(`${s[i].id} x ${s[j].id}`);
      }
    }
    for (const st of s) for (const k of allStructureSolids()) if (boxesOverlap(parkedBox(st.position), k.box)) hits.push(`${st.id} x ${k.kind}`);
    expect(hits).toEqual([]);
  });

  it('carries every canopy’s roof on spine columns clear of every fast-charger cabinet and car', () => {
    const s = stallsOf();
    const cabs = cabinetFootprints(s);
    for (const c of CANOPIES) {
      const ys = canopyColumnYs(c, cabs, s);
      expect(ys.length, c.id).toBeGreaterThanOrEqual(4);
      expect(ys[0] - c.y).toBeLessThanOrEqual(6);
      expect(c.y + c.h - ys[ys.length - 1]).toBeLessThanOrEqual(6);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeLessThanOrEqual(CANOPY_MAX_SPAN + 1e-9);
      for (const y of ys) {
        const col = boxOf({ x0: c.cx - CANOPY_COLUMN / 2, x1: c.cx + CANOPY_COLUMN / 2, y0: y - CANOPY_COLUMN / 2, y1: y + CANOPY_COLUMN / 2 });
        for (const k of cabs) expect(boxesOverlap(col, k.box), `${c.id} column y=${y} vs ${k.stallId}`).toBe(false);
        for (const st of s.filter((x) => x.type === 'dcfc' || x.type === 'l2')) {
          expect(boxGap(col, parkedBox(st.position)), `${c.id} column y=${y} vs ${st.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('hangs every OTTO-CLEAN ARM from a header between its canopy’s purlins, clear of its rafters and lights', () => {
    const s = stallsOf();
    const cabs = cabinetFootprints(s);
    const mounts = s.filter((x) => x.type === 'dcfc').map((x) => placeCleanArm(x.position.x, x.position.y, x.position.angle, DECK_Y).mount);
    // ten on each fast-charger canopy, none on a standard one
    expect(CANOPIES.map((c) => mounts.filter((m) => Math.abs(m.cx - c.cx) < 0.5).length))
      .toEqual(CANOPIES.map((_, i) => (i < CHARGER_BUILDS[build].dcfcCanopies ? 10 : 0)));
    for (const m of mounts) {
      expect(m.d).toBeGreaterThan(m.d0 + 0.5);
      expect(m.d).toBeLessThan(m.d1 - 0.5);
      expect(m.headerBottomAtJ1 - m.columnBottom).toBeGreaterThan(2.5);
      const c = CANOPIES.find((k) => Math.abs(k.cx - m.cx) < 0.5)!;
      for (const y of canopyColumnYs(c, cabs, s)) expect(Math.abs(m.planY - y)).toBeGreaterThan(0.45 / 2 + HEADER_WIDTH_U / 2 + 0.1);
    }
    // the fixtures left hanging are clear of every header
    for (const c of CANOPIES) {
      for (const side of [-1, 1] as const) {
        for (let y = c.y + 6; y <= c.y + c.h - 6; y += 10) {
          if (mounts.some((m) => fixtureHitsMount(m, c.cx, side, y, 1.8))) continue;
          for (const m of mounts) {
            if (Math.abs(m.cx - c.cx) > 0.5 || m.side !== side) continue;
            expect(Math.abs(m.planY - y)).toBeGreaterThan(1.8 + HEADER_WIDTH_U / 2);
          }
        }
      }
    }
  });
});
