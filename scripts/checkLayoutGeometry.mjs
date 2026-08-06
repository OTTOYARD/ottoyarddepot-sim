#!/usr/bin/env node
// ============================================================================
// checkLayoutGeometry.mjs — THE GUARD
// ============================================================================
//
// WHY THIS FILE EXISTS
//   An audit drew the database's depot for the first time and found 54 overlapping
//   stall pairs across 76 of 150 stalls, 13 staging stalls inside the wash building,
//   4 inside the BESS compound, 20 charging stalls with no drivable aisle, and 5 bays
//   with NULL dimensions. None of that was caught, because nothing ever checked.
//   Migration 0010 fixes the data. THIS file is the reason it cannot silently return.
//
//   Run it on every seed build and in CI. It exits non-zero on any FAIL, and every
//   failure names the offending stall IDs — a count alone tells you nothing you can
//   act on.
//
// USAGE
//   node scripts/buildLayoutSeed.mjs
//   node scripts/checkLayoutGeometry.mjs [path/to/layoutSeed.json]
//
// CHECKS
//   1  no NULL / non-finite width, depth or coordinates
//   2  stall counts match the declared inventory
//   3  zero overlapping stall pairs
//   4  zero stalls inside a structure footprint, except the whitelist below
//   5  every stall inside the perimeter fence
//   6  minimum drivable aisle clearance
//   7  design-vehicle fit  (REPORT ONLY — see the note on that check)
//
// ---------------------------------------------------------------------------
// FOUNDER-CONFIRMED EXEMPTION — read before touching this list
// ---------------------------------------------------------------------------
//   The two service bays sit INSIDE the office building footprint. That is not a
//   mistake and it is not to be "fixed": it is an ATTACHED SERVICE GARAGE, and the
//   founder confirmed it explicitly when reviewing the layout. The structure is
//   labelled to say so (OFFICE-01, "Office Building + Attached Service Garage").
//   The three wash bays sit inside the wash building for the same obvious reason.
//
//   These are whitelisted BY ID so that any OTHER stall drifting inside any OTHER
//   structure still fails loudly. Do not widen this to a rule like "bays may be
//   inside buildings" — that would hide the next bug.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const ENCLOSURE_WHITELIST = [
  // founder-confirmed: attached service garage inside the office building
  { stall_code: 'NASH-SVC-01', structure_code: 'OFFICE-01' },
  { stall_code: 'NASH-SVC-02', structure_code: 'OFFICE-01' },
  // a wash bay is a bay inside the wash building by definition
  { stall_code: 'NASH-WSH-01', structure_code: 'WASH-01-BLDG' },
  { stall_code: 'NASH-WSH-02', structure_code: 'WASH-01-BLDG' },
  { stall_code: 'NASH-WSH-03', structure_code: 'WASH-01-BLDG' },
];

/**
 * Structure kinds that are not solid obstructions and so cannot "contain" a stall:
 * roofs a car parks under, the fence around everything, painted markings, signage.
 * Light poles ARE solid, and are checked.
 */
const NON_ENCLOSING_KINDS = new Set([
  'solar_canopy', 'metal_canopy', 'fence_segment', 'gate', 'lane_marker', 'sign',
]);

/**
 * Minimum clear aisle width, in feet.
 *
 * 24 ft is the two-way / 90-degree parking standard, and it is the number the
 * charging aisles are held to — they are the ones the audit found at 12 ft.
 * The perimeter and collector lanes in this layout are ONE-WAY by design
 * (sitePlan.ts: "Collectors are two-way boulevards; aisles are one-way"), and the
 * one-way standard is 20 ft. Both thresholds are declared here rather than buried,
 * so that raising them is a visible edit.
 */
const AISLE_MIN_FT = { two_way: 24.0, one_way: 20.0 };

/** Width of the design vehicle, used to decide what actually counts as an obstruction. */
const DESIGN_VEHICLE_WIDTH_FT = 6.6;

// ---------------------------------------------------------------------------

const path = process.argv[2] || 'unreal/layoutSeed.json';
const plan = JSON.parse(readFileSync(path, 'utf8'));
const { stalls, structures, inventory, lot_ft: lot, meta } = plan;

const results = [];
const pass = (name, detail) => results.push({ name, ok: true, detail, offenders: [] });
const fail = (name, detail, offenders) => results.push({ name, ok: false, detail, offenders });
const info = (name, detail, offenders) => results.push({ name, ok: true, warn: true, detail, offenders });

/** Axis-aligned footprint of a stall, in database feet. A heading of 0 or 180 puts
 *  the vehicle's LENGTH on the y axis; 90 or 270 puts it on the x axis. */
