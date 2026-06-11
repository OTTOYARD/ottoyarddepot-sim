import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import {
  WEST_AISLE_X, EAST_AISLE_X, NORTH_LANE_Y, SOUTH_LANE_Y, REAR_LANE_Y, FORECOURT_Y,
  WEST_LINK_X, GAP_LANES, TEMP_LANE_X, INGRESS, EGRESS,
} from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

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
  const rotY = (headingDeg * Math.PI) / 180; // 0=N, 90=E, 180=S, 270=W
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
    // west + east aisle edges
    for (let y = 86; y <= 196; y += 9) segs.push({ x: WEST_AISLE_X + 6, y, horiz: false });
    for (let y = 52; y <= 196; y += 9) segs.push({ x: EAST_AISLE_X - 6, y, horiz: false });
    // north collector: edge dashes + center split (two-way)
    for (let x = 44; x <= 262; x += 9) segs.push({ x, y: NORTH_LANE_Y - 6, horiz: true });
    for (let x = 44; x <= 262; x += 9) segs.push({ x, y: NORTH_LANE_Y + 6, horiz: true });
    for (let x = 48; x <= 258; x += 12) segs.push({ x, y: NORTH_LANE_Y, horiz: true });
    // forecourt divider
    for (let x = 66; x <= 218; x += 7) segs.push({ x, y: FORECOURT_Y + 6.5, horiz: true });
    // south collector: edges + center split (two-way)
    for (let x = 44; x <= 250; x += 9) segs.push({ x, y: SOUTH_LANE_Y - 7, horiz: true });
    for (let x = 44; x <= 196; x += 9) segs.push({ x, y: SOUTH_LANE_Y + 7, horiz: true });
    for (let x = 48; x <= 246; x += 12) segs.push({ x, y: SOUTH_LANE_Y, horiz: true });
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
      {/* forecourt — entry guidance into each pull-through bay */}
      {[120, 138, 168, 186, 204].map((x) => <Arrow key={`f${x}`} x={x} y={FORECOURT_Y} headingDeg={0} />)}
      {/* rear apron — exits swing left (west link) or right (east aisle) */}
      {[180, 230].map((x) => <Arrow key={`re${x}`} x={x} y={REAR_LANE_Y} headingDeg={90} />)}
      {[90, 110].map((x) => <Arrow key={`rw${x}`} x={x} y={REAR_LANE_Y} headingDeg={270} />)}
      {/* west link — southbound from the apron to the collector */}
      <Arrow x={WEST_LINK_X} y={36} headingDeg={180} />
      <Arrow x={WEST_LINK_X} y={58} headingDeg={180} />
      {/* temp/overflow block — two-way central access aisle */}
      <Arrow x={TEMP_LANE_X} y={98} headingDeg={180} />
      <Arrow x={TEMP_LANE_X} y={148} headingDeg={0} />
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
