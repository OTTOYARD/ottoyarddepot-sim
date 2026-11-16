// ============================================================================
// siteCanopy — what each fast-charger canopy's OTTO-CLEAN ARMs take from the site, measured on the site plan: the
// canopy's board and its feed from TX-AUX, the board's network from the office, each arm's supply and network cables
// from the board, and the vacuum main from the canopy's producer to its arms.
//
// Chase, 2026-11-16, on closing the last open lines in the robots' cable schedules (the clean arm's CLN-SPW and CLN-SNW,
// which ended "add it from the site's layout"): "Sounds great. Yeah just keep going." It is the 30-post build's (as
// siteFeeders.ts is): 3 canopies of 10 fast chargers, an OTTO-CLEAN ARM over each.
//
// THE PLANT stands at grade under the canopy's south end, either side of its last spine column (sitePlan.CANOPY_PLANT):
// the board west of it, the vacuum producer east of it.
//
// AN ARM'S CABLES (ASSUMPTION: the site's electrical design sets the route; this is the one the CAD's tray implies):
//   1. out of the board's top and across to a cable ladder on the last spine column's west face;
//   2. up the ladder to the canopy's cable tray level (the clean arm CAD's CLN-CTY: 50 mm over the arm headers' tops);
//   3. across, along the column's rafter, to the cable tray on the arm's side of the spine, which runs along the canopy
//      over every header on that side (the CAD's tray, on the line of the arms' drop columns: within a few hundred mm);
//   4. north along that tray to the arm's drop, where the CAD's conduit takes the cable down to its supply enclosure.
// The conduit and the enclosure's tail are the CAD's (clean_arm.py), not counted here. A cable is bought by its route x
// 1.03 (its lie in the tray) and its rise, + a tail inside the board (ASSUMPTION: 1.0 m to the breaker, 1.5 m to the
// switch with a service loop).
//
// THE VACUUM MAIN goes from the producer's top up the same column's east face to the vacuum main's level (the CAD's
// CLN-VMN, 55 mm over the headers' tops), across the rafter to each side, and north over each side's headers to the
// farthest arm. Its size is the clean arm CAD's ASSUMPTION (DN 100); the plant is not sized here.
//
// THE BOARD'S FEED comes from TX-AUX, the one-line's unit for the battery, the building and the solar (otto-q-core 0810):
// the canopies' arms and producers are the depot's own plant, not charging, so they stay off the charger transformers.
// Its route (ASSUMPTION): south inside the battery yard to its south fence, east along it to the strip where the charger
// feeds' duct bank runs (siteFeeders.FEEDER_ROUTE.stripX), and on with them: south to under the forecourt, east to the
// canopy's spine, south along it under the slab to the board. Its load: 10 arms of about 2.4 kW (the arm's motors:
// clean_arm.py, SUPPLY_CABLE_OD) and a producer of about 3 kW per working arm (clean_arm.py, VAC), all at once, at
// 480 V and power factor 0.9 (ASSUMPTION). Its conductor is the smallest size that keeps the farthest board's drop under
// 3 %, worked by siteFeeders' copper resistance (IEC 28 and the copper temperature coefficient, both sourced there); the
// site's cable calculation sets the size and checks its ampacity.
//
// THE NETWORK: the board holds the canopy's network switch, fed with single-mode fibre in the same duct bank from the
// office's switch (as each post's is: siteFeeders.ts), and each arm takes a Cat 6A cable from it. A twisted-pair channel
// may be at most 90 m of fixed cable and 10 m of cords (ANSI/TIA-568-B, sourced in siteFeeders.ts): every arm's run is
// held under 90 m by siteCanopy.test.ts.
// ============================================================================
import { AUX_TRANSFORMER, BESS_YARD, BUILDING, CANOPIES, canopyPlants, generateStallsV2, type CanopyPlant } from './sitePlan';
import { CANOPY_COLUMN, cabinetFootprints, canopyColumnYs } from './structurePlan';
import { FEEDER_ROUTE, NETWORK_ALLOWANCE, NETWORK_SWITCH } from './siteFeeders';
import { PURLIN_UNDERSIDE_U, canopyRoofAt, placeCleanArm } from './ottoCleanArm/cleanArmPlacement';

