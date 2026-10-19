/**
 * OTTO-CLEAN ARM — the overhead robot that cleans a car's cabin while it charges.
 *
 * docs/OTTO-CLEAN-ARM.md is the design; this file is its numbers. Everything is in
 * METRES, in the authored CAR frame of vehicleEnvelope.ts: x along the car (+ = nose),
 * y up from grade, z across it (+ = the car's right flank). The arm hangs from the
 * canopy over the stall, so placing it is placing the parked car (CleanArm.tsx uses
 * the car's own stall pose).
 *
 * THE MACHINE, top down (a ceiling SCARA with a telescoping mast):
 *   drop column from the canopy header -> J1 shoulder yaw -> link 1 -> J2 elbow yaw
 *   -> link 2 (it rides under link 1, so the arm can fold) -> J3 mast yaw at link 2's
 *   tip -> a three-stage telescoping mast -> J4 wrist pitch -> a two-stage wand ->
 *   J5 nozzle pitch -> the nozzle (vacuum, air knife, lit ring).
 *
 * WHY THIS SHAPE. It has to reach both flanks from above and into the cabin from the
 * side. A SCARA moves the mast anywhere over the car in a plane far above every car
 * and the OTTO-CHARGE ARM, so it can swing from one side to the other without coming
 * near either; only the mast comes down, and only outside the car; only the wand goes
 * in, and only through the door. Overhead cleaners on a gantry over a parking spot are
 * in US 12,686,365 (https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12686365,
 * read through search results 2026-10-19).
 */

import { CAR_WIDTH_M, GLASS_PROUD_M } from '@/lib/ottoChargeArm/vehicleEnvelope';

const deg = (d: number) => (d * Math.PI) / 180;

export const CLEAN_ARM = {
  /** J1's vertical axis, along the car from its centre: over the door aperture (DOOR -0.25..0.85). */
  mountX: 0.18,
  /** Height of link 1's centre line above grade. */
  link1Y: 3.42,
  /** Link 2 rides this far below link 1, so it can fold under it. */
  link2Drop: 0.19,
  link1: { len: 0.95, w: 0.17, h: 0.15 },
  link2: { len: 0.80, w: 0.14, h: 0.13 },
  j1: { r: 0.17, h: 0.24 },
  j2: { r: 0.13, h: 0.36 },
  /** The drop column from the canopy header down to J1's housing. */
  column: { w: 0.2 },
  mast: {
    /** Section sizes of the three stages, outer to inner (square tubes). */
    sections: [0.16, 0.125, 0.095] as const,
    /** The outer sleeve hangs this far below link 2's centre line, and stands this far above it. */
    outerBelow: 0.95, outerAbove: 0.1,
    /** Each inner stage's length and how much of it stays inside the stage outside it. */
    stage: 0.9, overlap: 0.1,
  },
  /** The wrist pitch axis below the mast foot. */
  pivotBelowFoot: 0.1,
  wrist: { r: 0.065, w: 0.15 },
  /** A three-stage wand: the base and two extension stages of half maxExt each. */
  wand: { base: 0.45, maxExt: 0.92, r: 0.034, rMid: 0.028, rInner: 0.022 },
  nozzle: { len: 0.16, w: 0.15, h: 0.05 },
  /** The wrist pivot's distance from the car's centreline in every working pose: 0.20 m
   *  out from the car's widest point, so the mast's 0.16 m sleeve keeps 0.12 m off it. */
  pivotZ: CAR_WIDTH_M / 2 + 0.2,
  limits: {
    j2: [deg(-170), deg(170)] as const,
    pitch: [deg(-90), deg(45)] as const,
    nozzle: [deg(-80), deg(45)] as const,
  },
} as const;

/** Mast foot height above grade, fully retracted and fully out. */
export const MAST_FOOT_MAX = CLEAN_ARM.link1Y - CLEAN_ARM.link2Drop - CLEAN_ARM.mast.outerBelow;
export const MAST_FOOT_MIN = MAST_FOOT_MAX - 2 * (CLEAN_ARM.mast.stage - CLEAN_ARM.mast.overlap);

