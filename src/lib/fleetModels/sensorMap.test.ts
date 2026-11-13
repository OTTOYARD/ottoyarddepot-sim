// Each fleet vehicle's sensor map (sensorMap.ts) and the solid it is measured on (washSolid.ts):
//   - the solid is the vehicle's own skin: every vertex of the model's surface is on it, and a point 0.1 m off the
//     skin reads 0.1 m, inside SOLID_RESOLUTION_M;
//   - every sensor to clean is in the map (or named as buried), and nothing that is not a sensor is;
//   - each face's centre is on the vehicle, and its direction points away from it;
//   - each face has a zone and an arm, and a label a viewer can read with no maker's name in it.
import { describe, expect, it } from 'vitest';
import { FLEET_SPECS } from './index';
import { CENTRE_BAND_M, isCleanable, sensorMap } from './sensorMap';
import { makeSurface } from './surface';
import { FAR_M, SOLID_RESOLUTION_M, fleetWashSolid } from './washSolid';

const cases = FLEET_SPECS.map((spec) => ({ key: spec.key, spec }));
/** The faces each vehicle's map has: its sensors, with 3 or 6 for a lidar that turns and 2 for a wide window. */
const FACES: Record<string, { sensors: number; faces: number }> = {
  waymo_ojai: { sensors: 23, faces: 28 }, waymo_ipace: { sensors: 21, faces: 26 }, zoox_robotaxi: { sensors: 28, faces: 36 },
  tesla_cybercab: { sensors: 8, faces: 8 }, tesla_model_y: { sensors: 8, faces: 8 }, lucid_gravity_nuro: { sensors: 21, faces: 26 },
};

describe.each(cases)('the wash solid of $key', ({ spec }) => {
  const solid = fleetWashSolid(spec);
  it('is the vehicle\'s own skin, inside its stated resolution', () => {
    const s = makeSurface(spec.curves);
    let on = 0, off = 0, n = 0;
    for (const tri of s.grid(90)) {
      const v = tri[0];
      if ((v.id % 7) !== 0) continue;
      const p = { x: v.z, dy: -v.x, y: v.y };
      // the skin alone: a sensor or a tyre can stand over a vertex
      on = Math.max(on, Math.abs(solid.bodyGap(p)));
      const q = { x: v.z + v.nz * 0.1, dy: -(v.x + v.nx * 0.1), y: v.y + v.ny * 0.1 };
      off = Math.max(off, solid.bodyGap(q) - 0.1);
      n++;
    }
    expect(n).toBeGreaterThan(1000);
    if (process.env.WASH_REPORT) console.log(`SOLID ${spec.key} on ${(on * 1000).toFixed(2)} mm, 0.1 m off ${(off * 1000).toFixed(2)} mm, ${n} points`);
    expect(on).toBeLessThan(SOLID_RESOLUTION_M);
    // never more than the true distance by more than the resolution (0.1 m out along the normal is at most 0.1 m away)
    expect(off).toBeLessThan(SOLID_RESOLUTION_M);
  });

  it('has the vehicle\'s published size, with its sensors and mirrors counted', () => {
    expect(solid.length).toBeCloseTo(spec.dims.length, 6);
    expect(solid.bodyHalfWidth).toBeGreaterThan(spec.dims.width / 2 - 0.06);
    expect(solid.bodyHalfWidth).toBeLessThan(spec.dims.width / 2 + 0.02);
    expect(solid.halfWidth).toBeGreaterThanOrEqual(solid.bodyHalfWidth);
    expect(solid.top).toBeGreaterThan((spec.dims.bodyHeight ?? spec.dims.height) - 0.06);
    expect(solid.top).toBeLessThan(spec.dims.height + 0.45);
    // mirrored: the same clearance on both sides of the centre plane, the skin alone
    for (const p of [{ x: 0.7, dy: 0.3, y: 1.2 }, { x: 1.2, dy: -1.6, y: 0.5 }, { x: 0.2, dy: 2.0, y: 1.9 }]) {
      expect(solid.bodyGap(p)).toBeCloseTo(solid.bodyGap({ ...p, x: -p.x }), 9);
    }
    // well clear of the vehicle the answer is a lower bound: the distance to its box
    const far = { x: solid.halfWidth + 1.0, dy: 0, y: 1.0 };
    expect(solid.gap(far)).toBeGreaterThanOrEqual(FAR_M);
    expect(solid.gap(far)).toBeLessThanOrEqual(1.0 + 1e-9);
  });
});

