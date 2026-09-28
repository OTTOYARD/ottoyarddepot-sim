import { useMemo } from 'react';
import * as THREE from 'three';
import { useDepotStore } from '@/store/depotStore';
import {
  solidWallRuns, doorSpan, PARTITION_T, type ShellDef, type Rect,
} from '@/lib/structurePlan';
import { StaticBatch } from './staticBatch';
import {
  wallGraphite, wallSilver, interiorBlock, shopFloor, washFloor, roofMembrane, doorSlats,
  hazardBand, aluminiumTrim, darkSteel, galvanizedSteel, ledPanel, litInterior, statusLamp,
  signTexture,
} from './buildingSkin';

/**
 * A pull-through building, drawn from its ShellDef — walls, real door OPENINGS
 * (both ends), lintels, parapet, roof, partitions, lit interior, roll-up doors.
 *
 * The openings come from structurePlan.ts, which cuts them on the bay drive
 * lines; structureClearance.replay.test.ts replays captured runs against these
 * same rectangles. So what a car drives through here is exactly what was tested.
 *
 * Plan -> world: x_w = 150 - x, z_w = 110 - y. A shell's SOUTH wall (plan y1) is
 * the forecourt entry face; its exterior normal points to world -Z. The NORTH
 * wall (plan y0) is the rear-apron exit face; exterior normal +Z.
 */

const LINER = 0.14;          // interior liner panel thickness
const ROOF_T = 0.6;
const FLOOR_TOP = 0.28;      // just proud of the asphalt deck (0.26)
const HOOD_DEPTH = 1.0;
const HOOD_H = 1.3;

type Skin = 'graphite' | 'silver';

export interface BuildingShellProps {
  shell: ShellDef;
  skin: Skin;
  /** doors with index >= this are shut (a bay the config does not staff) */
  openDoors?: number;
  /** rect to leave OUT of the south wall because another component glazes it (the office) */
  southGlazing?: Rect;
}

export function BuildingShell({ shell, skin, openDoors = Infinity, southGlazing }: BuildingShellProps) {
  const geos = useMemo(() => buildShell(shell, openDoors, southGlazing), [shell, openDoors, southGlazing]);
  const mats = useMemo<Record<string, THREE.Material>>(() => ({
    skin: skin === 'graphite' ? wallGraphite() : wallSilver(),
    liner: litInterior(),
    block: interiorBlock(),
    floor: shell.id === 'wash' ? washFloor() : shopFloor(),
    roof: roofMembrane(),
    slats: doorSlats(),
    hazard: hazardBand(),
    trim: aluminiumTrim(),
    steel: darkSteel(),
    galv: galvanizedSteel(),
    led: ledPanel(2.4),
    pack: ledPanel(3.2),
  }), [skin, shell.id]);

  return (
    <group>
      {[...geos.entries()].map(([key, g]) => (
        <mesh
          key={key}
          geometry={g}
          material={mats[key]}
          castShadow={key === 'skin' || key === 'roof' || key === 'steel' || key === 'trim'}
          receiveShadow={key !== 'led' && key !== 'pack'}
        />
      ))}
      <DoorSigns shell={shell} />
      <BayStatusLamps shell={shell} />
    </group>
  );
}