const M = 0.4785;                                       // metres per plan unit (sitePlan's yardstick)

type Pt = { x: number; y: number };
const pathLength = (pts: Pt[]): number =>
  pts.slice(1).reduce((s, p, i) => s + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

/** The DN 100 vacuum main (clean_arm.py, VAC_MAIN_OD: ASSUMPTION). */
export const VACUUM_MAIN_OD_MM = 110;
/** The cable ladder on the last spine column's west face: its middle this far out from the spine, plan units (the steel's
 *  half-width and 0.1 u off its face). */
export const RISER_OFF_U = CANOPY_COLUMN / 2 + 0.1;
/** The vacuum riser on its east face: the pipe's axis this far out, plan units (0.05 u off the face). */
export const VACUUM_RISER_OFF_U = CANOPY_COLUMN / 2 + VACUUM_MAIN_OD_MM / 1000 / 0.4785 / 2 + 0.05;
/** What an arm's cable is bought by, beyond its route and its rise (ASSUMPTION: see the header). */
export const ARM_CABLE_ALLOWANCE = { lie: 1.03, supplyTailM: 1.0, networkTailM: 1.5 } as const;
/** What the board's feed is bought by: the route x 1.03, + 1.5 m up into TX-AUX's cable compartment, 0.5 m to make it
 *  off there, 0.75 m up from the duct bank into the board and 1.0 m inside it to its main breaker (ASSUMPTION). */
export const BOARD_FEED_ALLOWANCE = { lie: 1.03, endsM: 3.75 } as const;
/** An arm's supply at 480 V, 3 phase (its cable's 4 cores), and the board's load (ASSUMPTION: see the header). */
export const CANOPY_LOAD = { armKw: 2.4, producerKwPerArm: 3.0, volts: 480, pf: 0.9 } as const;

/** Copper's resistance, ohm per metre at 75 °C for a conductor of `mm2` (siteFeeders.FEED's: IACS at 20 °C, +0.00393 per
 *  °C, +2 % for the stranding). */
export const copperOhmPerM = (mm2: number): number => ((1 / 58) * (1 + 0.00393 * (75 - 20)) * 1.02) / mm2;
/** An AWG size's area, mm2 (ASTM B258's diameter, 0.127 mm x 92^((36 - n) / 39); 1/0 is n = 0, 2/0 is n = -1). */
export const awgMm2 = (n: number): number => (Math.PI / 4) * (0.127 * 92 ** ((36 - n) / 39)) ** 2;
const AWG_SIZES = [6, 4, 3, 2, 1, 0, -1, -2, -3] as const;
const awgName = (n: number): string => (n > 0 ? `${n} AWG` : `${1 - n}/0 AWG`);

/** The voltage drop, per cent, of a 3-phase load of `kw` at `volts` and `pf` over `metres` of a conductor of `mm2`. */
export function dropPct(kw: number, metres: number, mm2: number, volts = CANOPY_LOAD.volts, pf = CANOPY_LOAD.pf): number {
  const amps = (kw * 1000) / (Math.sqrt(3) * volts * pf);
  return (100 * Math.sqrt(3) * amps * copperOhmPerM(mm2) * metres) / volts;
}

/** The canopy's cable tray level and vacuum main level at an arm `d` plan units out from the spine, metres above grade:
 *  the CAD's 50 mm and 110 mm over the header's top (clean_arm.py: y_tray, y_main), the header's top being the purlins'
 *  underside (cleanArmPlacement). */
export const trayLevelM = (d: number): number => (canopyRoofAt(d) - PURLIN_UNDERSIDE_U) * M + 0.05;
export const vacuumMainLevelM = (d: number): number => (canopyRoofAt(d) - PURLIN_UNDERSIDE_U) * M + 0.11;

export interface ArmRun {
  /** the renderer's stall id (the twin's is NASH-<id>) */
  stall: string;
  canopy: CanopyPlant['canopy'];
  side: 1 | -1;
  /** the route, plan units: the board's top, the ladder's foot, the ladder's head, the tray on the arm's side, the drop */
  route: Pt[];
  /** the rise up the ladder, metres */
  riseM: number;
  /** the route's horizontal length plus its rise, metres */
  routeM: number;
  /** the supply cable's site length and the network cable's, metres (route x lie + the board's tail) */
  supplyM: number;
  networkM: number;
  /** the supply's voltage drop at the arm's full load, per cent of 480 V, in 4 x 2.5 mm2 (the CAD's supply cable) */
  supplyDropPct: number;
}

export interface CanopyBoard {
  canopy: CanopyPlant['canopy'];
  /** the feed's route from TX-AUX, plan units */
  route: Pt[];
  routeM: number;
  /** a feed conductor's length, metres (route x lie + ends) */
  feedM: number;
  /** the fibre's run from the office's switch, metres */
  netM: number;
  /** the board's load, kW */
  loadKw: number;
  /** the conductor chosen (one size for the 3 boards) and the drop it gives this board, per cent of 480 V */
  conductor: string;
  dropPct: number;
}

export interface VacuumMain {
  canopy: CanopyPlant['canopy'];
  /** the route from the producer's top to the farthest arm on each side, metres (riser, both rafters, both runs) */
  routeM: number;
  /** the riser's rise, metres */
  riseM: number;
}

interface Layout {
  stalls: ReturnType<typeof generateStallsV2>;
  plants: CanopyPlant[];
  /** each canopy's last spine column, plan y */
  colY: Map<CanopyPlant['canopy'], number>;
}

function layout(): Layout {
  const stalls = generateStallsV2(30, 0);
  const cabs = cabinetFootprints(stalls);
  const plants = canopyPlants(3);
  const colY = new Map(CANOPIES.map((c) => [c.id, Math.max(...canopyColumnYs(c, cabs, stalls))] as const));
  return { stalls, plants, colY };
}

const mid = (a: number, b: number) => (a + b) / 2;

/** Each OTTO-CLEAN ARM's supply and network cables from its canopy's board, in the 30-post build, by stall. */
export function armRuns(): ArmRun[] {
  const { stalls, plants, colY } = layout();
  const out: ArmRun[] = [];
  for (const s of stalls) {
    if (s.type !== 'dcfc') continue;
    const arm = placeCleanArm(s.position.x, s.position.y, s.position.angle, 0);
    const plant = plants.find((p) => p.cx === arm.mount.cx)!;
    const yCol = colY.get(plant.canopy)!;
    const top = { x: mid(plant.board.x0, plant.board.x1), y: mid(plant.board.y0, plant.board.y1) };
    const ladder = { x: plant.cx - RISER_OFF_U, y: yCol };
    const tray = { x: plant.cx + arm.mount.side * arm.mount.d, y: yCol };
    const drop = { x: tray.x, y: arm.j1Plan.y };
    const route = [top, { x: ladder.x, y: top.y }, ladder, tray, drop];
    const riseM = trayLevelM(arm.mount.d) - plant.board.h * M;
    const routeM = pathLength(route) * M + riseM;
    const supplyM = routeM * ARM_CABLE_ALLOWANCE.lie + ARM_CABLE_ALLOWANCE.supplyTailM;
    const networkM = routeM * ARM_CABLE_ALLOWANCE.lie + ARM_CABLE_ALLOWANCE.networkTailM;
    out.push({
      stall: s.id, canopy: plant.canopy, side: arm.mount.side, route, riseM, routeM, supplyM, networkM,
      supplyDropPct: dropPct(CANOPY_LOAD.armKw, supplyM, 2.5),
    });
  }
  return out;
}

/** Each canopy's board: its feed from TX-AUX and its fibre from the office, in the 30-post build. */
export function canopyBoards(): CanopyBoard[] {
  const { plants } = layout();
  const runs = armRuns();
  const { stripX, forecourtY } = FEEDER_ROUTE;
  const yardSouth = BESS_YARD.y + BESS_YARD.h - 1.5;
  const boards = plants.map((p) => {
    const at = { x: mid(p.board.x0, p.board.x1), y: mid(p.board.y0, p.board.y1) };
    const route = [
      { x: AUX_TRANSFORMER.x, y: AUX_TRANSFORMER.y }, { x: AUX_TRANSFORMER.x, y: yardSouth }, { x: stripX, y: yardSouth },
      { x: stripX, y: forecourtY }, { x: p.cx, y: forecourtY }, { x: p.cx, y: at.y }, at,
    ];
    const routeM = pathLength(route) * M;
    const feedM = routeM * BOARD_FEED_ALLOWANCE.lie + BOARD_FEED_ALLOWANCE.endsM;
    const net = [
      { x: NETWORK_SWITCH.x, y: NETWORK_SWITCH.y }, { x: stripX, y: NETWORK_SWITCH.y }, { x: stripX, y: forecourtY },
      { x: p.cx, y: forecourtY }, { x: p.cx, y: at.y }, at,
    ];
    const netM = pathLength(net) * M * NETWORK_ALLOWANCE.lie + NETWORK_ALLOWANCE.endsM;
    const arms = runs.filter((r) => r.canopy === p.canopy).length;
    const loadKw = arms * (CANOPY_LOAD.armKw + CANOPY_LOAD.producerKwPerArm);
    return { canopy: p.canopy, route, routeM, feedM, netM, loadKw };
  });
  // one conductor size for all 3 boards: the smallest that keeps the farthest board's drop under 3 %
  const n = AWG_SIZES.find((k) => boards.every((b) => dropPct(b.loadKw, b.feedM, awgMm2(k)) < 3)) ?? AWG_SIZES[AWG_SIZES.length - 1];
  return boards.map((b) => ({ ...b, conductor: `${awgName(n)} copper`, dropPct: dropPct(b.loadKw, b.feedM, awgMm2(n)) }));
}

/** Each canopy's vacuum main, in the 30-post build. */
export function vacuumMains(): VacuumMain[] {
  const { plants, colY } = layout();
  const runs = armRuns();
  return plants.map((p) => {
    const yCol = colY.get(p.canopy)!;
    const mine = runs.filter((r) => r.canopy === p.canopy);
    const d = Math.abs(mine[0].route[3].x - p.cx);
    const top = { x: mid(p.vacuum.x0, p.vacuum.x1), y: mid(p.vacuum.y0, p.vacuum.y1) };
    const riser = { x: p.cx + VACUUM_RISER_OFF_U, y: yCol };
    const toRiser = pathLength([top, { x: riser.x, y: top.y }, riser]);
    let horiz = toRiser;
    for (const side of [1, -1] as const) {
      const far = Math.min(...mine.filter((r) => r.side === side).map((r) => r.route[4].y));
      horiz += Math.abs(p.cx + side * d - riser.x) + (yCol - far);
    }
    const riseM = vacuumMainLevelM(d) - p.vacuum.h * M;
    return { canopy: p.canopy, routeM: horiz * M + riseM, riseM };
  });
}

/** What a board's feed may not cross (TX-AUX's own yard is where it starts, so the battery yard is not one). */
export function canopyKeepOuts(): { name: string; x0: number; x1: number; y0: number; y1: number }[] {
  return [{ name: 'office and service bays', x0: BUILDING.x, x1: BUILDING.x + BUILDING.w, y0: BUILDING.y, y1: BUILDING.y + BUILDING.h }];
}
