import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDepotStore } from '@/store/depotStore';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { poseCleanArm } from '@/lib/ottoCleanArm/buildCleanArm';
import { cleanSessionJoints, IDLE_CLEAN, type CleanSession } from '@/lib/ottoCleanArm/cleanSession';
import { placeCleanArm } from '@/lib/ottoCleanArm/cleanArmPlacement';
import { CLEAN_ARM } from '@/lib/ottoCleanArm/cleanArmSpec';
import { DECK_Y } from './coordUtils';
import { cleanSkeleton, writeCleanArm, clearCleanArm, type CleanArmFleet } from './cleanArmInstances';

/**
 * OTTO-CLEAN ARM — the overhead robot over each robotic fast-charger stall that
 * cleans a car's cabin while it charges (docs/OTTO-CLEAN-ARM.md).
 *
 * This component DRAWS; it decides nothing. The arm's session is stepped once, in the
 * motion driver (engine/motion/cleanGate.ts), from what the twin publishes (the
 * interior tidy the stall's arm is doing, and its times, otto-q-core 0758) and what
 * the motion layer knows (the car standing on its stall pose, the charge arm's phase).
 * The same session opens the car's doors (doorStore) and holds the car until the arm
 * is home. So the drawn arm, the drawn doors and the car's right to move are one
 * evaluation, and cannot disagree.
 *
 * The arm is authored in metres in the CAR's frame, and placed by the stall's pose
 * through the car body's own conversion (cleanArmPlacement): what it reaches into is
 * where the car is drawn. Its canopy steel (the header beam and the drop column) is
 * drawn with the canopy (SolarCanopy).
 *
 * Instanced (cleanArmInstances.ts): each arm keeps a skeleton, poses it with the
 * session's joints, and writes its segments into its slot.
 */

/** Status light by what the arm is doing: the OTTO-CHARGE ARM's palette, so one light means one thing. */
function statusOf(s: CleanSession): number {
  const p = s.phase;
  if (p === 'home') return 0x00e5ff;                    // teal: home, safe
  if (s.finishing) return 0xffb020;                     // amber: on its way out
  if (p === 'clean_a' || p === 'clean_b') return 0x35d07f; // green: working
  if (p.startsWith('enter') || p.startsWith('exit')) return 0xffd54a; // bright amber: through the door
  return 0xffb020;                                      // amber: moving
}

/**
 * DEV-ONLY: what each cleaning arm is doing, by stall — the same precedent as
 * ChargingArm's __arms (the R3F scene graph is not reachable from the DOM).
 */
const cleanDebug: Map<string, {
  phase: string; t: number; vehicleId: string | null;
  /** world positions, plan units: J1's axis, the wrist pivot, the nozzle's knuckle */
  j1: number[]; pivot: number[]; knuckle: number[];
}> | null = import.meta.env.DEV ? new Map() : null;
if (cleanDebug && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__cleanArms = cleanDebug;
}

interface CleanArmProps {
  stallId: string;
  fleet: CleanArmFleet;
  slot: number;
}

export function CleanArm({ stallId, fleet, slot }: CleanArmProps) {
  const groupRef = useRef<THREE.Group>(null);
  const frameRef = useRef<THREE.Group>(null);
  const hoseRef = useRef<THREE.Mesh>(null);

  const stalls = useDepotStore((s) => s.stalls);
  const stall = useMemo(() => stalls.find((s) => s.id === stallId), [stalls, stallId]);
  const place = useMemo(
    () => (stall ? placeCleanArm(stall.position.x, stall.position.y, stall.position.angle, DECK_Y) : null),
    [stall],
  );

  const rig = useMemo(() => cleanSkeleton(), []);
  useEffect(() => () => clearCleanArm(fleet, slot), [fleet, slot]);

  const hoseMat = useMemo(() => new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.82, metalness: 0.05 }), []);
  useEffect(() => () => { hoseMat.dispose(); hoseRef.current?.geometry.dispose(); }, [hoseMat]);

  const scratch = useMemo(() => ({
    a: new THREE.Vector3(), w: new THREE.Vector3(), m1: new THREE.Vector3(), m2: new THREE.Vector3(), out: new THREE.Vector3(),
  }), []);
  /** the hose is rebuilt only while the arm moves; at home it holds one shape */
  const hoseAtHome = useRef(false);

  useFrame(({ clock }) => {
    if (!place) return;
    const s = twinMotionDriver.cleanSessionAt(stallId) ?? IDLE_CLEAN;
    poseCleanArm(rig.nodes, cleanSessionJoints(s, place.sides));
    groupRef.current?.updateWorldMatrix(true, true);
    const working = s.phase === 'clean_a' || s.phase === 'clean_b';
    const glow = working ? 1.0 + Math.sin(clock.elapsedTime * 3.1) * 0.4 : 1.3;
    writeCleanArm(fleet, slot, rig.segments, statusOf(s), glow);
    if (cleanDebug) {
      const v = new THREE.Vector3();
      const at = (o: THREE.Object3D) => o.getWorldPosition(v).toArray().map((x) => Math.round(x * 1000) / 1000);
      cleanDebug.set(stallId, {
        phase: s.phase, t: s.t, vehicleId: s.vehicleId,
        j1: at(rig.nodes.CA_J1), pivot: at(rig.nodes.CA_Pitch), knuckle: at(rig.nodes.CA_Nozzle),
      });
    }

    // THE HOSE: from the J3 carriage, bowed outboard of the mast, to the wrist — away
    // from the car, so it never goes near the door the wand goes through. Drawn in the
    // car frame (metres), the sandbox's curve exactly.
    const hose = hoseRef.current;
    const frame = frameRef.current;
    if (!hose || !frame) return;
    const home = s.phase === 'home';
    if (home && hoseAtHome.current) return;
    hoseAtHome.current = home;
    frame.worldToLocal(rig.hoseRoot.getWorldPosition(scratch.a));
    frame.worldToLocal(rig.nodes.CA_Pitch.getWorldPosition(scratch.w));
    const a = scratch.a, w = scratch.w;
    const out = scratch.out.set(w.x - CLEAN_ARM.mountX, 0, w.z).normalize().multiplyScalar(0.12);
    const m1 = scratch.m1.set((a.x * 2 + w.x) / 3, (a.y * 2 + w.y) / 3 + 0.05, (a.z * 2 + w.z) / 3).add(out);
    const m2 = scratch.m2.set((a.x + w.x * 2) / 3, (a.y + w.y * 2) / 3, (a.z + w.z * 2) / 3).addScaledVector(out, 0.8);
    hose.geometry.dispose();
    hose.geometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([a.clone(), m1.clone(), m2.clone(), w.clone()]), 20, 0.022, 7, false,
    );
    hose.visible = true;
  });

  if (!place) return null;
  return (
    <group ref={groupRef} position={[place.world.x, DECK_Y, place.world.z]} rotation={[0, place.yaw, 0]}>
      {/* the car body's own metre -> plan-unit conversion (vehicleBody.planUnits): scale, then Ry(-PI/2) */}
      <group ref={frameRef} rotation={[0, -Math.PI / 2, 0]} scale={PLAN_UNITS_PER_METRE}>
        <primitive object={rig.root} />
        <mesh ref={hoseRef} material={hoseMat} visible={false} castShadow>
          <bufferGeometry />
        </mesh>
      </group>
    </group>
  );
}
