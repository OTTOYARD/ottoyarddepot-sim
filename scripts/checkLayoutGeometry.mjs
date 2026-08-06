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
const { stalls, structures, inventory, lot_ft: lot, meta, lanes } = plan;

const results = [];
const pass = (name, detail) => results.push({ name, ok: true, detail, offenders: [] });
const fail = (name, detail, offenders) => results.push({ name, ok: false, detail, offenders });
const info = (name, detail, offenders) => results.push({ name, ok: true, warn: true, detail, offenders });

// ---------------------------------------------------------------------------
// MEASURABILITY — read this before changing any geometry check.
//
// A stall with a NULL or non-finite width, depth or coordinate has NO FOOTPRINT.
// It cannot be overlapped, enclosed, fenced or reached, because there is nothing
// there to test. That is not a passing stall; it is an UNTESTED one.
//
// This distinction is not hypothetical — it is the exact shape of the bug that
// made migration 0010 necessary. The live database's five bays carry NULL width
// and depth, and both halves of this guard originally mishandled them, in
// opposite directions:
//
//   * here, `null / 2` evaluates to 0, so a NULL-dimension stall collapsed to a
//     zero-area POINT. Checks 3-6 then found nothing wrong with it and printed
//     PASS. Worse, check 4 concluded the five founder-confirmed exemptions were
//     STALE and advised deleting them — which would have permanently disarmed the
//     one exemption the founder explicitly asked for.
//
//   * in the SQL twin, LEAST()/GREATEST() SKIP nulls rather than propagating
//     them, so the same five stalls collided with everything: the overlap count
//     read 779 per depot instead of the true 54, while the fence check silently
//     dropped them.
//
// So: geometric checks run over MEASURABLE stalls only, and any check whose
// subject set was reduced reports FAIL — "not established" — naming what it could
// not assess. A check that silently skips its hardest input is worse than no
// check, because it reports confidence it has not earned.
// ---------------------------------------------------------------------------

const DIMS = ['relative_x', 'relative_y', 'stall_width_ft', 'stall_depth_ft', 'heading_degrees'];

/** A stall is measurable only if every dimension is a finite number and the
 *  footprint is positive. Anything else has no geometry to test. */
function measurable(s) {
  return DIMS.every((k) => s[k] !== null && s[k] !== undefined && Number.isFinite(s[k]))
    && s.stall_width_ft > 0 && s.stall_depth_ft > 0;
}

const measured = stalls.filter(measurable);
const unmeasured = stalls.filter((s) => !measurable(s)).map((s) => s.stall_code);

/** Wrap a geometric verdict so it can never claim more than it tested. */
function conclude(name, bad, passDetail) {
  if (bad.length) return fail(name, `${bad.length} violation(s)`, bad);
  if (unmeasured.length) {
    return fail(name, `NOT ESTABLISHED — ${unmeasured.length} stall(s) have no usable ` +
      `footprint and were not assessed (see check 1); the rest are clear`, unmeasured);
  }
  return pass(name, passDetail);
}

/** Axis-aligned footprint of a stall, in database feet. A heading of 0 or 180 puts
 *  the vehicle's LENGTH on the y axis; 90 or 270 puts it on the x axis.
 *  Only ever called on measurable stalls. */
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

const boxes = new Map(measured.map((s) => [s.stall_code, box(s)]));

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
  for (let i = 0; i < measured.length; i++) {
    for (let j = i + 1; j < measured.length; j++) {
      const o = overlap(boxes.get(measured[i].stall_code), boxes.get(measured[j].stall_code));
      if (o > 1e-6) bad.push(`${measured[i].stall_code} <-> ${measured[j].stall_code} (overlap ${o.toFixed(2)} ft)`);
    }
  }
  conclude('zero overlapping stall pairs', bad,
    `all ${(measured.length * (measured.length - 1)) / 2} pairs clear`);
}

