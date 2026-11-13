import type { VehicleSpec } from './spec';
import { waymoIpace } from './specs/waymoIpace';
import { waymoOjai } from './specs/waymoOjai';
import { zoox } from './specs/zoox';
import { teslaCybercab } from './specs/teslaCybercab';
import { teslaModelY } from './specs/teslaModelY';
import { lucidGravity } from './specs/lucidGravity';

export { buildVehicle } from './build';
export { setDoors, doorPose, doorNodes, doorClip, type DoorRig } from './rig';
export type { VehicleSpec } from './spec';

/** The fleet, in the order the cockpit lists it. */
export const FLEET_SPECS: VehicleSpec[] = [waymoOjai, waymoIpace, zoox, teslaCybercab, teslaModelY, lucidGravity];
export const fleetSpec = (key: string): VehicleSpec | undefined => FLEET_SPECS.find((s) => s.key === key);
