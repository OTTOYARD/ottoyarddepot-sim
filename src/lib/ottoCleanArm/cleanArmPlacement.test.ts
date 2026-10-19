/**
 * Placing the OTTO-CLEAN ARM is placing the parked car, and carrying it is the canopy's
 * job. So: the arm's frame IS the car body's frame (same heading rule as the motion
 * driver, same metre -> plan-unit conversion as the body), J1 hangs where the placement
 * says, its drop column has length, its header beam bears on the two purlins, and no
 * canopy LED fixture or rafter is left where the header goes.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateStallsV2, CANOPIES } from '@/lib/sitePlan';
import { canopyColumnYs } from '@/lib/structurePlan';
import { parkedHeading } from '@/engine/TwinMotionDriver';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { yawFromHeading2D, DECK_Y } from '@/components/canvas/three/coordUtils';
import {
  placeCleanArm, chargerParkedHeading, fixtureHitsMount, canopyRoofAt, PURLIN_UNDERSIDE_U, HEADER_WIDTH_U,
} from './cleanArmPlacement';
import { CLEAN_ARM } from './cleanArmSpec';

const dcfc = generateStallsV2().filter((s) => s.type === 'dcfc');

/** The car body's world matrix as the fleet writes it (fleetMath.writeYaw) times planUnits. */
function carMatrix(x: number, z: number, yaw: number): THREE.Matrix4 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const m = new THREE.Matrix4().set(c, 0, s, x, 0, 1, 0, DECK_Y, -s, 0, c, z, 0, 0, 0, 1);
  const pu = new THREE.Matrix4().makeRotationY(-Math.PI / 2).multiply(new THREE.Matrix4().makeScale(PLAN_UNITS_PER_METRE, PLAN_UNITS_PER_METRE, PLAN_UNITS_PER_METRE));
  return m.multiply(pu);
}

/** The cleaning arm's frame as CleanArm.tsx builds it. */
function armMatrix(p: ReturnType<typeof placeCleanArm>): THREE.Matrix4 {
  const outer = new THREE.Object3D();
  outer.position.set(p.world.x, DECK_Y, p.world.z);
  outer.rotation.y = p.yaw;
  const inner = new THREE.Object3D();
  inner.rotation.y = -Math.PI / 2;
  inner.scale.setScalar(PLAN_UNITS_PER_METRE);
  outer.add(inner);
  outer.updateMatrixWorld(true);
  return inner.matrixWorld.clone();
}

describe('the OTTO-CLEAN ARM is placed by its car', () => {
  it('reads every fast-charger stall’s parked heading exactly as the motion driver does', () => {
    expect(dcfc.length).toBeGreaterThan(0);
    for (const s of dcfc) {
      expect(chargerParkedHeading(s.position.angle)).toBeCloseTo(parkedHeading('dcfc', s.position.angle, s.position.x, s.position.y), 12);
    }
    expect(chargerParkedHeading(0)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('works in the car body’s own frame: every point of the car is the same world point to the arm', () => {
    for (const s of dcfc) {
      const p = placeCleanArm(s.position.x, s.position.y, s.position.angle, DECK_Y);
      const car = carMatrix(150 - s.position.x, 110 - s.position.y, yawFromHeading2D(parkedHeading('dcfc', s.position.angle, s.position.x, s.position.y)));
      const arm = armMatrix(p);
      for (const v of [[2.4, 0.5, 0.95], [-2.3, 1.6, -0.9], [0.18, 3.42, 0], [0, 0, 0]]) {
        const a = new THREE.Vector3(...v).applyMatrix4(car);
        const b = new THREE.Vector3(...v).applyMatrix4(arm);
        expect(a.distanceTo(b)).toBeLessThan(1e-9);
      }
    }
  });

  it('hangs J1 where the placement says, over the car, forward of its centre along its own axis', () => {
    for (const s of dcfc) {
      const p = placeCleanArm(s.position.x, s.position.y, s.position.angle, DECK_Y);
      const j1 = new THREE.Vector3(CLEAN_ARM.mountX, CLEAN_ARM.link1Y, 0).applyMatrix4(armMatrix(p));
      expect(j1.x).toBeCloseTo(150 - p.j1Plan.x, 9);
      expect(j1.z).toBeCloseTo(110 - p.j1Plan.y, 9);
      expect(Math.hypot(p.j1Plan.x - s.position.x, p.j1Plan.y - s.position.y)).toBeCloseTo(CLEAN_ARM.mountX * PLAN_UNITS_PER_METRE, 9);
    }
  });
});

describe('the canopy carries it', () => {
  it('drops a column of real length from the header to the arm’s base drum', () => {
    for (const s of dcfc) {
      const { mount: m } = placeCleanArm(s.position.x, s.position.y, s.position.angle, DECK_Y);
      expect(m.headerBottomAtJ1 - m.columnBottom).toBeGreaterThan(2.5);    // 1.2 m and more
      expect(m.columnBottom).toBeCloseTo(DECK_Y + (CLEAN_ARM.link1Y + CLEAN_ARM.j1.h / 2 + 0.05) * PLAN_UNITS_PER_METRE, 9);
    }
  });

  it('bears the header on the two purlins either side of J1', () => {
    for (const s of dcfc) {
      const { mount: m } = placeCleanArm(s.position.x, s.position.y, s.position.angle, DECK_Y);
      expect(m.d).toBeGreaterThan(m.d0 + 0.5);
      expect(m.d).toBeLessThan(m.d1 - 0.5);
      // the header's top is a purlin's underside at each end
      expect(canopyRoofAt(m.d0) - PURLIN_UNDERSIDE_U).toBeGreaterThan(canopyRoofAt(m.d1) - PURLIN_UNDERSIDE_U);
    }
  });

  it('leaves no canopy LED fixture where a header goes, and takes down only the ones it would cut', () => {
    const mounts = dcfc.map((s) => placeCleanArm(s.position.x, s.position.y, s.position.angle, DECK_Y).mount);
    let kept = 0, skipped = 0;
    for (const c of CANOPIES) {
      for (const side of [-1, 1] as const) {
        for (let y = c.y + 6; y <= c.y + c.h - 6; y += 10) {
          const hit = mounts.some((m) => fixtureHitsMount(m, c.cx, side, y, 1.8));
          if (hit) { skipped++; continue; }
          kept++;
          // a kept fixture's footprint does not overlap any header on its side of the spine
          for (const m of mounts) {
            if (Math.abs(m.cx - c.cx) > 0.5 || m.side !== side) continue;
            expect(Math.abs(m.planY - y)).toBeGreaterThan(1.8 + HEADER_WIDTH_U / 2);
          }
        }
      }
    }
    expect(skipped).toBeGreaterThan(0);
    expect(skipped).toBeLessThanOrEqual(mounts.length);
    expect(kept).toBeGreaterThan(skipped);
  });

  it('clears every canopy rafter', () => {
    for (const c of CANOPIES) {
      const ys = canopyColumnYs(c);
      for (const s of dcfc) {
        const { mount: m } = placeCleanArm(s.position.x, s.position.y, s.position.angle, DECK_Y);
        if (Math.abs(m.cx - c.cx) > 0.5) continue;
        for (const y of ys) expect(Math.abs(m.planY - y)).toBeGreaterThan(0.45 / 2 + HEADER_WIDTH_U / 2 + 0.1);
      }
    }
  });
});
