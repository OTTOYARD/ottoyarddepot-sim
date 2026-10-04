import { describe, it, expect } from 'vitest';
import {
  buildCityPlan, solidsOf, overlaps, CITY, CITY_VIEW_FAR, DEPOT_BLOCK, ENTRANCE_LAWN, NEAR_RING, SOUTH_ROAD,
  FAR_GROUND, type Rect,
} from './cityPlan';
import { CAMERA_PRESETS } from './cameraPresets';
import { VIEWER_CAMS } from '@/viewer/viewerCams';

/**
 * The city is scenery, so what matters is what it must never do: stand on the depot or
 * on the road the fleet drives, stand in front of a camera or around one, or drift
 * from one load to the next.
 */

const plan = buildCityPlan();
const solids = plan.buildings.flatMap((b) => solidsOf(b).map((s) => ({ ...s, id: b.id })));
const streets = plan.ground.filter((g) => g.surface === 'street');
type Box = Rect & { y0: number; y1: number };

/** Distance from a point to a box (0 inside). */
function dist(p: readonly number[], b: Box) {
  const dx = Math.max(b.x0 - p[0], 0, p[0] - b.x1);
  const dy = Math.max(b.y0 - p[1], 0, p[1] - b.y1);
  const dz = Math.max(b.z0 - p[2], 0, p[2] - b.z1);
  return Math.hypot(dx, dy, dz);
}

