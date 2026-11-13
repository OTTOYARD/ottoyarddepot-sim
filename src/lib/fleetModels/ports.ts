// Each fleet vehicle's charge inlet as the charge arm needs it. One adapter, so the models and the arm cannot disagree.
import type { MateTarget } from '@/lib/ottoChargeArm/mateSolver';
import type { VehicleSpec } from './spec';

export function mateTarget(spec: VehicleSpec): MateTarget | null {
  const cp = spec.chargePort;
  if (!cp) return null;
  return {
    face: cp.face,
    alongM: spec.dims.length / 2 - cp.xr,
    heightM: cp.y,
    lateralM: cp.z,
    connector: cp.connector,
    presentsEitherSide: cp.presentsEitherSide,
    lengthM: spec.dims.length,
    widthM: spec.dims.width,
  };
}

/** Which stall sides can charge a vehicle: the side its arm stands on, seen from the car. */
export function chargeableArmSides(spec: VehicleSpec): ('left' | 'right')[] {
  const cp = spec.chargePort;
  if (!cp) return [];
  if (cp.face === 'rear' || cp.presentsEitherSide) return ['left', 'right'];
  return [cp.face];
}
