// ============================================================================
// Seeded RNG for the OFFLINE DEMO engine.
//
// WHY THIS EXISTS
// `SimulationEngine` is the client-side fallback that runs when the backend
// twin is unreachable. It used bare `Math.random()`, which meant no two runs
// were ever the same and no run could be reproduced from its inputs. That is
// fine for a screensaver and disqualifying for anything called a simulation:
// you cannot A/B a scheduling policy, cannot reproduce a bug, and cannot show
// an OEM the same run twice.
//
// The backend twin is the authority (it has run seeds, common-random-number
// discipline, and a fitted corpus). This module gives the offline demo the one
// property it was missing so that it is at least honest about what it is.
//
// mulberry32: 32-bit state, period 2^32, passes gjrand's basic suite. Small and
// dependency-free, which matters more here than statistical perfection — this
// is a demo fallback, not the validation engine.
// ============================================================================

export interface SeededRng {
  /** uniform in [0, 1) */
  next(): number;
  /** uniform in [min, max) */
  range(min: number, max: number): number;
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number;
  /** true with probability p */
  chance(p: number): boolean;
  /** the seed this generator was created with — record it with the run */
  readonly seed: number;
}

export function createRng(seed: number): SeededRng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
  };
}

/**
 * The demo engine's generator. Re-seeded on every reset so a run is
 * reproducible from its seed alone.
 *
 * Module-level rather than threaded through every call site: the demo engine is
 * a singleton with a single loop, so a second instance would be a bug. Anything
 * needing independent streams should call `createRng` directly.
 */
let demoRng: SeededRng = createRng(20260727);

export function seedDemoRng(seed: number): SeededRng {
  demoRng = createRng(seed);
  return demoRng;
}

export function demoRandom(): SeededRng {
  return demoRng;
}

/** Seed currently driving the offline demo — surfaced in the run record. */
export function currentDemoSeed(): number {
  return demoRng.seed;
}
