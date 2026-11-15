import { useEffect, useState } from 'react';
import { buildDepotCad, depotFile, nearFile, parseGlb, type DepotCad, type DepotCadOptions } from '@/lib/robotics/cadDepot';
import { cadUrl, type RobotKey } from '@/lib/robotics/catalog';
import { MOUNT_HEIGHT_M } from '@/lib/ottoChargeArm/cobotSpec';
import type { FlexFleetOptions } from '@/lib/robotics/flexMesh';

/**
 * THE YARD'S ROBOTS ARE THE ENGINEERING CAD. Each robot kind's depot model (public/cad/<robot>.depot.glb, from
 * cad/build.py) is fetched once, cut into instanced parts (robotics/cadDepot.ts), and drawn by the robot components
 * in place of the simple procedural model they drew before. Until it has loaded, or if it cannot load, the
 * procedural model stays: the yard is never empty of robots.
 *
 * What the site draws itself is left out of the CAD here, so nothing is drawn twice:
 *   - OTTO-CLEAN ARM: its header beam, drop column and clamps are the canopy's steel, drawn by SolarCanopy with the
 *     canopy (from the same cleanArmSpec numbers);
 *   - OTTO-CHARGE ARM: nothing. Its riser, mount plate and supply from the cabinet (through the floor, finding 19 in
 *     docs/OTTO-ROBOTICS-CAD.md) are the arm's own, so ChargingField stops drawing its simple riser and trunk once the
 *     CAD arm is in (useDepotCad there);
 *   - OTTO-WASH: nothing. Its rails, anchor plates and drag chain are the machine's, so WashBays stops drawing its
 *     simple rails once the CAD machine is in.
 */

/** The OTTO-CLEAN ARM's canopy steel in the CAD: the canopy draws it. */
export const CLEAN_CANOPY_STEEL: readonly string[] = ['CLN-HDR', 'CLN-COL', 'CLN-CLP'];
export const DEPOT_CAD_OPTIONS: Readonly<Record<RobotKey, DepotCadOptions>> = {
  // the deck is MOUNT_HEIGHT_M under J1 (the CAD's origin): the channel's cover plates lie flush in it
  charge_arm: { deckY: -MOUNT_HEIGHT_M },
  clean_arm: { exclude: (id) => CLEAN_CANOPY_STEEL.includes(id) },
  // the beacon is the status light; the stop lamps are lights of their own (red, green). The bay's floor is the CAD's
  // y = 0: the drag chain's trench cover and the supply pit's cover lie flush in it
  wash_gantry: { lights: { led: 0, led_red: 1, led_green: 2 }, deckY: 0 },
};

/**
 * How each kind's lines are drawn in the yard. Far (the depot model): round tubes of 8 sides, each end seated 3 mm into
 * its fitting, chains as boxes, and a chain wholly under the deck left out (the yard's ground hides it). Near (the detail
 * model, cadDetail.ts): 16 sides, seated 4 mm, each chain's links as the CAD draws them, and every line each chain carries,
 * in its lane. `under` is the deck's height in the robot's own frame (metres): MOUNT_HEIGHT_M under the charge arm's J1,
 * the floor of a wash bay. The cleaning arm has no chain.
 */
export const FAR_FLEX_OPTIONS: Readonly<Record<RobotKey, FlexFleetOptions>> = {
  charge_arm: { radial: 8, seat: 0.003, under: -MOUNT_HEIGHT_M },
  clean_arm: { radial: 8, seat: 0.003 },
  wash_gantry: { radial: 8, seat: 0.003, under: 0 },
};
export const NEAR_FLEX_OPTIONS: Readonly<Record<RobotKey, FlexFleetOptions>> = {
  charge_arm: { radial: 16, coilPerTurn: 16, seat: 0.004, contents: true, under: -MOUNT_HEIGHT_M },
  clean_arm: { radial: 16, coilPerTurn: 16, seat: 0.004, contents: true },
  wash_gantry: { radial: 16, coilPerTurn: 16, seat: 0.004, contents: true, under: 0 },
};

