// Which fleet vehicle model the yard draws a car as. Pure, and a DRAWING choice only: nothing in the traffic model,
// a clearance or a robot reads it.
//
// The twin's snapshot row is the only input. In order:
//   1. `port.profile`, when the engine sends one and it is one of the six model keys (the engine's own word);
//   2. the car's make and model, read as text;
//   3. nothing: the yard draws its one generic car.

export const FLEET_MODEL_KEYS = [
  'waymo_ojai', 'waymo_ipace', 'zoox_robotaxi', 'tesla_cybercab', 'tesla_model_y', 'lucid_gravity_nuro',
] as const;
export type FleetModelKey = (typeof FLEET_MODEL_KEYS)[number];

export const isFleetModelKey = (k: unknown): k is FleetModelKey =>
  typeof k === 'string' && (FLEET_MODEL_KEYS as readonly string[]).includes(k);

/** The part of the snapshot's vehicle row this reads (TwinVehicle has it; so does a recorded roster row). */
export interface FleetModelRow {
  make?: string | null;
  model?: string | null;
  port?: { profile?: string | null } | null;
}

/** First match wins, so the order is part of the rule: a Cybercab is a Tesla, an Ojai and an I-PACE are Waymo's. */
const BY_NAME: readonly (readonly [RegExp, FleetModelKey])[] = [
  [/cybercab/, 'tesla_cybercab'],
  [/tesla/, 'tesla_model_y'],
  [/zeekr|ojai/, 'waymo_ojai'],
  [/jaguar|i-?pace|waymo/, 'waymo_ipace'],
  [/zoox/, 'zoox_robotaxi'],
  [/lucid|gravity/, 'lucid_gravity_nuro'],
];

export function fleetModelKeyFor(vehicle: FleetModelRow | null | undefined): FleetModelKey | null {
  if (!vehicle) return null;
  const profile = vehicle.port?.profile;
  if (isFleetModelKey(profile)) return profile;
  const name = `${vehicle.make ?? ''} ${vehicle.model ?? ''}`.toLowerCase();
  for (const [re, key] of BY_NAME) if (re.test(name)) return key;
  return null;
}