/** The wrist pivot's height range, which is what the poses are written in. */
export const PIVOT_Y_MAX = MAST_FOOT_MAX - CLEAN_ARM.pivotBelowFoot;
export const PIVOT_Y_MIN = MAST_FOOT_MIN - CLEAN_ARM.pivotBelowFoot;

/** The plane the wand crosses into the cabin: the flank's paint face (the door aperture). */
export const FLANK_PAINT_Z = CAR_WIDTH_M / 2 - GLASS_PROUD_M;

/** Length from the wrist pivot to the nozzle's tip, retracted. */
export const WAND_RETRACTED = CLEAN_ARM.wand.base + CLEAN_ARM.nozzle.len;

// ══════════════════════════════════════════════════════════════════ TIMING ═══
//
// The cycle, in sim seconds at nominal speed. Fixed phases are robot motion; the
// two CLEAN phases take the rest of the twin's step (cleanSession.ts stretches them
// so the arm is home and the doors are shut when the twin says the step ends).
//
// The twin's default cycle is 2 x 2.5 min of cleaning + 0.8 min of motion = 5.8 min
// (otto-q-core 0758, dials cabin_robot_side_min, cabin_robot_motion_min). ASSUMPTION,
// pending R-21: no public source gives a measured cycle time. Bracket: "in under two
// minutes" between rides (Teslarati's framing, not a Tesla figure,
// https://www.teslarati.com/tesla-cleaning-robot-cybercab-robotaxi-service/), and about
// 30 min for a whole servicing cycle with an inspection (Aseon, Robotics & Automation
// News 2026-10-02). The motion below is 52 s (CLEAN_MOTION_S, pinned by the tests),
// 4 s over the twin's 48: each side cleans 2 s less than the twin's 150, which no
// viewer can see.

export type CleanPhase =
  | 'home'
  | 'doors_open' | 'swing_a' | 'lower_a' | 'descend_a' | 'enter_a' | 'clean_a' | 'exit_a' | 'ascend_a' | 'raise_a'
  | 'swing_b' | 'lower_b' | 'descend_b' | 'enter_b' | 'clean_b' | 'exit_b' | 'ascend_b' | 'raise_b'
  | 'return' | 'doors_close';

/** The cycle in order, home to home. Side A is the car's far flank (no charge arm on it), side B its port flank. */
export const CLEAN_CHAIN: readonly CleanPhase[] = [
  'doors_open', 'swing_a', 'lower_a', 'descend_a', 'enter_a', 'clean_a', 'exit_a', 'ascend_a', 'raise_a',
  'swing_b', 'lower_b', 'descend_b', 'enter_b', 'clean_b', 'exit_b', 'ascend_b', 'raise_b',
  'return', 'doors_close',
];

/** Seconds per fixed phase at nominal speed. */
export const CLEAN_PHASE_S: Readonly<Record<Exclude<CleanPhase, 'home' | 'clean_a' | 'clean_b'>, number>> = {
  doors_open: 3,
  swing_a: 4, lower_a: 1.5, descend_a: 3.5, enter_a: 3.5, exit_a: 3.5, ascend_a: 3, raise_a: 1.5,
  swing_b: 5, lower_b: 1.5, descend_b: 3.5, enter_b: 3.5, exit_b: 3.5, ascend_b: 3, raise_b: 1.5,
  return: 4,
  doors_close: 3,
};

/** A clean phase's nominal length, used when the twin publishes no end time. */
export const CLEAN_SIDE_NOMINAL_S = 150;
/** Shortest a clean phase may be stretched to: below this the strokes would blur. */
export const CLEAN_SIDE_MIN_S = 20;
/** Longest: a step the twin says lasts for an hour is not cleaned for an hour. */
export const CLEAN_SIDE_MAX_S = 600;

/** Seconds of fixed motion in the whole cycle. */
export const CLEAN_MOTION_S = Object.values(CLEAN_PHASE_S).reduce((a, b) => a + b, 0);

/** Is the arm (and its doors) home: folded over the roof, doors shut? */
export const isCleanHome = (p: CleanPhase): boolean => p === 'home';
/** Is any part of the arm inside the car right now? (enter .. exit, both sides) */
export const wandMayBeInside = (p: CleanPhase): boolean =>
  p === 'enter_a' || p === 'clean_a' || p === 'exit_a' || p === 'enter_b' || p === 'clean_b' || p === 'exit_b';