describe.each(cases)('the sensor map of $key', ({ key, spec }) => {
  const solid = fleetWashSolid(spec);
  const map = sensorMap(spec);

  it('has every sensor to clean, and only those', () => {
    const cleanable = spec.sensors.filter(isCleanable).map((s) => s.id);
    expect(map.cleanable).toBe(cleanable.length);
    expect(map.cleanable).toBe(FACES[key].sensors);
    const inMap = new Set([...map.faces.map((f) => f.sensor), ...map.buried.map((b) => b.sensor)]);
    expect([...inMap].sort()).toEqual([...cleanable].sort());
    expect(map.faces).toHaveLength(FACES[key].faces);
    expect(new Set(map.faces.map((f) => f.id)).size).toBe(map.faces.length);
    // a housing is not a sensor
    for (const s of spec.sensors.filter((x) => x.type === 'pod' || x.type === 'audio')) expect(inMap.has(s.id), s.id).toBe(false);
  });

  it('puts each face on the vehicle, looking away from it', () => {
    for (const f of map.faces) {
      expect(Math.abs(solid.gap(f.p)), `${f.id} is ${solid.gap(f.p).toFixed(4)} m off the vehicle`).toBeLessThan(1e-3);
      expect(Math.hypot(f.out.x, f.out.dy, f.out.y), f.id).toBeCloseTo(1, 9);
      // a step along its direction is outside the vehicle and farther from it
      const out = { x: f.p.x + f.out.x * 0.05, dy: f.p.dy + f.out.dy * 0.05, y: f.p.y + f.out.y * 0.05 };
      // (a lidar drawn under its housing's overhang has that housing 7 mm from this point: the least of the fleet)
      expect(solid.gap(out), `${f.id} out`).toBeGreaterThan(0.005);
      // and it looks away from the vehicle's middle, or up
      const fromAxis = Math.abs(f.p.x) > 0.02 ? f.out.x * Math.sign(f.p.x) : 0;
      expect(Math.max(fromAxis, f.out.y, f.out.dy * Math.sign(f.p.dy)), `${f.id} looks inward`).toBeGreaterThan(0.2);
      expect(f.r).toBeGreaterThan(0.005);
      expect(f.r).toBeLessThanOrEqual(0.08);
    }
  });

  it('gives each face a zone and an arm: its own side\'s, and either for a sensor on the centre', () => {
    for (const f of map.faces) {
      expect(['front', 'sides', 'roof', 'rear']).toContain(f.zone);
      if (Math.abs(f.p.x) > CENTRE_BAND_M) expect(f.arm, f.id).toBe(f.p.x > 0 ? 1 : -1);
      if (f.zone === 'front') expect(f.p.dy, f.id).toBeLessThan(0);
      if (f.zone === 'rear') expect(f.p.dy, f.id).toBeGreaterThan(0);
    }
    // a sensor's faces are all one arm's, but for a lidar on the centre that turns: both arms take a side of it
    for (const id of new Set(map.faces.map((f) => f.sensor))) {
      const arms = new Set(map.faces.filter((f) => f.sensor === id).map((f) => f.arm));
      const sp = spec.sensors.find((s) => s.id === id)!;
      if (arms.size === 2) expect(sp.shape, id).toBe('spinLidar');
    }
    // the two arms share the work: neither has all of a vehicle's faces
    for (const arm of [1, -1]) expect(map.faces.filter((f) => f.arm === arm).length).toBeGreaterThan(map.faces.length / 5);
  });

  it('labels each face in plain words, with no maker\'s or operator\'s name', () => {
    const names = /waymo|zoox|tesla|lucid|nuro|jaguar|zeekr|ojai|cybercab|gravity|i-?pace|model y/i;
    for (const f of [...map.faces, ...map.buried]) {
      expect(f.label, f.label).toMatch(/lidar|camera|radar/);
      expect(f.label).not.toMatch(names);
      expect(f.label).toBe(f.label.toLowerCase());
    }
  });
});
