// ============================================================================
// buildLayoutSeed.mjs — renderer site plan  ->  deterministic SQL seed for OTTO-Q
// ============================================================================
//
// WHAT THIS IS
//   The depot exists twice: once as geometry in this renderer, once as rows in the
//   OTTO-Q database. They disagreed. The founder ruled the RENDERER is right.
//   This script is the one-way bridge: it reads the renderer's site plan and writes
//   a SQL seed that migration 0010_unify_depot_layout.sql applies to the database.
//
// SOURCE OF TRUTH
//   src/lib/sitePlan.ts — NOT unreal/sitePlan.json.
//   The committed JSON is stale in two non-stall fields (its ingress/egress are
//   SWAPPED, and it has 12 light poles where the TS has 11), so this script bundles
//   and imports the TS directly, exactly as scripts/exportSitePlan.mjs does.
//   Stall geometry is identical in both; gates and light poles are not.
//
// DETERMINISM CONTRACT
//   Same sitePlan.ts in  =>  byte-identical layoutSeed.sql out. No timestamps, no
//   UUIDs, no map iteration order, no locale. Every float is rendered by fixed(),
//   which rounds half-away-from-zero at 4 decimals and normalises -0. That means the
//   seed can be committed, diffed, and re-run, and a no-op re-run produces no diff.
//
//   The seed is DEPOT-AGNOSTIC. It carries stall_code as the natural key and no
//   depot_id and no `id`. The migration applies it to each depot and derives the
//   primary key there (see "UUID STRATEGY" below), which is what keeps this file
//   byte-stable no matter how many depots exist.
//
// UUID STRATEGY  (applied by the migration, defined here so it lives with the seed)
//   - A stall_code that ALREADY EXISTS for a depot keeps its existing `id`. It is
//     UPDATEd in place. This is not cosmetic: stalls.id is pointed at by 17 foreign
//     keys (bookings, sessions, dispatch commands, state log, missions ...) and by
//     the OCPP charger link. Re-keying would sever live history.
//   - A stall_code that is NEW gets a DETERMINISTIC key:
//         uuid_generate_v5(depot_id, stall_code)
//     depot_id is itself a valid UUID and is used as the v5 namespace, so the same
//     stall_code lands on the same id every time, in every environment, and never
//     collides across depots. Re-running the migration is therefore idempotent.
//   - Nothing uses uuid_generate_v4() here. A random key would make the apply
//     non-repeatable and would break the "diff the seed" workflow.
//
// UNITS — the conversion, stated explicitly, because getting it wrong caused an outage
//   1 logical render unit = 0.4785 m.  1 ft = 0.3048 m.
//   => 1 unit = 0.4785 / 0.3048 = 1.56988189... ft.
//   stalls.relative_x / relative_y are FEET. ottoq_itin_travel_leg multiplies them by
//   0.3048 to get metres. A past outage came from feeding it the 0.4785 factor, which
//   made every travel leg 1.5699x TOO LONG. The inverse trap is live right now: if we
//   wrote raw render UNITS into relative_x/y, every leg would come out 1.5699x TOO
//   SHORT. So this script multiplies by UNIT_FT and stores feet. Non-negotiable.
//
// FRAME — this is a Y-FLIP, not just a scale
//   Renderer: x east-positive, y SOUTH-positive, lot spans x 6..294, y 6..206.
//   Database: x east-positive, y NORTH-positive, origin at the fence's SW corner.
//   (Proof the DB is north-positive: zone 'staging_south' sits at relative_y=15 and
//   'staging_north' at relative_y=205.)
//       relative_x = (render_x - 6)      * UNIT_FT     -> 0 .. 452.13
//       relative_y = (206 - render_y)    * UNIT_FT     -> 0 .. 313.98
//   heading_degrees is carried through VERBATIM. Both frames express a compass
//   bearing (0=N, 90=E, 180=S, 270=W), and a compass bearing is unaffected by which
//   way the y axis counts, so the flip must NOT rotate it.
//
// FOOTPRINTS — derived from the renderer's own pitch, not from a wish
//   stall_width_ft / stall_depth_ft are NULL on the 5 bays today and a blanket
//   10x18 / 10x20 everywhere else. A blanket 10 ft width is arithmetically
//   incompatible with this layout: the west and east perimeter runs are pitched at
//   5.7u = 8.95 ft, so 10 ft stalls would overlap each other by 1.05 ft, and the L2
//   columns are pitched at 10.3u = 16.17 ft, so 20 ft deep stalls would overlap
//   nose-to-tail by 3.83 ft. Declaring a footprint the layout cannot hold is how the
//   database lied in the first place.
//   So: the dimension ALONG a run is min(nominal, pitch - CLEARANCE_FT), and the
//   cross dimension is nominal. The result is self-consistent by construction, which
//   is what lets checkLayoutGeometry.mjs assert "zero overlaps" and mean it.
//
// OUTPUTS
//   unreal/layoutSeed.sql   — the seed the migration applies (deterministic)
//   unreal/layoutSeed.json  — same data, machine-readable, for the geometry guard
//                             and for unreal/ottoq_usd_build.py
//
// USAGE
//   node scripts/exportSitePlan.mjs     # refresh unreal/sitePlan.json first
//   node scripts/buildLayoutSeed.mjs    # then build the seed
//   node scripts/checkLayoutGeometry.mjs
// ============================================================================

import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 0.4785 m per logical unit / 0.3048 m per foot. See the UNITS block above. */
export const UNIT_FT = 0.4785 / 0.3048; // = 1.5698818897637796

/** Renderer-frame y of the fence's SOUTH edge (LOT.y + LOT.h = 6 + 200). */
const FRAME_Y0 = 206;
/** Renderer-frame x of the fence's WEST edge (LOT.x). */
const FRAME_X0 = 6;

/** Depot origin used by ottoq_local_to_latlng. Matches public.depots for both depots. */
const ORIGIN_LAT = 36.1397;
const ORIGIN_LNG = -86.7728;
const FT_PER_DEG_LAT = 364000;

/** Gap left between a stall's declared footprint and its neighbour's, in feet. */
const CLEARANCE_FT = 0.5;

/** Design vehicle used for the fit report (a robotaxi-class sedan/crossover). */
const DESIGN_VEHICLE_FT = { width: 6.6, length: 16.0 };

// LaneGraph.rightOffset, in render units. Opposing directions on a divided road end
// up 2x this apart. Kept in step with src/engine/motion/LaneGraph.ts by the assertion
// in scripts/checkLayoutGeometry.mjs, which reads the real class.
const LANE_RIGHT_OFFSET = 3.2;

