// useLiveFollow — the depot's running robots, for the Robotics tab's "Follow a robot in the depot".
//
// It reads what the yard draws and nothing else: the motion driver's sessions (armSessionAt, cleanSessionAt,
// washSessionAt), the stalls and the wash bays the renderer has, and a car's own charge port. It writes nothing and
// decides nothing. The poses are lib/robotics/liveFollow.ts's.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import { useDepotStore } from '@/store/depotStore';
import { useSimulationStore } from '@/store/simulationStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { placeArm } from '@/lib/ottoChargeArm/depotPlacement';
import { IDLE_SESSION } from '@/lib/ottoChargeArm/roboticService';
import { placeCleanArm } from '@/lib/ottoCleanArm/cleanArmPlacement';
import { IDLE_CLEAN } from '@/lib/ottoCleanArm/cleanSession';
import { IDLE_WASH } from '@/lib/ottoWash/washSession';
import { WASH_SHELL } from '@/lib/structurePlan';
import { DECK_Y } from '@/components/canvas/three/coordUtils';
import type { RobotKey } from '@/lib/robotics/catalog';
import {
  MODEL_TOWARD, chargeLiveAngles, cleanLiveAngles, liveUnit, sortUnits, washLiveAngles, type LiveSession, type LiveUnit, type PortAt,
} from '@/lib/robotics/liveFollow';

const sessionAt = (robot: RobotKey, id: string): LiveSession | null =>
  robot === 'charge_arm' ? twinMotionDriver.armSessionAt(id)
    : robot === 'clean_arm' ? twinMotionDriver.cleanSessionAt(id) : twinMotionDriver.washSessionAt(id);

const carName = (vehicleId: string): string | null => {
  const v = useVehicleStore.getState().vehicles.find((x) => x.id === vehicleId);
  return v ? v.label ?? null : null;
};

export interface LiveFollow {
  /** the depot's machines of this kind, the ones that work first */
  units: LiveUnit[];
  /** the motion driver has a session for at least one of them: a run plays in the yard */
  live: boolean;
  /** the followed machine, or null when the tab follows none */
  following: LiveUnit | null;
  /** the followed machine's joint values now (for the joint read-outs), or null */
  angles: Record<string, number> | null;
  /** the followed machine stands on the other side of its car from the model: it is the model's mirror image */
  mirrored: boolean;
  /** the viewer's frame reader: the followed machine's joint values at this frame, or null */
  read: (() => Record<string, number> | null) | null;
  follow: (id: string | null) => void;
}

export function useLiveFollow(robot: RobotKey): LiveFollow {
  const stalls = useDepotStore((s) => s.stalls);
  const washBayCount = useSimulationStore((s) => s.config.washBayCount);
  const ids = useMemo(
    () => (robot === 'wash_gantry'
      ? WASH_SHELL.bays.slice(0, Math.max(0, washBayCount)).map((b) => b.id)
      : stalls.filter((s) => s.type === 'dcfc').map((s) => s.id)),
    [robot, stalls, washBayCount],
  );
  const [id, setId] = useState<string | null>(null);
  const [seen, setSeen] = useState<{ units: LiveUnit[]; live: boolean; angles: Record<string, number> | null }>({ units: [], live: false, angles: null });
  useEffect(() => { setId(null); }, [robot]);

  // The port of the car the followed arm serves: found while the car is on the roster, held after (the yard's rule).
  const port = useRef<{ for: string | null; at: PortAt | null }>({ for: null, at: null });
  useEffect(() => { port.current = { for: null, at: null }; }, [robot, id]);
  const anglesNow = useCallback((): Record<string, number> | null => {
    if (!id) return null;
    if (robot === 'clean_arm') return cleanLiveAngles(twinMotionDriver.cleanSessionAt(id) ?? IDLE_CLEAN);
    if (robot === 'wash_gantry') return washLiveAngles(twinMotionDriver.washSessionAt(id) ?? IDLE_WASH);
    const s = twinMotionDriver.armSessionAt(id) ?? IDLE_SESSION;
    if (s.vehicleId && s.vehicleId !== port.current.for) {
      const v = useVehicleStore.getState().vehicles.find((x) => x.id === s.vehicleId);
      if (v) { const p = portFor(v.id, v.oem); port.current = { for: v.id, at: { along: p.along, height: p.height } }; }
    }
    return chargeLiveAngles(s, port.current.at);
  }, [robot, id]);

  // The list and the read-outs refresh a few times a second. The model itself is posed on every frame, by `read`.
  useEffect(() => {
    const look = () => {
      let live = false;
      const units = sortUnits(ids.map((u) => {
        const s = sessionAt(robot, u);
        if (s) live = true;
        return liveUnit(robot, u, s ?? (robot === 'charge_arm' ? IDLE_SESSION : robot === 'clean_arm' ? IDLE_CLEAN : IDLE_WASH), carName);
      }));
      setSeen({ units, live, angles: anglesNow() });
    };
    look();
    const t = setInterval(look, 300);
    return () => clearInterval(t);
  }, [robot, ids, anglesNow]);

  const mirrored = useMemo(() => {
    const stall = id && robot !== 'wash_gantry' ? stalls.find((s) => s.id === id) : null;
    if (!stall) return false;
    const { x, y, angle } = stall.position;
    return robot === 'charge_arm'
      ? placeArm(stall.id, x, y, angle).toward !== MODEL_TOWARD
      : placeCleanArm(x, y, angle, DECK_Y).sides.b !== 1; // catalog's clean arm is sidesFor(1)
  }, [robot, id, stalls]);

  const following = id ? seen.units.find((u) => u.id === id) ?? null : null;
  return {
    units: seen.units, live: seen.live, following, angles: id ? seen.angles : null, mirrored,
    read: id ? anglesNow : null, follow: setId,
  };
}
