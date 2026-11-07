/**
 * The committed CAD, read from disk for tests (no network): public/cad, as cad/build.py writes it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as THREE from 'three';
import { depotFile, parseGlb } from '@/lib/robotics/cadDepot';
import type { RobotKey } from '@/lib/robotics/catalog';

export const PUBLIC_CAD = resolve(__dirname, '../../public/cad');

/** A robot's depot model (what the yard draws), parsed into a three.js scene at rest. */
export function depotSceneFromDisk(robot: RobotKey): Promise<THREE.Group> {
  return parseGlb(readFileSync(`${PUBLIC_CAD}/${depotFile(robot)}`));
}

/** A robot's full engineering model (what the Robotics tab draws), parsed into a three.js scene at rest. */
export function fullSceneFromDisk(robot: RobotKey): Promise<THREE.Group> {
  return parseGlb(readFileSync(`${PUBLIC_CAD}/${robot}.glb`));
}
