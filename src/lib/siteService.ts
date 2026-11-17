// ============================================================================
// siteService — each service bay's OTTO-TIRE machine and what it takes from the site, measured on the site plan: its
// load, its feed from TX-AUX and that feed's conductor and fault current, and its network from the office.
//
// Chase, 2026-11-17, asked for the service bays' robotic wheel change "with electrical design for the machine and into
// the yard itself". The machine's own lines are its CAD's (cad/otto_cad/robots/tire_bay.py, the cable schedule); this file
// carries them on from the bay's cabinet to the depot's electrical yard, as siteCanopy.ts does for the canopies' boards.
//
// THE SUPPLY: 480 V, 3 phase, 60 Hz, from TX-AUX, the one-line's unit for the battery, the building and the canopies'
// plant (otto-q-core 0810; 2,500 kVA in its power nodes, read 2026-11-17). The bays' machines are the depot's own plant, not
// charging, so they stay off the charger transformers, as the canopies' boards do.
//
// THE ROUTE (ASSUMPTION: the site's civil design sets it; this is the one the CAD's cable tray implies): from TX-AUX south
// inside the battery yard to its south fence, east along it to the strip between the yard and the office (where the
// chargers' duct bank runs, siteFeeders.FEEDER_ROUTE.stripX), north up the strip to the ops building's north wall, in
// through its west wall, and east along the building's cable tray on the inside of the north wall to the bay's cabinet. The
// tray is 4.4 m up (the CAD's TB-BTR); the conduit down from it to the cabinet's top is the CAD's (TB-CFD), not counted here.
//
// THE LOAD, by NEC 670.4(A) for industrial machinery: 125 % of the largest motor's full-load current plus the full-load
// currents of every other motor and load (the code text, NEC 2008: https://solar365.com/green-homes/national-electric-code-
// 2008/industrial-machinery/page/0/1, and a summary of it: https://codebookcity.com/codearticles/nec/necarticle670-675.htm,
// both read through a web search on 2026-11-17; check the edition the site adopts). The largest motor is the lift pump's
// 5 hp: 7.6 A at 460 V by NEC Table 430.250 (https://static.elliottelectric.com/StaticPages/ElectricalReferences/
// ElectricalTables/FullLoad_Current.aspx, read through a web search on 2026-11-17). Every servo and nutrunner drive is
// counted at its motor's rating, all at once (ASSUMPTION: the class sizes in the CAD's parts list; the drives' own input
// ratings replace them when the drives are chosen), at a drive's input power factor 0.95 and efficiency 0.92 (ASSUMPTION).
//
// THE CONDUCTOR is the smallest copper size whose 75 °C ampacity (NEC Table 310.16: 10 AWG 35 A, 8 AWG 50 A, 6 AWG 65 A,
// 4 AWG 85 A; https://elliottelectric.com/StaticPages/ElectricalReferences/ElectricalTables/Allowable_Ampacities.aspx, read
// through a web search on 2026-11-17) carries the load and that keeps the farther bay's drop under 3 %, by siteCanopy's
// copper resistance. The site's cable calculation checks its derating in the duct bank and the tray.
//
// THE FAULT CURRENT at the cabinet sets the cabinet's short-circuit rating (NEC 670.3(A) asks the machine's nameplate to
// state it). TX-AUX at 5.75 % impedance, the nominal a utility's specification gives for 750 to 3,750 kVA units, at its
// -7.5 % tolerance (5.32 %: https://esr.snopud.com/Content/Material/B-Transformers/636318.1.htm, read through a web search on
// 2026-11-17), from an infinite primary, through the feeder's copper at 20 °C (more current than at 75 °C): an upper bound.
// ============================================================================
import { AUX_TRANSFORMER, BESS_YARD, BUILDING, SERVICE_BAY_XS } from './sitePlan';
import { WALL_T } from './structurePlan';
import { FEEDER_ROUTE, NETWORK_ALLOWANCE, NETWORK_SWITCH } from './siteFeeders';
import { awgMm2, copperOhmPerM } from './siteCanopy';
import { CABINETS } from './ottoTire/tireSpec';

