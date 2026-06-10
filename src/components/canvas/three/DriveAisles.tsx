import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import {
  WEST_AISLE_X, EAST_AISLE_X, NORTH_LANE_Y, SOUTH_LANE_Y, REAR_LANE_Y, INGRESS, EGRESS,
} from '@/lib/sitePlan';
import { toWorld } from './coordUtils';

/**
 * One-way circulation markings: directional arrows + dashed lane edges for
 * west aisle (north), north travel lane (east), east aisle (south),
 * south collector (east → egress), and the rear pull-through lane.
 */

function Arrow({ x, y, headingDeg }: { x: number; y: number; headingDeg: number }) {
  const mat = useMemo(() => MATERIALS.laneMarkingWhite(), []);
  const [wx, , wz] = toWorld({ x, y }, 0);
  // heading 0 = north (logical -y → world +z); 90 = east; 180 = south; 270 = west
  const rotY = (headingDeg * Math.PI) / 180;
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
  // dashed lane-edge instancing
  const dashes = useMemo(() => {
    const segs: { x: number; y: number; horiz: boolean }[] = [];
    for (let y = 70; y <= 196; y += 9) segs.push({ x: WEST_AISLE_X + 6, y, horiz: false });
    for (let y = 64; y <= 196; y += 9) segs.push({ x: EAST_AISLE_X - 6, y, horiz: false });
    for (let x = 44; x <= 262; x += 9) segs.push({ x, y: NORTH_LANE_Y + 5, horiz: true });
    for (let x = 44; x <= 186; x += 9) segs.push({ x, y: SOUTH_LANE_Y - 5, horiz: true });
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
      {[170, 140, 110, 80].map((y) => <Arrow key={`w${y}`} x={WEST_AISLE_X} y={y} headingDeg={0} />)}
      {/* north travel lane — eastbound */}
      {[70, 110, 150, 190, 230].map((x) => <Arrow key={`n${x}`} x={x} y={NORTH_LANE_Y} headingDeg={90} />)}
      {/* east aisle — southbound */}
      {[80, 120, 160].map((y) => <Arrow key={`e${y}`} x={EAST_AISLE_X} y={y} headingDeg={180} />)}
      {/* south collector — eastbound toward egress */}
      {[60, 110, 160].map((x) => <Arrow key={`s${x}`} x={x} y={SOUTH_LANE_Y} headingDeg={90} />)}
      {/* rear pull-through lane — eastbound */}
      {[100, 150, 195].map((x) => <Arrow key={`r${x}`} x={x} y={REAR_LANE_Y} headingDeg={90} />)}
      {/* gate throats */}
      <Arrow x={INGRESS.x} y={200} headingDeg={0} />
      <Arrow x={EGRESS.x} y={192} headingDeg={180} />
    </group>
  );
}
