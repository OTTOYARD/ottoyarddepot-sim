import { useMemo } from 'react';
import * as THREE from 'three';
import { WASH_SHELL } from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';
import { WASH_GANTRY } from '@/lib/ottoWash/washSpec';
import { BuildingShell } from './BuildingShell';
import { StaticBatch } from './staticBatch';
import { MATERIALS } from './materials';
import { galvanizedSteel, darkSteel, litInterior, safetyYellowPaint } from './buildingSkin';

/**
 * The wash hall: three PULL-THROUGH bays (structurePlan.WASH_SHELL). This draws the
 * hall and what stays put in each bay: the two floor rails the rollover machine rides
 * and the trench drain down the drive line. The machine itself moves, so it is drawn
 * apart, by WashGantry.tsx, from the motion driver's session. Bays beyond `count` keep
 * their doors shut.
 */
export function WashBays({ count }: { count: number }) {
  const geos = useMemo(() => build(count), [count]);
  const mats = useMemo<Record<string, THREE.Material>>(() => ({
    galv: galvanizedSteel(),
    steel: darkSteel(),
    clere: litInterior(),
    yellow: safetyYellowPaint(),
    pv: MATERIALS.solarPanelGlass(),
  }), []);
  return (
    <group>
      <BuildingShell shell={WASH_SHELL} skin="silver" openDoors={count} />
      {[...geos.entries()].map(([k, g]) => (
        <mesh key={k} geometry={g} material={mats[k]} castShadow={k !== 'clere'} receiveShadow />
      ))}
    </group>
  );
}

function build(count: number): Map<string, THREE.BufferGeometry> {
  const b = new StaticBatch();
  const f = WASH_SHELL.footprint;
  const deck = WASH_SHELL.height - WASH_SHELL.parapet;
  const R = WASH_GANTRY.rail;
  WASH_SHELL.bays.forEach((bay, i) => {
    if (i >= count) return; // a shut bay is dark and empty
    // the rollover machine's two floor rails, on a low plinth, with an end stop at each end
    for (const side of [-1, 1]) {
      const x = bay.x + side * WASH_GANTRY.legX;
      const y0 = BAY_STALL_Y + R.from, y1 = BAY_STALL_Y + R.to;
      b.planBox('galv', { x0: x - 0.7, x1: x + 0.7, y0, y1 }, 0.28, 0.32);
      b.planBox('steel', { x0: x - R.w / 2, x1: x + R.w / 2, y0, y1 }, 0.32, 0.32 + R.h);
      for (const y of [y0, y1]) b.planBox('yellow', { x0: x - 0.6, x1: x + 0.6, y0: y - 0.3, y1: y + 0.3 }, 0.32, 0.95);
    }
    // trench drain grate down the drive line (flush with the floor)
    b.planBox('steel', { x0: bay.x - 0.55, x1: bay.x + 0.55, y0: f.y0 + WASH_SHELL.wallT + 1.5, y1: f.y1 - WASH_SHELL.wallT - 1.5 }, 0.28, 0.295);
  });
  // clerestory: translucent daylight panels high on the west and east walls
  for (const x of [f.x0 - 0.06, f.x1 - 0.1]) {
    b.planBox('clere', { x0: x, x1: x + 0.16, y0: f.y0 + 2, y1: f.y1 - 2 }, 6.0, 8.6);
  }
  // rooftop PV, south-facing tilt, clear of the parapet
  for (let x = f.x0 + 2; x + 4.2 <= f.x1 - 2; x += 4.6) {
    for (let y = f.y0 + 3; y + 4 <= f.y1 - 2.5; y += 6) {
      const g = new THREE.BoxGeometry(4.2, 0.12, 4.0);
      g.rotateX(-0.17);
      g.translate(150 - (x + 2.1), deck + 0.9, 110 - (y + 2));
      b.geometry('pv', g);
      b.planBox('galv', { x0: x + 0.3, x1: x + 0.5, y0: y + 3.2, y1: y + 3.4 }, deck, deck + 1.2);
      b.planBox('galv', { x0: x + 3.7, x1: x + 3.9, y0: y + 3.2, y1: y + 3.4 }, deck, deck + 1.2);
    }
  }
  return b.build();
}
