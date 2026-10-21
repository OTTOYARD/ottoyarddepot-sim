/**
 * OTTO-WASH — the robotic rollover gantry in each wash bay (docs/OTTO-WASH.md).
 *
 * Chase, 2026-10-20: "Wash bays are robotic too. Car pulls in and the machine moves
 * back and forth over it several times to wash and rinse and blow dry before vehicle
 * leave." So each bay has ONE machine: a portal gantry on two floor rails that travels
 * over the parked car, carrying everything the wash needs (an in-bay automatic, the
 * rollover kind). The car does not move while it works.
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
 *     │ arch │ top brush │ side brushes │ air │   dy -1.6, -0.7, +0.6, +1.9 from the gantry's line
 *         the two vacuum wands' carriages        dy -1.2, outboard of everything but the arch
 *     legs ride the rails at x = ±6.8, outside the door opening (±5.5)
 *
 * The parts stand at different points along the beam so none can meet another: the top
 * brush is narrower than the gap between the side brushes, and its hangers stand clear of
 * them along the beam. Every moving part sits inside the portal. Retracted, the portal
 * clears a car and its roof pod with room to spare, so a car drives in under the machine
 * and out under it.
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

/**
 * Where it stands for the interior clean. Its wands then stand at the car's middle, in the door
 * apertures' rear half (the doors open from their front hinge, so the rear half is free), and
 * its side brushes stand south of every point an opening door sweeps.
 */
export const WASH_CABIN_DY = 1.2;

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
  /** the spray arch on the beam's north face */
  arch: { dy: -1.6, x: 5.6, top: 6.5, r: 0.13, nozzles: 9 },
  /** the horizontal top brush, north of the side brushes, on hangers at its ends */
  topBrush: { dy: -0.7, r: 0.75, halfLen: 1.7, retractY: 5.7, squash: 0.15, hangerX: 1.86 },
  /** the two vertical side brushes */
  sideBrush: { dy: 0.6, r: 0.9, y0: 0.6, y1: 5.9, retractX: 4.3, squash: 0.18 },
  /** air knives on the beam's south side: one over the roof, one beside each flank */
  dryer: {
    dy: 1.9,
    top: { halfLen: 1.9, d: 0.4, h: 0.35, gap: 0.5, retractY: 6.0 },
    side: { w: 0.35, d: 0.4, y0: 0.55, y1: 3.0, gap: 0.55, retractX: 5.6 },
  },
  /** the interior clean: a vacuum wand each side, on a carriage north of the top brush's hangers */
  wand: {
    dy: -1.2,
    /** the carriage's x: 0.3 m outboard of the flank */
    x: 2.62,
    /** the vertical stage's reach: from under the beam to the door's mid-height */
    topY: 6.8, workY: 1.82,
    /** the horizontal stage: from the carriage in to 0.24 m off the car's centreline */
    reachX: 0.5,
    r: 0.09,
  },
  /** stop light on the beam's south face, toward an arriving car */
  light: { y: 6.35, x: 0 },
} as const;

/** The program, in order. A detail seat runs the interior first, then the exterior. */
export type WashPhase =
  | 'home'
  | 'settle'
  | 'to_cabin' | 'doors_open' | 'wands_down' | 'wands_in' | 'vacuum' | 'wands_out' | 'wands_up' | 'doors_close' | 'to_start'
  | 'soak' | 'wash_1' | 'wash_2' | 'rinse' | 'dry_1' | 'dry_2'
  | 'done'
  | 'retract' | 'return';

export const WASH_INTERIOR: readonly WashPhase[] = [
  'to_cabin', 'doors_open', 'wands_down', 'wands_in', 'vacuum', 'wands_out', 'wands_up', 'doors_close', 'to_start',
];
export const WASH_EXTERIOR: readonly WashPhase[] = ['soak', 'wash_1', 'wash_2', 'rinse', 'dry_1', 'dry_2'];

