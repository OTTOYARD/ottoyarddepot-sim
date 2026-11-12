/**
 * OTTO-WASH — the touchless wash machine in each wash bay (docs/OTTO-WASH.md).
 *
 * Chase, 2026-10-20: "Wash bays are robotic too. Car pulls in and the machine moves
 * back and forth over it several times to wash and rinse and blow dry before vehicle
 * leave." So each bay has ONE machine: a portal gantry on two floor rails that travels
 * over the parked car. The car does not move while it works.
 *
 * Chase, 2026-11-11: "I don't think it makes sense to have giant brushes that will be
 * whipping the vehicle since a lot of AV's have extended areas with cameras and and lidar
 * ... much more delicate, and maybe only rinses and dries, then ... an robot arm will locate
 * all sensors and hand wipe gently with a cloth ... I don't think doors should open
 * whatsoever once in the large external wash bay." So NOTHING THAT TURNS TOUCHES THE CAR:
 *   1. the arch soaks the car, washes it with water jets, and rinses it;
 *   2. the air knives dry it;
 *   3. two arms come down from the beam and wipe each sensor with a soft pad;
 *   4. the doors stay shut. The cabin is cleaned at the fast charger (otto-q-core 0815).
 *
 * UNITS: PLAN UNITS throughout (1 u = 0.4785 m), heights above grade in plan units too,
 * because the wash hall is drawn in them (structurePlan.WASH_SHELL). The car's shape
 * comes from vehicleEnvelope.ts in metres and is converted in carShape.ts, once.
 *
 * FRAME: the BAY's. `x` across the bay from its drive line (the car's centreline),
 * `dy` along it from the parked car's centre, NEGATIVE = NORTH = toward the car's nose
 * (a car in a bay parks facing north, TwinMotionDriver.parkedHeading). The car enters
 * through the south door and leaves through the north one.
 *
 * THE MACHINE, side on (car facing left, north), along the beam's 4.1 u depth:
 *
 *     ┌──────────────── beam ────────────────┐   at 6.9..7.6 u
 *     │ arch │   wipe arms' cross rail   │ air │   dy -1.6, -0.2, +1.9 from the gantry's line
 *     legs ride the rails at x = ±6.8, outside the door opening (±5.5)
 *
 * Every moving part sits inside the portal. Stowed, the portal clears a car and its roof
 * pod with room to spare, so a car drives in under the machine and out under it.
 *
 * TIMES are SIM seconds, like the cleaning arm's: the twin times the seat (otto-q-core
 * 0746, 0762) and this machine plays its program inside it.
 */

/** Travel of the gantry's centreline, from the parked car's centre (plan u). */
export const WASH_TRAVEL = {
  /** north end: the air knives' line stands 1 u ahead of the car's nose (the car's half-length is 4.9 u) */
  north: -7.8,
  /** south end: the arch's line stands 1.1 u behind its tail */
  south: 7.6,
} as const;

/** Where the machine waits between cars: the north end, so an arriving car pulls up to its stop light. */
export const WASH_HOME_DY = WASH_TRAVEL.north;