/**
 * Nominal footprints. Charging and staging match what the database already
 * declares (depots.site_layout.stall_dims_ft = charging "10x20", parking "10x18").
 * The two bay footprints are NEW — they are NULL on all 300 rows today. They are
 * ASSUMPTIONS, sized to sit inside the renderer's 18u (28.26 ft) bay pitch and the
 * 30u (47.10 ft) building depth, and they are tunable.
 */
const NOMINAL = {
  dcfc:        { width: 10, depth: 20 },
  l2:          { width: 10, depth: 20 },
  staging:     { width: 10, depth: 18 },
  service_bay: { width: 14, depth: 30 },   // ASSUMPTION - first non-NULL value ever
  wash_bay:    { width: 14, depth: 35 },   // ASSUMPTION - first non-NULL value ever
};

/**
 * Renderer stall id -> database stall_code.
 *
 * The database's code vocabulary is the one already wired into 17 foreign keys, the
 * OCPP charger links and every dashboard, so the codes stay and the GEOMETRY moves
 * underneath them. Two consequences worth stating out loud:
 *
 *  - L2: the renderer has 30 L2 stalls, the database has 35. The founder named the
 *    five to retire: NASH-L2-STALL-21..25. They are the ones that overrun canopy 2
 *    to the south (relative_y 165..205 where the canopy ends at 155), they are 10 of
 *    the 54 overlapping pairs, and one sits on top of a staging space. They are
 *    phantom capacity. So renderer L2-01..30 map onto the 30 SURVIVING codes in
 *    ascending order: 01..20 then 26..35.
 *
 *  - Staging: the renderer's 8 runs regroup into the database's 6 zone prefixes.
 *    The zone vocabulary is CLOSED and load-bearing (functions_ottoq.sql:727 hardcodes
 *    the staging ring as staging_north/south/east/west, and 'arrival_inspection'
 *    appears in ~15 predicates), so inventing a new zone string would silently drop
 *    stalls out of the ring. Run -> zone -> code prefix is fixed here.
 */
const RUN_ZONE = {
  W:  { zone: 'staging_west',       prefix: 'NASH-STG-W', pad: 3, role: 'long', kind: 'staging'    },
  E:  { zone: 'staging_east',       prefix: 'NASH-STG-E', pad: 3, role: 'long', kind: 'staging'    },
  S1: { zone: 'staging_south',      prefix: 'NASH-STG-S', pad: 3, role: 'long', kind: 'staging'    },
  S2: { zone: 'staging_south',      prefix: 'NASH-STG-S', pad: 3, role: 'long', kind: 'staging'    },
  S3: { zone: 'staging_south',      prefix: 'NASH-STG-S', pad: 3, role: 'long', kind: 'staging'    },
  N1: { zone: 'staging_north',      prefix: 'NASH-STG-N', pad: 3, role: 'long', kind: 'staging'    },
  TW: { zone: 'staging_buffer',     prefix: 'NASH-STG-B', pad: 3, role: 'temp', kind: 'staging'    },
  TE: { zone: 'arrival_inspection', prefix: 'NASH-STG-I', pad: 3, role: 'temp', kind: 'inspection' },
};
/** S1, S2 and S3 all land in staging_south, so they share one running counter. */
const ZONE_ORDER = ['W', 'E', 'S1', 'S2', 'S3', 'N1', 'TW', 'TE'];

/** Renderer canopy id -> database structure_code. Canopy A is the DCFC canopy. */
const CANOPY_CODE = { A: 'CANOPY-01', B: 'CANOPY-02', C: 'CANOPY-03' };

// ---------------------------------------------------------------------------
// Deterministic number formatting
// ---------------------------------------------------------------------------

/**
 * Fixed-precision, half-away-from-zero, negative-zero-normalised.
 * toFixed() alone is not enough: it rounds half-to-even on some values and it will
 * happily emit "-0.0000". Both would make the output non-reproducible in a diff.
 */
function fixed(n, dp = 4) {
  if (!Number.isFinite(n)) throw new Error(`non-finite number in seed: ${n}`);
  const f = 10 ** dp;
  const r = (n < 0 ? -1 : 1) * Math.round(Math.abs(n) * f + Number.EPSILON) / f;
  const s = (r === 0 ? 0 : r).toFixed(dp);
  return s === `-${(0).toFixed(dp)}` ? (0).toFixed(dp) : s;
}

/** Single-quoted SQL literal. */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** JSONB literal with STABLE key order (JSON.stringify follows insertion order). */
const jb = (o) => `${q(JSON.stringify(o))}::jsonb`;

// ---------------------------------------------------------------------------
// Frame transform
// ---------------------------------------------------------------------------

/** Renderer x (units) -> database relative_x (feet). */
const toX = (x) => (x - FRAME_X0) * UNIT_FT;
/** Renderer y (units, SOUTH-positive) -> database relative_y (feet, NORTH-positive). */
const toY = (y) => (FRAME_Y0 - y) * UNIT_FT;
/** Renderer length (units) -> feet. */
const toFt = (u) => u * UNIT_FT;

/** Mirrors public.ottoq_local_to_latlng exactly. Do not hand-roll a second formula. */
function localToLatLng(xFt, yFt) {
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);
  return { lat: ORIGIN_LAT + yFt / FT_PER_DEG_LAT, lng: ORIGIN_LNG + xFt / ftPerDegLng };
}

/**
 * A renderer rect {x,y,w,h} (y south-positive) -> a database footprint anchored at
 * its SOUTH-WEST corner (y north-positive), which is how ottoq_site_structures
 * stores origin_x_ft / origin_y_ft.
 */
function rectToDb(r) {
  return {
    origin_x_ft: toX(r.x),
    origin_y_ft: toY(r.y + r.h), // south edge in the flipped frame
    width_ft: toFt(r.w),         // x extent
    length_ft: toFt(r.h),        // y extent
  };
}

/** Axis-aligned containment test in DATABASE feet. */
const inRect = (x, y, r) =>
  x >= r.origin_x_ft && x <= r.origin_x_ft + r.width_ft &&
  y >= r.origin_y_ft && y <= r.origin_y_ft + r.length_ft;

// ---------------------------------------------------------------------------
// Load the site plan from TypeScript (source of truth)
// ---------------------------------------------------------------------------