/** The whole program for a seat, home to home. */
export function washChain(interior: boolean): readonly WashPhase[] {
  return interior
    ? ['settle', ...WASH_INTERIOR, ...WASH_EXTERIOR, 'done']
    : ['settle', ...WASH_EXTERIOR, 'done'];
}

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
export const PASS_KIND: Readonly<Record<WashPass, 'soak' | 'brush' | 'rinse' | 'dry'>> = {
  soak: 'soak', wash_1: 'brush', wash_2: 'brush', rinse: 'rinse', dry_1: 'dry', dry_2: 'dry',
};

/**
 * A pass's length at nominal pace, sim seconds. Six passes of 15.4 u (7.4 m, 24 ft) in 210 s is
 * 44 m (145 ft) in 3.5 minutes, 0.21 m/s on average with the brushes' stops. Read 2026-10-21:
 *   - a 5-brush rollover on a 23 ft guiderail "would travel 138' in six passes (3 minutes)"
 *     (carwashforum.com, 2015-10-12, https://carwashforum.com/goto/post?id=99620);
 *   - an in-bay automatic runs about 4 minutes a car (ccentral.ca,
 *     https://ccentral.ca/experts-weigh-small-footprint-car-wash-opportunities, via search results);
 *   - a gantry's dryer pass at 0.33 ft/s (0.1 m/s) in US 6,863,739
 *     (https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6863739, via search results).
 * The six passes, the settle and the finish make 3.6 minutes, inside the twin's robotic wash of
 * 5 minutes (pull in 0.5, program 4.0, pull out 0.5; otto-q-core 0746, robotic_wash_min).
 */
export const PASS_NOMINAL_S: Readonly<Record<WashPass, number>> = {
  soak: 30, wash_1: 40, wash_2: 40, rinse: 30, dry_1: 35, dry_2: 35,
};
export const PASSES_NOMINAL_S = Object.values(PASS_NOMINAL_S).reduce((a, b) => a + b, 0);

/** Fixed phases, sim seconds. `vacuum` and the passes are paced to the seat; `return` by the way home. */
export const WASH_PHASE_S: Readonly<Record<Exclude<WashPhase, WashPass | 'home' | 'vacuum' | 'return'>, number>> = {
  settle: 2.5,
  to_cabin: 6, doors_open: 3, wands_down: 3, wands_in: 3, wands_out: 3, wands_up: 3, doors_close: 3, to_start: 6,
  done: 2,
  // a seat that ends mid-pass: brushes and air knives come off the car at their own speed, never hurried
  retract: 2,
};

/** The interior's fixed motion, sim seconds. */
export const INTERIOR_FIXED_S = WASH_INTERIOR
  .filter((p) => p !== 'vacuum')
  .reduce((a, p) => a + WASH_PHASE_S[p as keyof typeof WASH_PHASE_S], 0);

/** The vacuum's nominal length when the twin publishes no end: the twin's robot, 10 of 16.5 minutes (0746). */
export const VACUUM_NOMINAL_S = 600;
export const VACUUM_MIN_S = 20;
export const VACUUM_MAX_S = 1800;

/** How far the passes may be slowed or hurried to fit the seat. */
export const PASS_SCALE_MIN = 0.4;
export const PASS_SCALE_MAX = 2.0;

/** The program ends this long before the twin's seat does, so the machine is home when the car may go. */
export const WASH_END_MARGIN_S = 8;

/** Brushes close in (and open out) over this share of a brush pass, at the pass's two ends, standing still. */
export const PASS_EASE = 0.12;

/** Return travel: how fast the machine goes home when the seat ends before its program does. */
export const WASH_ABORT_SPEED = 3;
/** Return travel at nominal speed, plan u per sim second (0.38 m/s, a gantry's quick traverse). */
export const WASH_RETURN_UPS = 0.8;

/** Brush spin, radians per WALL second (decoration, kept off the sim clock so 8x play does not strobe it). */
export const BRUSH_SPIN_RAD_S = 9;
