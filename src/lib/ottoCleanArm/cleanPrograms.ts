/**
 * WHICH PROGRAM THE CLEANING ARM PLAYS FOR WHICH VEHICLE.
 *
 * The twin's row names the car in the stall (fleetModels/assign.fleetModelKeyFor). Each fleet vehicle has its own
 * CleanProgram, made by rule from its cabin (cleanProgramFleet.ts) and stored in programs/fleetPrograms.json, so the
 * yard reads a list and does no search. cleanProgramFleet.test.ts makes every program again and fails when the file
 * is stale: `CLEAN_PROGRAM_WRITE=1 npx vitest run src/lib/ottoCleanArm/cleanProgramFleet.test.ts` writes it.
 *
 * A car the row does not name, or a key this file does not hold, is cleaned by the generic program, as before.
 * A vehicle whose stored program visits NO opening is one the arm as built cannot clean: its arm stays home
 * (cleanSession.advanceCleanSession), and `notReached` says why.
 */
import { GENERIC_PROGRAM, makeCleanProgram, type ChargeBeside, type CleanProgram, type CleanVisit } from './cleanArmPose';
import STORED from './programs/fleetPrograms.json';

/** One vehicle's program as the file holds it. */
export interface StoredCleanProgram {
  pivotZ: number;
  visits: CleanVisit[];
  notReached: string[];
  /** When the port-flank doors may be open beside the charge arm (chargeArmBeside.measureChargeBeside). */
  beside: ChargeBeside;
}

const stored = STORED as unknown as Record<string, StoredCleanProgram>;
const built = new Map<string, CleanProgram>();

/** The model keys that have a program of their own. */
export const FLEET_PROGRAM_KEYS: readonly string[] = Object.keys(stored);

/** The program for a vehicle model key (null or unknown: the generic car's). */
export function cleanProgramFor(key: string | null | undefined): CleanProgram {
  if (!key || key === GENERIC_PROGRAM.key) return GENERIC_PROGRAM;
  const hit = built.get(key);
  if (hit) return hit;
  const st = stored[key];
  if (!st) return GENERIC_PROGRAM;
  const made = makeCleanProgram(key, st.pivotZ, st.visits, st.notReached, st.beside);
  built.set(key, made);
  return made;
}
