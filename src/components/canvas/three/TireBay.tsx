import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { OPS_SHELL } from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { homeState, tireAngles } from '@/lib/ottoTire/tireProgram';
import { IDLE_TIRE, tireSessionAngles, type TireSession } from '@/lib/ottoTire/tireSession';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import { poseSkeleton, type DepotCad } from '@/lib/robotics/cadDepot';
import type { DetailDirector } from '@/lib/robotics/cadDetail';
import { makeFlexFleet, type FlexFleet } from '@/lib/robotics/flexMesh';
import { DECK_Y } from './coordUtils';
import { makeInstancedFleet, clearFleetSlot, type InstancedFleet } from './instancedFleet';
import { drawRobot, type DetailFleets } from './detailDraw';
import { FAR_FLEX_OPTIONS } from './cadFleet';

/**
 * OTTO-TIRE — the robotic wheel service in each service bay (docs/OTTO-TIRE.md), as the engineering CAD
 * (cad/ tire_bay.py, robotics/cadDepot.ts): the portal on its 2 floor rails with its 2 wheel robots, the lift's saddles
 * and arms flush in the floor, the wheel racks, socket racks and cover nests, the bay cabinet and the lift's power unit on
 * the north wall, and their lines.
 *
 * This component DRAWS; it decides nothing. OTTO-Q seats a car in a service bay for its tire work (otto-q-core 0842: a
 * worn set replaced, or the quarterly rotation), and the motion driver plays the bay's machine inside the seat
 * (engine/motion/tireGate.ts, the one evaluation): this draws exactly that session's pose each frame, and the lift's
 * rise under the car is drawn on the car (liftStore, Vehicle3D). At home, as for a seat for other work, the portal is
 * parked over the OLD racks at the exit end, the robots raised and turned to the car, the lift down, and a car drives in
 * under nothing. Every bay's machine is one instance of one set of meshes (instancedFleet.ts), and near the camera the
 * detail model (cadDetail.ts). robotics/cadYard.test.ts holds it inside the bay and clear of a car driving through;
 * structurePlan.tireBaySolids carries its footprint into the site plan's solids.
 *
 * FRAME: each bay's group stands on the bay's drive line at its lift mark (plan y BAY_STALL_Y), on the deck. The CAD's
 * bay frame (metres, +X west, +Z north) is the yard's own axes there (world x = 150 - plan x, world z = 110 - plan y),
 * scaled to plan units. Until the CAD has loaded the bays stand empty: the machine has no simple stand-in.
 */

const HOME = tireAngles(homeState());
/** The status beacon: ready for a car at home, working, and on its way home (OTTO-WASH's colours). */
const READY = 0x00e5ff;
const WORKING = 0x35d07f;
const FINISHING = 0xffb020;
const beaconFor = (s: TireSession): number => (s.phase === 'working' ? WORKING : s.phase === 'finishing' ? FINISHING : READY);

/** One bay's machine: its skeleton at home, drawn into its slot of the shared meshes. */
function CadTireBay({ bayId, planX, cad, fleet, flex, slot, detail, director }: {
  bayId: string;
  planX: number;
  cad: DepotCad;
  fleet: InstancedFleet;
  flex: FlexFleet | null;
  slot: number;
  detail: DetailFleets | null;
  director: DetailDirector | null;
}) {
  const machineRef = useRef<THREE.Group>(null);
  const skel = useMemo(() => {
    const s = cad.skeleton();
    poseSkeleton(s, HOME);
    return s;
  }, [cad]);
  useEffect(() => () => clearFleetSlot(fleet, slot), [fleet, slot]);
  useEffect(() => () => flex?.clear(slot), [flex, slot]);
  // where it stands, for the detail choice: the bay's middle, 2 m up, 6 m round (rails, portal, racks and cabinets)
  useEffect(() => {
    if (!director) return;
    director.place('tire_bay', slot, 150 - planX, DECK_Y + 2 * PLAN_UNITS_PER_METRE, 110 - BAY_STALL_Y, 6 * PLAN_UNITS_PER_METRE);
    return () => director.remove('tire_bay', slot);
  }, [director, planX, slot]);
  const seen = useRef({ detail: false });
  const posed = useRef<TireSession>(IDLE_TIRE);

  useFrame(() => {
    // the session the motion driver stepped this frame; re-pose only when it moved
    const s = twinMotionDriver.tireSessionAt(bayId) ?? IDLE_TIRE;
    if (s !== posed.current) {
      poseSkeleton(skel, s.phase === 'home' ? HOME : tireSessionAngles(s));
      posed.current = s;
    }
    machineRef.current?.updateWorldMatrix(true, true);
    drawRobot({ fleet, flex, slot }, detail, skel.segments, skel, beaconFor(s), 2.2, [], seen.current);
  });

  return (
    <group position={[150 - planX, DECK_Y, 110 - BAY_STALL_Y]}>
      {/* the CAD is in metres, in this same bay frame: scale it to plan units */}
      <group ref={machineRef} scale={PLAN_UNITS_PER_METRE}>
        <primitive object={skel.root} />
      </group>
    </group>
  );
}

/** Every service bay's machine as one instance of the CAD's meshes. */
function CadTireBays({ cad, bays, detail, director }: {
  cad: DepotCad;
  bays: readonly { id: string; x: number }[];
  detail: DetailFleets | null;
  director: DetailDirector | null;
}) {
  const fleet = useMemo(() => makeInstancedFleet(cad.parts, bays.length, { receiveShadow: true }), [cad, bays.length]);
  useEffect(() => () => fleet.dispose(), [fleet]);
  // the depot model's lines: round tubes seated in their fittings, the chains as boxes
  const flex = useMemo(() => (cad.flex.length ? makeFlexFleet(cad.flex, bays.length, FAR_FLEX_OPTIONS.tire_bay) : null), [cad, bays.length]);
  useEffect(() => () => flex?.dispose(), [flex]);
  useEffect(() => { for (const m of fleet.meshes) m.count = bays.length; }, [fleet, bays.length]);
  return (
    <group name="tireBays">
      {fleet.meshes.map((m, i) => <primitive key={`tirepart-${i}`} object={m} />)}
      {flex && <primitive object={flex.group} />}
      {bays.map((b, i) => <CadTireBay key={b.id} bayId={b.id} planX={b.x} cad={cad} fleet={fleet} flex={flex} slot={i} detail={detail} director={director} />)}
    </group>
  );
}

/** The service bays' machines: one OTTO-TIRE in each, once its CAD has loaded (cadFleet.ts). */
export function TireBays({ cad, detail = null, director = null }: {
  cad: DepotCad | null; detail?: DetailFleets | null; director?: DetailDirector | null;
}) {
  const bays = useMemo(() => OPS_SHELL.bays.filter((b) => b.kind === 'service'), []);
  if (!cad) return null;
  return <CadTireBays cad={cad} bays={bays} detail={detail} director={director} />;
}