await build({
  entryPoints: ['src/lib/sitePlan.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: '/tmp/ottoq_siteplan_seed.cjs',
  logLevel: 'silent',
});
const sp = createRequire(import.meta.url)('/tmp/ottoq_siteplan_seed.cjs');

// ---------------------------------------------------------------------------
// Build the stall rows
// ---------------------------------------------------------------------------

const canopyRects = Object.fromEntries(
  sp.CANOPIES.map((c) => [c.id, rectToDb({ x: c.x, y: c.y, w: c.w, h: c.h })]),
);
const carportRects = Object.fromEntries(
  sp.PARK_RUNS.filter((r) => r.carport).map((r) => [r.id, rectToDb(r.carport)]),
);
const officeRect = rectToDb(sp.BUILDING);
const washRect = rectToDb(sp.WASH);
const bessRect = rectToDb(sp.BESS_YARD);
const lotRect = rectToDb(sp.LOT);

/** Pitch between consecutive stalls of a run/column, in feet. */
const pitchFt = (dx, dy) => toFt(Math.hypot(dx, dy));

/**
 * Choose the declared footprint. `alongIsDepth` says whether consecutive stalls in
 * this run are nose-to-tail (pitch constrains DEPTH) or shoulder-to-shoulder (pitch
 * constrains WIDTH). It follows from the heading: a car at heading 0 or 180 has its
 * length on the y axis, so a run that steps along y is nose-to-tail.
 */
function footprint(type, heading, dx, dy) {
  const nom = NOMINAL[type];
  if (dx === 0 && dy === 0) return { ...nom, pitch_ft: null };
  const pitch = pitchFt(dx, dy);
  const lengthOnY = heading === 0 || heading === 180;
  const stepsAlongY = Math.abs(dy) > Math.abs(dx);
  const alongIsDepth = lengthOnY === stepsAlongY;
  const cap = Math.max(0, pitch - CLEARANCE_FT);
  return alongIsDepth
    ? { width: nom.width, depth: Math.min(nom.depth, cap), pitch_ft: pitch }
    : { width: Math.min(nom.width, cap), depth: nom.depth, pitch_ft: pitch };
}

const stalls = [];

function pushStall(row) {
  const { lat, lng } = localToLatLng(row.relative_x, row.relative_y);
  stalls.push({ ...row, absolute_lat: lat, absolute_lng: lng });
}

// ---- DCFC: canopy A, two columns of 5, stepping along y (nose-to-tail) ----
{
  const A = sp.CANOPIES[0];
  const src = sp.generateStallsV2().filter((s) => s.type === 'dcfc');
  src.forEach((s, i) => {
    const fp = footprint('dcfc', s.position.angle, 0, 16); // step 16u along y
    pushStall({
      stall_code: `NASH-DCFC-STALL-${String(i + 1).padStart(2, '0')}`,
      render_id: s.id,
      stall_type: 'dcfc',
      stall_kind: 'charging',
      zone: 'dcfc_zone',
      staging_role: null,
      relative_x: toX(s.position.x),
      relative_y: toY(s.position.y),
      heading_degrees: s.position.angle,
      stall_width_ft: fp.width,
      stall_depth_ft: fp.depth,
      pitch_ft: fp.pitch_ft,
      canopy_code: CANOPY_CODE[A.id],
      canopy_side: s.position.x < A.cx ? 'W' : 'E',
      covered: true,
      run_id: 'A',
    });
  });
}

// ---- L2: canopies B and C. West column pitch 10.3u, east column pitch 11u. ----
{
  // The 30 surviving database codes: 01..20 then 26..35. 21..25 are retired.
  const L2_CODES = [];
  for (let i = 1; i <= 35; i++) {
    if (i >= 21 && i <= 25) continue;
    L2_CODES.push(`NASH-L2-STALL-${String(i).padStart(2, '0')}`);
  }
  const src = sp.generateStallsV2().filter((s) => s.type === 'l2');
  if (src.length !== L2_CODES.length) {
    throw new Error(`L2 count mismatch: renderer ${src.length}, codes ${L2_CODES.length}`);
  }
  src.forEach((s, i) => {
    const canopy = sp.CANOPIES.find((c) => Math.abs(s.position.x - c.cx) <= 8);
    const west = s.position.x < canopy.cx;
    const fp = footprint('l2', s.position.angle, 0, west ? 10.3 : 11);
    pushStall({
      stall_code: L2_CODES[i],
      render_id: s.id,
      stall_type: 'l2',
      stall_kind: 'charging',
      zone: 'l2_zone',
      staging_role: null,
      relative_x: toX(s.position.x),
      relative_y: toY(s.position.y),
      heading_degrees: s.position.angle,
      stall_width_ft: fp.width,
      stall_depth_ft: fp.depth,
      pitch_ft: fp.pitch_ft,
      canopy_code: CANOPY_CODE[canopy.id],
      canopy_side: west ? 'W' : 'E',
      covered: true,
      run_id: canopy.id,
    });
  });
}

// ---- Bays. Isolated (no run pitch), so they take the nominal footprint. ----
{
  const src = sp.generateStallsV2();
  src.filter((s) => s.type === 'service').forEach((s, i) => {
    pushStall({
      stall_code: `NASH-SVC-${String(i + 1).padStart(2, '0')}`,
      render_id: s.id,
      stall_type: 'service_bay',
      stall_kind: 'service',
      zone: 'service',
      staging_role: null,
      relative_x: toX(s.position.x),
      relative_y: toY(s.position.y),
      heading_degrees: s.position.angle,
      stall_width_ft: NOMINAL.service_bay.width,
      stall_depth_ft: NOMINAL.service_bay.depth,
      pitch_ft: null,
      canopy_code: null,
      canopy_side: null,
      covered: true,
      run_id: 'BAY',
    });
  });
  src.filter((s) => s.type === 'wash').forEach((s, i) => {
    pushStall({
      stall_code: `NASH-WSH-${String(i + 1).padStart(2, '0')}`,
      render_id: s.id,
      stall_type: 'wash_bay',
      stall_kind: 'wash',
      zone: 'cleaning',
      staging_role: null,
      relative_x: toX(s.position.x),
      relative_y: toY(s.position.y),
      heading_degrees: s.position.angle,
      stall_width_ft: NOMINAL.wash_bay.width,
      stall_depth_ft: NOMINAL.wash_bay.depth,
      pitch_ft: null,
      canopy_code: null,
      canopy_side: null,
      covered: true,
      run_id: 'BAY',
    });
  });
}

// ---- Staging: 8 renderer runs -> 6 database zones ----
{
  const counters = {}; // zone prefix -> running index
  for (const runId of ZONE_ORDER) {
    const run = sp.PARK_RUNS.find((r) => r.id === runId);
    const z = RUN_ZONE[runId];
    counters[z.prefix] = counters[z.prefix] || 0;
    const fp = footprint('staging', run.angle, run.dx, run.dy);
    for (let i = 0; i < run.n; i++) {
      counters[z.prefix] += 1;
      const x = run.x0 + i * run.dx;
      const y = run.y0 + i * run.dy;
      pushStall({
        stall_code: `${z.prefix}${String(counters[z.prefix]).padStart(z.pad, '0')}`,
        render_id: `${runId}-${i + 1}`,
        stall_type: 'staging',
        stall_kind: z.kind,
        zone: z.zone,
        staging_role: z.role,
        relative_x: toX(x),
        relative_y: toY(y),
        heading_degrees: run.angle,
        stall_width_ft: fp.width,
        stall_depth_ft: fp.depth,
        pitch_ft: fp.pitch_ft,
        canopy_code: null,
        canopy_side: null,
        covered: Boolean(run.carport),
        run_id: runId,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Derived attributes + display names
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Corner-clip resolution
// ---------------------------------------------------------------------------
//
// Footprints are derived per RUN, from that run's own pitch. Two stalls belonging to
// DIFFERENT runs can therefore still clip where runs meet at a corner, even though
// every stall is correctly spaced within its own run. On this layout exactly one such
// pair exists (the SW corner, where the west column meets the first south row) and it
// clips by ~5 inches.
//
// That is an artefact of how *this script* derives footprints, not a defect in the
// renderer's layout — no stall CENTRE moves, and the founder's reviewed plan is
// untouched. So the honest fix is to make the derivation consistent: trim the two
// footprints along their axis of least overlap, split evenly, until they clear by
// CLEARANCE_FT. Every trim is recorded on the stall and reported, so a trim that
// grows over time is visible rather than silent.
//
// Deterministic: pairs are visited in stall_code order and the trim is symmetric.
function resolveClips() {
  const boxOf = (s) => {
    const lengthOnY = s.heading_degrees === 0 || s.heading_degrees === 180;
    const ex = (lengthOnY ? s.stall_width_ft : s.stall_depth_ft) / 2;
    const ey = (lengthOnY ? s.stall_depth_ft : s.stall_width_ft) / 2;
    return { x0: s.relative_x - ex, x1: s.relative_x + ex, y0: s.relative_y - ey, y1: s.relative_y + ey };
  };
  const order = [...stalls].sort((a, b) => (a.stall_code < b.stall_code ? -1 : 1));
  const trims = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const a = order[i], b = order[j];
      const ba = boxOf(a), bb = boxOf(b);
      const ox = Math.min(ba.x1, bb.x1) - Math.max(ba.x0, bb.x0);
      const oy = Math.min(ba.y1, bb.y1) - Math.max(ba.y0, bb.y0);
      if (ox <= 1e-9 || oy <= 1e-9) continue;
      const onX = ox <= oy;                      // trim along the axis of least overlap
      const need = (onX ? ox : oy) + CLEARANCE_FT;
      for (const s of [a, b]) {
        const lengthOnY = s.heading_degrees === 0 || s.heading_degrees === 180;
        // which declared dimension lies on the axis we are trimming?
        const dim = (onX === lengthOnY) ? 'stall_width_ft' : 'stall_depth_ft';
        s[dim] = Math.max(0.5, s[dim] - need / 2);
        s.corner_trim_ft = Number(fixed((s.corner_trim_ft || 0) + need / 2));
      }
      trims.push(`${a.stall_code} <-> ${b.stall_code}: clipped ${(onX ? ox : oy).toFixed(2)} ft on ${onX ? 'x' : 'y'}, each trimmed ${(need / 2).toFixed(2)} ft`);
    }
  }
  return trims;
}
const CORNER_TRIMS = resolveClips();

for (const s of stalls) {
  if (s.corner_trim_ft === undefined) s.corner_trim_ft = 0;
  // Verify `covered` and `canopy_code` against real rectangle containment rather
  // than trusting the labels above. A silent mismatch here is how "2 of 4 canopies
  // shelter no chargers" happened in the first place.
  if (s.canopy_code) {
    const r = canopyRects[Object.keys(CANOPY_CODE).find((k) => CANOPY_CODE[k] === s.canopy_code)];
    if (!inRect(s.relative_x, s.relative_y, r)) {
      throw new Error(`${s.stall_code} carries ${s.canopy_code} but is outside that canopy`);
    }
  }
  if (s.covered && carportRects[s.run_id] && !inRect(s.relative_x, s.relative_y, carportRects[s.run_id])) {
    throw new Error(`${s.stall_code} marked covered but is outside carport ${s.run_id}`);
  }

  s.display_name =
    s.canopy_code ? `${s.canopy_code} ${s.canopy_side}-${s.stall_code.slice(-2)}`
    : s.stall_type === 'service_bay' ? `Service Bay ${s.stall_code.slice(-2)}`
    : s.stall_type === 'wash_bay' ? `Wash Bay ${s.stall_code.slice(-2)}`
    : `${s.zone.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} ${s.stall_code.slice(-3)}`;
}

stalls.sort((a, b) => (a.stall_code < b.stall_code ? -1 : a.stall_code > b.stall_code ? 1 : 0));

// ---------------------------------------------------------------------------
// Build the structure rows
// ---------------------------------------------------------------------------
//
// SERVICE BAYS INSIDE THE OFFICE ARE INTENTIONAL. The founder confirmed this is an
// attached service garage, not a mistake. The structure is therefore RELABELLED to
// say so, and the geometry guard whitelists exactly NASH-SVC-01 and NASH-SVC-02.

const structures = [];
const S = (r) => structures.push(r);

S({
  structure_code: 'FENCE-PERIMETER', structure_kind: 'fence_segment',
  title: 'Perimeter Security Fence',
  ...lotRect, height_ft: 8, rotation_deg: 0, status: 'active',
  properties: { material: 'steel_pickets', height_ft: 8, lighting: 'integrated_led' },
});
S({
  structure_code: 'BESS-COMPOUND', structure_kind: 'bess_compound',
  title: 'BESS + Transformer Compound',
  ...bessRect, height_ft: 12, rotation_deg: 0, status: 'active',
  properties: { fenced: true, pad_material: 'concrete', bess_power_kw: 1500, bess_energy_kwh: 3000, transformer_count: 2 },
});
S({
  structure_code: 'OFFICE-01', structure_kind: 'office_building',
  // RELABELLED. The two service bays sit inside this footprint on purpose.
  title: 'Office Building + Attached Service Garage (2 bays)',
  ...officeRect, height_ft: 22, rotation_deg: 0, status: 'active',
  properties: {
    purpose: 'admin+control_room+attached_service_garage',
    attached_service_garage: true,
    encloses_stall_codes: ['NASH-SVC-01', 'NASH-SVC-02'],
    enclosure_intentional: true,
    enclosure_confirmed_by: 'founder',
    service_bays: [
      { code: 'NASH-SVC-01', kind: 'mechanical_service', drive_through: true, vehicle_capacity: 2 },
      { code: 'NASH-SVC-02', kind: 'sensor_calibration', drive_through: true, vehicle_capacity: 2 },
    ],
  },
});
S({
  structure_code: 'WASH-01-BLDG', structure_kind: 'wash_building',
  title: 'Wash & Detail Building',
  ...washRect, height_ft: 18, rotation_deg: 0, status: 'active',
  properties: {
    encloses_stall_codes: ['NASH-WSH-01', 'NASH-WSH-02', 'NASH-WSH-03'],
    enclosure_intentional: true,
    wash_bays: [
      { code: 'NASH-WSH-01', drive_through: true },
      { code: 'NASH-WSH-02', drive_through: true },
      { code: 'NASH-WSH-03', drive_through: true },
    ],
  },
});

// Solar canopies. Each keeps its EXISTING solar properties untouched (288 panels,
// 180 kW DC) even though the renderer's roofs are larger. Re-scaling them would
// change energy output, and this migration is geometry only.
for (const c of sp.CANOPIES) {
  const nStalls = stalls.filter((s) => s.canopy_code === CANOPY_CODE[c.id]).length;
  S({
    structure_code: CANOPY_CODE[c.id], structure_kind: 'solar_canopy',
    title: `Solar Canopy ${c.id} (${c.kind.toUpperCase()})`,
    ...rectToDb({ x: c.x, y: c.y, w: c.w, h: c.h }),
    height_ft: 14, rotation_deg: 0, status: 'active',
    properties: {
      panel_count: 288, solar_kw_dc: 180,
      stall_capacity: nStalls,
      chargers: c.kind === 'dcfc' ? { dcfc: nStalls } : { l2: nStalls },
    },
  });
}

// Solar carports over the 5 covered perimeter runs. These REPLACE the single
// blanket METAL-CANOPY-PERIM row, which claimed to cover 100 stalls with no
// geometry at all (width and length were both NULL).
for (const r of sp.PARK_RUNS.filter((p) => p.carport)) {
  const n = stalls.filter((s) => s.run_id === r.id).length;
  S({
    structure_code: `CARPORT-${r.id}`, structure_kind: 'metal_canopy',
    title: `Solar Carport ${r.id} (covered staging)`,
    ...rectToDb(r.carport), height_ft: 12, rotation_deg: 0, status: 'active',
    properties: { covers: 'perimeter_staging_stalls', purpose: 'inspection-while-parked weather coverage', stall_count: n },
  });
}

// Gates. Taken from sitePlan.ts, NOT sitePlan.json — the JSON has them SWAPPED.
// The renderer puts the gate stubs at y=215, which is 9 units OUTSIDE the south
// fence line; the database models a gate as a structure ON the fence, so y is
// clamped to 0 and the renderer's approach point is recorded in properties.
for (const [code, pt, title, dir, controls] of [
  ['GATE-INGRESS', sp.INGRESS, 'Ingress Gate (SE)', 'in',  ['alpr', 'barrier_arm', 'intercom']],
  ['GATE-EGRESS',  sp.EGRESS,  'Egress Gate (SW)',  'out', ['alpr', 'barrier_arm']],
]) {
  const w = toFt(sp.GATE_W);
  S({
    structure_code: code, structure_kind: 'gate', title,
    origin_x_ft: toX(pt.x) - w / 2, origin_y_ft: 0,
    width_ft: w, length_ft: toFt(6), height_ft: 8, rotation_deg: 0, status: 'active',
    properties: {
      direction: dir, controls,
      approach_point_ft: { x: Number(fixed(toX(pt.x))), y: Number(fixed(toY(pt.y))) },
    },
  });
}

S({
  structure_code: 'SIGN-OTTOYARD-FRONT', structure_kind: 'sign',
  title: 'OTTOYARD Front Wall Signage',
  origin_x_ft: (lotRect.width_ft - 60) / 2, origin_y_ft: 3,
  width_ft: 60, length_ft: 1, height_ft: 8, rotation_deg: 0, status: 'active',
  properties: { mount: 'concrete_wall', illuminated: true },
});

// Lighting poles: 11, from sitePlan.ts. (unreal/sitePlan.json still says 12 — it
// predates commit ff9c810 "Light poles: canopy SOUTH end-caps". This is the field
// that proves the seed was built from the TS and not from the stale JSON.)
sp.LIGHT_POLES.forEach((p, i) => {
  S({
    structure_code: `LIGHT-${String(i + 1).padStart(2, '0')}`, structure_kind: 'lighting_pole',
    title: `Site Light Pole ${i + 1}`,
    origin_x_ft: toX(p.x), origin_y_ft: toY(p.y),
    width_ft: 1.5, length_ft: 1.5, height_ft: toFt(18), rotation_deg: 0, status: 'active',
    properties: { fixture: 'led_area', mount: 'pole' },
  });
});

for (const st of structures) {
  const c = localToLatLng(st.origin_x_ft + (st.width_ft ?? 0) / 2, st.origin_y_ft + (st.length_ft ?? 0) / 2);
  st.absolute_lat = c.lat;
  st.absolute_lng = c.lng;
}
structures.sort((a, b) => (a.structure_code < b.structure_code ? -1 : a.structure_code > b.structure_code ? 1 : 0));

// ---------------------------------------------------------------------------
// Declared inventory — the guard and the migration both assert against this
// ---------------------------------------------------------------------------

const INVENTORY = { staging: 115, l2: 30, dcfc: 10, wash_bay: 3, service_bay: 2 };
const actual = {};
for (const s of stalls) actual[s.stall_type] = (actual[s.stall_type] || 0) + 1;
for (const [k, v] of Object.entries(INVENTORY)) {
  if (actual[k] !== v) throw new Error(`inventory mismatch: ${k} declared ${v}, built ${actual[k] ?? 0}`);
}
if (stalls.length !== 160) throw new Error(`expected 160 stalls, built ${stalls.length}`);

// ---------------------------------------------------------------------------
// Codes the database holds today that this layout no longer uses
// ---------------------------------------------------------------------------
//
// RULE (the one this generator previously broke): a stall ROW may only be DELETED
// if it is referenced by NOTHING. stalls.id is pointed at by 17 foreign keys, and
// three of those cascade (ottoq_stall_bookings, charger_cooldowns,
// charger_health_scores) while four more SET NULL. A delete on a referenced row
// therefore does not error -- it silently destroys or blanks history. Measured on
// the live database before this change: the 12 NASH-STG-N008..N019 rows plus
// NASH-STG-B014 carried 13 released bookings, and NASH-STG-N010/N011/N019 carried
// 11 vehicle_state_log rows.
//
// The prep's own design already said staging is FUNGIBLE and re-homing beats
// retiring. This is that design, actually implemented:
//
//   * STAGING codes that leave the layout are RE-HOMED. The row keeps its id -- and
//     therefore every booking, every state-log line, every mission pointing at it --
//     and is UPDATEd onto one of the staging positions this layout mints. 14 staging
//     codes leave; 29 staging codes are minted; so every one of the 14 has a home.
//   * L2 21..25 are genuinely DELETED. There is no spare L2 code to re-home onto
//     (the layout has 30 L2 and all 30 codes already exist), and they are provably
//     unreferenced: 0 rows in all 17 FK columns, 0 bookings in the pre-import
//     snapshot, 0 occupied/reserved.
//
// "Retire in place" (status='closed') is NOT an option for the L2 five:
// ottoq_plan_overnight_wave counts stall_type='l2' with no status filter, so a
// closed row keeps broadcasting charger capacity that does not exist.
//
// The migration re-derives the reference counts at APPLY time and RAISEs if any row
// it is about to delete is referenced by anything. This list is a declaration of
// intent; the database gets the final vote.

/** Staging codes that leave the layout -> the minted staging code each is re-homed onto. */
const REHOMED_STAGING_SOURCES = [
  ...Array.from({ length: 12 }, (_, i) => `NASH-STG-N${String(i + 8).padStart(3, '0')}`),
  'NASH-STG-I014',
  'NASH-STG-B014',
];

/** Codes DELETED outright. Must be provably unreferenced; the migration re-checks. */
const RETIRED = {
  l2: ['NASH-L2-STALL-21', 'NASH-L2-STALL-22', 'NASH-L2-STALL-23', 'NASH-L2-STALL-24', 'NASH-L2-STALL-25'],
};
const RETIRED_ALL = [...RETIRED.l2];
const RETIRED_STRUCTURES = ['CANOPY-04', 'METAL-CANOPY-PERIM'];

// The database's staging codes today (100 per depot), derived from the same prefix
// runs the pre-0010 layout used. Anything here that this layout does not mint must
// be re-homed, never dropped.
const PRE0010_STAGING = [];
for (const [p, n] of [['B', 14], ['E', 17], ['I', 14], ['N', 19], ['S', 19], ['W', 17]]) {
  for (let i = 1; i <= n; i++) PRE0010_STAGING.push(`NASH-STG-${p}${String(i).padStart(3, '0')}`);
}
const SEED_CODES = new Set(stalls.map((s) => s.stall_code));
const LEAVING_STAGING = PRE0010_STAGING.filter((c) => !SEED_CODES.has(c));
const MINTED_STAGING = stalls
  .filter((s) => s.stall_type === 'staging' && !PRE0010_STAGING.includes(s.stall_code))
  .map((s) => s.stall_code)
  .sort();

// The declared source list must BE the computed one -- otherwise the re-home table
// silently misses a row and the migration deletes it.
{
  const a = [...LEAVING_STAGING].sort().join(',');
  const b = [...REHOMED_STAGING_SOURCES].sort().join(',');
  if (a !== b) throw new Error(`re-home source list drifted.\n  computed: ${a}\n  declared: ${b}`);
  if (MINTED_STAGING.length < LEAVING_STAGING.length) {
    throw new Error(`cannot re-home: ${LEAVING_STAGING.length} staging codes leaving but only ${MINTED_STAGING.length} minted`);
  }
  for (const c of RETIRED_ALL) {
    if (SEED_CODES.has(c)) throw new Error(`${c} is marked for deletion but the layout still mints it`);
  }
}

/** Deterministic pairing: leaving codes in code order -> minted codes in code order. */
const REHOME_PAIRS = [...LEAVING_STAGING].sort().map((from, i) => [from, MINTED_STAGING[i]]);

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Seed checksum — the migration's md5 guard compares against this
// ---------------------------------------------------------------------------
//
// The migration recomputes this hash in SQL, from the temp table it just loaded, and
// refuses to run if it differs. That makes a hand-edited seed fail loudly instead of
// quietly reshaping the depot.
//
// The canonical string below is byte-for-byte what Postgres produces from
//   string_agg(stall_code||'|'||stall_type||'|'||relative_x::text||...,  E'\n'
//              ORDER BY stall_code)
// which is only true because those columns are NUMERIC in the seed's temp table.
const CANON = stalls
  .map((s) => [
    s.stall_code, s.stall_type, fixed(s.relative_x), fixed(s.relative_y),
    String(s.heading_degrees), fixed(s.stall_width_ft), fixed(s.stall_depth_ft),
  ].join('|'))
  .join('\n');
const SEED_MD5 = createHash('md5').update(CANON, 'utf8').digest('hex');

const L = [];
L.push('-- =============================================================================');
L.push('-- ottoq_layout_seed  —  GENERATED FILE, DO NOT EDIT BY HAND');
L.push('--');
L.push('-- Generated by scripts/buildLayoutSeed.mjs from src/lib/sitePlan.ts.');
L.push('-- Deterministic: same site plan in => byte-identical file out. Re-run and diff.');
L.push('--');
L.push(`-- 1 render unit = 0.4785 m / 0.3048 m per ft = ${UNIT_FT.toFixed(8)} ft`);
L.push(`-- relative_x = (render_x - ${FRAME_X0}) * UNIT_FT      [0 .. ${fixed(lotRect.width_ft, 2)} ft]`);
L.push(`-- relative_y = (${FRAME_Y0} - render_y) * UNIT_FT     [0 .. ${fixed(lotRect.length_ft, 2)} ft]  <- Y IS FLIPPED`);
L.push('--');
L.push(`-- Stalls:     ${stalls.length}  (staging ${INVENTORY.staging}, l2 ${INVENTORY.l2}, dcfc ${INVENTORY.dcfc}, wash ${INVENTORY.wash_bay}, service ${INVENTORY.service_bay})`);
L.push(`-- Structures: ${structures.length}`);
L.push(`-- Re-homed stall codes:    ${REHOME_PAIRS.length}  (staging; row + id + history kept, position moved)`);
L.push(`-- Deleted stall codes:     ${RETIRED_ALL.length}  (must be referenced by nothing)`);
L.push(`-- Retired structure codes: ${RETIRED_STRUCTURES.length}  (${RETIRED_STRUCTURES.join(', ')})`);
L.push('--');
L.push(`-- SEED MD5: ${SEED_MD5}`);
L.push('--   md5 over stall_code|stall_type|relative_x|relative_y|heading|width|depth,');
L.push('--   newline-joined, ordered by stall_code. Migration 0010 recomputes this in SQL');
L.push('--   and aborts on mismatch, so a hand-edited seed cannot reshape the depot.');
L.push('-- =============================================================================');
L.push('');
L.push('-- The seed is DEPOT-AGNOSTIC. stall_code is the natural key; the migration');
L.push('-- resolves it to a depot and to a primary key. See buildLayoutSeed.mjs for the');
L.push('-- UUID strategy (existing codes keep their id; new codes get uuid_generate_v5).');
L.push('');
L.push('CREATE TEMP TABLE ottoq_layout_seed_stalls (');
L.push('  stall_code       text PRIMARY KEY,');
L.push('  render_id        text        NOT NULL,');
L.push('  stall_type       text        NOT NULL,');
L.push('  stall_kind       text        NOT NULL,');
L.push('  zone             text        NOT NULL,');
L.push('  staging_role     text,');
L.push('  display_name     text        NOT NULL,');
// NOTE: relative_x/y are NUMERIC here even though public.stalls stores them as
// double precision. numeric round-trips through ::text exactly, which is what makes
// the migration's md5 guard reproducible; a double can print as 141.28940000000001.
// The migration casts to double precision on the way in.
L.push('  relative_x       numeric     NOT NULL,');
L.push('  relative_y       numeric     NOT NULL,');
L.push('  heading_degrees  smallint    NOT NULL,');
L.push('  stall_width_ft   numeric     NOT NULL,');
L.push('  stall_depth_ft   numeric     NOT NULL,');
L.push('  absolute_lat     numeric     NOT NULL,');
L.push('  absolute_lng     numeric     NOT NULL,');
L.push('  canopy_code      text,');
L.push('  canopy_side      text,');
L.push('  covered          boolean     NOT NULL,');
L.push('  run_id           text        NOT NULL');
L.push(') ON COMMIT DROP;');
L.push('');
L.push('INSERT INTO ottoq_layout_seed_stalls');
L.push('  (stall_code, render_id, stall_type, stall_kind, zone, staging_role, display_name,');
L.push('   relative_x, relative_y, heading_degrees, stall_width_ft, stall_depth_ft,');
L.push('   absolute_lat, absolute_lng, canopy_code, canopy_side, covered, run_id)');
L.push('VALUES');
L.push(stalls.map((s) => '  (' + [
  q(s.stall_code), q(s.render_id), q(s.stall_type), q(s.stall_kind), q(s.zone),
  s.staging_role ? q(s.staging_role) : 'NULL', q(s.display_name),
  fixed(s.relative_x), fixed(s.relative_y), String(s.heading_degrees),
  fixed(s.stall_width_ft), fixed(s.stall_depth_ft),
  fixed(s.absolute_lat, 8), fixed(s.absolute_lng, 8),
  s.canopy_code ? q(s.canopy_code) : 'NULL', s.canopy_side ? q(s.canopy_side) : 'NULL',
  s.covered ? 'true' : 'false', q(s.run_id),
].join(', ') + ')').join(',\n') + ';');
L.push('');
L.push('CREATE TEMP TABLE ottoq_layout_seed_structures (');
L.push('  structure_code  text PRIMARY KEY,');
L.push('  structure_kind  text    NOT NULL,');
L.push('  title           text    NOT NULL,');
L.push('  origin_x_ft     numeric NOT NULL,');
L.push('  origin_y_ft     numeric NOT NULL,');
L.push('  width_ft        numeric NOT NULL,');
L.push('  length_ft       numeric NOT NULL,');
L.push('  height_ft       numeric NOT NULL,');
L.push('  rotation_deg    numeric NOT NULL,');
L.push('  status          text    NOT NULL,');
L.push('  absolute_lat    numeric NOT NULL,');
L.push('  absolute_lng    numeric NOT NULL,');
L.push('  properties      jsonb   NOT NULL');
L.push(') ON COMMIT DROP;');
L.push('');
L.push('INSERT INTO ottoq_layout_seed_structures');
L.push('  (structure_code, structure_kind, title, origin_x_ft, origin_y_ft, width_ft, length_ft,');
L.push('   height_ft, rotation_deg, status, absolute_lat, absolute_lng, properties)');
L.push('VALUES');
L.push(structures.map((s) => '  (' + [
  q(s.structure_code), q(s.structure_kind), q(s.title),
  fixed(s.origin_x_ft), fixed(s.origin_y_ft), fixed(s.width_ft), fixed(s.length_ft),
  fixed(s.height_ft), fixed(s.rotation_deg), q(s.status),
  fixed(s.absolute_lat, 8), fixed(s.absolute_lng, 8), jb(s.properties),
].join(', ') + ')').join(',\n') + ';');
L.push('');
L.push('-- The divided ring, as the four straight runs the geometry guard tests. Emitted');
L.push('-- from sitePlan.ts so the migration never hardcodes a lane coordinate -- the');
L.push('-- single-source rule that applies to stalls applies to lanes too. Each run is a');
L.push('-- lane BODY (one design vehicle wide) offset from its centreline; no stall');
L.push('-- footprint may intersect one. Gate-approach diagonals are NOT modelled here.');
L.push('CREATE TEMP TABLE ottoq_layout_seed_lanes (');
L.push('  lane_name text PRIMARY KEY,');
L.push('  x0 numeric NOT NULL, y0 numeric NOT NULL,');
L.push('  x1 numeric NOT NULL, y1 numeric NOT NULL');
L.push(') ON COMMIT DROP;');
L.push('');
{
  const off = LANE_RIGHT_OFFSET * UNIT_FT;
  const half = DESIGN_VEHICLE_FT.width / 2;
  const wx = toX(sp.WEST_AISLE_X), ex = toX(sp.EAST_AISLE_X);
  const ny = toY(sp.NORTH_LANE_Y), sy = toY(sp.SOUTH_LANE_Y);
  const ay0 = Math.min(ny, sy), ay1 = Math.max(ny, sy);
  const cx0 = Math.min(wx, ex), cx1 = Math.max(wx, ex);
  const rows = [];
  for (const [nm, cx] of [['west avenue', wx], ['east avenue', ex]]) {
    for (const [d, s] of [['northbound', 1], ['southbound', -1]]) {
      rows.push([`${nm} ${d}`, cx + s * off - half, ay0, cx + s * off + half, ay1]);
    }
  }
  for (const [nm, cy] of [['north collector', ny], ['south collector', sy]]) {
    for (const [d, s] of [['eastbound', 1], ['westbound', -1]]) {
      rows.push([`${nm} ${d}`, cx0, cy + s * off - half, cx1, cy + s * off + half]);
    }
  }
  L.push('INSERT INTO ottoq_layout_seed_lanes (lane_name, x0, y0, x1, y1) VALUES');
  L.push(rows.map(([n, a, b2, c, d]) =>
    `  (${q(n)}, ${fixed(a)}, ${fixed(b2)}, ${fixed(c)}, ${fixed(d)})`).join(',\n') + ';');
  L.push('');
}
L.push('-- Staging codes that leave the layout. These rows are RE-HOMED, never deleted:');
L.push('-- the row keeps its id, so every booking / state-log line / mission that points');
L.push('-- at it survives. Staging is fungible, so the position is what changes.');
L.push('CREATE TEMP TABLE ottoq_layout_seed_rehome (');
L.push('  from_code text PRIMARY KEY,');
L.push('  to_code   text NOT NULL UNIQUE,');
L.push('  reason    text NOT NULL');
L.push(') ON COMMIT DROP;');
L.push('');
L.push('INSERT INTO ottoq_layout_seed_rehome (from_code, to_code, reason) VALUES');
L.push(REHOME_PAIRS.map(([f, t]) => {
  const why = f.startsWith('NASH-STG-N')
    ? 'north apron kept clear for pull-through bay-rear maneuvering; run N1 holds 7'
    : f === 'NASH-STG-I014'
      ? 'arrival_inspection resized 14 -> 13 to match temp block column TE'
      : 'staging_buffer resized 14 -> 13 to match temp block column TW';
  return `  (${q(f)}, ${q(t)}, ${q(why)})`;
}).join(',\n') + ';');
L.push('');
L.push('-- Codes DELETED outright. Only rows referenced by NOTHING may appear here; the');
L.push('-- migration re-counts all 17 foreign keys at apply time and RAISEs on any hit.');
L.push('CREATE TEMP TABLE ottoq_layout_seed_retired (');
L.push('  stall_code text PRIMARY KEY,');
L.push('  reason     text NOT NULL');
L.push(') ON COMMIT DROP;');
L.push('');
L.push('INSERT INTO ottoq_layout_seed_retired (stall_code, reason) VALUES');
L.push([
  ...RETIRED.l2.map((c) => [c, 'phantom L2 capacity: overran canopy 2 to the south, was among the overlapping pairs, one stacked on a staging space. Deleted not closed: ottoq_plan_overnight_wave counts stall_type=l2 with no status filter, so a closed row would keep broadcasting capacity. Provably unreferenced across all 17 FK columns.']),
].map(([c, r]) => `  (${q(c)}, ${q(r)})`).join(',\n') + ';');
L.push('');
L.push('CREATE TEMP TABLE ottoq_layout_seed_retired_structures (');
L.push('  structure_code text PRIMARY KEY,');
L.push('  reason         text NOT NULL');
L.push(') ON COMMIT DROP;');
L.push('');
L.push('INSERT INTO ottoq_layout_seed_retired_structures (structure_code, reason) VALUES');
L.push([
  ['CANOPY-04', 'the renderer has 3 canopies, not 4; canopy 4 sheltered no chargers. Row RETAINED (never dropped) and marked decommissioned; its geometry stays in the superseded pre-0010 frame and is void. ottoq_canopy_state is DELIBERATELY untouched, so solar output does not change.'],
  ['METAL-CANOPY-PERIM', 'replaced by five real carports (CARPORT-W/E/S1/S2/S3). This row claimed to cover 100 stalls with width_ft and length_ft both NULL.'],
].map(([c, r]) => `  (${q(c)}, ${q(r)})`).join(',\n') + ';');
L.push('');

const sql = L.join('\n');

const json = {
  meta: {
    source: 'src/lib/sitePlan.ts',
    generator: 'scripts/buildLayoutSeed.mjs',
    unit_ft: UNIT_FT,
    frame: 'database: feet, origin at fence SW corner, y NORTH-positive (renderer y is SOUTH-positive)',
    origin_lat: ORIGIN_LAT,
    origin_lng: ORIGIN_LNG,
    clearance_ft: CLEARANCE_FT,
    seed_md5: SEED_MD5,
    design_vehicle_ft: DESIGN_VEHICLE_FT,
  },
  lot_ft: lotRect,
  site: {
    site_length_ft: lotRect.width_ft,
    site_width_ft: lotRect.length_ft,
    site_acres: (lotRect.width_ft * lotRect.length_ft) / 43560,
  },
  inventory: INVENTORY,
  lanes: {
    west_aisle_x: toX(sp.WEST_AISLE_X), east_aisle_x: toX(sp.EAST_AISLE_X),
    north_lane_y: toY(sp.NORTH_LANE_Y), south_lane_y: toY(sp.SOUTH_LANE_Y),
    rear_lane_y: toY(sp.REAR_LANE_Y), forecourt_y: toY(sp.FORECOURT_Y),
    west_link_x: toX(sp.WEST_LINK_X), temp_lane_x: toX(sp.TEMP_LANE_X),
    gap_lanes_x: Object.fromEntries(Object.entries(sp.GAP_LANES).map(([k, v]) => [k, toX(v)])),
    // A divided avenue carries two opposing lanes, each offset this far from the
    // centreline. Exported so the geometry guards (JS check 7, migration 0010
    // section 6.6) can test stall-vs-LANE clearance -- the class of defect that let
    // the east avenue's northbound lane sit 0.9u inside the E-column stalls.
    right_offset_ft: LANE_RIGHT_OFFSET * UNIT_FT,
    lane_body_width_ft: DESIGN_VEHICLE_FT.width,
    // The divided RING, as the four straight runs the guards test. The two avenues
    // are vertical and span between the collectors; the two collectors are
    // horizontal and span between the avenues. Gate-approach diagonals are NOT in
    // here and are NOT claimed to be tested.
    ring_ft: {
      avenue_y0: toY(sp.SOUTH_LANE_Y), avenue_y1: toY(sp.NORTH_LANE_Y),
      collector_x0: toX(sp.WEST_AISLE_X), collector_x1: toX(sp.EAST_AISLE_X),
    },
  },
  stalls,
  structures,
  retired_stalls: RETIRED_ALL,
  rehomed_stalls: Object.fromEntries(REHOME_PAIRS),
  retired_structures: RETIRED_STRUCTURES,
};

mkdirSync('unreal', { recursive: true });
writeFileSync('unreal/layoutSeed.sql', sql + '\n');
writeFileSync('unreal/layoutSeed.json', JSON.stringify(json, null, 2) + '\n');

console.log(`BUILT unreal/layoutSeed.sql  — ${stalls.length} stalls, ${structures.length} structures, ${RETIRED_ALL.length} retired codes`);
console.log(`      lot ${fixed(lotRect.width_ft, 2)} x ${fixed(lotRect.length_ft, 2)} ft = ${fixed(json.site.site_acres, 3)} acres`);
console.log(`      unit conversion ${UNIT_FT.toFixed(8)} ft/unit`);
console.log(`      SEED MD5 ${SEED_MD5}   <- bake this into migration 0010`);
if (CORNER_TRIMS.length) {
  console.log(`      ${CORNER_TRIMS.length} corner clip(s) resolved by trimming declared footprints:`);
  for (const t of CORNER_TRIMS) console.log(`        - ${t}`);
}