function buildShell(s: ShellDef, openDoors: number, southGlazing?: Rect): Map<string, THREE.BufferGeometry> {
  const b = new StaticBatch();
  const f = s.footprint;
  const deck = s.height - s.parapet;
  const t = s.wallT;
  const outer = t - LINER;

  // ── floor + roof ────────────────────────────────────────────────────────────
  b.planBox('floor', { x0: f.x0 + t, x1: f.x1 - t, y0: f.y0 + t, y1: f.y1 - t }, 0, FLOOR_TOP);
  b.planBox('roof', f, deck - ROOF_T, deck);

  // ── south + north walls: solid runs full height, lintels over each opening ──
  for (const side of ['south', 'north'] as const) {
    const yOut = side === 'south' ? f.y1 : f.y0;          // exterior face
    const dir = side === 'south' ? -1 : 1;                 // plan direction INTO the building
    const band = (d0: number, d1: number) => {
      const a = yOut + dir * d0, c = yOut + dir * d1;
      return { y0: Math.min(a, c), y1: Math.max(a, c) };
    };
    const skinBand = band(0, outer);
    const linerBand = band(outer, t);
    for (const [x0, x1] of solidWallRuns(s)) {
      if (side === 'south' && southGlazing) {
        // leave the glazed office bay open; the office component fills it
        const gx0 = Math.max(x0, southGlazing.x0), gx1 = Math.min(x1, southGlazing.x1);
        if (gx1 > gx0) {
          if (gx0 > x0) wallRun(b, x0, gx0, skinBand, linerBand, deck);
          if (x1 > gx1) wallRun(b, gx1, x1, skinBand, linerBand, deck);
          continue;
        }
      }
      wallRun(b, x0, x1, skinBand, linerBand, deck);
    }
    s.doors.forEach((d, i) => {
      const [x0, x1] = doorSpan(d);
      b.planBox('skin', { x0, x1, ...skinBand }, d.height, deck);
      b.planBox('liner', { x0, x1, ...linerBand }, d.height, deck);
      doorHardware(b, d.x, x0, x1, d.height, yOut, dir, i >= openDoors);
    });
  }

  // ── west + east walls (full height, no openings) ───────────────────────────
  b.planBox('skin', { x0: f.x0, x1: f.x0 + outer, y0: f.y0, y1: f.y1 }, 0, deck);
  b.planBox('liner', { x0: f.x0 + outer, x1: f.x0 + t, y0: f.y0 + t, y1: f.y1 - t }, 0, deck);
  b.planBox('skin', { x0: f.x1 - outer, x1: f.x1, y0: f.y0, y1: f.y1 }, 0, deck);
  b.planBox('liner', { x0: f.x1 - t, x1: f.x1 - outer, y0: f.y0 + t, y1: f.y1 - t }, 0, deck);

  // ── partitions ─────────────────────────────────────────────────────────────
  for (const px of s.partitions) {
    b.planBox('block', { x0: px - PARTITION_T / 2, x1: px + PARTITION_T / 2, y0: f.y0 + t, y1: f.y1 - t }, 0, deck - ROOF_T);
  }

  // ── parapet + aluminium coping ──────────────────────────────────────────────
  const par = [
    { x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y0 + t },
    { x0: f.x0, x1: f.x1, y0: f.y1 - t, y1: f.y1 },
    { x0: f.x0, x1: f.x0 + t, y0: f.y0, y1: f.y1 },
    { x0: f.x1 - t, x1: f.x1, y0: f.y0, y1: f.y1 },
  ];
  for (const r of par) {
    b.planBox('skin', r, deck, s.height);
    b.planBox('trim', { x0: r.x0 - 0.12, x1: r.x1 + 0.12, y0: r.y0 - 0.12, y1: r.y1 + 0.12 }, s.height, s.height + 0.16);
  }

  // ── downspouts at the four corners ─────────────────────────────────────────
  for (const [x, y] of [[f.x0 + 0.8, f.y0 - 0.25], [f.x1 - 0.8, f.y0 - 0.25], [f.x0 + 0.8, f.y1 + 0.25], [f.x1 - 0.8, f.y1 + 0.25]]) {
    b.planBox('galv', { x0: x - 0.2, x1: x + 0.2, y0: y - 0.2, y1: y + 0.2 }, 0.1, deck);
  }

  // ── interior: ceiling LED panels down each bay, over the drive line ─────────
  for (const bay of s.bays) {
    for (const yy of [f.y0 + 7, (f.y0 + f.y1) / 2, f.y1 - 7]) {
      for (const dx of [-3.4, 3.4]) {
        b.planBox('led', { x0: bay.x + dx - 0.6, x1: bay.x + dx + 0.6, y0: yy - 2.2, y1: yy + 2.2 }, deck - ROOF_T - 0.12, deck - ROOF_T - 0.02);
      }
    }
    // painted bay boundary + centre stop line on the floor (flush, liner white)
    b.planBox('liner', { x0: bay.x - 5.6, x1: bay.x - 5.35, y0: f.y0 + t + 0.5, y1: f.y1 - t - 0.5 }, FLOOR_TOP, FLOOR_TOP + 0.01);
    b.planBox('liner', { x0: bay.x + 5.35, x1: bay.x + 5.6, y0: f.y0 + t + 0.5, y1: f.y1 - t - 0.5 }, FLOOR_TOP, FLOOR_TOP + 0.01);
  }

  return b.build();
}

/** One solid run of wall: outer skin + interior liner, floor to roof deck. */
function wallRun(b: StaticBatch, x0: number, x1: number,
  skinBand: { y0: number; y1: number }, linerBand: { y0: number; y1: number }, deck: number) {
  b.planBox('skin', { x0, x1, ...skinBand }, 0, deck);
  b.planBox('liner', { x0, x1, ...linerBand }, 0.28, deck);
}

