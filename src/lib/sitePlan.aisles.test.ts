// ============================================================================
// The founder's 2026-08-11 geometry spec, asserted against the real pipeline.
//
// These are not style checks. Each one pins a number that was WRONG in the tree
// before this change and that nothing would have caught:
//
//   * the east avenue's corridor was documented as "14.31u, impossible to widen"
//     from an E-column x0 that had already been superseded. It measured 23.60 ft.
//   * the painted aisles were hand-typed rectangles (the temp aisle was 15.70 ft
//     of tint over a 22.82 ft aisle) that could not track a column that moved.
//   * STALL_HALF_DEPTH_U in the renderer and NOMINAL.staging.depth in the seed
//     generator are the same physical dimension held in two files, in two units,
//     with nothing binding them. This reads the COMMITTED seed to bind them.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  TEMP_AISLE, EAST_AVENUE, TEMP_LANE_X, EAST_AISLE_X, STALL_HALF_DEPTH_U,
  clearAisleBetween, PARK_RUNS,
} from "./sitePlan";

const UNIT_FT = 1.5698818897637796;
/** The founder's spec: real-world two-way / 90-degree parking. */
const TWO_WAY_MIN_FT = 24.0;

describe("depot aisles — the founder's 24 ft two-way spec", () => {
  it("the temp block aisle is at least 24 ft of clear pavement", () => {
    expect(TEMP_AISLE.width * UNIT_FT).toBeGreaterThanOrEqual(TWO_WAY_MIN_FT);
  });

  it("the east avenue is at least 24 ft of clear pavement", () => {
    expect(EAST_AVENUE.width * UNIT_FT).toBeGreaterThanOrEqual(TWO_WAY_MIN_FT);
  });

  it("each aisle's lane centreline sits in the MIDDLE of its clear pavement", () => {
    // Not cosmetic. An off-centre centreline is exactly the defect that put the east
    // avenue's northbound lane 1.41 ft inside the E-column stalls: the road was where
    // a constant said, not where the pavement was. Centring is what makes the shy
    // space symmetric (3.87 ft on both flanks instead of 1.91 / 5.05).
    expect(TEMP_AISLE.centre).toBeCloseTo(TEMP_LANE_X, 6);
    expect(EAST_AVENUE.centre).toBeCloseTo(EAST_AISLE_X, 6);
  });

  it("the temp columns straddle TEMP_LANE_X symmetrically", () => {
    const tw = PARK_RUNS.find((r) => r.id === "TW")!;
    const te = PARK_RUNS.find((r) => r.id === "TE")!;
    expect(TEMP_LANE_X - tw.x0).toBeCloseTo(te.x0 - TEMP_LANE_X, 6);
  });

  it("STALL_HALF_DEPTH_U agrees with the staging depth the DATABASE seed declares", () => {
    // The bind. If someone retunes NOMINAL.staging.depth in buildLayoutSeed.mjs and
    // regenerates, this fails here rather than silently drawing pavement over cars.
    const seed = JSON.parse(readFileSync("unreal/layoutSeed.json", "utf8"));
    const staging = seed.stalls.filter(
      (s: { stall_type: string; run_id: string }) =>
        s.stall_type === "staging" && (s.run_id === "TW" || s.run_id === "TE" || s.run_id === "E"),
    );
    expect(staging.length).toBeGreaterThan(0);
    for (const s of staging as { stall_code: string; stall_depth_ft: number }[]) {
      expect(s.stall_depth_ft / 2 / UNIT_FT).toBeCloseTo(STALL_HALF_DEPTH_U, 6);
    }
  });

  it("refuses to measure an aisle between runs that are not facing columns", () => {
    // Fail safe: a row that steps along x has no 'east face', and silently returning a
    // number for it would paint a lane through the row.
    expect(() => clearAisleBetween("S1", "S2")).toThrow();
    expect(() => clearAisleBetween("TW", "NOPE")).toThrow();
  });
});
