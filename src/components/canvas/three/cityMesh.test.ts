import { describe, it, expect } from 'vitest';
import { buildCityPlan, FACADE_SPEC, type Mass } from './cityPlan';
import { buildCityGeometry, CITY_MATERIAL_KEYS, facade, GeoBatch } from './cityMesh';

/**
 * What the city costs and how it is wound. The whole city is one buffer per
 * material, so the budget below is the scene's added triangle count, and a wall
 * wound the wrong way would vanish under back-face culling.
 */

const geos = buildCityGeometry(buildCityPlan());

describe('city geometry', () => {
  it('builds only buffers that have a material, each with position, normal, uv and colour', () => {
    for (const [key, g] of geos) {
      expect(CITY_MATERIAL_KEYS as readonly string[], key).toContain(key);
      for (const a of ['position', 'normal', 'uv', 'color']) expect(g.getAttribute(a), `${key}.${a}`).toBeTruthy();
      expect(g.getAttribute('position').count % 3, key).toBe(0);
    }
  });

  it('holds no NaN, and every normal is a unit vector', () => {
    for (const [key, g] of geos) {
      const p = g.getAttribute('position').array, n = g.getAttribute('normal').array;
      let bad = 0;
      for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) bad++;
      for (let i = 0; i < n.length; i += 3) if (Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) > 1e-4) bad++;
      expect(bad, key).toBe(0);
    }
  });

  it('stays inside its budget: under 160k triangles for the whole city', () => {
    let tris = 0;
    for (const g of geos.values()) tris += g.getAttribute('position').count / 3;
    expect(tris).toBeLessThan(160_000);
  });

  it('winds every wall outward, and runs the window grid unbroken round the corners', () => {
    const m: Mass = { x0: 10, x1: 52, z0: -30, z1: 5, y0: 0, y1: 70, facade: 'brick', tint: '#ffffff', u: 0.25, v: 0.5 };
    const b = new GeoBatch();
    facade(b, m, true);
    const g = b.build().get('f:brick')!;
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const cx = (m.x0 + m.x1) / 2, cz = (m.z0 + m.z1) / 2;
    for (let t = 0; t < p.count; t += 3) {
      const mx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3, mz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
      expect(n.getX(t) * (mx - cx) + n.getZ(t) * (mz - cz)).toBeGreaterThan(0);
      expect(Math.abs(n.getY(t))).toBeLessThan(1e-9);
    }
    // u at a corner is the same on both walls that meet there
    const tileW = FACADE_SPEC.brick.bay * FACADE_SPEC.brick.tileBays;
    const perimeter = 2 * ((m.x1 - m.x0) + (m.z1 - m.z0));
    let maxU = 0;
    for (let i = 0; i < uv.count; i++) maxU = Math.max(maxU, uv.getX(i));
    expect(maxU).toBeCloseTo(m.u + perimeter / tileW, 9);
    // floors line up with the base: v climbs one tile per tileFloors floors
    let maxV = 0;
    for (let i = 0; i < uv.count; i++) maxV = Math.max(maxV, uv.getY(i));
    expect(maxV).toBeCloseTo(m.v + (m.y1 - m.y0) / (FACADE_SPEC.brick.floor * FACADE_SPEC.brick.tileFloors), 9);
  });
});
