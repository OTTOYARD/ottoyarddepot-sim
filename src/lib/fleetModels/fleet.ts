// The fleet's vehicle specs, without the model builder: pure data, for the robots (cabin.ts, the clean programs)
// and anything else that must not pull three.js in with it. index.ts re-exports these beside the builder.
import type { VehicleSpec } from './spec';
import { waymoIpace } from './specs/waymoIpace';
import { waymoOjai } from './specs/waymoOjai';
import { zoox } from './specs/zoox';
import { teslaCybercab } from './specs/teslaCybercab';
import { teslaModelY } from './specs/teslaModelY';
import { lucidGravity } from './specs/lucidGravity';

/** The fleet, in the order the cockpit lists it. */
export const FLEET_SPECS: VehicleSpec[] = [waymoOjai, waymoIpace, zoox, teslaCybercab, teslaModelY, lucidGravity];
export const fleetSpec = (key: string): VehicleSpec | undefined => FLEET_SPECS.find((s) => s.key === key);
