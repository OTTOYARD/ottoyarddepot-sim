/**
 * The 20-post build-out, as the renderer will draw it once otto-q-core 0759 is applied:
 * canopy B re-striped exactly as canopy A (DCFC-11..20), canopy C's 15 standard
 * chargers as they are (L2-16..30). The as-built layout must not move by a hair, and
 * the new one must hold every rule the as-built one is held to: no car on a car, no
 * structure in a stall, columns clear of every cabinet and car, and an OTTO-CLEAN ARM
 * that hangs from steel it can reach.
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
    expect(chargerBuildFor({ dcfc: 1, l2: 0 })).toBeNull();
    expect(chargerBuildFor({ dcfc: 40, l2: 0 })).toBeNull();
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

  it('carries canopy B’s roof on spine columns clear of every fast-charger cabinet and car', () => {
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

  it('hangs every new OTTO-CLEAN ARM from a header between canopy B’s purlins, clear of its rafters and lights', () => {
    const s = stallsOf();
    const cabs = cabinetFootprints(s);
    const mounts = s.filter((x) => x.type === 'dcfc').map((x) => placeCleanArm(x.position.x, x.position.y, x.position.angle, DECK_Y).mount);
    expect(mounts.filter((m) => Math.abs(m.cx - CANOPIES[1].cx) < 0.5).length).toBe(10);
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
