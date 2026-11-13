// Which fleet model each car is, as the twin's snapshot says it, held for the robots that work to the vehicle's own
// shape. The same answer the yard draws the car with (assign.fleetModelKeyFor): the engine's `port.profile` first,
// then the car's make and model. vehiclePort.ts is the pattern: the motion driver publishes each snapshot's rows, and
// a robot reads the car in its bay by id.
import { fleetModelKeyFor, type FleetModelKey, type FleetModelRow } from './assign';

const models = new Map<string, FleetModelKey>();

/** Called with each snapshot's vehicle rows. A row that names no fleet model removes that car's entry. */
export function publishVehicleModels(rows: readonly ({ id: string } & FleetModelRow)[]): void {
  for (const r of rows) {
    const key = fleetModelKeyFor(r);
    if (key) models.set(r.id, key);
    else models.delete(r.id);
  }
}

/** The car's fleet model, or null when the twin's row names none: the robots then work to the generic car. */
export function vehicleModelKey(id: string | null | undefined): FleetModelKey | null {
  return (id && models.get(id)) || null;
}

export function clearVehicleModels(): void { models.clear(); }