function box(s) {
  const lengthOnY = s.heading_degrees === 0 || s.heading_degrees === 180;
  const ex = (lengthOnY ? s.stall_width_ft : s.stall_depth_ft) / 2;
  const ey = (lengthOnY ? s.stall_depth_ft : s.stall_width_ft) / 2;
  return {
    x0: s.relative_x - ex, x1: s.relative_x + ex,
    y0: s.relative_y - ey, y1: s.relative_y + ey,
  };
}

/** Signed overlap of two boxes: positive means they intersect, by that many feet. */
function overlap(a, b) {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return ox > 0 && oy > 0 ? Math.min(ox, oy) : 0;
}

const boxes = new Map(stalls.map((s) => [s.stall_code, box(s)]));

// ---- 1. NULL / non-finite ---------------------------------------------------
{
  const bad = [];
  for (const s of stalls) {
    const missing = ['relative_x', 'relative_y', 'stall_width_ft', 'stall_depth_ft', 'heading_degrees']
      .filter((k) => s[k] === null || s[k] === undefined || !Number.isFinite(s[k]));
    if (missing.length) bad.push(`${s.stall_code} (${missing.join(', ')})`);
    else if (s.stall_width_ft <= 0 || s.stall_depth_ft <= 0) bad.push(`${s.stall_code} (non-positive footprint)`);
  }
  bad.length
    ? fail('no NULL width/depth/coordinates', `${bad.length} stall(s) incomplete`, bad)
    : pass('no NULL width/depth/coordinates', `all ${stalls.length} stalls fully dimensioned`);
}

// ---- 2. Inventory -----------------------------------------------------------
{
  const got = {};
  for (const s of stalls) got[s.stall_type] = (got[s.stall_type] || 0) + 1;
  const bad = Object.entries(inventory)
    .filter(([k, v]) => (got[k] || 0) !== v)
    .map(([k, v]) => `${k}: declared ${v}, found ${got[k] || 0}`);
  for (const k of Object.keys(got)) if (!(k in inventory)) bad.push(`${k}: ${got[k]} found but not declared`);
  const total = Object.values(inventory).reduce((a, b) => a + b, 0);
  if (stalls.length !== total) bad.push(`total: declared ${total}, found ${stalls.length}`);
  bad.length
    ? fail('stall counts match declared inventory', 'inventory drift', bad)
    : pass('stall counts match declared inventory',
        `${stalls.length} = ` + Object.entries(inventory).map(([k, v]) => `${k} ${v}`).join(', '));
}

// ---- 3. Overlapping stall pairs --------------------------------------------
{
  const bad = [];
  for (let i = 0; i < stalls.length; i++) {
    for (let j = i + 1; j < stalls.length; j++) {
      const o = overlap(boxes.get(stalls[i].stall_code), boxes.get(stalls[j].stall_code));
      if (o > 1e-6) bad.push(`${stalls[i].stall_code} <-> ${stalls[j].stall_code} (overlap ${o.toFixed(2)} ft)`);
    }
  }
  bad.length
    ? fail('zero overlapping stall pairs', `${bad.length} overlapping pair(s)`, bad)
    : pass('zero overlapping stall pairs', `all ${(stalls.length * (stalls.length - 1)) / 2} pairs clear`);
}

// ---- 4. Stalls inside structures -------------------------------------------
{
  const solid = structures.filter(
    (t) => !NON_ENCLOSING_KINDS.has(t.structure_kind) && t.status === 'active',
  );
  const allowed = new Set(ENCLOSURE_WHITELIST.map((w) => `${w.stall_code}|${w.structure_code}`));
  const bad = [];
  const exempted = [];
  for (const s of stalls) {
    const b = boxes.get(s.stall_code);
    for (const t of solid) {
      const r = { x0: +t.origin_x_ft, y0: +t.origin_y_ft, x1: +t.origin_x_ft + +t.width_ft, y1: +t.origin_y_ft + +t.length_ft };
      if (overlap(b, r) <= 1e-6) continue;
      const key = `${s.stall_code}|${t.structure_code}`;
      if (allowed.has(key)) exempted.push(key);
      else bad.push(`${s.stall_code} inside ${t.structure_code} (${t.structure_kind}, "${t.title}")`);
    }
  }
  const missing = [...allowed].filter((k) => !exempted.includes(k));
  if (missing.length) {
    // A whitelist entry that no longer matches means the layout moved under the
    // exemption. Surface it — a stale exemption is how a real overlap gets hidden.
    bad.push(...missing.map((k) => `STALE WHITELIST ENTRY: ${k} is no longer enclosed; remove it`));
  }
  bad.length
    ? fail('zero stalls inside a structure footprint', `${bad.length} violation(s)`, bad)
    : pass('zero stalls inside a structure footprint',
        `${exempted.length} founder-confirmed exemption(s): ${exempted.join(', ')}`);
}

