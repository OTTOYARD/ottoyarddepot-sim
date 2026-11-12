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
 * ... I don't think doors should open whatsoever once in the large external wash bay."
 *
 * Chase, 2026-11-12: "the final sensor polisher should be swivel/mechanical arms similar to
 * robocharging arm ... able to move like a hand almost to reach difficult angles of cameras
 * and sensors ... the wash arch ... stows at the front of the wash entrance ... then the
 * detail arms come from the opposite end of the ways bay (the exit side) and come down each
 * of their rails independently ... and stow before the vehicle departs the bay completely.
 * This will be more like an assembly line."
 *
 * So the bay is a short line of machines round a car that stands still:
 *   1. THE GANTRY (arch and air knives) waits at the ENTRANCE (south). It soaks the car,
 *      washes it with water jets, rinses it and dries it in six passes, and stows there.
 *   2. TWO DETAIL ARMS, one each side, wait at the EXIT (north), each folded on its own
 *      floor track. Each is the OTTO-CHARGE ARM's own six-axis arm with a polishing head. They
 *      come down their tracks and polish every sensor with a soft pad, each on its own
 *      timing, and go back to their docks.
 *   3. No brush touches the car and no door opens. The cabin is cleaned at the fast
 *      charger (otto-q-core 0815).
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
 * THE GANTRY, side on (car facing left, north), along the beam's 4.1 u depth:
 *
 *     ┌──────────── beam ────────────┐   at 6.9..7.6 u
 *     │ arch │                  │ air │   dy -1.6 and +1.9 from the gantry's line
 *     legs ride the rails at x = ±6.8, outside the door opening (±5.5)
 *
 * THE DETAIL ARMS' TRACKS run at x = ±4.39 u (2.10 m), inside the gantry's rails, from the docks
 * north of the gantry's travel to the car's tail. The gantry passes over the tracks, never over
 * an arm: the docks stand north of where the gantry goes.
 *
 * TIMES are SIM seconds, like the cleaning arm's: the twin times the seat (otto-q-core
 * 0746, 0762) and this machine plays its program inside it.
 */

/** Travel of the gantry's centreline, from the parked car's centre (plan u). */
export const WASH_TRAVEL = {
  /** north end: the air knives' line stands 1 u ahead of the car's nose (the car's half-length is 4.9 u) */
  north: -7.8,
  /** south end of a pass: the arch's line stands 1.1 u behind its tail */
  south: 7.6,
  /**
   * where it stows: 4 u (1.91 m) farther south, at the entrance. Its north face is then 4.62 m from the car's centre,
   * 2.3 m behind the tail: room for a detail arm working on the tail from a carriage 3.0 m from the car's centre.
   */
  home: 11.6,
} as const;

/**
 * Where the gantry waits between cars and while the detail arms work: stowed at the entrance. A car drives in under
 * it and on to the bay's centre. The first pass starts from here and the last pass ends here.
 */
export const WASH_HOME_DY = WASH_TRAVEL.home;

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
  rail: { w: 0.32, h: 0.14, from: -10.0, to: 14.2 },
  /** the spray arch on the beam's north face: a soak circuit and a jet circuit, one ring of nozzles each */
  arch: { dy: -1.6, x: 5.6, top: 6.5, r: 0.13, nozzles: 9 },
  /** air knives on the beam's south side: one over the roof, one beside each flank */
  dryer: {
    dy: 1.9,
    top: { halfLen: 1.9, d: 0.4, h: 0.35, gap: 0.5, retractY: 6.0 },
    side: { w: 0.35, d: 0.4, y0: 0.55, y1: 3.0, gap: 0.55, retractX: 5.6 },
  },
  /**
   * The two detail arms' tracks and docks (the arm itself is cobotSpec's, in metres: DETAIL_ARM below).
   */
  detail: {
    /** each track's line from the drive line: 2.10 m, 1.14 m off the flank */
    trackX: 4.3887,
    /** the dock: each arm's J1 axis when parked, north of the gantry's travel (its trolleys reach -9.9) */
    dockDy: -10.9,
    /** the carriage's south stop: 3.06 m from the car's centre, 0.72 m past its tail, for the tail's sensors */
    trackTo: 6.4,
    /** the polishing pad: a soft disc (radius 60 mm), small enough to fit between the roof pod and the roof */
    padR: 0.1254,
  },
  /** stop light on the beam's south face, toward an arriving car */
  light: { y: 6.35, x: 0 },
} as const;

