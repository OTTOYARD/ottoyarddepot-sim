import { describe, it, expect } from 'vitest';
import {
  generateStallsV2, chargerStallFrame, PARK_RUNS,
  WEST_AISLE_X, EAST_AISLE_X, TEMP_LANE_X, SOUTH_LANE_Y, N1_LANE_Y,
} from '@/lib/sitePlan';
import { hasWheelStop, wheelStopPose, WHEEL_STOP_SETBACK, WHEEL_STOP_SIZE } from './wheelStops';

/**
 * A wheel stop is a bumper the tyre rolls up against, so it must lie ACROSS the
 * stall, square to the car. Every staging stop was drawn turned 90 degrees, lying
 * along the car and parallel to the stall lines, and nothing checked it: the founder
 * caught it on screen (2026-10-04). These tests pin it for every stall the site
 * declares, using the same orientation algebra the renderer uses.
 */

// toWorld maps plan to world as worldX = 150 - x, worldZ = 110 - y, so a plan
// direction (dx, dy) is the world direction (-dx, -dy) in (X, Z).
const worldDir = (d: { x: number; y: number }) => ({ x: -d.x, z: -d.y });
// Ry(r) sends the box's local +X, its long axis, to world (cos r, 0, -sin r).
const longAxis = (rotY: number) => ({ x: Math.cos(rotY), z: -Math.sin(rotY) });
// ...and its local +Z, its depth, to world (sin r, 0, cos r).
const depthAxis = (rotY: number) => ({ x: Math.sin(rotY), z: Math.cos(rotY) });
const dot = (a: { x: number; z: number }, b: { x: number; z: number }) => a.x * b.x + a.z * b.z;

const stalls = generateStallsV2();
const parked = stalls.filter(hasWheelStop);
const staging = parked.filter((s) => s.type === 'staging');
const chargers = parked.filter((s) => s.type === 'l2' || s.type === 'dcfc');

describe('wheel stops', () => {
  it('every parking stall gets one, and no pull-through bay does', () => {
    expect(staging).toHaveLength(113);
    expect(chargers.filter((s) => s.type === 'l2')).toHaveLength(30);
    expect(chargers.filter((s) => s.type === 'dcfc')).toHaveLength(10);
    expect(stalls.filter((s) => s.type === 'wash' || s.type === 'service').some(hasWheelStop)).toBe(false);
  });

  it('every stop lies across its stall: its long axis is square to the car', () => {
    for (const s of parked) {
      const car = worldDir(chargerStallFrame(s.position.angle).fwd);
      const across = longAxis(wheelStopPose(s).rotY);
      expect(Math.abs(dot(car, across)), s.id).toBeLessThan(1e-9);
    }
  });

  it("every stop sits on its car's own axis, 3.4u from the centre, not beside the car", () => {
    for (const s of parked) {
      const p = wheelStopPose(s);
      const off = { x: p.x - s.position.x, y: p.y - s.position.y };
      const { fwd } = chargerStallFrame(s.position.angle);
      expect(Math.abs(off.x * fwd.y - off.y * fwd.x), s.id).toBeLessThan(1e-9);
      expect(Math.hypot(off.x, off.y), s.id).toBeCloseTo(WHEEL_STOP_SETBACK, 9);
    }
  });

  it('staging stops sit at the stall head, the end away from the aisle the car comes off', () => {
    const aisle: Record<string, { axis: 'x' | 'y'; at: number }> = {
      W: { axis: 'x', at: WEST_AISLE_X },
      E: { axis: 'x', at: EAST_AISLE_X },
      TW: { axis: 'x', at: TEMP_LANE_X },
      TE: { axis: 'x', at: TEMP_LANE_X },
      S1: { axis: 'y', at: SOUTH_LANE_Y },
      S2: { axis: 'y', at: SOUTH_LANE_Y },
      S3: { axis: 'y', at: SOUTH_LANE_Y },
      N1: { axis: 'y', at: N1_LANE_Y },
    };
    for (const run of PARK_RUNS) {
      const a = aisle[run.id];
      expect(a, `no aisle declared for run ${run.id}`).toBeDefined();
      for (let i = 0; i < run.n; i++) {
        const c = { x: run.x0 + i * run.dx, y: run.y0 + i * run.dy };
        const p = wheelStopPose({ type: 'staging', position: { ...c, angle: run.angle } });
        expect(Math.abs(p[a.axis] - a.at), `${run.id} #${i}`).toBeGreaterThan(Math.abs(c[a.axis] - a.at));
      }
    }
  });

  it('neighbouring stops in a run never touch: each fits inside its stall pitch', () => {
    for (const run of PARK_RUNS) {
      const pitch = Math.hypot(run.dx, run.dy);
      const along = worldDir({ x: run.dx / pitch, y: run.dy / pitch });
      const { rotY } = wheelStopPose({ type: 'staging', position: { x: run.x0, y: run.y0, angle: run.angle } });
      const extent = Math.abs(dot(longAxis(rotY), along)) * WHEEL_STOP_SIZE.length
        + Math.abs(dot(depthAxis(rotY), along)) * WHEEL_STOP_SIZE.depth;
      // The stop now spans the stall's width, so the run's pitch has to clear it.
      expect(extent, run.id).toBeCloseTo(WHEEL_STOP_SIZE.length, 9);
      expect(pitch - extent, run.id).toBeGreaterThan(0.5);
    }
  });

  it('the angled charger stops are exactly where they were', () => {
    for (const s of chargers) {
      const { heading, fwd } = chargerStallFrame(s.position.angle);
      expect(wheelStopPose(s), s.id).toEqual({
        x: s.position.x + fwd.x * 3.4,
        y: s.position.y + fwd.y * 3.4,
        rotY: Math.PI / 2 - heading,
      });
    }
  });
});
