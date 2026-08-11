// ============================================================================
// THE LOCK-IN: the seed, the database and the renderer describe ONE depot.
// ============================================================================
//
// The depot exists in three places at once — sitePlan.ts draws it, the committed
// seed declares it, and public.stalls in the twin backend stores it. Nothing bound
// them, and the drift was not theoretical:
//
//   * the renderer was replanned to 158 stalls while the database kept 160. The two
//     extra codes (NASH-STG-B013 / NASH-STG-I013) do not merely fail to resolve —
//     TwinMotionDriver.setTwinStallMap packs staging codes into renderer slots in
//     (group, index) order, so ONE extra code shifts every staging stall after it.
//     Every car the twin sent to a staging stall past B013 was drawn in the wrong
//     one, and the last two were aimed at stalls the scene does not contain.
//
//   * the geometry guard classified every staging stall as one-way with a 20 ft
//     floor, on the strength of a stale comment, while the founder's east avenue
//     measured 24.39 ft. It could have been narrowed to 20.1 ft and the guard would
//     have printed PASS on every check.
//
// Both are now asserted, against the COMMITTED seed rather than a hand-built fixture,
// so neither can come back quietly.
// ============================================================================
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { twinMotionDriver, parkedHeading, APPROACH_BACK_U } from "@/engine/TwinMotionDriver";
import {
  generateStallsV2, PARK_RUNS, TEMP_LANE_X, WEST_AISLE_X, EAST_AISLE_X,
  SOUTH_LANE_Y, N1_LANE_Y,
} from "@/lib/sitePlan";
import { useDepotStore } from "@/store/depotStore";
import { useVehicleStore } from "@/store/vehicleStore";

type SeedStall = { stall_code: string; stall_type: string; run_id: string; relative_x: number };
type Seed = { stalls: SeedStall[] };

const SEED_PATH = "unreal/layoutSeed.json";
const GUARD = "scripts/checkLayoutGeometry.mjs";
const seed = (): Seed => JSON.parse(readFileSync(SEED_PATH, "utf8")) as Seed;

/** Run the guard on a seed file. Returns its exit code and combined output —
 *  a non-zero exit is the guard doing its job, not a test error. */