/**
 * The program, in order: the gantry's six passes, then the detail arms' work, then everything stowed.
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
  | 'arms_out' | 'wipe_front' | 'wipe_sides' | 'wipe_roof' | 'wipe_rear' | 'arms_stow'
  | 'done'
  | 'retract' | 'return';

export const WASH_EXTERIOR: readonly WashPhase[] = ['soak', 'wash_1', 'wash_2', 'rinse', 'dry_1', 'dry_2'];
export const WASH_WIPE: readonly WashPhase[] = ['arms_out', 'wipe_front', 'wipe_sides', 'wipe_roof', 'wipe_rear', 'arms_stow'];

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

/** Which way each pass travels: from home (south, the entrance) on the odd passes, back to it on the even ones. */
export const PASS_FROM: Readonly<Record<WashPass, number>> = {
  soak: WASH_HOME_DY, wash_1: WASH_TRAVEL.north, wash_2: WASH_TRAVEL.south,
  rinse: WASH_TRAVEL.north, dry_1: WASH_TRAVEL.south, dry_2: WASH_TRAVEL.north,
};
/** The last pass ends at the stow; the others turn at the ends of the car. */
export const passTo = (p: WashPass): number =>
  p === 'dry_2' ? WASH_HOME_DY : PASS_FROM[p] === WASH_TRAVEL.north ? WASH_TRAVEL.south : WASH_TRAVEL.north;

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
 * With no brush to dwell on the car, a pass is a steady travel. The six passes (180 s), the detail arms' work
 * (WIPE_FIXED_S) and the settle and finish make 4.5 minutes at nominal pace, which is the twin's program since
 * 2026-11-11 (otto-q-core robotic_wash_min 5.5 at the twin depot: pull in 0.5, program 4.5, pull out 0.5).
 */
export const PASS_NOMINAL_S: Readonly<Record<WashPass, number>> = {
  soak: 25, wash_1: 35, wash_2: 35, rinse: 25, dry_1: 30, dry_2: 30,
};
export const PASSES_NOMINAL_S = Object.values(PASS_NOMINAL_S).reduce((a, b) => a + b, 0);

/**
 * Fixed phases, sim seconds. The passes and `cabin_hold` are paced to the seat; `return` by the way home.
 * `arms_out`: each arm unfolds at its dock and rides to the nose. A wipe phase gives each of its sensors a move, a
 * touch, a polish and a lift. `arms_stow`: each arm tucks, rides to its dock and folds. ASSUMPTION: no public source
 * gives a measured time for a robot arm polishing a car's sensors. About 5 s a sensor is a careful hand's pace.
 */
export const WASH_PHASE_S: Readonly<Record<Exclude<WashPhase, WashPass | 'home' | 'cabin_hold' | 'return'>, number>> = {
  settle: 2.5,
  arms_out: 10, wipe_front: 21, wipe_sides: 21, wipe_roof: 38, wipe_rear: 40, arms_stow: 15,
  done: 2,
  // a seat that ends mid-program: the air knives come off the car and the arms tuck, at their own speed, never hurried
  retract: 9,
};

/** The detail arms' fixed length, sim seconds. */
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

/** The share of one sensor's time spent on each part: the move to it, the touch, the polish, the lift. */
export const WIPE_PARTS = { move: 0.45, touch: 0.075, polish: 0.4, lift: 0.075 } as const;

/**
 * THE DETAIL ARM, in metres and radians. It is the OTTO-CHARGE ARM's arm (cobotSpec.OTTO_CHARGE_ARM: the same links,
 * joints and limits, solved by the same cobotIK) with a shorter tool, standing on a track carriage at the charge arm's
 * own mount height.
 */
export const DETAIL_ARM = {
  /** J6 flange to the pad's face: force sensor 40, floating joint 30, backing plate 8, pad 62 mm */
  toolM: 0.14,
  /** parked: the upper arm leans along the track and the forearm folds back over it; the tool hangs straight down */
  stow: { j2: 0.30, j3: 2.30 },
  /** how far the pad stands off a sensor before it touches, and the safe shell it moves in between sensors */
  hoverM: 0.15, safeM: 0.40,
  /** the height the pad lifts to when it crosses over the car */
  overM: 2.05,
  /** the carriage's fastest travel, m/s */
  railMps: 1.5,
} as const;