/**
 * Roll-up door hardware on the EXTERIOR face: coil hood above the opening,
 * guide channels down both jambs, the curtain's bottom slats showing below the
 * hood (raised) — or the full curtain (shut), hazard-banded jamb guards, and a
 * wall pack over the hood.
 */
function doorHardware(b: StaticBatch, x: number, x0: number, x1: number, h: number, yOut: number, dir: number, shut: boolean) {
  const outBand = (d0: number, d1: number) => {
    const a = yOut - dir * d0, c = yOut - dir * d1; // negative d = inside
    return { y0: Math.min(a, c), y1: Math.max(a, c) };
  };
  // coil hood
  b.planBox('steel', { x0: x0 - 0.45, x1: x1 + 0.45, ...outBand(0, HOOD_DEPTH) }, h + 0.15, h + 0.15 + HOOD_H);
  // guide channels
  for (const jx of [x0 - 0.2, x1 + 0.2]) {
    b.planBox('steel', { x0: jx - 0.2, x1: jx + 0.2, ...outBand(0, 0.35) }, 0.28, h + 0.2);
    // hazard-banded jamb guard (bottom 1.6u)
    b.planBox('hazard', { x0: jx - 0.22, x1: jx + 0.22, ...outBand(0.35, 0.62) }, 0.28, 1.9);
  }
  // curtain: a raised door shows ~0.9u of slats under the hood; a shut door fills the opening
  const cur = outBand(-0.05, 0.12);
  if (shut) b.planBox('slats', { x0, x1, ...cur }, 0.28, h);
  else b.planBox('slats', { x0, x1, ...cur }, h - 0.9, h);
  // bottom bar of a raised curtain
  if (!shut) b.planBox('steel', { x0, x1, ...outBand(-0.08, 0.16) }, h - 1.0, h - 0.9);
  // wall pack over the hood
  b.planBox('steel', { x0: x - 0.9, x1: x + 0.9, ...outBand(0, 0.6) }, h + 1.9, h + 2.4);
  b.planBox('pack', { x0: x - 0.75, x1: x + 0.75, ...outBand(0.1, 0.62) }, h + 1.84, h + 1.92);
}

/** Bay name panels on the parapet over each south door ("SERVICE 1", "WASH 3").
 *  On the PARAPET because that is the one band every door has clear above its
 *  coil hood: the wash hall's lintel is only 1.3u, fully taken by the hood. */
function DoorSigns({ shell }: { shell: ShellDef }) {
  const signs = useMemo(() => shell.doors.map((d, i) => {
    const label = `${d.kind === 'service' ? 'SERVICE' : 'WASH'} ${i + 1}`;
    const tex = signTexture(label, { fg: '#e9edf2', bg: '#15181d', w: 512, h: 128 });
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.1, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.35 });
    const wx = 150 - d.x;
    const wz = 110 - shell.footprint.y1 - 0.06;
    const wy = shell.height - shell.parapet / 2;
    return { key: d.bayId, m, pos: [wx, wy, wz] as [number, number, number], h: Math.min(0.7, shell.parapet - 0.16) };
  }), [shell]);
  return (
    <group>
      {signs.map((s) => (
        <mesh key={s.key} position={s.pos} rotation={[0, Math.PI, 0]} material={s.m}>
          <planeGeometry args={[s.h * 4, s.h]} />
        </mesh>
      ))}
    </group>
  );
}

/** Green = bay free, amber = occupied/reserved, red = offline. Read live from the depot store. */
function BayStatusLamps({ shell }: { shell: ShellDef }) {
  const key = useDepotStore((st) => shell.bays.map((b) => st.stalls.find((x) => x.id === b.id)?.status ?? 'none').join('|'));
  const statuses = key.split('|');
  return (
    <group>
      {shell.doors.map((d, i) => {
        const s = statuses[i];
        const col = s === 'available' ? '#2fd07a' : s === 'offline' ? '#ff3b3b' : s === 'none' ? '#3a3f47' : '#ffb020';
        const [, x1] = doorSpan(d);
        return (
          <mesh key={d.bayId} position={[150 - (x1 + 1.1), 5.2, 110 - shell.footprint.y1 - 0.3]} material={statusLamp(col)}>
            <boxGeometry args={[0.5, 0.9, 0.3]} />
          </mesh>
        );
      })}
    </group>
  );
}