function runGuard(path: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync("node", [GUARD, path], { encoding: "utf8" }) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("the geometry guard ratchets the founder's 24 ft two-way spec", () => {
  it("the committed seed is green, and the two-way floor is applied by LANE, not by stall type", () => {
    const { code, out } = runGuard(SEED_PATH);
    expect(out).toContain("[PASS] minimum drivable aisle");
    expect(code).toBe(0);

    // The point of the change: staging stalls on a two-way corridor are held to 24 ft.
    // If this ever reads 40 (the ten DCFC + thirty L2 held by TYPE), the classification
    // has silently reverted to the stall_type test and the avenues are unguarded again.
    const held = /(\d+) of (\d+) stalls held to the 24 ft two-way floor/.exec(out);
    expect(held).not.toBeNull();
    expect(Number(held![1])).toBeGreaterThan(40);
    expect(Number(held![2])).toBe(seed().stalls.length);
  });

  it("FAULT INJECTION: narrowing the east avenue below 24 ft now FAILS", () => {
    // 0.40 ft off the corridor takes it 24.39 -> 23.99 ft: a hairline breach of the
    // founder's spec, and deliberately too small to touch a lane body, so the ONLY
    // check that can catch it is the aisle floor. Measured on origin/main before this
    // change, the whole guard printed PASS on exactly this seed.
    const p = seed();
    for (const s of p.stalls) if (s.run_id === "E") s.relative_x -= 0.40;
    const dir = mkdtempSync(join(tmpdir(), "ottoq-guard-"));
    const path = join(dir, "seed_hairline.json");
    writeFileSync(path, JSON.stringify(p));

    const { code, out } = runGuard(path);
    expect(code).toBe(1);
    expect(out).toContain("[FAIL] minimum drivable aisle");
    expect(out).toContain("needs 24 ft [two-way");
    expect(out).toContain("NASH-STG-E008");
    // …and nothing else fired, which is what makes this a proof about the floor
    // rather than a lucky catch by the stall-vs-lane check.
    expect(out).toContain("1 CHECK(S) FAILED: minimum drivable aisle");
  });
});

describe("every stall the twin publishes resolves to a stall the renderer draws", () => {
  beforeEach(() => {
    twinMotionDriver.clear();
    useVehicleStore.getState().reset();
    useDepotStore.getState().regenerateStalls(10, 30, 3, 113, 2);
  });

  /** The layout the driver receives, built from the codes the DATABASE now holds:
   *  migration 'the_depot_is_158_stalls_in_both_worlds' made public.stalls on depot
   *  11111111-… equal this file field for field (verified by per-group md5). */
  const layoutFromSeed = () => seed().stalls.map((s, i) => ({
    id: `twin-${i}`, code: s.stall_code, type: s.stall_type,
  }));
  const mapOf = () =>
    (twinMotionDriver as unknown as { twinStall: Map<string, string> }).twinStall;
  const drawnIds = () => new Set(useDepotStore.getState().stalls.map((s) => s.id));

  it("all 113 STAGING codes map 1:1 onto stalls the scene draws", () => {
    // This is what the migration bought. Before it, the twin published 115 staging
    // codes into a scene with 113 staging stalls: the group-packing shifted every
    // slot after NASH-STG-B013 and the last two named nothing.
    const layout = layoutFromSeed();
    twinMotionDriver.setTwinStallMap(layout);
    const map = mapOf();
    const drawn = drawnIds();

    const staging = layout.filter((s) => s.type === "staging");
    expect(staging.length).toBe(113);
    const resolved = staging.map((s) => map.get(s.id));
    expect(resolved.filter((r) => r === undefined)).toEqual([]);       // total
    expect(new Set(resolved).size).toBe(staging.length);               // injective
    expect(resolved.filter((r) => !drawn.has(r!))).toEqual([]);        // grounded
  });

  it("a 159th staging code aims a car at a stall that does not exist", () => {
    // The property above holds only while the twin's staging count does not EXCEED
    // the renderer's: setTwinStallMap numbers slots 1..N with no reference to how
    // many stalls the scene draws. Re-adding one of the two deleted road-blockers
    // reproduces the exact failure, so "the counts must match" is a tested claim.
    const layout = layoutFromSeed();
    layout.push({ id: "twin-extra", code: "NASH-STG-B013", type: "staging" });
    twinMotionDriver.setTwinStallMap(layout);
    const map = mapOf();
    const drawn = drawnIds();

    const dangling = layout
      .filter((s) => s.type === "staging")
      .map((s) => map.get(s.id))
      .filter((r) => !r || !drawn.has(r));
    expect(dangling.length).toBe(1);
  });

  it("KNOWN DEFECT, pinned: five L2 codes still resolve to stalls the scene lacks", () => {
    // NOT caused by the 158-stall migration, and not fixed by it. The L2 code set is
    // 01..20 then 26..35 — 30 codes, because 21..25 were retired years of migrations
    // ago — and setTwinStallMap's single-group branch preserves the trailing number
    // so it can survive a gap. That is right for the twenty-five codes at or below 30
    // and WRONG for 31..35: the scene draws L2-01..L2-30, so those five map onto
    // renderer ids that do not exist. The doc comment above setTwinStallMap already
    // claims these "simply fall back to zone-based assignment"; they do not, because
    // the map holds a truthy string and acceptMotionCommand's own not-mapped refusal
    // (TwinMotionDriver.ts ~line 390) never fires.
    //
    // It is pinned rather than fixed here because the fix changes which stall five
    // charging cars are drawn in, which moves the motion fixture's ratcheted samples —
    // a different stream's measured baseline. This test fails the moment the set
    // changes, in either direction.
    const layout = layoutFromSeed();
    twinMotionDriver.setTwinStallMap(layout);
    const map = mapOf();
    const drawn = drawnIds();

    const dangling = layout
      .filter((s) => !drawn.has(map.get(s.id) ?? ""))
      .map((s) => `${s.code} -> ${map.get(s.id)}`)
      .sort();
    expect(dangling).toEqual([
      "NASH-L2-STALL-31 -> L2-31",
      "NASH-L2-STALL-32 -> L2-32",
      "NASH-L2-STALL-33 -> L2-33",
      "NASH-L2-STALL-34 -> L2-34",
      "NASH-L2-STALL-35 -> L2-35",
    ]);
  });
});

// ============================================================================
// EVERY PULL-IN COMES OFF THE DRIVE AISLE
// ============================================================================
//
// routeToStall aims a parking car at a point APPROACH_BACK_U behind its parked nose
// and then drives it straight in, so the parked heading decides which side the car
// enters from. parkedHeading used to pick that side by comparing the stall against the
// LOT CENTRE — face away from the middle of the depot. That holds for the four
// perimeter runs, where "away from the centre" and "away from the aisle" coincide, and
// it breaks on an interior block: the TW column sits east of the lot centre but is the
// WEST column of the temp block, so it was pointed east and approached from x=224.5,
// its back side, while its aisle (TEMP_LANE_X) sits at 247 on the other flank.
//
// Measured over the 158-stall replan: 12 of 113 staging stalls (exactly TW) approached
// from +9.00u — FARTHER from their aisle than the stall itself — against -9.00u for the
// other 101. The side is now derived from the nearest corridor, and this test pins it.
//
// The expectation table below is written by hand ON PURPOSE. Deriving the serving aisle
// with the same corridor lookup the implementation uses would make the test agree with
// the code by construction and prove nothing.
// ============================================================================
describe("every staging pull-in is approached from its serving aisle", () => {
  const SERVING: Record<string, { axis: "x" | "y"; at: number }> = {
    W:  { axis: "x", at: WEST_AISLE_X },  // west avenue, EAST of the west column
    E:  { axis: "x", at: EAST_AISLE_X },  // east avenue, WEST of the east column
    TW: { axis: "x", at: TEMP_LANE_X },   // temp aisle, EAST of the TW column
    TE: { axis: "x", at: TEMP_LANE_X },   // temp aisle, WEST of the TE column
    S1: { axis: "y", at: SOUTH_LANE_Y },
    S2: { axis: "y", at: SOUTH_LANE_Y },
    S3: { axis: "y", at: SOUTH_LANE_Y },
    N1: { axis: "y", at: N1_LANE_Y },
  };

  /** Which PARK_RUN a generated stall centre came from. */
  const runOf = (x: number, y: number): string => {
    let best = "?", bestD = Infinity;
    for (const r of PARK_RUNS) {
      for (let i = 0; i < r.n; i++) {
        const d = Math.hypot(r.x0 + i * r.dx - x, r.y0 + i * r.dy - y);
        if (d < bestD) { bestD = d; best = r.id; }
      }
    }
    return best;
  };

  it("the approach point is always nearer the aisle than the stall is", () => {
    const staging = generateStallsV2().filter((s) => s.type === "staging");
    expect(staging.length).toBe(113);

    const wrong: string[] = [];
    const deltas: number[] = [];
    for (const s of staging) {
      const { x, y, angle } = s.position;
      const facing = parkedHeading("staging", angle, x, y);
      const ax = x - Math.cos(facing) * APPROACH_BACK_U;
      const ay = y - Math.sin(facing) * APPROACH_BACK_U;

      const sv = SERVING[runOf(x, y)];
      expect(sv).toBeDefined();
      const dApproach = sv.axis === "x" ? Math.abs(ax - sv.at) : Math.abs(ay - sv.at);
      const dStall    = sv.axis === "x" ? Math.abs(x  - sv.at) : Math.abs(y  - sv.at);
      deltas.push(dApproach - dStall);
      if (dApproach >= dStall) {
        wrong.push(`${s.id} @(${x.toFixed(1)},${y.toFixed(1)}) approach ${(dApproach - dStall).toFixed(2)}u FARTHER from aisle`);
      }
    }

    expect(wrong).toEqual([]);
    // Every stall must move a full car-length TOWARD its aisle, not merely not-away.
    expect(Math.max(...deltas)).toBeCloseTo(-APPROACH_BACK_U, 6);
  });

  it("the temp block's two columns face each other across the aisle", () => {
    // The regression that motivated the change: TW and TE must nose in OPPOSITE
    // directions so both are entered from TEMP_LANE_X between them. Before the fix both
    // read 0 (east) and TW was served from its back side.
    const tw = PARK_RUNS.find((r) => r.id === "TW")!;
    const te = PARK_RUNS.find((r) => r.id === "TE")!;
    expect(tw.x0).toBeLessThan(TEMP_LANE_X);
    expect(te.x0).toBeGreaterThan(TEMP_LANE_X);

    expect(parkedHeading("staging", tw.angle, tw.x0, tw.y0)).toBeCloseTo(Math.PI, 6); // faces WEST
    expect(parkedHeading("staging", te.angle, te.x0, te.y0)).toBeCloseTo(0, 6);       // faces EAST
  });

  it("falls back instead of producing a heading from a degenerate coordinate", () => {
    // Totality: no corridor list can be consulted for a NaN, and the rule must still
    // return a usable angle rather than NaN propagating into the rail geometry.
    for (const v of [NaN, Infinity]) {
      expect(Number.isFinite(parkedHeading("staging", 90, v, 100))).toBe(true);
      expect(Number.isFinite(parkedHeading("staging", 0, 100, v))).toBe(true);
    }
    // Charging and bay stalls are unconditional NORTH and never consult an aisle.
    for (const l of ["dcfc", "l2", "wash", "service"] as const) {
      expect(parkedHeading(l, 90, 233.5, 100)).toBeCloseTo(-Math.PI / 2, 6);
    }
  });
});