const M = 0.4785;                                       // metres per plan unit (sitePlan's yardstick)

type Pt = { x: number; y: number };
const pathLength = (pts: Pt[]): number =>
  pts.slice(1).reduce((s, p, i) => s + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

/** The building's cable tray: on the inside of the north wall, 0.3 m out from it, 4.4 m up (the CAD's TB-BTR). */
export const SERVICE_TRAY = { y: BUILDING.y + WALL_T + 0.3 / M, heightM: 4.4 } as const;
/** What the feed is bought by: the route x 1.03, its rise from the duct bank (0.75 m down) up the building's west wall to
 *  the tray (5.15 m), + 1.5 m up into TX-AUX's cable compartment and 0.5 m to make it off there (ASSUMPTION). The conduit
 *  down to the cabinet and the tail inside it are the CAD's. */
export const SERVICE_FEED_ALLOWANCE = { lie: 1.03, riseM: 0.75 + SERVICE_TRAY.heightM, endsM: 2.0 } as const;
/** The network fibre's rise from the office switch (ASSUMPTION: 1.5 m up) to the tray. */
export const SERVICE_NET_RISE_M = SERVICE_TRAY.heightM - 1.5;

/** The supply and the drives' input (ASSUMPTION: see the header). */
export const SERVICE_SUPPLY = { volts: 480, drivePf: 0.95, driveEff: 0.92 } as const;

/**
 * Each robot's drives, kW (the CAD's class sizes, tire_bay.py): its trolley and slew (their drives in the portal cabinet),
 * and behind the slip ring its Z, its tilt (the joint actuator's motor), the head's small drives (cluster 0.1, scroll 0.05,
 * grip 0.1, clamp 0.2, 2 rollers 0.1, 4 cup cylinders 0.2, vacuum pump 0.05) and its 5 nutrunners. Each of the portal's 2
 * travel drives, and the 2 cabinets' controls, computers, 24 V and 48 V supplies and fans.
 */
export const ROBOT_DRIVES_KW = { trolley: 0.4, slew: 0.4, z: 1.0, tilt: 1.0, headSmall: 0.8, nutrunner: 1.0, nutrunners: 5 } as const;
export const TRAVEL_DRIVE_KW = 2.0;
export const CONTROLS_KW = 2.0;
const R = ROBOT_DRIVES_KW;

/** Every load of one bay's machine at 480 V: the lift pump's motor by NEC Table 430.250, and each drive by its motor's kW. */
export const SERVICE_LOADS = [
  { name: 'Lift pump motor, 5 hp', kind: 'motor', amps: 7.6 },
  { name: 'Portal travel drives, 2 x 2.0 kW', kind: 'drive', kw: 2 * TRAVEL_DRIVE_KW },
  { name: 'West robot: trolley, slew, Z, tilt and head drives', kind: 'drive', kw: R.trolley + R.slew + R.z + R.tilt + R.headSmall },
  { name: 'West robot: 5 nutrunners, 1.0 kW each', kind: 'drive', kw: R.nutrunners * R.nutrunner },
  { name: 'East robot: trolley, slew, Z, tilt and head drives', kind: 'drive', kw: R.trolley + R.slew + R.z + R.tilt + R.headSmall },
  { name: 'East robot: 5 nutrunners, 1.0 kW each', kind: 'drive', kw: R.nutrunners * R.nutrunner },
  { name: 'Controls, computers, supplies and fans', kind: 'other', kw: CONTROLS_KW },
] as const;

/**
 * The machine's one-line below the bay's feed: what protects each supply and what it is carried in (the CAD's cabinets and
 * cable schedule name the same, cadCables.test.ts). The feed: a 3-pole breaker at TX-AUX's low-voltage board, the bay
 * cabinet's lockable main switch (NEC 670.4(B)), and a short-circuit rating the cabinet is marked with (NEC 670.3(A)). In
 * the bay cabinet: the pump's motor circuit protector and contactor, and the portal's feeder, in 4G10 through the floor
 * chain. In the portal cabinet: each robot's feeder, in 4G2.5 through its trolley chain and across its slip ring. A
 * conductor sized in mm2 is held to the AWG size it has more copper than: NEC 240.4(D) protects 14 AWG at 15 A and 10 AWG
 * at 30 A (read through a web search on 2026-11-17:
 * https://www.ecmweb.com/national-electrical-code/code-basics/article/20885916/article-240-overcurrent-protection).
 */
export const SERVICE_ONE_LINE = {
  feedBreakerA: 50,
  mainSwitchA: 60,
  sccrKa: 10,
  portalFeederA: 40, portalFeederMm2: 10,
  robotFeederA: 15, robotFeederMm2: 2.5,
} as const;

/** A load's current at 480 V: a motor's table current, a drive's or a control load's input current. */
export const loadAmps = (l: (typeof SERVICE_LOADS)[number]): number =>
  'amps' in l ? l.amps : (l.kw * 1000) / (Math.sqrt(3) * SERVICE_SUPPLY.volts * SERVICE_SUPPLY.drivePf * (l.kind === 'drive' ? SERVICE_SUPPLY.driveEff : 1));

/** The bay's supply current by NEC 670.4(A): 125 % of the largest motor's plus the sum of the rest. */
export function serviceDesignAmps(): number {
  const motors = SERVICE_LOADS.filter((l) => l.kind === 'motor').map(loadAmps);
  const largest = Math.max(...motors);
  return 1.25 * largest + SERVICE_LOADS.map(loadAmps).reduce((s, a) => s + a, 0) - largest;
}

/** A drive's input current at 480 V for its motor's kW. */
const driveAmps = (kw: number): number => (kw * 1000) / (Math.sqrt(3) * SERVICE_SUPPLY.volts * SERVICE_SUPPLY.drivePf * SERVICE_SUPPLY.driveEff);
/** NEC 670.4(A) over a group of drives: 125 % of the largest one's current plus the sum of the rest. */
const groupAmps = (kws: number[]): number => 0.25 * driveAmps(Math.max(...kws)) + kws.reduce((s, k) => s + driveAmps(k), 0);
const behindSlipRing = (): number[] => [R.z, R.tilt, R.headSmall, ...Array.from({ length: R.nutrunners }, () => R.nutrunner)];

/** One robot's supply across its slip ring: what turns with the slew (its feeder in the portal cabinet carries it). */
export const robotSupplyAmps = (): number => groupAmps(behindSlipRing());

/** The portal's supply through the floor chain: both robots, their trolleys and slews, and the 2 travel drives. */
export const portalSupplyAmps = (): number =>
  groupAmps([...behindSlipRing(), ...behindSlipRing(), R.trolley, R.slew, R.trolley, R.slew, TRAVEL_DRIVE_KW, TRAVEL_DRIVE_KW]);

/** Copper conductors by NEC Table 310.16, 75 °C column (AWG, amperes). */
export const AMPACITY_75C = [[10, 35], [8, 50], [6, 65], [4, 85], [3, 100], [2, 115]] as const;
const awgName = (n: number): string => `${n} AWG`;

/** TX-AUX (otto-q-core 0810's power nodes) and its impedance at the low end of its tolerance (see the header). */
export const TX_AUX = { kva: 2500, zPct: 5.75 * (1 - 0.075) } as const;

/** The voltage drop, per cent, of `amps` over `metres` of a conductor of `mm2` (resistance only, as siteCanopy's). */
export const dropPctAmps = (amps: number, metres: number, mm2: number): number =>
  (100 * Math.sqrt(3) * amps * copperOhmPerM(mm2) * metres) / SERVICE_SUPPLY.volts;

/** The 3-phase bolted fault current, kA, at the end of `metres` of a conductor of `mm2` from TX-AUX's secondary. */
export function faultKa(metres: number, mm2: number): number {
  const v = SERVICE_SUPPLY.volts;
  const xTx = (v * v) / (TX_AUX.kva * 1000) * (TX_AUX.zPct / 100);
  const r = ((1 / 58) * 1.02 / mm2) * metres;            // copper at 20 °C
  return v / (Math.sqrt(3) * Math.hypot(xTx, r)) / 1000;
}

export interface ServiceBayFeed {
  /** the bay: 1 is the one beside the office, 2 the east one */
  bay: 1 | 2;
  /** the cabinet's middle on the plan, plan units */
  cabinet: Pt;
  /** the feed's route from TX-AUX, plan units */
  route: Pt[];
  routeM: number;
  /** the feed's site length, metres (route x lie + rise + ends) */
  feedM: number;
  /** the network fibre's run from the office's switch to the cabinet's top, metres */
  netM: number;
  /** the conductor, its ampacity, the design current, the drop at it, and the fault current at the cabinet */
  conductor: string;
  ampacity: number;
  designAmps: number;
  dropPct: number;
  faultKa: number;
}

/** Each service bay's feed and network. */
export function serviceBayFeeds(): ServiceBayFeed[] {
  const yardSouth = BESS_YARD.y + BESS_YARD.h - 1.5;
  const amps = serviceDesignAmps();
  const bays = SERVICE_BAY_XS.map((bx, i) => {
    // the cabinet stands west of the bay's drive line by CABINETS.bay.x (the bay's frame's +X is west: smaller plan x)
    const cabinet = { x: bx - CABINETS.bay.x / M, y: BUILDING.y + WALL_T + CABINETS.bay.d / M / 2 };
    const route = [
      { x: AUX_TRANSFORMER.x, y: AUX_TRANSFORMER.y }, { x: AUX_TRANSFORMER.x, y: yardSouth }, { x: FEEDER_ROUTE.stripX, y: yardSouth },
      { x: FEEDER_ROUTE.stripX, y: SERVICE_TRAY.y }, { x: BUILDING.x, y: SERVICE_TRAY.y }, { x: cabinet.x, y: SERVICE_TRAY.y },
    ];
    const routeM = pathLength(route) * M;
    const feedM = routeM * SERVICE_FEED_ALLOWANCE.lie + SERVICE_FEED_ALLOWANCE.riseM + SERVICE_FEED_ALLOWANCE.endsM;
    const net = [{ x: NETWORK_SWITCH.x, y: NETWORK_SWITCH.y }, { x: BUILDING.x, y: SERVICE_TRAY.y }, { x: cabinet.x, y: SERVICE_TRAY.y }];
    const netM = pathLength(net) * M * NETWORK_ALLOWANCE.lie + SERVICE_NET_RISE_M + NETWORK_ALLOWANCE.endsM;
    return { bay: (i + 1) as 1 | 2, cabinet, route, routeM, feedM, netM };
  });
  // one size for both bays: the smallest that carries the load and keeps the farther bay's drop under 3 %
  const pick = AMPACITY_75C.find(([n, a]) => a >= amps && bays.every((b) => dropPctAmps(amps, b.feedM, awgMm2(n)) < 3))
    ?? AMPACITY_75C[AMPACITY_75C.length - 1];
  const [n, a] = pick;
  return bays.map((b) => ({
    ...b, conductor: `3 x ${awgName(n)} copper and an equipment ground`, ampacity: a, designAmps: amps,
    dropPct: dropPctAmps(amps, b.feedM, awgMm2(n)), faultKa: faultKa(b.feedM, awgMm2(n)),
  }));
}