export const WASH_GANTRY = {
  /** the portal's legs ride the rails at this offset from the drive line */
  legX: 6.8,
  /** leg section: across x, along the beam (dy), and its centre along the beam */
  leg: { w: 0.6, d: 3.6, dy: 0.15, top: 6.9 },
  /** the trolley under each leg, on its rail */
  trolley: { w: 1.0, d: 4.2, h: 0.55 },
  /** the beam across the top, along the gantry's line from dy0 to dy1 */
  beam: { y0: 6.9, y1: 7.6, dy0: -1.9, dy1: 2.2 },
  /** floor rails: from the car's centre, plan u */
  rail: { w: 0.32, h: 0.14, from: -10.0, to: 10.2 },
  /** the spray arch on the beam's north face: a soak circuit and a jet circuit, one ring of nozzles each */
  arch: { dy: -1.6, x: 5.6, top: 6.5, r: 0.13, nozzles: 9 },
  /** air knives on the beam's south side: one over the roof, one beside each flank */
  dryer: {
    dy: 1.9,
    top: { halfLen: 1.9, d: 0.4, h: 0.35, gap: 0.5, retractY: 6.0 },
    side: { w: 0.35, d: 0.4, y0: 0.55, y1: 3.0, gap: 0.55, retractX: 5.6 },
  },
  /**
   * The two sensor-wipe arms, one each side, on a cross rail under the beam. Each has a carriage that
   * slides across the bay, a mast that lowers the pad, and a wrist that turns the pad to face the car.
   */
  wipe: {
    /** the cross rail's line along the beam, from the gantry's line */
    dy: -0.2,
    /** where a mast parks: outboard of the car, 1.1 m off its flank, where the side brushes of the first machine stood */
    parkX: 4.3,
    /** the pad's height with the mast up. The masts park beside the car's path, not over it, so they need not clear the roof */
    stowY: 3.5,
    /** the pad: a soft disc on a sprung head (radius, thickness) */
    padR: 0.26, padT: 0.12,
    /** the wrist's forearm: the pad's centre stands this far from the mast's axis, the way the pad faces */
    forearm: 0.35,
    /** the mast's section and the carriage's block */
    mastR: 0.1, carriage: { w: 0.7, d: 0.6, h: 0.4 },
  },
  /** stop light on the beam's south face, toward an arriving car */
  light: { y: 6.35, x: 0 },
} as const;

/**
 * The program, in order: the six passes, then the sensor wipe, then home.
 *
 * `cabin_hold` is the one phase of a DETAIL seat that a wash seat does not have. The twin still seats a car for a
 * detail when no fast charger's arm reached it (otto-q-core 0815 §3), and times a cabin clean in that seat. The
 * machine does no cabin work and no door opens here: it stands parked and dry for that time, before the water.
 */
export type WashPhase =
  | 'home'
  | 'settle'
  | 'cabin_hold'
  | 'soak' | 'wash_1' | 'wash_2' | 'rinse' | 'dry_1' | 'dry_2'
  | 'arms_down' | 'wipe_front' | 'wipe_sides' | 'wipe_roof' | 'wipe_rear' | 'arms_up' | 'to_home'
  | 'done'
  | 'retract' | 'return';

export const WASH_EXTERIOR: readonly WashPhase[] = ['soak', 'wash_1', 'wash_2', 'rinse', 'dry_1', 'dry_2'];
export const WASH_WIPE: readonly WashPhase[] = ['arms_down', 'wipe_front', 'wipe_sides', 'wipe_roof', 'wipe_rear', 'arms_up', 'to_home'];

/** The whole program for a seat, home to home. */
export function washChain(interior: boolean): readonly WashPhase[] {
  return interior
    ? ['settle', 'cabin_hold', ...WASH_EXTERIOR, ...WASH_WIPE, 'done']
    : ['settle', ...WASH_EXTERIOR, ...WASH_WIPE, 'done'];
}

/** The four places the arms wipe, in order. */
export type WipeStation = 'front' | 'sides' | 'roof' | 'rear';
export const WIPE_STATIONS: readonly WipeStation[] = ['front', 'sides', 'roof', 'rear'];
export const isWipe = (p: WashPhase): p is `wipe_${WipeStation}` => p.startsWith('wipe_');
export const stationOf = (p: `wipe_${WipeStation}`): WipeStation => p.slice(5) as WipeStation;

/** The passes over the car, each from one end of the travel to the other. */
export type WashPass = 'soak' | 'wash_1' | 'wash_2' | 'rinse' | 'dry_1' | 'dry_2';
export const isPass = (p: WashPhase): p is WashPass => (WASH_EXTERIOR as readonly string[]).includes(p);

/** Which way each pass travels: from home (north) on the odd passes, back to it on the even ones. */
export const PASS_FROM: Readonly<Record<WashPass, number>> = {
  soak: WASH_TRAVEL.north, wash_1: WASH_TRAVEL.south, wash_2: WASH_TRAVEL.north,
  rinse: WASH_TRAVEL.south, dry_1: WASH_TRAVEL.north, dry_2: WASH_TRAVEL.south,
};
export const passTo = (p: WashPass): number =>
  PASS_FROM[p] === WASH_TRAVEL.north ? WASH_TRAVEL.south : WASH_TRAVEL.north;