/** Does the segment a→b pass through the box? (slab test) */
function segmentHits(a: readonly number[], b: readonly number[], box: Box) {
  let t0 = 0, t1 = 1;
  const lo = [box.x0, box.y0, box.z0], hi = [box.x1, box.y1, box.z1];
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-9) { if (a[k] < lo[k] || a[k] > hi[k]) return false; continue; }
    let ta = (lo[k] - a[k]) / d, tb = (hi[k] - a[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

const cams = [
  ...Object.entries(CAMERA_PRESETS).map(([name, c]) => ({ name, position: c.position, target: c.target })),
  ...Object.values(VIEWER_CAMS).map((c) => ({ name: `viewer:${c.id}`, position: c.position, target: c.target })),
];

describe('the city around the depot', () => {
  it('is the same city on every load', () => {
    expect(JSON.stringify(buildCityPlan())).toBe(JSON.stringify(plan));
  });

  it('has a city in it: streets, a few thousand buildings, trees, lamps, a skyline', () => {
    expect(plan.buildings.length).toBeGreaterThan(1000);
    expect(plan.trees.length).toBeGreaterThan(500);
    expect(plan.lights.length).toBeGreaterThan(200);
    const tops = solids.map((s) => s.y1).sort((a, b) => b - a);
    expect(tops[0]).toBeGreaterThan(250);
  });

  it('builds nothing on the depot, its grass, or the road at its gates', () => {
    for (const s of solids) {
      expect(overlaps(s, DEPOT_BLOCK), s.id).toBe(false);
      expect(s.z1 < SOUTH_ROAD.at - SOUTH_ROAD.width / 2 || s.z0 > SOUTH_ROAD.at + SOUTH_ROAD.width / 2, s.id).toBe(true);
    }
    for (const t of plan.trees) expect(t.x > DEPOT_BLOCK.x0 && t.x < DEPOT_BLOCK.x1 && t.z > DEPOT_BLOCK.z0 && t.z < DEPOT_BLOCK.z1).toBe(false);
  });

  it('keeps every building off the streets and sidewalks, and every tree and lamp off the pavement', () => {
    const bad: string[] = [];
    const paved = [...streets, ...plan.sidewalks];
    for (const s of solids) for (const st of paved) if (overlaps(s, st, -1e-6)) bad.push(`${s.id} on the pavement`);
    const inside = (x: number, z: number, r: Rect) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
    for (const t of plan.trees) for (const st of streets) if (inside(t.x, t.z, st)) bad.push(`tree at ${t.x},${t.z}`);
    for (const l of plan.lights) for (const st of streets) if (inside(l.x, l.z, st)) bad.push(`lamp at ${l.x},${l.z}`);
    for (const g of plan.signals) for (const st of streets) if (inside(g.x, g.z, st)) bad.push(`signal at ${g.x},${g.z}`);
    expect(bad).toEqual([]);
  });

  it('puts every building inside its own block, clear of every other building', () => {
    const bad: string[] = [];
    const blockOf = new Map(plan.blocks.map((k) => [k.id, k]));
    for (const b of plan.buildings) {
      const block = blockOf.get(b.id.slice(0, b.id.indexOf('.')))!;
      for (const m of b.masses) {
        if (!(m.x0 >= block.lot.x0 - 1e-6 && m.x1 <= block.lot.x1 + 1e-6 && m.z0 >= block.lot.z0 - 1e-6 && m.z1 <= block.lot.z1 + 1e-6)) bad.push(`${b.id} outside its lot`);
        if (!(m.y1 > m.y0)) bad.push(`${b.id} has no height`);
      }
    }
    // every mass of one building against every mass of the others
    const foot = plan.buildings.flatMap((b) => b.masses.map((r) => ({ id: b.id, r }))).sort((a, b) => a.r.x0 - b.r.x0);
    for (let i = 0; i < foot.length; i++) {
      for (let j = i + 1; j < foot.length && foot[j].r.x0 < foot[i].r.x1; j++) {
        if (foot[i].id !== foot[j].id && overlaps(foot[i].r, foot[j].r, -1e-6)) bad.push(`${foot[i].id} / ${foot[j].id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps the lawn across the road from the gates open: the Entrance camera stands on it', () => {
    for (const s of solids) expect(overlaps(s, ENTRANCE_LAWN), s.id).toBe(false);
  });

  it('stays low near the lot, where the corner, orbit and Operator cameras fly', () => {
    for (const s of solids) {
      const d = Math.hypot((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2 - 4);
      if (d < NEAR_RING.radius) expect(s.y1, s.id).toBeLessThanOrEqual(NEAR_RING.maxHeight);
    }
  });

  it('never stands within 10 u of a camera, nor in its way, for every preset and live-view camera', () => {
    const bad: string[] = [];
    for (const c of cams) {
      for (const s of solids) {
        if (dist(c.position, s) <= 10) bad.push(`${c.name} within 10 u of ${s.id}`);
        if (segmentHits(c.position, c.target, s)) bad.push(`${c.name} looks through ${s.id}`);
      }
      for (const t of plan.trees) {
        const crown: Box = { x0: t.x - t.r, x1: t.x + t.r, z0: t.z - t.r, z1: t.z + t.r, y0: 0, y1: t.h * 0.55 + t.r * 1.6 };
        if (segmentHits(c.position, c.target, crown)) bad.push(`${c.name} looks through a tree at ${t.x.toFixed(0)},${t.z.toFixed(0)}`);
      }
      for (const l of plan.lights) {
        const pole: Box = { x0: l.x - 0.4, x1: l.x + 0.4, z0: l.z - 0.4, z1: l.z + 0.4, y0: 0, y1: 16.5 };
        if (segmentHits(c.position, c.target, pole)) bad.push(`${c.name} looks through a lamp at ${l.x.toFixed(0)},${l.z.toFixed(0)}`);
      }
      for (const g of plan.signals) {
        const pole: Box = { x0: g.x - 0.4, x1: g.x + 0.4, z0: g.z - 0.4, z1: g.z + 0.4, y0: 0, y1: 9.5 };
        if (segmentHits(c.position, c.target, pole)) bad.push(`${c.name} looks through a signal at ${g.x.toFixed(0)},${g.z.toFixed(0)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never meets a live-view corner camera as it spins round the lot', () => {
    const bad: string[] = [];
    for (const c of Object.values(VIEWER_CAMS).filter((v) => v.kind === 'orbit')) {
      const [px, py, pz] = c.position, [tx, , tz] = c.target;
      const r = Math.hypot(px - tx, pz - tz);
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        const p = [tx + Math.cos(a) * r, py, tz + Math.sin(a) * r];
        for (const s of solids) if (dist(p, s) <= 10) bad.push(`${c.id} at ${k * 5}° vs ${s.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('fits inside the far plane from every camera, with the plain beyond it reaching past the haze', () => {
    for (const c of cams) {
      for (const s of solids) {
        const far = Math.hypot(Math.max(Math.abs(s.x0 - c.position[0]), Math.abs(s.x1 - c.position[0])),
          Math.max(Math.abs(s.z0 - c.position[2]), Math.abs(s.z1 - c.position[2])), s.y1);
        expect(far, `${c.name} vs ${s.id}`).toBeLessThan(CITY_VIEW_FAR);
      }
    }
    expect(FAR_GROUND.x1).toBeGreaterThan(CITY.x1);
    expect(FAR_GROUND.z1).toBeGreaterThan(CITY.z1);
  });

  it('lays its ground without two surfaces on top of each other (no flicker)', () => {
    const bad: string[] = [];
    const g = [...plan.ground].sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length && g[j].x0 < g[i].x1; j++) {
        if (overlaps(g[i], g[j], -1e-6)) bad.push(`${g[i].surface} ${JSON.stringify(g[i])} / ${g[j].surface} ${JSON.stringify(g[j])}`);
      }
    }
    // the city's ground never covers the depot block, where DepotGround lays its grass
    for (const r of plan.ground) if (overlaps(r, DEPOT_BLOCK, -1e-6)) bad.push(`${r.surface} on the depot block`);
    const w = [...plan.sidewalks].sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < w.length; i++) {
      for (let j = i + 1; j < w.length && w[j].x0 < w[i].x1; j++) if (overlaps(w[i], w[j], -1e-6)) bad.push('two sidewalks overlap');
      for (const r of plan.ground) if (overlaps(w[i], r, -1e-6)) bad.push(`sidewalk ${JSON.stringify(w[i])} over ${r.surface}`);
    }
    expect(bad).toEqual([]);
  });

  it('carries the nod to the skyline: one two-spired tower, the tallest thing in town', () => {
    const twin = plan.buildings.filter((b) => (b.spires ?? []).length === 2);
    expect(twin).toHaveLength(1);
    const top = Math.max(...solidsOf(twin[0]).map((s) => s.y1));
    for (const s of solids) expect(s.y1).toBeLessThanOrEqual(top);
  });
});
