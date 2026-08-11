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
//   7  stall vs LANE clearance          (no travel lane may cut into a parked car)
//   8  design-vehicle fit               (REPORT ONLY — see the note on that check)
//   9  structure vs LANE clearance      (no solid object may stand in a travel lane)
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
 * 24 ft is the two-way / 90-degree parking standard. 20 ft is the one-way standard.
 * Both thresholds are declared here rather than buried, so that raising them is a
 * visible edit.
 *
 * WHICH STALL GETS WHICH — this used to be `stall_type === 'dcfc' || 'l2'`, i.e. the
 * charging stalls got 24 ft and EVERY staging stall got 20 ft, on the strength of a
 * sitePlan comment reading "Collectors are two-way boulevards; aisles are one-way".
 * That comment is not what the layout says. sitePlan declares BOTH avenues "two-way
 * divided" (WEST_AISLE_X, EAST_AISLE_X), the founder specified the temp aisle and the
 * east avenue to the ~24 ft two-way standard on 2026-08-11, and the lane graph carries
 * the opposing pair for each of them. So the guard was holding the founder's own 24 ft
 * corridors to a 20 ft floor: the east avenue could have been narrowed from its
 * measured 24.39 ft down to 20.1 ft and this check would still have printed PASS.
 *
 * The classification is now DERIVED from the lane graph rather than typed here (see
 * LANE_RUNS below): a corridor is two-way when the graph carries both directions
 * across it. That is the same construction check 7 uses — the guarded set is the
 * driven set — so a lane that changes direction re-classifies the stalls it serves on
 * the next seed build, with nobody having to remember to edit a list.
 *
 * The floor is a RATCHET: a stall is held to the greater of its type floor and its
 * aisle floor, so making the classification data-driven can only ever raise a
 * threshold, never lower one. The charging stalls stay at 24 ft even though the gap
 * lanes that serve them are genuinely one-way northbound.
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

