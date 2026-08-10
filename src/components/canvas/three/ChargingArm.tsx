import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';
import { useSimulationStore } from '@/store/simulationStore';
import { buildCobot, makeCobotMaterials, type CobotHandles } from '@/lib/ottoChargeArm/buildCobot';
import { OTTO_CHARGE_ARM, METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { CAR_WIDTH } from '@/engine/motion/traffic';
import { statusColor, isTethered, vehicleMayMove } from '@/lib/ottoChargeArm/armStateMachine';
import { poseFor, type ArmTarget } from '@/lib/ottoChargeArm/armMotion';
import { placeArm, portInArmFrame } from '@/lib/ottoChargeArm/depotPlacement';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { phaseAt, stallHasArm } from '@/lib/ottoChargeArm/roboticService';

/**
 * OTTO-CHARGE ARM — robotic DCFC connection, mounted on the charger pedestal.
 *
 * Replaces the previous placeholder arm, which had four defects that made it
 * decorative rather than functional:
 *
 *   1. It was anchored at `stall.position` — the CAR's parking spot — while
 *      ChargingField.tsx puts the pedestal 4.5 plan units to the side. Every
 *      arm grew out of the middle of a parking space.
 *   2. Its rotation was hardcoded to [0, PI/2, 0] regardless of which side of
 *      the canopy spine the stall sat on, so half of them faced away.
 *   3. Its geometry was authored in metres and dropped into a plan-unit world
 *      (1 unit = 0.4785 m) with no scale factor — the same ~48% shrink that
 *      made Vehicle3D a toy car.
 *   4. Its joint angles were fixed constants, so the connector never actually
 *      arrived at a charge port.
 *
 * This one solves real IK to the vehicle's modelled inlet, enters along the
 * port axis, and reports when a target is out of its envelope instead of
 * faking a pose. Mounted on DCFC stalls only.
 */

const spec = OTTO_CHARGE_ARM;

/**
 * ONE template, cloned per stall. buildCobot allocates fresh geometry on every
 * call; ten independent builds would be ten times the buffers for ten
 * identical machines. Object3D.clone() shares geometry and material by
 * reference, so the whole canopy costs one arm's worth of GPU memory.
 *
 * Built at 'depot' detail: fasteners, cooling ribs, connector pins and sensor
 * glass are dropped. They are sub-centimetre features on a 1.9 m arm viewed
 * from tens of metres, and they account for two thirds of the mesh count.
 */
const TEMPLATE: CobotHandles = buildCobot(spec, { withPlinth: true, lod: 'depot' });

/** Rendered vehicle half-width in metres, from the shared plan-unit footprint. */
const CAR_HALF_WIDTH_M = (CAR_WIDTH * METRES_PER_PLAN_UNIT) / 2;

interface ChargingArmProps {
  stallId: string;
  stallType: 'dcfc' | 'l2';
}

export function ChargingArm({ stallId, stallType }: ChargingArmProps) {
  const groupRef = useRef<THREE.Group>(null);
  const cableRef = useRef<THREE.Mesh>(null);

  const stalls = useDepotStore((s) => s.stalls);
  const stall = useMemo(() => stalls.find((s) => s.id === stallId), [stalls, stallId]);

  const placement = useMemo(
    () => (stall ? placeArm(stall.id, stall.position.x, stall.position.y) : null),
    [stall],
  );

  // Per-instance clone with its own status material (the LED colour differs by
  // phase, so it cannot be shared with the other nine arms).
  const rig = useMemo(() => {
    const root = TEMPLATE.root.clone(true);
    const statusMaterial = TEMPLATE.statusMaterial.clone();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === TEMPLATE.statusMaterial) m.material = statusMaterial;
    });
    const byName = (n: string) => root.getObjectByName(n) as THREE.Group;
    return {
      root,
      j1: byName('J1_BaseYaw'),
      j2: byName('J2_Shoulder'),
      j3: byName('J3_Elbow'),
      j4: byName('J4_ForearmRoll'),
      j5: byName('J5_WristPitch'),
      j6: byName('J6_ToolRoll'),
      tcp: root.getObjectByName('TCP_ConnectorTip') as THREE.Object3D,
      latch: byName('Connector_Latch'),
      statusMaterial,
    };
  }, []);

  useEffect(() => () => { rig.statusMaterial.dispose(); }, [rig]);

  const cableMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.85, metalness: 0.05 }),
    [],
  );
  useEffect(() => () => { cableMat.dispose(); }, [cableMat]);

  // Reusable scratch objects — allocating per frame across ten arms is how a
  // 3D scene quietly acquires a GC stutter.
  const scratch = useMemo(() => ({
    tip: new THREE.Vector3(),
    gland: new THREE.Vector3(),
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
  }), []);

  useFrame(() => {
    if (!placement || !stall || !rig.root) return;

    const simTime = useSimulationStore.getState().simTime;
    const vehicles = useVehicleStore.getState().vehicles;
    const v = vehicles.find((x) => x.assignedStall === stallId);

    // Resolve the phase. No vehicle, or a vehicle that is not mid-service here,
    // means the arm is home.
    let phase: ReturnType<typeof phaseAt>['phase'] = 'stowed';
    let t = 1;
    if (v && v.serviceStartTime !== null && v.serviceDuration !== null) {
      let elapsed = simTime - v.serviceStartTime;
      if (elapsed < 0) elapsed += 86400; // the sim clock wraps at midnight
      const r = phaseAt(elapsed, v.serviceDuration);
      phase = r.phase;
      t = r.t;
    }

    // Target: this vehicle's modelled inlet, in the arm's base frame, metres.
    const port = v ? portFor(v.id, v.oem) : { along: 0, height: 0.75, family: '' };
    const target: ArmTarget = {
      port: portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M, placement.toward),
      normal: { x: 0, y: 0, z: -1 },
    };

    const pose = poseFor({ phase, t, elapsed: 0 }, target, spec);

    rig.j1.rotation.set(0, pose.angles.j1, 0);
    rig.j2.rotation.set(pose.angles.j2, 0, 0);
    rig.j3.rotation.set(pose.angles.j3, 0, 0);
    rig.j4.rotation.set(0, pose.angles.j4, 0);
    rig.j5.rotation.set(pose.angles.j5, 0, 0);
    rig.j6.rotation.set(0, pose.angles.j6, 0);

    const s = 1 - 0.28 * pose.latch;
    rig.latch.scale.set(s, 1, s);

    const col = pose.ok ? statusColor(phase) : 0xff2d2d;
    rig.statusMaterial.color.setHex(col);
    rig.statusMaterial.emissive.setHex(col);
    rig.statusMaterial.emissiveIntensity = phase === 'charging'
      ? 1.0 + Math.sin(simTime * 2.2) * 0.45
      : 1.3;

    // Charge cable, drawn only while the connector is actually mated. Ten live
    // catenaries every frame would be wasteful; at most a handful are mated at
    // once, and a cable hanging off a stowed arm would be wrong anyway.
    const cable = cableRef.current;
    if (cable) {
      const show = isTethered(phase);
      cable.visible = show;
      if (show) {
        rig.tcp.getWorldPosition(scratch.tip);
        rig.root.getWorldPosition(scratch.gland);
        // local space of the arm group, so the tube follows the arm's transform
        rig.root.worldToLocal(scratch.tip);
        const tip = scratch.tip;
        const mid1 = scratch.a.set(tip.x * 0.35, tip.y * 0.35 - 0.9, tip.z * 0.35 - 0.25);
        const mid2 = scratch.b.set(tip.x * 0.72, tip.y * 0.72 - 0.5, tip.z * 0.72 - 0.1);
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, -0.05, -0.28), mid1.clone(), mid2.clone(), tip.clone(),
        ]);
        cable.geometry.dispose();
        cable.geometry = new THREE.TubeGeometry(curve, 16, 0.045, 6, false);
      }
    }
  });

  if (!stallHasArm(stallType) || !placement) return null;

  return (
    <group
      ref={groupRef}
      position={placement.world}
      rotation={[0, placement.rotationY, 0]}
      scale={placement.scale}
    >
      <primitive object={rig.root} />
      <mesh ref={cableRef} material={cableMat} visible={false}>
        <bufferGeometry />
      </mesh>
    </group>
  );
}

/** Re-exported so callers can gate movement without importing the state machine. */
export { vehicleMayMove };
