import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import {
  WEST_AISLE_X, EAST_AISLE_X, NORTH_LANE_Y, SOUTH_LANE_Y, REAR_LANE_Y, FORECOURT_Y,
  WEST_LINK_X, GAP_LANES, TEMP_LANE_X, CANOPIES, INGRESS, EGRESS,
  TEMP_AISLE, EAST_AVENUE, N1_LANE_Y, PARK_RUNS,
} from '@/lib/sitePlan';
import { toWorld, yawFromCompassDeg } from './coordUtils';

/**
 * Continuous-flow lane markings:
 *  - flanking PULL-OUT lanes beside every canopy (northbound to the collector)
 *  - two-way NORTH + SOUTH collectors (directional arrows in both lanes)
 *  - FORECOURT throat arrows into every pull-through bay
 *  - 30ft REAR APRON arrows (left to the west link, right to the east aisle)
 *  - one-way west (N) / east (S) aisles, gate throats
 */

function Arrow({ x, y, headingDeg }: { x: number; y: number; headingDeg: number }) {
  const mat = useMemo(() => MATERIALS.laneMarkingWhite(), []);
  const [wx, , wz] = toWorld({ x, y }, 0);
  // 0=N, 90=E, 180=S, 270=W. The bearing->yaw conversion lives in coordUtils
  // with toWorld: this file's inline (deg * PI/180) predated d879a23's X
  // negation, so every east/west arrow pointed AGAINST its own one-way lane.
  const rotY = yawFromCompassDeg(headingDeg);
  return (
    <group position={[wx, 0.06, wz]} rotation={[0, rotY, 0]}>
      <mesh material={mat}><boxGeometry args={[0.9, 0.04, 4.6]} /></mesh>
      <mesh position={[-1.05, 0, 1.45]} rotation={[0, 0.66, 0]} material={mat}>
        <boxGeometry args={[0.9, 0.04, 2.6]} />
      </mesh>
      <mesh position={[1.05, 0, 1.45]} rotation={[0, -0.66, 0]} material={mat}>
        <boxGeometry args={[0.9, 0.04, 2.6]} />
      </mesh>
    </group>
  );
}

