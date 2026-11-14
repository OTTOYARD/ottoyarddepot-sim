/**
 * WHICH PROGRAM A WASH BAY PLAYS: the vehicle's own, when the twin's row says which of the fleet's models it is.
 *
 * Chase, 2026-11-13: "Our system knows which car is pulling into which stall so that should activate different
 * training sets for our robotics."
 *
 * A program is everything about the machine's work that depends on the vehicle:
 *   - the DETAIL ARMS': the places the pads polish, how each is met, the paths between them, and the solid the arms
 *     keep off (detailArm.DetailProgram; a fleet vehicle's is made by rule in fleetWash.ts);
 *   - the GANTRY's: the shape its air knives follow and its frame clears (carShape.CarShape);
 *   - the TIME the four polish zones take.
 * A car whose row names no fleet model gets the generic program, which is the machine as it was before 2026-11-13.
 * The model's key is the one the yard draws the car with (fleetModels/assign.fleetModelKeyFor), so the machine works
 * on the vehicle the viewer sees.
 */
import { fleetSpec } from '@/lib/fleetModels';
import { isFleetModelKey } from '@/lib/fleetModels/assign';
import { fleetShape, GENERIC_SHAPE, type CarShape } from './carShape';
import { GENERIC, type DetailProgram } from './detailArm';
import { fleetDetailProgram, type FleetDetail } from './fleetWash';
import { WASH_GANTRY, WASH_PHASE_S, WIPE_FIXED_S, WIPE_STATIONS, type WipeStation } from './washSpec';

export interface WashProgram {
  /** 'generic', or the fleet model's key */
  key: string;
  detail: DetailProgram;
  shape: CarShape;
  /** the four polish zones' lengths, sim seconds */
  zoneS: Readonly<Record<WipeStation, number>>;
  /** `arms_stow`'s length and `retract`'s (a seat that ends early), sim seconds */
  stowS: number;
  retractS: number;
  /** the detail arms' whole time: out of the docks, the four zones, and stowed again */
  wipeS: number;
  /** a fleet vehicle's program as the rule made it: what is cleaned and what is left out */
  fleet: FleetDetail | null;
}

export const GENERIC_WASH: WashProgram = {
  key: 'generic', detail: GENERIC, shape: GENERIC_SHAPE,
  zoneS: { front: WASH_PHASE_S.wipe_front, sides: WASH_PHASE_S.wipe_sides, roof: WASH_PHASE_S.wipe_roof, rear: WASH_PHASE_S.wipe_rear },
  stowS: WASH_PHASE_S.arms_stow, retractS: WASH_PHASE_S.retract, wipeS: WIPE_FIXED_S, fleet: null,
};

const made = new Map<string, WashProgram>();

/** The program for a vehicle's model. Null, or a key that is not a fleet model's: the generic program. */
export function washProgramFor(model: string | null | undefined): WashProgram {
  if (!model || !isFleetModelKey(model)) return GENERIC_WASH;
  const hit = made.get(model);
  if (hit) return hit;
  const spec = fleetSpec(model);
  if (!spec) return GENERIC_WASH;
  const fleet = fleetDetailProgram(spec);
  const zones = WIPE_STATIONS.reduce((a, z) => a + fleet.zoneS[z], 0);
  const prog: WashProgram = {
    key: model, detail: fleet, shape: fleetShape(fleet.solid, WASH_GANTRY.dryer.side), zoneS: fleet.zoneS,
    stowS: fleet.stowS, retractS: fleet.retractS, wipeS: WASH_PHASE_S.arms_out + zones + fleet.stowS, fleet,
  };
  made.set(model, prog);
  return prog;
}
