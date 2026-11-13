// Which vehicle is at a charger and where its charge inlet is, as the twin says it.
//
// The twin's snapshot carries, on each vehicle row, the car's model and its port profile (otto-q-core 0824:
// face, fore/aft, height, connector, body size). The renderer used to draw every inlet where its own table put it
// (chargePort.ts). This is the one place the arms read the twin's answer from. A car with no published port keeps the
// old drawing: nothing here invents one.
import { headIK, solveMate, type Connector, type Mate, type MateTarget } from './mateSolver';
import type { ArmTarget } from './armMotion';

/** The port object on a snapshot vehicle row (otto-q-core public.ottoq_vehicle_port_json). */
export interface TwinPort {
  profile: string;
  face: 'left' | 'right' | 'rear';
  along_m: number;
  height_m: number;
  lateral_m: number;
  connector: Connector;
  either_side: boolean;
  assumed: boolean;
  length_m: number;
  width_m: number;
}

const ports = new Map<string, TwinPort>();

/** Called with each snapshot's vehicle rows. A row with no port removes that car's entry. */
export function publishVehiclePorts(rows: readonly { id: string; port?: TwinPort | null }[]): void {
  for (const r of rows) {
    if (r.port && typeof r.port.along_m === 'number') ports.set(r.id, r.port);
    else ports.delete(r.id);
  }
}

export function vehiclePort(id: string | null | undefined): TwinPort | null {
  return (id && ports.get(id)) || null;
}

export function clearVehiclePorts(): void { ports.clear(); }

export function mateTargetOf(p: TwinPort): MateTarget {
  return {
    face: p.face, alongM: Number(p.along_m), heightM: Number(p.height_m), lateralM: Number(p.lateral_m) || 0,
    connector: p.connector, presentsEitherSide: p.either_side, lengthM: Number(p.length_m), widthM: Number(p.width_m),
  };
}

/** What a charge arm does for one car: where its base goes, what its joints are solved to, which connector works. */
export interface ArmMate {
  mate: Mate;
  /** The arm's target relative to its base at this mate: armMotion.poseFor solves the whole cycle to it. */
  target: ArmTarget;
  /** The head roll that keeps the connector upright on this approach, radians. */
  j6: number;
}

/**
 * Solve the mate for a car at a stall. `toward` is the stall's facing sign (depotPlacement.towardFor): +1 where the
 * arm stands on the car's right. Returns the mate even when it is refused (`mate.ok` false), so the arm can show it.
 */
export function armMateFor(p: TwinPort, toward: 1 | -1): ArmMate {
  const mate = solveMate(mateTargetOf(p), toward === 1);
  return { mate, target: { port: mate.axisPort, normal: mate.normal }, j6: mate.ik?.j6 ?? 0 };
}

export { headIK };