// ---- 4. Stalls inside structures -------------------------------------------
{
  const solid = structures.filter(
    (t) => !NON_ENCLOSING_KINDS.has(t.structure_kind) && t.status === 'active',
  );
  const allowed = new Set(ENCLOSURE_WHITELIST.map((w) => `${w.stall_code}|${w.structure_code}`));
  const bad = [];
  const exempted = [];
  for (const s of measured) {
    const b = boxes.get(s.stall_code);
    for (const t of solid) {
      const r = { x0: +t.origin_x_ft, y0: +t.origin_y_ft, x1: +t.origin_x_ft + +t.width_ft, y1: +t.origin_y_ft + +t.length_ft };
      if (overlap(b, r) <= 1e-6) continue;
      const key = `${s.stall_code}|${t.structure_code}`;
      if (allowed.has(key)) exempted.push(key);
      else bad.push(`${s.stall_code} inside ${t.structure_code} (${t.structure_kind}, "${t.title}")`);
    }
  }
  // A whitelist entry that no longer matches means the layout moved out from under
  // the exemption. Surface it — a stale exemption is how a real overlap gets hidden.
  //
  // But only say STALE when the stall was actually MEASURED and found to be outside.
  // An unmeasurable stall has no footprint, so it is not outside its structure — it
  // is untested. Calling that "stale, remove it" would talk an operator into deleting
  // the founder's exemption to silence a NULL, which is precisely backwards.
  const unmeasuredCodes = new Set(unmeasured);
  const missing = [...allowed].filter((k) => !exempted.includes(k));
  for (const k of missing) {
    const code = k.split('|')[0];
    bad.push(unmeasuredCodes.has(code)
      ? `${k}: exemption NOT VERIFIABLE — ${code} has no usable footprint (see check 1). ` +
        `Fix the dimensions; do NOT remove the exemption.`
      : `STALE WHITELIST ENTRY: ${k} is no longer enclosed; remove it`);
  }
  bad.length
    ? fail('zero stalls inside a structure footprint', `${bad.length} violation(s)`, bad)
    : conclude('zero stalls inside a structure footprint', [],
        `${exempted.length} founder-confirmed exemption(s): ${exempted.join(', ')}`);
}

