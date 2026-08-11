import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';
import { useSimulationStore } from '@/store/simulationStore';
import { buildCobot, makeCobotMaterials, type CobotHandles } from '@/lib/ottoChargeArm/buildCobot';
import { OTTO_CHARGE_ARM, METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { CAR_WIDTH } from '@/engine/motion/traffic';
import { statusColor, vehicleMayMove, type ArmPhase } from '@/lib/ottoChargeArm/armStateMachine';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import {
  poseFor, slewAngles, slewScalar, type ArmTarget,
} from '@/lib/ottoChargeArm/armMotion';
import { STOWED, type JointAngles } from '@/lib/ottoChargeArm/cobotIK';
import { placeArm, portInArmFrame } from '@/lib/ottoChargeArm/depotPlacement';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import {
  advanceArmSession, isArmCommitted, isArmHome, stallHasArm,
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

/**
 * Largest sim-clock step this component will treat as elapsed time.
 *
 * The depot clock can JUMP — a scrub, a run change, a snapshot from a new run.
 * A jump is not thirty seconds of the world happening; it is a different world.
 * Feeding it to the session reducer would fast-forward a whole cycle in one
 * frame, which is exactly the discontinuity being fixed. Beyond this, the arm
 * simply holds and resumes on the next real step.
 */
const MAX_CLOCK_STEP_S = 30;

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
const armDebug: Map<string, { phase: ArmPhase; t: number; vehicleId: string | null; latch: number }> | null =
  import.meta.env.DEV ? new Map() : null;
if (armDebug && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__arms = armDebug;
}

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

  useFrame((_state, frameDelta) => {
    if (!placement || !stall || !rig.root) return;

    // THE DEPOT CLOCK. In twin mode the driver publishes it on an imperative
    // channel (same reason poseStore exists): the store copy is deliberately
    // throttled to 1 Hz so a 60 Hz write does not re-render the whole 3D tree,
    // and a 1 Hz clock would step this cycle in visible jerks. The store is the
    // fallback for any mode where no backend owns the clock.
    const simTime = twinMotionDriver.simClockTod() ?? useSimulationStore.getState().simTime;
    let simDt = 0;
    if (lastSim.current !== null) {
      simDt = simTime - lastSim.current;
      if (simDt < 0) simDt += 86400;                    // the clock wraps at midnight
      if (simDt > MAX_CLOCK_STEP_S) simDt = 0;          // a scrub is not elapsed time
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
    // one proof on the roster that the car is PHYSICALLY PARKED — the driver only
    // publishes it once playback reaches 'docked', and an arm reaching into a
    // stall a car is still taxiing toward is the invented picture this renderer
    // must never draw. It is deliberately NOT required to CONTINUE one: dwell
    // legs are rebuilt from every snapshot, so a re-plan that drops the leg would
    // otherwise yank the connector out of a car that is still charging.
    const chargingState = v?.status === 'charging';
    const parked = v?.serviceStartTime !== null && v?.serviceStartTime !== undefined;
    const charging = !!v && chargingState && (parked || isArmCommitted(session.current.phase));

    // RELEASE comes from the STALL. The robotic tether is OTTO-Q saying the
    // session is over and this is how long it has allowed for the demate.
    const tetherLeft = twinMotionDriver.stallTetherRemainingS(stallId);

    session.current = advanceArmSession(session.current, {
      dt: simDt,
      vehicleId: v?.id ?? null,
      charging,
      tetherRemainingS: tetherLeft,
    });
    const { phase, t } = session.current;

    // Target: the modelled inlet of the car this session is serving, in the arm's
    // base frame, metres. Refreshed while that car is on the roster, held after.
    const served = session.current.vehicleId
      ? vehicles.find((x) => x.id === session.current.vehicleId)
      : undefined;
    if (served) {
      const port = portFor(served.id, served.oem);
      target.current = {
        port: portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M, placement.toward),
        normal: { x: 0, y: 0, z: -1 },
      };
    }

    // No car has ever docked here, so there is no inlet to solve to. Publish the
    // absence: sit folded. Never synthesise a plausible port.
    const pose = target.current
      ? poseFor({ phase, t }, target.current, spec)
      : { angles: STOWED, latch: 0, engaged: false, ok: true };

    // ── RENDER THROUGH A RATE LIMIT ───────────────────────────────────────────
    // The solved pose is a REQUEST. What gets drawn chases it at a bounded joint
    // speed, so no input — a phase change, a re-planned target, a car swapped
    // under the arm, a stale frame — can move the machine by more than
    // MAX_JOINT_RATE * dt. Real time, not sim time: this is servo travel, and it
    // is the only thing standing between a jumpy feed and the SNAP the founder
    // reported. Above ~4x playback it becomes the binding constraint and the arm
    // trails the clock slightly, the same way the cars do.
    const rdt = Math.min(Math.max(frameDelta, 0), 0.1);
    shown.current.angles = slewAngles(shown.current.angles, pose.angles, rdt);
    shown.current.latch = slewScalar(shown.current.latch, pose.latch, rdt);
    const a = shown.current.angles;

    rig.j1.rotation.set(0, a.j1, 0);
    rig.j2.rotation.set(a.j2, 0, 0);
    rig.j3.rotation.set(a.j3, 0, 0);
    rig.j4.rotation.set(0, a.j4, 0);
    rig.j5.rotation.set(a.j5, 0, 0);
    rig.j6.rotation.set(0, a.j6, 0);

    const s = 1 - 0.28 * shown.current.latch;
    rig.latch.scale.set(s, 1, s);

    armDebug?.set(stallId, {
      phase, t, vehicleId: session.current.vehicleId, latch: shown.current.latch,
    });

    const col = pose.ok ? statusColor(phase) : 0xff2d2d;
    rig.statusMaterial.color.setHex(col);
    rig.statusMaterial.emissive.setHex(col);
    rig.statusMaterial.emissiveIntensity = phase === 'charging'
      ? 1.0 + Math.sin(simTime * 2.2) * 0.45
      : 1.3;

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
    if (cable) {
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
