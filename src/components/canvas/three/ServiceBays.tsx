import { useMemo } from 'react';
import * as THREE from 'three';
import { OPS_SHELL } from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';
import { StaticBatch } from './staticBatch';
import { darkSteel, galvanizedSteel } from './buildingSkin';

/**
 * Service-bay fittings inside the operations building that are the building's, not a machine's: the hose reels on the
 * ceiling over each bay's drive line. Each bay's machine is OTTO-TIRE (TireBay.tsx, drawn from its CAD): its lift in the
 * floor, its portal on 2 floor rails, its wheel and socket racks, and its cabinets on the north wall. It replaced the
 * two-post lift and the casework this file drew until 2026-11-17. The reels hang 4.9 m up and more, over everything the
 * machine lifts or moves (its highest moving part is under 4 m).
 */
export function ServiceBays() {
  const geos = useMemo(() => build(), []);
  const mats = useMemo<Record<string, THREE.Material>>(() => ({ steel: darkSteel(), galv: galvanizedSteel() }), []);
  return (
    <group>
      {[...geos.entries()].map(([k, g]) => (
        <mesh key={k} geometry={g} material={mats[k]} castShadow receiveShadow />
      ))}
    </group>
  );
}

function build(): Map<string, THREE.BufferGeometry> {
  const b = new StaticBatch();
  const deck = OPS_SHELL.height - OPS_SHELL.parapet;
  const y = BAY_STALL_Y;
  for (const bay of OPS_SHELL.bays) {
    // ceiling hose reels over the drive line, fore and aft of the bay's middle
    for (const yy of [y - 8, y + 8]) {
      b.hCylinder('galv', 150 - bay.x, deck - 1.4, 110 - yy, 0.45, 0.6, 'x', 12);
      b.planBox('steel', { x0: bay.x - 0.1, x1: bay.x + 0.1, y0: yy - 0.1, y1: yy + 0.1 }, deck - 1.0, deck - 0.6);
    }
  }
  return b.build();
}