// ---------------------------------------------------------------------------
// THE ROAD NETWORK, WITH ITS DIRECTIONALITY
//
// The seed emits lanes.runs_ft: every DIRECTED edge of buildDepotLanes(), named
// "FROM>TO", offset drive-on-the-right and widened to one design vehicle. A corridor
// is TWO-WAY exactly when the graph also carries the opposing edge — "SE>NE" is
// two-way because "NE>SE" exists; "Sg3>Ng3" is one-way because "Ng3>Sg3" does not.
//
// That is a fact about the network the cars actually drive, not a label anyone has to
// keep in sync. Measured on this seed it separates 42 two-way runs from 13 one-way
// ones, and the 13 are exactly the ones the doctrine says are one-way: the four
// charge-lane pull-outs (northbound only), the rear-apron chain, and the ingress and
// egress spurs.
//
// Used by check 6 (which floor a stall's approach is held to) and by checks 7 and 9
// (nothing solid may stand in a lane).
// ---------------------------------------------------------------------------
const LANE_RECTS = (() => {
  const runs = lanes?.runs_ft;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const ok = (r) => ['x0', 'y0', 'x1', 'y1'].every((k) => Number.isFinite(r[k])) && typeof r.lane_name === 'string';
  if (!runs.every(ok)) return null;
  const named = new Set(runs.map((r) => r.lane_name));
  return runs.map((r) => {
    const [from, to] = r.lane_name.split('>');
    return {
      name: r.lane_name,
      // A malformed name (no '>') yields undefined halves and `undefined>undefined`
      // is not in the set, so it classifies one-way — the LOWER claim, never a
      // silent upgrade to "this is a 24 ft corridor".
      two_way: named.has(`${to}>${from}`),
      x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1),
      y0: Math.min(r.y0, r.y1), y1: Math.max(r.y0, r.y1),
    };
  });
})();

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
// WHICH FLOOR. Every face is classified by the lane that SERVES it — the nearest lane
// body lying beyond that face and overlapping it laterally — and held to 24 ft when
// that lane is two-way. The stall then passes on the best of its four faces, as before.
// See AISLE_MIN_FT for why this replaced a hand-typed stall_type test.
{
  if (!LANE_RECTS) {
    // The classification cannot be established without the road network, and a
    // 20 ft floor applied to a 24 ft corridor is a false PASS. Refuse, do not guess.
    fail('minimum drivable aisle',
      'lane geometry missing from the seed (lanes.runs_ft) — the two-way/one-way ' +
      'classification is NOT ESTABLISHED. Re-run scripts/buildLayoutSeed.mjs.', []);
  } else {
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

  /** The lane a car leaving through this face drives into: the nearest lane body
   *  beyond the face that actually lies across it. Lateral overlap is required, so a
   *  road running past the END of a column does not get read as that column's aisle.
   *  Returns null when no lane lies that way at all — a fence face, or the back of a
   *  building — and null is reported as such rather than assumed to be one-way. */
  function servingLane(s, { dx, dy }) {
    const b = boxes.get(s.stall_code);
    const edge = dx !== 0 ? (dx > 0 ? b.x1 : b.x0) : (dy > 0 ? b.y1 : b.y0);
    const lat0 = dx !== 0 ? b.y0 : b.x0;
    const lat1 = dx !== 0 ? b.y1 : b.x1;
    let best = null;
    for (const L of LANE_RECTS) {
      const [near, far] = dx !== 0 ? [L.x0, L.x1] : [L.y0, L.y1];
      const [olat0, olat1] = dx !== 0 ? [L.y0, L.y1] : [L.x0, L.x1];
      if (Math.min(lat1, olat1) - Math.max(lat0, olat0) <= 1e-6) continue; // not across this face
      const d = (dx > 0 || dy > 0) ? near - edge : edge - far;
      if (d < -1e-6) continue;                                             // behind the face
      if (!best || d < best.d) best = { d, lane: L };
    }
    return best;
  }

  const rows = [];
  for (const s of measured) {
    // The type floor is the ratchet's lower bound: charging is held to 24 ft whatever
    // the lane graph says, because the gap lanes that serve it are one-way northbound
    // and that must not be allowed to relax the number the audit was written around.
    const typeFloor = (s.stall_type === 'dcfc' || s.stall_type === 'l2')
      ? AISLE_MIN_FT.two_way : AISLE_MIN_FT.one_way;

    const faces = SIDES.map((side) => {
      const c = clearance(s, side);
      const sl = servingLane(s, side);
      const aisleFloor = sl && sl.lane.two_way ? AISLE_MIN_FT.two_way : AISLE_MIN_FT.one_way;
      const min = Math.max(typeFloor, aisleFloor);
      return {
        ...c, side: side.name, min,
        lane: sl ? sl.lane.name : null,
        aisle: sl ? (sl.lane.two_way ? 'two-way' : 'one-way') : 'no lane on this face',
        margin: c.clear - min,
      };
    });

    // A stall needs ONE adequate way in, so it passes on its best face — but "best"
    // now means the largest margin over that face's OWN floor, not the widest gap.
    // A 30 ft one-way face and a 25 ft two-way face are not comparable as raw numbers.
    const best = faces.reduce((m, f) => (f.margin > m.margin ? f : m), faces[0]);
    rows.push({ code: s.stall_code, type: s.stall_type, ...best });
  }

  const bad = rows.filter((r) => r.margin < -1e-6)
    .sort((a, b) => a.margin - b.margin)
    .map((r) => `${r.code} (${r.type}): best side ${r.side} gives ${r.clear.toFixed(1)} ft clear, ` +
                `needs ${r.min.toFixed(0)} ft [${r.aisle}${r.lane ? ` — lane ${r.lane}` : ''}] — ` +
                `blocked by ${r.blocker}`);
  const tightest = rows.reduce((m, r) => (r.margin < m.margin ? r : m), rows[0]);
  const twoWayRows = rows.filter((r) => r.min >= AISLE_MIN_FT.two_way);
  const tightTwo = twoWayRows.reduce((m, r) => (r.clear < m.clear ? r : m), twoWayRows[0]);
  bad.length
    ? fail('minimum drivable aisle', `${bad.length} stall(s) below standard`, bad)
    : conclude('minimum drivable aisle', [],
        `${twoWayRows.length} of ${rows.length} stalls held to the ${AISLE_MIN_FT.two_way} ft two-way floor ` +
        `(${rows.filter((r) => r.aisle === 'two-way').length} by their serving lane); ` +
        `tightest margin ${tightest.code} at ${tightest.clear.toFixed(2)} ft vs ${tightest.min.toFixed(0)} ft ` +
        `[${tightest.aisle}]; tightest two-way ${tightTwo.code} at ${tightTwo.clear.toFixed(2)} ft`);
  }
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
// has accepted, and no other corridor on this site is wide enough to match it.
//
// WHICH LANES. This check used to rebuild FOUR runs (the divided ring) from four
// sitePlan constants. That is a smaller road network than the cars drive, and the
// blind spot was load-bearing: the east avenue continues NORTH of the north collector
// up to the rear apron, and the N1 overflow row sat 0.17 ft off that stretch with a
// light pole standing inside it -- while this check printed the avenue clear, because
// its rectangle stopped at the collector. The gap lanes and the rear apron were not
// modelled at all.
//
// The seed now emits lanes.runs_ft: EVERY directed edge of buildDepotLanes(), offset
// drive-on-the-right and widened to one design vehicle. The guarded set is the driven
// set by construction, so a lane added to the graph is guarded the moment it exists.
// LANE_RECTS is built once near the top of this file, because check 6 needs its
// directionality too.

/** Signed separation of a footprint from a lane body. Negative on BOTH axes means the
 *  lane cuts into it; otherwise the larger separation is the clear gap. */
function laneGap(b, L) {
  const dx = Math.max(L.x0 - b.x1, b.x0 - L.x1);
  const dy = Math.max(L.y0 - b.y1, b.y0 - L.y1);
  return { dx, dy, cuts: dx < 0 && dy < 0, gap: Math.max(dx, dy), depth: Math.min(-dx, -dy) };
}

const WEST_REFERENCE_FT = 6.44;

{
  if (!LANE_RECTS) {
    // NOT ESTABLISHED, never a silent pass.
    fail('stall vs lane clearance',
      'lane geometry missing from the seed (lanes.runs_ft) — NOT ESTABLISHED. Re-run scripts/buildLayoutSeed.mjs.', []);
  } else {
    const overlaps = [];
    let tightest = null;
    for (const s of measured) {
      const b = boxes.get(s.stall_code);
      for (const L of LANE_RECTS) {
        const r = laneGap(b, L);
        if (r.cuts) {
          overlaps.push(`${s.stall_code} (x ${b.x0.toFixed(1)}..${b.x1.toFixed(1)}, y ${b.y0.toFixed(1)}..${b.y1.toFixed(1)}) ` +
                        `overlaps lane ${L.name} by ${r.depth.toFixed(2)} ft`);
        } else if (!tightest || r.gap < tightest.gap) {
          tightest = { gap: r.gap, code: s.stall_code, lane: L.name };
        }
      }
    }

    if (overlaps.length) {
      fail('stall vs lane clearance', `${overlaps.length} stall/lane overlap(s) — a travel lane cuts into a parked car`, overlaps);
    } else {
      const detail = `${LANE_RECTS.length} lane bodies tested; tightest ${tightest.code} vs lane ${tightest.lane}: ` +
                     `${tightest.gap.toFixed(2)} ft clear (west avenue reference ${WEST_REFERENCE_FT} ft)`;
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

// ---- 9. Structure vs LANE clearance -----------------------------------------
//
// WHY THIS CHECK EXISTS. Check 4 tests stalls against structures and check 7 tests
// stalls against lanes. NOTHING tested STRUCTURES against LANES, so a solid object
// could stand in the middle of a road and every check still printed PASS. That is not
// hypothetical. Measured on main immediately before this check was written, FOUR of
// the eleven site light poles stood inside a lane body a car drives:
//
//   LIGHT-03 (render 36,174)  1.42 ft inside the south collector westbound
//   LIGHT-04 (render 268,60)  3.15 ft inside the east avenue, north of the collector
//   LIGHT-05 (render 268,120) 3.15 ft inside the east avenue southbound
//   LIGHT-06 (render 268,174) 1.42 ft inside the south collector westbound
//
// and sitePlan.ts carried a comment above the pole list asserting they were "NEVER in
// a travel lane". A claim nobody checks is a claim that drifts. This is the check.
//
// A pole is 1.5 ft square, so a car could in principle steer around one. That is not
// the bar: a permanent solid object inside a marked travel lane is a design defect and
// a collision hazard, and the layout has room to not do it. Overlap FAILS.
//
// Canopy roofs, carport roofs, the perimeter fence, painted markings and signage are
// excluded exactly as in check 4 — a car drives under a roof by design.
{
  if (!LANE_RECTS) {
    fail('structure vs lane clearance',
      'lane geometry missing from the seed (lanes.runs_ft) — NOT ESTABLISHED. Re-run scripts/buildLayoutSeed.mjs.', []);
  } else {
    const solid = structures.filter(
      (t) => !NON_ENCLOSING_KINDS.has(t.structure_kind) && t.status === 'active',
    );
    const unmeasuredStructs = solid
      .filter((t) => !['origin_x_ft', 'origin_y_ft', 'width_ft', 'length_ft']
        .every((k) => Number.isFinite(+t[k])))
      .map((t) => t.structure_code);

    const overlaps = [];
    let tightest = null;
    for (const t of solid) {
      if (unmeasuredStructs.includes(t.structure_code)) continue;
      const b = { x0: +t.origin_x_ft, y0: +t.origin_y_ft,
                  x1: +t.origin_x_ft + +t.width_ft, y1: +t.origin_y_ft + +t.length_ft };
      for (const L of LANE_RECTS) {
        const r = laneGap(b, L);
        if (r.cuts) {
          overlaps.push(`${t.structure_code} (${t.structure_kind}, "${t.title}") ` +
                        `stands ${r.depth.toFixed(2)} ft inside lane ${L.name}`);
        } else if (!tightest || r.gap < tightest.gap) {
          tightest = { gap: r.gap, code: t.structure_code, lane: L.name };
        }
      }
    }

    if (overlaps.length) {
      fail('structure vs lane clearance',
        `${overlaps.length} structure/lane overlap(s) — a solid object stands in a travel lane`, overlaps);
    } else if (unmeasuredStructs.length) {
      // Same rule as `conclude`: a check whose subject set was reduced does not pass.
      fail('structure vs lane clearance',
        `NOT ESTABLISHED — ${unmeasuredStructs.length} solid structure(s) have no usable ` +
        `footprint and were not assessed; the rest are clear`, unmeasuredStructs);
    } else {
      pass('structure vs lane clearance',
        `${solid.length} solid structure(s) vs ${LANE_RECTS.length} lane bodies; ` +
        `tightest ${tightest.code} vs lane ${tightest.lane}: ${tightest.gap.toFixed(2)} ft clear`);
    }
  }
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