// ---- 5. Inside the fence ----------------------------------------------------
{
  const bad = [];
  for (const s of stalls) {
    const b = boxes.get(s.stall_code);
    if (b.x0 < lot.origin_x_ft - 1e-6 || b.y0 < lot.origin_y_ft - 1e-6 ||
        b.x1 > lot.origin_x_ft + lot.width_ft + 1e-6 || b.y1 > lot.origin_y_ft + lot.length_ft + 1e-6) {
      bad.push(`${s.stall_code} (x ${b.x0.toFixed(1)}..${b.x1.toFixed(1)}, y ${b.y0.toFixed(1)}..${b.y1.toFixed(1)})`);
    }
  }
  bad.length
    ? fail('every stall inside the perimeter fence', `${bad.length} outside`, bad)
    : pass('every stall inside the perimeter fence',
        `lot ${lot.width_ft.toFixed(1)} x ${lot.length_ft.toFixed(1)} ft`);
}

// ---- 6. Drivable aisle ------------------------------------------------------
//
// A stall is only usable if a car can REACH it, and this layout reaches stalls from
// different sides depending on where they are. sitePlan.ts is explicit about it:
// charging is "gas-pump" — a car rides a flanking pull-out lane to depth and
// SIDESTEPS IN, so a charging stall is served laterally, not head-on. Perimeter
// staging is served from behind (the east run faces the fence). The bays are
// pull-through, served front and rear.
//
// Measuring "straight out of the nose" would therefore be wrong in every one of
// those cases — it would report the car parked ahead in the same column as a blocked
// aisle. So: measure the clear run on ALL FOUR sides of each stall and take the best
// one. A stall needs one adequate way in; it does not need four. That is also
// exactly the defect the audit found — 20 charging stalls with NO clear side at all.
//
// Charging stalls are held to the two-way standard because they are the ones the
// audit caught at 12 ft. Perimeter and temp staging sit on one-way aisles.
{
  const solid = structures.filter(
    (t) => !NON_ENCLOSING_KINDS.has(t.structure_kind) && t.status === 'active',
  ).map((t) => ({
    code: t.structure_code,
    x0: +t.origin_x_ft, y0: +t.origin_y_ft,
    x1: +t.origin_x_ft + +t.width_ft, y1: +t.origin_y_ft + +t.length_ft,
  }));

  const SIDES = [
    { name: 'E', dx:  1, dy:  0 },
    { name: 'W', dx: -1, dy:  0 },
    { name: 'N', dx:  0, dy:  1 },
    { name: 'S', dx:  0, dy: -1 },
  ];

  // An object only BLOCKS a face if it actually stands in the way of a car leaving
  // through it. A 1.5 ft light pole beside a 10 ft stall mouth, or a neighbouring
  // stall clipping the last 5 inches of a corner, does not stop anything — the car
  // drives past it. So an obstruction is counted only when it covers at least a
  // design-vehicle's width of the face.
  //
  // This is an approximation: it does not compute the widest contiguous clear gap
  // across the face, it just ignores obstructions narrower than a car. On this
  // layout the two are equivalent. If a future layout puts several narrow
  // obstructions side by side across one mouth, this check would miss it.
  const BLOCKING_SPAN_FT = DESIGN_VEHICLE_WIDTH_FT;

  /** Clear run from one side of a stall to the nearest obstruction on that side. */
  function clearance(s, { dx, dy }) {
    const b = boxes.get(s.stall_code);
    const edge = dx !== 0 ? (dx > 0 ? b.x1 : b.x0) : (dy > 0 ? b.y1 : b.y0);
    const lat0 = dx !== 0 ? b.y0 : b.x0;
    const lat1 = dx !== 0 ? b.y1 : b.x1;

    const fenceEdge = dx > 0 ? lot.origin_x_ft + lot.width_ft
      : dx < 0 ? lot.origin_x_ft
      : dy > 0 ? lot.origin_y_ft + lot.length_ft
      : lot.origin_y_ft;
    let clear = Math.abs(fenceEdge - edge);
    let blocker = 'fence';

    const consider = (near, far, olat0, olat1, code) => {
      const span = Math.min(lat1, olat1) - Math.max(lat0, olat0);
      if (span < BLOCKING_SPAN_FT - 1e-6) return; // too narrow to stop a car
      const d = (dx > 0 || dy > 0) ? near - edge : edge - far;
      if (d >= -1e-6 && d < clear) { clear = Math.max(0, d); blocker = code; }
    };
    for (const o of stalls) {
      if (o.stall_code === s.stall_code) continue;
      const ob = boxes.get(o.stall_code);
      dx !== 0 ? consider(ob.x0, ob.x1, ob.y0, ob.y1, o.stall_code)
               : consider(ob.y0, ob.y1, ob.x0, ob.x1, o.stall_code);
    }
    for (const o of solid) {
      dx !== 0 ? consider(o.x0, o.x1, o.y0, o.y1, o.code)
               : consider(o.y0, o.y1, o.x0, o.x1, o.code);
    }
    return { clear, blocker };
  }

  const rows = [];
  for (const s of stalls) {
    // best of the four faces — the side the car actually uses to get in
    let best = { clear: -1, blocker: null, side: null };
    for (const side of SIDES) {
      const c = clearance(s, side);
      if (c.clear > best.clear) best = { ...c, side: side.name };
    }
    const twoWay = s.stall_type === 'dcfc' || s.stall_type === 'l2';
    rows.push({ code: s.stall_code, type: s.stall_type, clear: best.clear,
                blocker: best.blocker, side: best.side,
                min: twoWay ? AISLE_MIN_FT.two_way : AISLE_MIN_FT.one_way, twoWay });
  }

  const bad = rows.filter((r) => r.clear < r.min - 1e-6)
    .sort((a, b) => a.clear - b.clear)
    .map((r) => `${r.code} (${r.type}): best side ${r.side} gives ${r.clear.toFixed(1)} ft clear, ` +
                `needs ${r.min.toFixed(0)} ft [${r.twoWay ? 'two-way' : 'one-way'}] — blocked by ${r.blocker}`);
  const tightest = rows.reduce((m, r) => (r.clear < m.clear ? r : m), rows[0]);
  const tightCharge = rows.filter((r) => r.twoWay).reduce((m, r) => (r.clear < m.clear ? r : m), rows.find((r) => r.twoWay));
  bad.length
    ? fail('minimum drivable aisle', `${bad.length} stall(s) below standard`, bad)
    : pass('minimum drivable aisle',
        `tightest overall ${tightest.code} at ${tightest.clear.toFixed(1)} ft ` +
        `(needs ${tightest.min.toFixed(0)} ft, ${tightest.twoWay ? 'two-way' : 'one-way'}); ` +
        `tightest charging ${tightCharge.code} at ${tightCharge.clear.toFixed(1)} ft (needs 24 ft)`);
}

