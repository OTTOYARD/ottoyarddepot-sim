import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import {
  WEST_AISLE_X, EAST_AISLE_X, NORTH_LANE_Y, SOUTH_LANE_Y, REAR_LANE_Y, FORECOURT_Y,
  INGRESS, EGRESS,
} from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

/**
 * One-way circulation markings for the continuous-flow plan:
 *   west aisle (north) → NORTH COLLECTOR (east) → down a charging lane, or
 *   turn into the FORECOURT throat → through a bay → REAR LANE (east) →
 *   east aisle (south) → SOUTH COLLECTOR (east) → egress gate.
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
  // dashed lane edges
  const dashes = useMemo(() => {
    const segs: { x: number; y: number; horiz: boolean }[] = [];
    // west + east aisle edges
    for (let y = 78; y <= 196; y += 9) segs.push({ x: WEST_AISLE_X + 6, y, horiz: false });
    for (let y = 60; y <= 196; y += 9) segs.push({ x: EAST_AISLE_X - 6, y, horiz: false });
    // north collector edges (both sides)
    for (let x = 44; x <= 262; x += 9) segs.push({ x, y: NORTH_LANE_Y - 6, horiz: true });
    for (let x = 44; x <= 262; x += 9) segs.push({ x, y: NORTH_LANE_Y + 6, horiz: true });
    // forecourt / collector divider (short dashes across the bay frontage)
    for (let x = 66; x <= 218; x += 7) segs.push({ x, y: FORECOURT_Y + 6.5, horiz: true });
    // south collector edges
    for (let x = 44; x <= 250; x += 9) segs.push({ x, y: SOUTH_LANE_Y - 7, horiz: true });
    for (let x = 44; x <= 196; x += 9) segs.push({ x, y: SOUTH_LANE_Y + 7, horiz: true });
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

  return (
    <group>
      <primitive object={dashes} />

      {/* west aisle — northbound */}
      {[172, 142, 112, 86].map((y) => <Arrow key={`w${y}`} x={WEST_AISLE_X} y={y} headingDeg={0} />)}
      {/* north collector — eastbound (the main artery) */}
      {[60, 100, 140, 180, 220, 255].map((x) => <Arrow key={`n${x}`} x={x} y={NORTH_LANE_Y} headingDeg={90} />)}
      {/* forecourt — entry guidance into each pull-through bay */}
      {[120, 138, 168, 186, 204].map((x) => <Arrow key={`f${x}`} x={x} y={FORECOURT_Y} headingDeg={0} />)}
      {/* rear lane — eastbound behind the bays (pull-through egress) */}
      {[100, 150, 195].map((x) => <Arrow key={`r${x}`} x={x} y={REAR_LANE_Y} headingDeg={90} />)}
      {/* east aisle — southbound */}
      {[85, 120, 155].map((y) => <Arrow key={`e${y}`} x={EAST_AISLE_X} y={y} headingDeg={180} />)}
      {/* south collector — eastbound toward egress */}
      {[60, 110, 160].map((x) => <Arrow key={`s${x}`} x={x} y={SOUTH_LANE_Y} headingDeg={90} />)}
      {/* gate throats */}
      <Arrow x={INGRESS.x} y={198} headingDeg={0} />
      <Arrow x={EGRESS.x} y={192} headingDeg={180} />
    </group>
  );
}