// ---- 5. Inside the fence ----------------------------------------------------
{
  const bad = [];
  for (const s of measured) {
    const b = boxes.get(s.stall_code);
    if (b.x0 < lot.origin_x_ft - 1e-6 || b.y0 < lot.origin_y_ft - 1e-6 ||
        b.x1 > lot.origin_x_ft + lot.width_ft + 1e-6 || b.y1 > lot.origin_y_ft + lot.length_ft + 1e-6) {
      bad.push(`${s.stall_code} (x ${b.x0.toFixed(1)}..${b.x1.toFixed(1)}, y ${b.y0.toFixed(1)}..${b.y1.toFixed(1)})`);
    }
  }
  conclude('every stall inside the perimeter fence', bad,
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
    for (const o of measured) {
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
  for (const s of measured) {
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
    : conclude('minimum drivable aisle', [],
        `tightest overall ${tightest.code} at ${tightest.clear.toFixed(1)} ft ` +
        `(needs ${tightest.min.toFixed(0)} ft, ${tightest.twoWay ? 'two-way' : 'one-way'}); ` +
        `tightest charging ${tightCharge.code} at ${tightCharge.clear.toFixed(1)} ft (needs 24 ft)`);
}

// ---- 7. Stall vs LANE clearance ---------------------------------------------
//
// Checks 3 and 4 test stall-vs-stall and stall-vs-structure. Nothing tested
// stall-vs-LANE, so a travel lane could be routed straight through a parked car and
// every check would still report PASS. That is not hypothetical: the east avenue's
// northbound lane overlapped the E-column stalls by 0.90 render units (1.41 ft), on
// every single northbound pass, and this guard blessed it.
//
// A divided avenue carries two opposing lanes, each `right_offset_ft` from the
// centreline. A car in one of them occupies a body `lane_body_width_ft` wide about
// that lane. That body must not intersect a parked car's footprint.
//
// BLOCKING bar is overlap, i.e. clearance < 0 -- a lane may abut a stall (that is
// how a parking aisle works) but it may never cut into one. Anything positive but
// below the west avenue's proven 6.44 ft is reported as a WARN, not a failure: the
// west is the reference the renderer has actually run, not a standard the founder
// has accepted, and the east's corridor is physically too narrow to match it.
{
  const ln = lanes ?? {};
  const off = ln.right_offset_ft;
  const bodyHalf = (ln.lane_body_width_ft ?? meta.design_vehicle_ft?.width ?? 0) / 2;
  const WEST_REFERENCE_FT = 6.44;

  const ring = ln.ring_ft ?? {};
  const haveRing = ['avenue_y0', 'avenue_y1', 'collector_x0', 'collector_x1'].every((k) => Number.isFinite(ring[k]));

  if (!Number.isFinite(off) || !Number.isFinite(ln.west_aisle_x) || !Number.isFinite(ln.east_aisle_x) ||
      !Number.isFinite(ln.north_lane_y) || !Number.isFinite(ln.south_lane_y) || bodyHalf <= 0 || !haveRing) {
    // NOT ESTABLISHED, never a silent pass.
    fail('stall vs lane clearance',
      'lane geometry missing from the seed (lanes.right_offset_ft / lane_body_width_ft / *_aisle_x / *_lane_y / ring_ft) — NOT ESTABLISHED', []);
  } else {
    // Each run of the divided ring is a RECTANGLE: a lane body of finite length, not
    // an infinite band. Modelling the avenues as full-height bands would flag the
    // south perimeter row, which sits well south of where the avenue actually runs.
    const [ay0, ay1] = [Math.min(ring.avenue_y0, ring.avenue_y1), Math.max(ring.avenue_y0, ring.avenue_y1)];
    const [cx0, cx1] = [Math.min(ring.collector_x0, ring.collector_x1), Math.max(ring.collector_x0, ring.collector_x1)];
    const rects = [];
    for (const [nm, cx] of [['west avenue', ln.west_aisle_x], ['east avenue', ln.east_aisle_x]]) {
      for (const d of [-1, +1]) {
        const c = cx + d * off;
        rects.push({ name: `${nm} ${d > 0 ? 'northbound' : 'southbound'}`, x0: c - bodyHalf, x1: c + bodyHalf, y0: ay0, y1: ay1 });
      }
    }
    for (const [nm, cy] of [['north collector', ln.north_lane_y], ['south collector', ln.south_lane_y]]) {
      for (const d of [-1, +1]) {
        const c = cy + d * off;
        rects.push({ name: `${nm} ${d > 0 ? 'eastbound' : 'westbound'}`, x0: cx0, x1: cx1, y0: c - bodyHalf, y1: c + bodyHalf });
      }
    }

    const overlaps = [];
    let tightest = null;
    for (const s of measured) {
      const b = boxes.get(s.stall_code);
      for (const L of rects) {
        const dx = Math.max(L.x0 - b.x1, b.x0 - L.x1);
        const dy = Math.max(L.y0 - b.y1, b.y0 - L.y1);
        // Separated on either axis => clear. Overlapping on BOTH => the lane cuts in.
        const gap = (dx >= 0 || dy >= 0) ? Math.max(dx, dy) : Math.max(dx, dy);
        if (dx < 0 && dy < 0) {
          overlaps.push(`${s.stall_code} (x ${b.x0.toFixed(1)}..${b.x1.toFixed(1)}, y ${b.y0.toFixed(1)}..${b.y1.toFixed(1)}) ` +
                        `overlaps ${L.name} by ${Math.min(-dx, -dy).toFixed(2)} ft`);
        } else if (!tightest || gap < tightest.gap) {
          tightest = { gap, code: s.stall_code, lane: L.name };
        }
      }
    }

    if (overlaps.length) {
      fail('stall vs lane clearance', `${overlaps.length} stall/lane overlap(s) — a travel lane cuts into a parked car`, overlaps);
    } else {
      const detail = `tightest ${tightest.code} vs ${tightest.lane}: ${tightest.gap.toFixed(2)} ft clear ` +
                     `(west avenue reference ${WEST_REFERENCE_FT} ft)`;
      tightest.gap < WEST_REFERENCE_FT
        ? info('stall vs lane clearance', `no overlap; tightest is below the west avenue's proven clearance. ${detail}`, [])
        : pass('stall vs lane clearance', detail);
    }
  }
}

// ---- 8. Design-vehicle fit (REPORT ONLY) ------------------------------------
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
