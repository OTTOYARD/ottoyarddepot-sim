/**
 * The service bays as the site plan builds them (structurePlan.OPS_SHELL), measured for OTTO-TIRE (tireSpec.ts). The
 * machine is designed for the NARROWER half of either bay, from its drive line to the partition beside it: 8.8 u =
 * 4.211 m in both bays (bay 2's east wall is 11.4 u off its drive line). The bay is 30 u deep between its end walls' inner
 * faces less the walls.
 *
 * It is its own file so that tireSpec.ts reads nothing from the site plan: the site plan reads the machine's footprint
 * from tireSpec (structurePlan.tireBaySolids), and an import each way would be a cycle.
 */
import { METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { DOOR_WIDTH, OPS_SHELL, PARTITION_T, SERVICE_DOOR_HEIGHT, WALL_T } from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';

const U = METRES_PER_PLAN_UNIT;
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

function bayFit() {
  const halves = OPS_SHELL.bays.filter((b) => b.kind === 'service').flatMap((b) => [
    b.x - (b.x0 + PARTITION_T / 2 * (b.x0 === OPS_SHELL.footprint.x0 + WALL_T ? 0 : 1)),
    (b.x1 - (b.x1 === OPS_SHELL.footprint.x1 - WALL_T ? 0 : PARTITION_T / 2)) - b.x,
  ]);
  const f = OPS_SHELL.footprint;
  return {
    halfWidth: r4(Math.min(...halves) * U),
    north: r4((BAY_STALL_Y - (f.y0 + WALL_T)) * U),
    south: r4(((f.y1 - WALL_T) - BAY_STALL_Y) * U),
    doorHalfWidth: r4(DOOR_WIDTH / 2 * U),
    doorHeight: r4(SERVICE_DOOR_HEIGHT * U),
    roofDeck: r4((OPS_SHELL.height - OPS_SHELL.parapet) * U),
  };
}

/** The bay OTTO-TIRE stands in (metres, the bay frame of tireSpec.ts). */
export const TIRE_BAY = bayFit();
