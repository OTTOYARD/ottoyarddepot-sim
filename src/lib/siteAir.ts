// ============================================================================
// siteAir — the depot's one compressed-air plant and its main, routed on the site plan.
//
// Chase, 2026-11-16, on the recommendation to make the charge arm's head electric and keep the clean arms' air knives with
// one compressor for the depot: "Okay I like your recommendation. Go build. And test it." So:
//   - the charge arms take no air at all: their plunge actuators and float lock are electric (charge_arm.py);
//   - the clean arms' air knives are the one tool that uses compressed air (about 150 L/min at 6 bar each while it blows:
//     clean_arm.py, CLN-NZK, ASSUMPTION);
//   - the wash machines have a self-sealing coupling on the beam for service (wash_gantry.py, WSH-APT); no tool on them
//     uses air;
//   - the service bays take shop air through the plant room's wall, which they share.
// The plant stands in the ops building's office block (sitePlan.AIR_PLANT). Its main leaves through the building's south
// wall, crosses under the forecourt and runs (ASSUMPTION: the civil design sets the route):
//   - to each canopy: east or west under the forecourt to the canopy's spine, south under the north collector to the
//     canopy's north end, and up its first column to the canopy's own air main, which runs under the roof over the arms'
//     headers (the clean arm CAD's CLN-AMN, 5.6 m above the deck);
//   - to the wash hall: east under the forecourt to the hall's south-west corner. Its run inside the hall to each bay's wall
//     panel is the hall's, and not counted here.
//
// THE DEMAND (ASSUMPTION): if every clean arm blew at once, 30 x 150 L/min = 4.5 m3/min of free air. The couplings and the
// shop outlets are for service and are not counted, so the plant is of the 5 m3/min class at 7 bar: a class, not a sized
// machine. A main's length is its route x 1.03 for its fittings and its lie, plus its rise (ASSUMPTION).
// ============================================================================
import { AIR_PLANT, BESS_YARD, BUILDING, CANOPIES, FORECOURT_Y, TX_YARD, WASH } from './sitePlan';

const M = 0.4785;                                       // metres per plan unit (sitePlan's yardstick)

/** The clean arms' air knives, the plant's only steady users (clean_arm.py: CLN-NZK, ASSUMPTION). */
export const AIR_DEMAND = { arms: 30, litresPerMinuteEach: 150, barG: 6 } as const;
/** All 30 at once, m3/min of free air. */
export const PEAK_FREE_AIR_M3_MIN = (AIR_DEMAND.arms * AIR_DEMAND.litresPerMinuteEach) / 1000;

/** Where the main leaves the plant room: through the building's south wall, at the room's middle. */
export const AIR_PLANT_EXIT = { x: AIR_PLANT.x + AIR_PLANT.w / 2, y: BUILDING.y + BUILDING.h } as const;

/** What a main is bought by, beyond its route: its lie and fittings, and its rise up a canopy column (ASSUMPTION: 0.8 m of
 *  cover under the forecourt and the collector, and the canopy main 5.6 m above the deck). */
export const AIR_ALLOWANCE = { lie: 1.03, canopyRiseM: 0.8 + 5.6 } as const;

export interface AirMain {
  /** 'canopy A' .. 'canopy C', or 'wash hall' */
  to: string;
  /** the route, plan units, from the plant room's wall to where the main meets what it feeds */
  route: { x: number; y: number }[];
  /** the main's length, metres (route x lie, + the rise for a canopy) */
  lengthM: number;
}

const pathLength = (pts: { x: number; y: number }[]): number =>
  pts.slice(1).reduce((s, p, i) => s + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

/** The main to each canopy and to the wash hall. */
export function airMains(): AirMain[] {
  const e = AIR_PLANT_EXIT;
  const out: AirMain[] = CANOPIES.map((c) => {
    const route = [{ x: e.x, y: e.y }, { x: e.x, y: FORECOURT_Y }, { x: c.cx, y: FORECOURT_Y }, { x: c.cx, y: c.y }];
    return { to: `canopy ${c.id}`, route, lengthM: pathLength(route) * M * AIR_ALLOWANCE.lie + AIR_ALLOWANCE.canopyRiseM };
  });
  const wash = [{ x: e.x, y: e.y }, { x: e.x, y: FORECOURT_Y }, { x: WASH.x, y: FORECOURT_Y }, { x: WASH.x, y: WASH.y + WASH.h }];
  out.push({ to: 'wash hall', route: wash, lengthM: pathLength(wash) * M * AIR_ALLOWANCE.lie });
  return out;
}

/** The yards a main may not cross. */
export function airKeepOuts(): { name: string; x0: number; x1: number; y0: number; y1: number }[] {
  return [
    { name: 'battery yard', x0: BESS_YARD.x, x1: BESS_YARD.x + BESS_YARD.w, y0: BESS_YARD.y, y1: BESS_YARD.y + BESS_YARD.h },
    { name: 'transformer yard', x0: TX_YARD.x, x1: TX_YARD.x + TX_YARD.w, y0: TX_YARD.y, y1: TX_YARD.y + TX_YARD.h },
  ];
}