export function DriveAisles() {
  const dashes = useMemo(() => {
    const segs: { x: number; y: number; horiz: boolean }[] = [];
    // west + east aisle edges.
    // The east edge was hardcoded at `EAST_AISLE_X - 6`, and the collector sweeps
    // stopped at hand-typed x values (262 / 250 / 196) chosen for an older column
    // layout. Both now derive from EAST_AVENUE, so the edge dash sits on the real
    // pavement edge and the sweeps reach the real avenue.
    const eastEdge = EAST_AVENUE.x0;
    const eastEnd = EAST_AVENUE.centre;
    for (let y = 86; y <= 196; y += 9) segs.push({ x: WEST_AISLE_X + 6, y, horiz: false });
    for (let y = 52; y <= 196; y += 9) segs.push({ x: eastEdge, y, horiz: false });
    // north collector: edge dashes + center split (two-way)
    for (let x = 44; x <= eastEnd - 12; x += 9) segs.push({ x, y: NORTH_LANE_Y - 6, horiz: true });
    for (let x = 44; x <= eastEnd - 12; x += 9) segs.push({ x, y: NORTH_LANE_Y + 6, horiz: true });
    for (let x = 48; x <= eastEnd - 16; x += 12) segs.push({ x, y: NORTH_LANE_Y, horiz: true });
    // temp block aisle edges — the aisle the founder built to 24.39 ft. It had no
    // markings at all in 3D because it had no lane in the graph.
    for (let y = 86; y <= 160; y += 9) {
      segs.push({ x: TEMP_AISLE.x0, y, horiz: false });
      segs.push({ x: TEMP_AISLE.x1, y, horiz: false });
    }
    // N1 approach edges
    {
      const n1 = PARK_RUNS.find((r) => r.id === 'N1')!;
      for (let x = n1.x0 - 4; x <= eastEnd - 8; x += 9) {
        segs.push({ x, y: N1_LANE_Y - 5.3, horiz: true });
        segs.push({ x, y: N1_LANE_Y + 5.3, horiz: true });
      }
    }
    // forecourt divider
    for (let x = 66; x <= 218; x += 7) segs.push({ x, y: FORECOURT_Y + 6.5, horiz: true });
    // south collector: edges + center split (two-way)
    for (let x = 44; x <= eastEnd - 12; x += 9) segs.push({ x, y: SOUTH_LANE_Y - 7, horiz: true });
    for (let x = 44; x <= eastEnd - 12; x += 9) segs.push({ x, y: SOUTH_LANE_Y + 7, horiz: true });
    for (let x = 48; x <= eastEnd - 16; x += 12) segs.push({ x, y: SOUTH_LANE_Y, horiz: true });
    // rear apron south edge (the bays' rear wall line is the north edge)
    for (let x = 70; x <= 260; x += 9) segs.push({ x, y: 26, horiz: true });
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.3, 0.04, 4.2), MATERIALS.laneMarkingWhite(), segs.length,
    );
    const d = new THREE.Object3D();
    segs.forEach((s, i) => {
      const [wx, , wz] = toWorld({ x: s.x, y: s.y }, 0);
      d.position.set(wx, 0.05, wz);
      d.rotation.set(0, s.horiz ? Math.PI / 2 : 0, 0);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }, []);

  const gapLanes = [GAP_LANES.westOfA, GAP_LANES.AB, GAP_LANES.BC, GAP_LANES.eastOfC];

  return (
    <group>
      <primitive object={dashes} />

      {/* west aisle — northbound */}
      {[176, 146, 116, 90].map((y) => <Arrow key={`w${y}`} x={WEST_AISLE_X} y={y} headingDeg={0} />)}
      {/* canopy pull-out lanes — northbound to the collector */}
      {gapLanes.map((x) => (
        [100, 128, 156].map((y) => <Arrow key={`g${x}-${y}`} x={x} y={y} headingDeg={0} />)
      ))}
      {/* north collector — two-way (east lane / west lane) */}
      {[64, 112, 160, 208, 252].map((x) => <Arrow key={`ne${x}`} x={x} y={NORTH_LANE_Y + 3.2} headingDeg={90} />)}
      {[88, 136, 184, 232].map((x) => <Arrow key={`nw${x}`} x={x} y={NORTH_LANE_Y - 3.2} headingDeg={270} />)}
      {/* charging lanes — pull-forward guidance flanking every charger column,
          pointing north toward the collector / service & wash */}
      {CANOPIES.map((c) => (
        [c.cx - 7, c.cx + 7].map((x) => (
          [c.y + 26, c.y + 62].map((y) => <Arrow key={`cl${x}-${y}`} x={x} y={y} headingDeg={0} />)
        ))
      ))}
      {/* forecourt — entry guidance into each pull-through bay (approach + threshold) */}
      {[120, 138, 168, 186, 204].map((x) => <Arrow key={`f${x}`} x={x} y={FORECOURT_Y + 3} headingDeg={0} />)}
      {[120, 138, 168, 186, 204].map((x) => <Arrow key={`ft${x}`} x={x} y={FORECOURT_Y - 3.4} headingDeg={0} />)}
      {/* bay REAR exits — paired left/right arrows just out the rear door */}
      {[120, 138, 168, 186, 204].map((x) => (
        <group key={`rx${x}`}>
          <Arrow x={x - 3} y={21.5} headingDeg={270} />
          <Arrow x={x + 3} y={21.5} headingDeg={90} />
        </group>
      ))}
      {/* rear apron — through-traffic swings left (west link) or right (east aisle) */}
      {[225].map((x) => <Arrow key={`re${x}`} x={x} y={REAR_LANE_Y} headingDeg={90} />)}
      {[95].map((x) => <Arrow key={`rw${x}`} x={x} y={REAR_LANE_Y} headingDeg={270} />)}
      {/* west link — southbound from the apron to the collector */}
      <Arrow x={WEST_LINK_X} y={36} headingDeg={180} />
      <Arrow x={WEST_LINK_X} y={58} headingDeg={180} />
      {/* temp/overflow block — two-way central access aisle. The arrows sit IN their
          own lane (offset to the right of travel) rather than on the shared centreline,
          which is where the cars actually drive. */}
      <Arrow x={TEMP_LANE_X - 3.2} y={98} headingDeg={180} />
      <Arrow x={TEMP_LANE_X + 3.2} y={148} headingDeg={0} />
      {/* N1 approach — two-way, serving the overflow row from below */}
      <Arrow x={238} y={N1_LANE_Y + 3.2} headingDeg={90} />
      <Arrow x={262} y={N1_LANE_Y - 3.2} headingDeg={270} />
      {/* east aisle — southbound */}
      {[60, 100, 140].map((y) => <Arrow key={`e${y}`} x={EAST_AISLE_X} y={y} headingDeg={180} />)}
      {/* south collector — two-way */}
      {[64, 118, 164].map((x) => <Arrow key={`se${x}`} x={x} y={SOUTH_LANE_Y + 3.4} headingDeg={90} />)}
      {[90, 144].map((x) => <Arrow key={`sw${x}`} x={x} y={SOUTH_LANE_Y - 3.4} headingDeg={270} />)}
      {/* gate throats */}
      <Arrow x={INGRESS.x} y={198} headingDeg={0} />
      <Arrow x={EGRESS.x} y={192} headingDeg={180} />
    </group>
  );
}
