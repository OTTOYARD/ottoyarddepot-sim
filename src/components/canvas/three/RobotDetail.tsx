import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { DETAIL_RULES, DetailDirector } from '@/lib/robotics/cadDetail';
import type { DepotCad } from '@/lib/robotics/cadDepot';
import type { RobotKey } from '@/lib/robotics/catalog';
import { makeFlexFleet } from '@/lib/robotics/flexMesh';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { makeInstancedFleet } from './instancedFleet';
import { NEAR_FLEX_OPTIONS, useDetailCad } from './cadFleet';
import { clearReleased, type DetailFleets } from './detailDraw';

/**
 * THE YARD'S DETAIL ROBOTS (robotics/cadDetail.ts): one director for the scene, and for each robot kind its detail
 * model, fetched the first time one of its robots comes near the camera, and one set of instanced fleets for the few
 * robots it draws at a time. The robot components draw into them (detailDraw.ts); nothing here poses a robot.
 */

/** Same segments, in the same order: one skeleton then places both models (cadDetail.test.ts holds the GLBs to it). */
export function sameSegments(a: DepotCad, b: DepotCad): boolean {
  return a.segmentNames.length === b.segmentNames.length && a.segmentNames.every((n, i) => n === b.segmentNames[i]);
}

/** The scene's director, and which kinds have asked for their detail model yet. */
export function useDetailDirector(): { director: DetailDirector; wanted: Record<RobotKey, boolean> } {
  const director = useMemo(() => new DetailDirector(PLAN_UNITS_PER_METRE), []);
  const [wanted, setWanted] = useState<Record<RobotKey, boolean>>({ charge_arm: false, clean_arm: false, wash_gantry: false, tire_bay: false });
  useEffect(() => {
    director.onFirstWant = (k) => setWanted((w) => (w[k] ? w : { ...w, [k]: true }));
    return () => { director.onFirstWant = null; };
  }, [director]);
  return { director, wanted };
}

/**
 * One kind's detail fleets, once its detail model has loaded and only if it has the depot model's segments (else the
 * depot model keeps drawing every robot of the kind, and the console says why once).
 */
export function useDetailFleets(kind: RobotKey, depot: DepotCad | null, wanted: boolean, director: DetailDirector): DetailFleets | null {
  const near = useDetailCad(kind, wanted && depot !== null);
  const fleets = useMemo(() => {
    if (!near || !depot) return null;
    if (!sameSegments(near, depot)) {
      console.warn(`[depot] the ${kind} detail CAD's joints differ from its depot CAD's, so the yard draws the depot model up close`);
      return null;
    }
    const cap = DETAIL_RULES[kind].capacity;
    const fleet = makeInstancedFleet(near.parts, cap, { receiveShadow: true });
    const flex = near.flex.length ? makeFlexFleet(near.flex, cap, { ...NEAR_FLEX_OPTIONS[kind], links: near.links }) : null;
    return { kind, director, fleet, flex } satisfies DetailFleets;
  }, [near, depot, kind, director]);
  useEffect(() => () => { fleets?.fleet.dispose(); fleets?.flex?.dispose(); }, [fleets]);
  return fleets;
}

/** Each frame, before the robots draw: choose the detail robots for this camera, and empty the slots that changed hands. */
export function DetailFrame({ director, fleets }: { director: DetailDirector; fleets: readonly (DetailFleets | null)[] }) {
  useFrame(({ camera }) => {
    const released = director.update(camera, (k) => fleets.some((f) => f?.kind === k));
    for (const f of fleets) if (f) clearReleased(f, released.get(f.kind));
  }, -1);
  return null;
}

/** A kind's detail fleets in the scene. */
export function DetailMeshes({ fleets }: { fleets: DetailFleets | null }) {
  if (!fleets) return null;
  return (
    <group name={`detail:${fleets.kind}`}>
      {fleets.fleet.meshes.map((m, i) => <primitive key={`detail-${fleets.kind}-${i}`} object={m} />)}
      {fleets.flex && <primitive object={fleets.flex.group} />}
    </group>
  );
}
