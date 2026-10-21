// ============================================================================
// chargerBuild — which chargers the depot has, and where: the one live answer the
// site plan, the structures, the motion driver and the canopy all read.
//
// Three builds, all at the twin depot (rule 8):
//   as_built  canopy A: 10 robotic fast chargers; canopies B and C: 30 standard (L2).
//   dcfc20    the 20-post build-out (otto-q-core 0759, applied only on Chase's word):
//             canopy B re-striped exactly as canopy A, two columns of five fast chargers
//             at the fast-charger row pitch, and canopy C's 15 standard chargers as
//             they are. 20 fast + 15 standard. A fast charger's pedestal (5.9u off its
//             car's centreline) does not fit the standard rows' 8.4u pitch, which is
//             why the build-out re-stripes a whole canopy rather than converting
//             stalls in place (docs/OTTO-CLEAN-ARM.md, "Twenty posts").
//   dcfc30    every standard charger gone (otto-q-core 0763 after 0759, Chase's call of
//             2026-10-21): canopy C re-striped as canopies A and B, 30 fast + 0 standard,
//             every car met by an OTTO-CHARGE ARM and cleaned by an OTTO-CLEAN ARM. At
//             this arm design it is the site's ceiling: ten posts a canopy, three
//             canopies (docs/OTTO-CLEAN-ARM.md, "Thirty posts").
//
// THE RENDERER NEVER CHOOSES A BUILD. It draws the one the twin's layout describes:
// the bridge reads the layout's stall census and calls setChargerBuild before it maps
// twin stalls onto renderer stalls (chargerBuildFor). A census that is neither build
// leaves the build as it is: the renderer has no third layout to draw, and drawing a
// guess would put cars on chargers the depot does not have.
//
// Everything that derives geometry from the layout keys its cache on
// chargerBuildVersion(), so a change of build rebuilds it once.
// ============================================================================

export type ChargerBuild = "as_built" | "dcfc20" | "dcfc30";

export interface ChargerBuildSpec {
  /** robotic fast chargers (each with its OTTO-CHARGE ARM and OTTO-CLEAN ARM) */
  dcfc: number;
  /** standard chargers */
  l2: number;
  /** canopies given to fast chargers, from canopy A: 1 = A, 2 = A and B, 3 = all three */
  dcfcCanopies: number;
}

export const CHARGER_BUILDS: Readonly<Record<ChargerBuild, ChargerBuildSpec>> = Object.freeze({
  as_built: { dcfc: 10, l2: 30, dcfcCanopies: 1 },
  dcfc20: { dcfc: 20, l2: 15, dcfcCanopies: 2 },
  dcfc30: { dcfc: 30, l2: 0, dcfcCanopies: 3 },
});

let current: ChargerBuild = "as_built";
let version = 0;

/** The build the renderer draws now. */
export const chargerBuild = (): ChargerBuild => current;
/** The build's spec. */
export const chargerBuildSpec = (): ChargerBuildSpec => CHARGER_BUILDS[current];
/** Bumped on every change of build: what layout-derived caches key on. */
export const chargerBuildVersion = (): number => version;

/** Draw this build from now on. Returns true when it changed. */
export function setChargerBuild(b: ChargerBuild): boolean {
  if (b === current) return false;
  current = b;
  version++;
  return true;
}

/** The build a twin layout's stall census describes, or null when it describes neither. */
export function chargerBuildFor(census: { dcfc: number; l2: number }): ChargerBuild | null {
  for (const k of Object.keys(CHARGER_BUILDS) as ChargerBuild[]) {
    const s = CHARGER_BUILDS[k];
    if (s.dcfc === census.dcfc && s.l2 === census.l2) return k;
  }
  return null;
}

/** Is canopy `index` (0 = A, 1 = B, 2 = C) a fast-charger canopy in the current build? */
export const canopyIsFast = (index: number): boolean => index < chargerBuildSpec().dcfcCanopies;
