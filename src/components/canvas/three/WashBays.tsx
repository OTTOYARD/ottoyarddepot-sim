import { useMemo } from 'react';
import * as THREE from 'three';
import {
  WASH_SHELL, WASH_FRAME_DY, WASH_BRUSH_OFFSET, WASH_BRUSH_RADIUS, WASH_GANTRY_LEG_OFFSET,
  WASH_GANTRY_LEG, WASH_ARCH_INSET, WASH_ARCH_OFFSET,
} from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';
import { BuildingShell } from './BuildingShell';
import { StaticBatch } from './staticBatch';
import { MATERIALS } from './materials';
import { galvanizedSteel, darkSteel, brushFoam, litInterior, safetyYellowPaint } from './buildingSkin';

/**
 * The wash hall: three PULL-THROUGH bays (structurePlan.WASH_SHELL), each with
 * a pre-soak spray arch just inside the entry, two brush gantries straddling
 * the drive line (side brushes retracted outboard of the car, top brush above
 * roof height), a trench drain down the centre and a blower hood at the exit.
 * Bays beyond `count` keep their doors shut.
 */
export function WashBays({ count }: { count: number }) {
  const geos = useMemo(() => build(count), [count]);
  const mats = useMemo<Record<string, THREE.Material>>(() => ({
    galv: galvanizedSteel(),
    steel: darkSteel(),
    blue: brushFoam('#2a6fd6'),
    red: brushFoam('#c8313f'),
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
  const hl = WASH_GANTRY_LEG / 2;
  WASH_SHELL.bays.forEach((bay, i) => {
    if (i >= count) return; // a shut bay is dark and empty
    const wx = 150 - bay.x;
    for (const dy of [-WASH_FRAME_DY, WASH_FRAME_DY]) {
      const y = BAY_STALL_Y + dy;
      const wz = 110 - y;
      // gantry legs + top rail (clear height 3.3 m)
      for (const side of [-1, 1]) {
        const lx = bay.x + side * WASH_GANTRY_LEG_OFFSET;
        b.planBox('galv', { x0: lx - hl, x1: lx + hl, y0: y - hl, y1: y + hl }, 0.28, 7.2);
      }
      b.planBox('galv', { x0: bay.x - WASH_GANTRY_LEG_OFFSET - hl, x1: bay.x + WASH_GANTRY_LEG_OFFSET + hl, y0: y - 0.45, y1: y + 0.45 }, 6.9, 7.6);
      // side brushes, retracted outboard (hub + foam)
      for (const side of [-1, 1]) {
        const bx = 150 - (bay.x + side * WASH_BRUSH_OFFSET);
        b.cylinder(dy < 0 ? 'blue' : 'red', bx, 0.7, wz, WASH_BRUSH_RADIUS, 5.2, 18);
        b.cylinder('steel', bx, 5.9, wz, 0.18, 1.0, 8);
        b.planBox('steel', { x0: bay.x + side * WASH_BRUSH_OFFSET - 0.4, x1: bay.x + side * WASH_BRUSH_OFFSET + 0.4, y0: y - 0.4, y1: y + 0.4 }, 6.5, 6.9);
      }
      // top brush above roof height (car + sensor pod tops out at ~3.9u)
      b.hCylinder(dy < 0 ? 'blue' : 'red', wx, 5.7, wz, 0.75, 7.0, 'x', 18);
      b.planBox('steel', { x0: bay.x - 3.8, x1: bay.x + 3.8, y0: y - 0.15, y1: y + 0.15 }, 6.45, 6.9);
    }
    // pre-soak spray arch just inside the entry
    const ay = f.y1 - WASH_SHELL.wallT - WASH_ARCH_INSET;
    for (const side of [-1, 1]) b.cylinder('galv', 150 - (bay.x + side * WASH_ARCH_OFFSET), 0.28, 110 - ay, 0.18, 6.4, 10);
    b.hCylinder('galv', wx, 6.6, 110 - ay, 0.18, WASH_ARCH_OFFSET * 2 + 0.4, 'x', 10);
    for (let k = -4; k <= 4; k++) b.planBox('yellow', { x0: bay.x + k * 1.3 - 0.1, x1: bay.x + k * 1.3 + 0.1, y0: ay - 0.1, y1: ay + 0.1 }, 6.2, 6.45);
    // blower hood over the exit end
    const by = f.y0 + WASH_SHELL.wallT + 4;
    b.planBox('steel', { x0: bay.x - 5.2, x1: bay.x + 5.2, y0: by - 1.0, y1: by + 1.0 }, 6.2, 7.2);
    for (const side of [-1, 1]) b.planBox('steel', { x0: bay.x + side * 5.0 - 0.35, x1: bay.x + side * 5.0 + 0.35, y0: by - 0.35, y1: by + 0.35 }, deck - 1.2, deck - 0.6);
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