/** What each pass does. */
export const PASS_KIND: Readonly<Record<WashPass, 'soak' | 'jet' | 'rinse' | 'dry'>> = {
  soak: 'soak', wash_1: 'jet', wash_2: 'jet', rinse: 'rinse', dry_1: 'dry', dry_2: 'dry',
};

/**
 * A pass's length at nominal pace, sim seconds. Six passes of 15.4 u (7.4 m, 24 ft) in 180 s is
 * 44 m (145 ft) in 3 minutes, 0.25 m/s. Read 2026-10-21:
 *   - a rollover on a 23 ft guiderail "would travel 138' in six passes (3 minutes)"
 *     (carwashforum.com, 2015-10-12, https://carwashforum.com/goto/post?id=99620);
 *   - an in-bay automatic runs about 4 minutes a car (ccentral.ca,
 *     https://ccentral.ca/experts-weigh-small-footprint-car-wash-opportunities, via search results);
 *   - a gantry's dryer pass at 0.33 ft/s (0.1 m/s) in US 6,863,739
 *     (https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6863739, via search results).
 * With no brush to dwell on the car, a pass is a steady travel. The six passes (180 s), the sensor wipe
 * (WIPE_FIXED_S) and the settle and finish make 4.6 minutes at nominal pace. The twin's robotic wash allows a
 * 4.0-minute program (otto-q-core 0746, robotic_wash_min 5.0), so the passes run at about 0.8 of nominal there.
 */
export const PASS_NOMINAL_S: Readonly<Record<WashPass, number>> = {
  soak: 25, wash_1: 35, wash_2: 35, rinse: 25, dry_1: 30, dry_2: 30,
};
export const PASSES_NOMINAL_S = Object.values(PASS_NOMINAL_S).reduce((a, b) => a + b, 0);

/**
 * Fixed phases, sim seconds. The passes and `cabin_hold` are paced to the seat; `return` by the way home.
 * A wipe phase is: pads out to clear the car, travel to the place, close in, wipe, back out. ASSUMPTION: no public
 * source gives a measured time for a robot arm wiping a car's sensors. 14 to 18 s a place is a gentle hand's pace.
 */
export const WASH_PHASE_S: Readonly<Record<Exclude<WashPhase, WashPass | 'home' | 'cabin_hold' | 'return'>, number>> = {
  settle: 2.5,
  arms_down: 3, wipe_front: 14, wipe_sides: 14, wipe_roof: 16, wipe_rear: 18, arms_up: 3, to_home: 17,
  done: 2,
  // a seat that ends mid-program: air knives and pads come off the car at their own speed, never hurried
  retract: 2,
};

/** The sensor wipe's fixed length, sim seconds. */
export const WIPE_FIXED_S = WASH_WIPE.reduce((a, p) => a + WASH_PHASE_S[p as keyof typeof WASH_PHASE_S], 0);

/** A detail seat's cabin hold when the twin publishes no end: the twin's ten minutes in the cabin (0746). */
export const CABIN_HOLD_NOMINAL_S = 600;
export const CABIN_HOLD_MIN_S = 20;
export const CABIN_HOLD_MAX_S = 1800;

/** How far the passes may be slowed or hurried to fit the seat. */
export const PASS_SCALE_MIN = 0.4;
export const PASS_SCALE_MAX = 2.0;

/** The program ends this long before the twin's seat does, so the machine is home when the car may go. */
export const WASH_END_MARGIN_S = 8;

/** The air knives close in (and open out) over this share of a dry pass, at the pass's two ends, standing still. */
export const PASS_EASE = 0.12;

/** Return travel: how fast the machine goes home when the seat ends before its program does. */
export const WASH_ABORT_SPEED = 3;
/** Return travel at nominal speed, plan u per sim second (0.38 m/s, a gantry's quick traverse). */
export const WASH_RETURN_UPS = 0.8;

/** The share of a wipe phase spent on each part: out to clear and travel, close in, wipe, back out. */
export const WIPE_PARTS = { travel: 0.42, close: 0.14, wipe: 0.30, open: 0.14 } as const;
