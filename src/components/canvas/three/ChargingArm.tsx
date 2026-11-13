import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';
import { useSimulationStore } from '@/store/simulationStore';
import { OTTO_CHARGE_ARM, METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { armSkeleton, segmentNodes, writeArm, clearArm, type ArmFleet } from './armInstances';
import type { DepotCad, DepotSkeleton } from '@/lib/robotics/cadDepot';
import type { FlexFleet } from '@/lib/robotics/flexMesh';
import { CAR_WIDTH } from '@/engine/motion/traffic';
import { statusColor, vehicleMayMove, type ArmPhase } from '@/lib/ottoChargeArm/armStateMachine';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import {
  poseFor, servoDt, slewAngles, slewScalar, type ArmTarget,
} from '@/lib/ottoChargeArm/armMotion';
import { STOWED, type JointAngles } from '@/lib/ottoChargeArm/cobotIK';
import { placeArm, portInArmFrame } from '@/lib/ottoChargeArm/depotPlacement';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { armMateFor, vehiclePort, type ArmMate } from '@/lib/ottoChargeArm/vehiclePort';
import { ARM_REACH, BASE_JOINT_NAMES, HEAD_JOINT_NAMES, bedCentreX } from '@/lib/ottoChargeArm/mateSolver';
import { poseSkeleton } from '@/lib/robotics/cadDepot';
import { newMateSeq, stepMateSeq } from '@/lib/ottoChargeArm/mateSequence';
import {
  playArmSession, isArmHome, stallHasArm,
  IDLE_SESSION, type ArmSession,
} from '@/lib/ottoChargeArm/roboticService';

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
 * ONE model, INSTANCED across every stall (instancedFleet.ts). Each arm keeps
 * only a skeleton — the model's joint hierarchy with no meshes — which it
 * drives through IK here and whose segment matrices it writes into its slot of
 * the shared instanced meshes. Ten arms or twenty, the canopy draws in the same
 * number of calls, from one arm's worth of GPU memory.
 *
 * THE MODEL IS THE ENGINEERING CAD (cad/, robotics/cadDepot.ts): every link,
 * actuator, light ring, cable run and the riser it stands on, as designed, at
 * the depot's level of detail (the parts you can see from the yard). Its joints
 * are the twin's J1..J6, in the same frames and on the same axes (cad.test.ts),
 * so the same angles drive it, and robotics/cadYard.test.ts holds it to the
 * same car, cabinet and beacon as the procedural arm. Until the CAD has loaded,
 * or if it cannot, the arm draws the procedural model at 'depot' detail.
 */

/** Rendered vehicle half-width in metres, from the shared plan-unit footprint. */
const CAR_HALF_WIDTH_M = (CAR_WIDTH * METRES_PER_PLAN_UNIT) / 2;

/**
 * DEV-ONLY: what each arm is actually doing, by stall.
 *
 * The arm's session lives in a component ref inside an R3F frame loop, and R3F
 * runs its own reconciler — the scene graph is NOT reachable from the DOM's React
 * tree, so there is no way to check an arm from the console without this. Same
 * precedent and same guard as __twinDriver: stripped from any production build,
 * and nothing reads it. Verifying the founder's report meant answering "is this
 * arm still latched?" from outside the renderer, which is otherwise unanswerable
 * except by eye at ten metres.
 */
const armDebug: Map<string, {
  phase: ArmPhase; t: number; vehicleId: string | null; latch: number;
  /** the mate: which of its five stops, the base's travel, the connector forward, whether the solver took it */
  stop: number; slideM: number; crossM: number; head: string | null; mateOk: boolean | null; profile: string | null;
}> | null =
  import.meta.env.DEV ? new Map() : null;
if (armDebug && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__arms = armDebug;
}

interface ChargingArmProps {
  stallId: string;
  stallType: 'dcfc' | 'l2';
  /** The instanced arm meshes this arm draws into, and its slot there. */
  fleet: ArmFleet;
  slot: number;
  /** The engineering CAD the fleet was built from, or null for the procedural arm. */
  cad: DepotCad | null;
  /** The CAD's flexible lines for every arm (its charge cable), drawn into the same slot; null without the CAD. */
  flex?: FlexFleet | null;
}

/** One arm's joints to drive: the CAD's skeleton, or the procedural one. */
interface ArmRig {
  root: THREE.Object3D;
  /** segment nodes, in the fleet's segment order */
  nodes: THREE.Object3D[];
  j1: THREE.Object3D; j2: THREE.Object3D; j3: THREE.Object3D;
  j4: THREE.Object3D; j5: THREE.Object3D; j6: THREE.Object3D;
  /** the procedural arm's connector tip, for its charge cable (the CAD arm carries its own cable) */
  tcp: THREE.Object3D | null;
  /** the procedural arm's latch collar (the CAD connector's latch is inside it) */
  latch: THREE.Object3D | null;
  /** the CAD's skeleton, for its flexible lines */
  skel: DepotSkeleton | null;
}

function armRig(cad: DepotCad | null): ArmRig {
  if (cad) {
    const s = cad.skeleton();
    return {
      root: s.root, nodes: s.segments,
      j1: s.node('J1_BaseYaw'), j2: s.node('J2_Shoulder'), j3: s.node('J3_Elbow'),
      j4: s.node('J4_ForearmRoll'), j5: s.node('J5_WristPitch'), j6: s.node('J6_ToolRoll'),
      tcp: null, latch: null, skel: s,
    };
  }
  const root = armSkeleton();
  const byName = (n: string) => root.getObjectByName(n) as THREE.Object3D;
  return {
    root, nodes: segmentNodes(root),
    j1: byName('J1_BaseYaw'), j2: byName('J2_Shoulder'), j3: byName('J3_Elbow'),
    j4: byName('J4_ForearmRoll'), j5: byName('J5_WristPitch'), j6: byName('J6_ToolRoll'),
    tcp: byName('TCP_ConnectorTip'), latch: byName('Connector_Latch'), skel: null,
  };
}


export function ChargingArm({ stallId, stallType, fleet, slot, cad, flex }: ChargingArmProps) {
  const groupRef = useRef<THREE.Group>(null);
  const cableRef = useRef<THREE.Mesh>(null);

  const stalls = useDepotStore((s) => s.stalls);
  const stall = useMemo(() => stalls.find((s) => s.id === stallId), [stalls, stallId]);

  const placement = useMemo(
    () => (stall ? placeArm(stall.id, stall.position.x, stall.position.y, stall.position.angle) : null),
    [stall],
  );

  // Per-instance skeleton: joints to drive, no meshes (those are instanced).
  const rig = useMemo(() => armRig(cad), [cad]);

  // an unmounted arm leaves its slot empty
  useEffect(() => () => clearArm(fleet, slot), [fleet, slot]);
  useEffect(() => () => flex?.clear(slot), [flex, slot]);

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

  /**
   * The live connection session for this stall. A REF, not store state: it is
   * stepped 60 times a second and nothing outside this component reads it, so
   * putting it in React would re-render the whole 3D tree for an animation.
   */
  const session = useRef<ArmSession>(IDLE_SESSION);
  /** Depot clock at the previous frame, for the sim-seconds delta. */
  const lastSim = useRef<number | null>(null);
  /**
   * The port the arm is currently working to, cached.
   *
   * A retract has to play out against the inlet the connector is COMING OUT OF.
   * The car is often gone from the roster before the arm is home — OTTO-Q holds
   * it, but a re-plan can drop it — and recomputing the target from "no vehicle"
   * would move the IK goal to a default mid-retract: a teleport dressed as a
   * pose. Keeping the last real target is the honest answer.
   */
  const target = useRef<ArmTarget | null>(null);
  /** What the joints are actually SHOWING, as opposed to what was solved. */
  const shown = useRef<{ angles: JointAngles; latch: number }>({ angles: { ...STOWED }, latch: 0 });
  const baseJoints = useMemo<Record<string, number>>(() => ({}), []);
  /**
   * The mate the twin's own port facts solve to (vehiclePort.armMateFor): where the base goes on its rail and
   * cross-slide, which connector comes forward. Null for a car whose port the twin has not published: that car keeps
   * the old drawing, base at the stall's middle. Held after the car leaves the roster, as `target` is.
   */
  const mate = useRef<ArmMate | null>(null);
  /** Where the base and the two connectors are SHOWN: metres along the rail, toward the car, and each plunge. */
  /** The mate's five stops, the base's travel and the drawn joints (mateSequence.ts). */
  const seq = useRef(newMateSeq());

  useFrame((_state, frameDelta) => {
    if (!placement || !stall || !rig.root) return;

    // THE DEPOT CLOCK. In twin mode the driver publishes it on an imperative
    // channel (same reason poseStore exists): the store copy is deliberately
    // throttled to 1 Hz so a 60 Hz write does not re-render the whole 3D tree,
    // and a 1 Hz clock would step this cycle in visible jerks. The store is the
    // fallback for any mode where no backend owns the clock.
    const simTime = twinMotionDriver.simClockTod() ?? useSimulationStore.getState().simTime;
    // A jump of the clock (a scrub, a run change, a snapshot from a new run) is not
    // elapsed time: playArmSession plays none of it (roboticService.armElapsedS, the
    // depart gate's rule too), so the arm holds and resumes on the next real step.
    let simDt = 0;
    if (lastSim.current !== null) {
      simDt = simTime - lastSim.current;
      if (simDt < 0) simDt += 86400;                    // the clock wraps at midnight
    }
    lastSim.current = simTime;

    const vehicles = useVehicleStore.getState().vehicles;
    const v = vehicles.find((x) => x.assignedStall === stallId);

    // ── THE TWO AUTHORITIES ───────────────────────────────────────────────────
    //
    // CONNECT + HOLD comes from the VEHICLE. `status === 'charging'` is what
    // charging_dcfc / charging_l2 map to on the wire, and it stays true for as
    // long as OTTO-Q is pushing electrons — which is as long as the pack needs,
    // not as long as some reservation predicted. That is the whole fix: the hold
    // condition is a state, so it cannot expire.
    //
    // A window (serviceStartTime) is required to START a mate, because it is the
    // one proof on the roster that the car is PHYSICALLY PARKED — an arm reaching
    // into a stall a car is still taxiing toward is the invented picture this
    // renderer must never draw. It is deliberately NOT required to CONTINUE one:
    // dwell legs are rebuilt from every snapshot, so a re-plan that drops the leg
    // would otherwise yank the connector out of a car that is still charging.
    //
    // WHAT "PHYSICALLY PARKED" MEANS ON THE OTHER SIDE OF THIS SEAM, because it
    // is the whole reason arms never connected. The driver used to publish the
    // window only while its `playback` state read 'docked' — a VISIBILITY state
    // with a twelve REAL-second life (DWELL_FLOOR_MS). Twelve seconds after
    // docking, a car that was still charging lost its window, and an arm that
    // had not already committed could never start. Mount this component against
    // a run already in flight — the founder's every page load — and every car on
    // a charger was already past that floor, so NO arm ever left 'stowed'.
    // TwinMotionDriver.physicallyParked() now gates the window on the car's POSE
    // (no rail, no back-out, body on the stall pose), which does not expire and
    // is strictly stronger about the taxiing case. See its comment, and
    // TwinMotionDriver.armreality.test.ts cases E and G, which fake wall time
    // because nothing else in this repo does.
    const chargingState = v?.status === 'charging';
    const parked = v?.serviceStartTime !== null && v?.serviceStartTime !== undefined;

    // RELEASE comes from the STALL. The robotic tether is OTTO-Q saying the
    // session is over and this is how long it has allowed for the demate.
    const tetherLeft = twinMotionDriver.stallTetherRemainingS(stallId);

    // ONE frame with the depart gate's (playArmSession): the frame's sim time in small
    // steps, so this arm and the gate's keep the clock at any frame rate, each step
    // composed by armSessionInput, including the interlock with the stall's OTTO-CLEAN
    // ARM: no mate starts while that arm is out over the car, and a latched connector
    // stays in until it is home.
    session.current = playArmSession(session.current, simDt, {
      vehicleId: v?.id ?? null,
      chargingState,
      parked,
      tetherRemainingS: tetherLeft,
      cleanBusy: twinMotionDriver.cleanArmBusy(stallId),
      cleanBlocksMate: twinMotionDriver.cleanArmBlocksMate(stallId),
      chargerFaulted: twinMotionDriver.stallChargerFaulted(stallId),
    });
    const { phase, t } = session.current;

    // Target: the modelled inlet of the car this session is serving, in the arm's
    // base frame, metres. Refreshed while that car is on the roster, held after.
    const served = session.current.vehicleId
      ? vehicles.find((x) => x.id === session.current.vehicleId)
      : undefined;
    if (served) {
      const twinPort = vehiclePort(served.id);
      if (twinPort) {
        // The twin says which vehicle this is and where its inlet is: solve the real mate.
        mate.current = armMateFor(twinPort, placement.toward);
        target.current = mate.current.target;
      } else {
        mate.current = null;
        const port = portFor(served.id, served.oem);
        target.current = {
          port: portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M, placement.toward),
          normal: { x: 0, y: 0, z: -1 },
        };
      }
    }

    // THE ORDER OF A MATE is mateSequence.ts's (the 2D plan plays the same): five stops, the arm's pose first and
    // then the base. It also slews the drawn joints at the arm's bounded speed, in depot time (armMotion.servoDt):
    // the solved pose is a REQUEST, and no input (a phase change, a re-planned target, a car swapped under the
    // arm, a stale frame) moves the machine by more than MAX_JOINT_RATE * dt.
    const m = mate.current;
    const rdt = servoDt(frameDelta, twinMotionDriver.playbackSpeed());
    const pose = stepMateSeq(seq.current, phase, t, target.current, m, rdt, spec);
    shown.current.angles = seq.current.shown;
    shown.current.latch = slewScalar(shown.current.latch, pose.latch, rdt);
    const a = shown.current.angles;

    rig.j1.rotation.set(0, a.j1, 0);
    rig.j2.rotation.set(a.j2, 0, 0);
    rig.j3.rotation.set(a.j3, 0, 0);
    rig.j4.rotation.set(0, a.j4, 0);
    rig.j5.rotation.set(a.j5, 0, 0);
    rig.j6.rotation.set(0, a.j6, 0);
    // The CAD's base stage and head (the procedural arm has neither and stays at the stall's middle).
    if (rig.skel) {
      baseJoints[BASE_JOINT_NAMES[0]] = bedCentreX(placement.toward);
      baseJoints[BASE_JOINT_NAMES[1]] = seq.current.slide;
      baseJoints[BASE_JOINT_NAMES[2]] = seq.current.cross;
      baseJoints[HEAD_JOINT_NAMES.CCS1] = seq.current.ccs;
      baseJoints[HEAD_JOINT_NAMES.NACS] = seq.current.nacs;
      poseSkeleton(rig.skel, baseJoints);
    }

    if (rig.latch) {
      const s = 1 - 0.28 * shown.current.latch;
      rig.latch.scale.set(s, 1, s);
    }

    armDebug?.set(stallId, {
      phase, t, vehicleId: session.current.vehicleId, latch: shown.current.latch,
      stop: seq.current.stop, slideM: seq.current.slide, crossM: seq.current.cross,
      head: seq.current.ccs > 0.01 ? 'CCS1' : seq.current.nacs > 0.01 ? 'NACS' : null,
      mateOk: m ? m.mate.ok : null, profile: served ? vehiclePort(served.id)?.profile ?? null : null,
    });

    const col = pose.ok ? statusColor(phase) : 0xff2d2d;
    const glow = phase === 'charging'
      ? 1.0 + Math.sin(simTime * 2.2) * 0.45
      : 1.3;
    // The joints are set; bring the skeleton's world matrices up to date and
    // hand its segments to the instanced meshes.
    groupRef.current?.updateWorldMatrix(true, true);
    writeArm(fleet, slot, rig.nodes, col, glow);
    // the CAD's flex links: the booted copper links that carry the charge current across the joints, solved at this pose
    if (flex && rig.skel) flex.write(slot, rig.skel);

    // Charge cable, drawn whenever the arm is out of its cradle. It used to be
    // drawn only while LATCHED, which popped the cable out of existence the
    // instant the lock released — a second, smaller version of the same snap.
    // The cable is attached to the connector on the arm, so it travels with it
    // through the extract and the retract and disappears only when the arm is
    // home. Ten live catenaries every frame would be wasteful; at most a handful
    // of arms are deployed at once.
    //
    // `pose.ok` gates it as well. When the inlet is outside the envelope the arm
    // REFUSES and holds the stowed pose while the phase still reads 'charging' —
    // drawing the cable off that would put a connected-looking cable on an arm
    // that never left its cradle. That is the renderer inventing a connection
    // OTTO-Q never reported. Publish the absence instead; the LED already goes
    // red, which is the honest signal.
    const cable = cableRef.current;
    if (cable && !rig.tcp) cable.visible = false;
    else if (cable && rig.tcp) {
      const show = pose.ok && !isArmHome(phase);
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