// ---- 7. Design-vehicle fit (REPORT ONLY) ------------------------------------
//
// Not a hard failure. The declared footprints are derived from the renderer's own
// pitch, and the founder has reviewed and approved that layout, so a stall being
// tighter than nominal is a known and accepted property of this site — not a
// regression. But it is worth NAMING, because a stall shorter than the design
// vehicle is a stall a car physically overhangs, and nobody should have to
// rediscover that with a tape measure.
{
  const v = meta.design_vehicle_ft;
  // Only dimensioned stalls are assessable here; check 1 already failed on the rest.
  const tight = stalls
    .filter((s) => Number.isFinite(s.stall_depth_ft) && Number.isFinite(s.stall_width_ft))
    .filter((s) => s.stall_depth_ft < v.length || s.stall_width_ft < v.width)
    .map((s) => `${s.stall_code}: ${s.stall_width_ft.toFixed(2)} x ${s.stall_depth_ft.toFixed(2)} ft ` +
                `vs design vehicle ${v.width} x ${v.length} ft`);
  tight.length
    ? info('design-vehicle fit', `${tight.length} stall(s) tighter than the design vehicle`, tight)
    : pass('design-vehicle fit', `all stalls clear ${v.width} x ${v.length} ft`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log(`\nOTTO-Q depot geometry guard — ${path}`);
console.log(`  source: ${meta.source}   unit: ${meta.unit_ft.toFixed(8)} ft/render-unit\n`);

for (const r of results) {
  const tag = !r.ok ? 'FAIL' : r.warn ? 'WARN' : 'PASS';
  console.log(`[${tag}] ${r.name}`);
  console.log(`       ${r.detail}`);
  for (const o of r.offenders.slice(0, 40)) console.log(`         - ${o}`);
  if (r.offenders.length > 40) console.log(`         ... and ${r.offenders.length - 40} more`);
}

if (failed.length) {
  console.error(`\n${failed.length} CHECK(S) FAILED: ${failed.map((f) => f.name).join('; ')}`);
  process.exit(1);
}
console.log('\nAll blocking geometry checks passed.');
