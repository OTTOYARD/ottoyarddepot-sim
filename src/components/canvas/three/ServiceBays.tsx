import { useMemo } from 'react';
import * as THREE from 'three';
import {
  OPS_SHELL, LIFT_POST_OFFSET, LIFT_POST_SIZE, SERVICE_CASEWORK_DEPTH, PARTITION_T,
} from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';
import { StaticBatch } from './staticBatch';
import { liftBlue, toolRed, darkSteel, galvanizedSteel, rubberBlack, safetyYellowPaint } from './buildingSkin';

/**
 * Service-bay equipment inside the operations building: a two-post lift either
 * side of each bay's drive line (the car drives between the posts and parks
 * over the folded arms), a red tool chest and a tyre rack against the bay's
 * west partition, hose reels on the ceiling. Every footprint here is also in
 * structurePlan.bayEquipmentSolids, which the replay clearance test drives
 * every recorded car against.
 */
export function ServiceBays() {
  const geos = useMemo(() => build(), []);
  const mats = useMemo<Record<string, THREE.Material>>(() => ({
    lift: liftBlue(), red: toolRed(), steel: darkSteel(), galv: galvanizedSteel(),
    rubber: rubberBlack(), yellow: safetyYellowPaint(),
  }), []);
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
  const f = OPS_SHELL.footprint;
  const deck = OPS_SHELL.height - OPS_SHELL.parapet;
  const y = BAY_STALL_Y;
  const hp = LIFT_POST_SIZE / 2;
  for (const bay of OPS_SHELL.bays) {
    // ── two-post lift ──
    for (const side of [-1, 1]) {
      const x = bay.x + side * LIFT_POST_OFFSET;
      b.planBox('lift', { x0: x - hp, x1: x + hp, y0: y - hp, y1: y + hp }, 0.28, 7.6);
      b.planBox('steel', { x0: x - hp - 0.3, x1: x + hp + 0.3, y0: y - hp - 0.3, y1: y + hp + 0.3 }, 0.28, 0.45); // base plate
      // carriage + two swing arms folded fore/aft along the car's flank, low
      b.planBox('steel', { x0: x - hp - 0.05, x1: x + hp + 0.05, y0: y - hp - 0.05, y1: y + hp + 0.05 }, 1.0, 1.9);
      const armX = x - side * 1.2; // inboard of the post, still outboard of the body (2.1)
      for (const dy of [-2.6, 2.6]) {
        b.planBox('steel', { x0: armX - 0.18, x1: armX + 0.18, y0: Math.min(y, y + dy), y1: Math.max(y, y + dy) }, 0.42, 0.62);
        b.planBox('rubber', { x0: armX - 0.26, x1: armX + 0.26, y0: y + dy - 0.26, y1: y + dy + 0.26 }, 0.62, 0.72);
      }
      // hydraulic power unit on the west post
      if (side === -1) b.planBox('yellow', { x0: x + hp, x1: x + hp + 0.6, y0: y - 0.4, y1: y + 0.4 }, 3.2, 4.6);
    }
    // overhead crossbeam tying the posts (clear height 3.5 m)
    b.planBox('lift', { x0: bay.x - LIFT_POST_OFFSET - hp, x1: bay.x + LIFT_POST_OFFSET + hp, y0: y - 0.35, y1: y + 0.35 }, 7.3, 7.9);

    // ── casework against the west partition ──
    const cx0 = bay.x0 + PARTITION_T / 2 + 0.2, cx1 = cx0 + SERVICE_CASEWORK_DEPTH;
    const chest = { x0: cx0, x1: cx1, y0: f.y1 - OPS_SHELL.wallT - 6.5, y1: f.y1 - OPS_SHELL.wallT - 3.0 };
    b.planBox('red', chest, 0.28, 3.4);
    for (let k = 1; k <= 5; k++) b.planBox('galv', { x0: cx1 - 0.02, x1: cx1 + 0.04, y0: chest.y0 + 0.3, y1: chest.y1 - 0.3 }, 0.28 + k * 0.55, 0.36 + k * 0.55);
    const rack = { x0: cx0, x1: cx1, y0: f.y0 + OPS_SHELL.wallT + 2.5, y1: f.y0 + OPS_SHELL.wallT + 8.5 };
    for (const z of [0.3, 2.3, 4.3]) b.planBox('galv', { ...rack }, z, z + 0.15);
    for (const yy of [rack.y0, rack.y1 - 0.15]) b.planBox('galv', { x0: rack.x0, x1: rack.x1, y0: yy, y1: yy + 0.15 }, 0.28, 5.2);
    for (let t = 0; t < 4; t++) {
      for (const z of [0.45, 2.45]) {
        b.hCylinder('rubber', 150 - (cx0 + cx1) / 2, z + 0.75, 110 - (rack.y0 + 0.9 + t * 1.45), 0.72, 0.52, 'x', 14);
      }
    }
    // ceiling hose reels over the drive line (fore and aft of the lift beam)
    for (const yy of [y - 8, y + 8]) {
      b.hCylinder('galv', 150 - bay.x, deck - 1.4, 110 - yy, 0.45, 0.6, 'x', 12);
      b.planBox('steel', { x0: bay.x - 0.1, x1: bay.x + 0.1, y0: yy - 0.1, y1: yy + 0.1 }, deck - 1.0, deck - 0.6);
    }
  }
  return b.build();
}