const loads = new Map<RobotKey, Promise<DepotCad>>();
const loaded = new Map<RobotKey, DepotCad>();
const warned = new Set<RobotKey>();
const detailLoads = new Map<RobotKey, Promise<DepotCad>>();
const detailLoaded = new Map<RobotKey, DepotCad>();

/** Fetch, parse and cut one robot's depot model, once per page. */
export function loadDepotCad(robot: RobotKey, fetcher: typeof fetch = fetch): Promise<DepotCad> {
  let p = loads.get(robot);
  if (!p) {
    p = fetcher(cadUrl(depotFile(robot)))
      .then((r) => {
        if (!r.ok) throw new Error(`${depotFile(robot)}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => parseGlb(b))
      .then((scene) => {
        const cad = buildDepotCad(robot, scene, DEPOT_CAD_OPTIONS[robot]);
        loaded.set(robot, cad);
        return cad;
      });
    loads.set(robot, p);
  }
  return p;
}

/**
 * A robot kind's CAD once it has loaded: null until then, and null for good if it cannot load (the robot components
 * then keep the procedural model, and say so once in the console).
 */
export function useDepotCad(robot: RobotKey): DepotCad | null {
  const [cad, setCad] = useState<DepotCad | null>(() => loaded.get(robot) ?? null);
  useEffect(() => {
    if (cad) return;
    let live = true;
    loadDepotCad(robot).then(
      (c) => { if (live) setCad(c); },
      (err: unknown) => {
        if (warned.has(robot)) return;
        warned.add(robot);
        console.warn(`[depot] the ${robot} CAD did not load, so the yard draws its simple model:`, err);
      },
    );
    return () => { live = false; };
  }, [robot, cad]);
  return cad;
}

/**
 * A robot kind's DETAIL model (public/cad/<robot>.near.glb): every visible part to the last screw, fine curves, real chain
 * links with their cables (robotics/cadDetail.ts says which robots it draws). Fetched the first time a robot of the kind
 * comes into detail range, once per page, and cut into instanced parts as the depot model is, with indexed buffers. Its
 * nodes and joints are the depot model's, so a robot's one skeleton poses both (cadDetail.test.ts holds them equal).
 */
export function loadDetailCad(robot: RobotKey, fetcher: typeof fetch = fetch): Promise<DepotCad> {
  let p = detailLoads.get(robot);
  if (!p) {
    p = fetcher(cadUrl(nearFile(robot)))
      .then((r) => {
        if (!r.ok) throw new Error(`${nearFile(robot)}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => parseGlb(b))
      .then((scene) => {
        const cad = buildDepotCad(robot, scene, { ...DEPOT_CAD_OPTIONS[robot], indexed: true });
        detailLoaded.set(robot, cad);
        return cad;
      });
    detailLoads.set(robot, p);
  }
  return p;
}

/**
 * A robot kind's detail model once `wanted` and loaded: null until then, and null for good if it cannot load (the depot
 * model then draws every robot of the kind, as before, and the console says so once).
 */
export function useDetailCad(robot: RobotKey, wanted: boolean): DepotCad | null {
  const [cad, setCad] = useState<DepotCad | null>(() => detailLoaded.get(robot) ?? null);
  useEffect(() => {
    if (cad || !wanted) return;
    let live = true;
    loadDetailCad(robot).then(
      (c) => { if (live) setCad(c); },
      (err: unknown) => {
        const key = `${robot}:detail` as RobotKey;
        if (warned.has(key)) return;
        warned.add(key);
        console.warn(`[depot] the ${robot} detail CAD did not load, so the yard draws its depot model up close too:`, err);
      },
    );
    return () => { live = false; };
  }, [robot, cad, wanted]);
  return cad;
}

