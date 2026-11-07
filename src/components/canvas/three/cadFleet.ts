import { useEffect, useState } from 'react';
import { buildDepotCad, depotFile, parseGlb, type DepotCad, type DepotCadOptions } from '@/lib/robotics/cadDepot';
import { cadUrl, type RobotKey } from '@/lib/robotics/catalog';

/**
 * THE YARD'S ROBOTS ARE THE ENGINEERING CAD. Each robot kind's depot model (public/cad/<robot>.depot.glb, from
 * cad/build.py) is fetched once, cut into instanced parts (robotics/cadDepot.ts), and drawn by the robot components
 * in place of the simple procedural model they drew before. Until it has loaded, or if it cannot load, the
 * procedural model stays: the yard is never empty of robots.
 *
 * What the site draws itself is left out of the CAD here, so nothing is drawn twice:
 *   - OTTO-CLEAN ARM: its header beam, drop column and clamps are the canopy's steel, drawn by SolarCanopy with the
 *     canopy (from the same cleanArmSpec numbers);
 *   - OTTO-CHARGE ARM: nothing. Its riser, cable trunk and mount plate are the arm's own, so ChargingField stops
 *     drawing its simple riser and trunk once the CAD arm is in (useDepotCad there);
 *   - OTTO-WASH: nothing. Its rails, anchor plates and drag chain are the machine's, so WashBays stops drawing its
 *     simple rails once the CAD machine is in.
 */

/** The OTTO-CLEAN ARM's canopy steel in the CAD: the canopy draws it. */
export const CLEAN_CANOPY_STEEL: readonly string[] = ['CLN-HDR', 'CLN-COL', 'CLN-CLP'];
/** The OTTO-WASH brushes: each turns on its own shaft, so each is its own segment. */
export const WASH_BRUSH_PARTS: readonly string[] = ['WSH-TBR', 'WSH-SBRL', 'WSH-SBRR'];

export const DEPOT_CAD_OPTIONS: Readonly<Record<RobotKey, DepotCadOptions>> = {
  charge_arm: {},
  clean_arm: { exclude: (id) => CLEAN_CANOPY_STEEL.includes(id) },
  // the beacon is the status light; the stop lamps are lights of their own (red, green)
  wash_gantry: { ownSegment: (id) => WASH_BRUSH_PARTS.includes(id), lights: { led: 0, led_red: 1, led_green: 2 } },
};

const loads = new Map<RobotKey, Promise<DepotCad>>();
const loaded = new Map<RobotKey, DepotCad>();
const warned = new Set<RobotKey>();

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
