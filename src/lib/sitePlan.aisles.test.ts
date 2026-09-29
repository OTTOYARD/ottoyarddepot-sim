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
  clearAisleBetween, PARK_RUNS, L2_ROW_PITCH, DCFC_ROW_PITCH,
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

  it("every L2 stall is long enough to hold the design vehicle", () => {
    // The defect this pins: 16 west-column L2 stalls were declared 15.67 ft deep
    // against a 16.0 ft design vehicle — the stall was SHORTER THAN THE CAR — and the
    // guard reported it as a WARN for long enough that nobody actioned it. A WARN is
    // the right call for the guard (it does not block a seed build); a test is the
    // right place to stop it coming back.
    const seed = JSON.parse(readFileSync("unreal/layoutSeed.json", "utf8"));
    const designLength = seed.meta.design_vehicle_ft.length;
    const l2 = seed.stalls.filter((s: { stall_type: string }) => s.stall_type === "l2");
    expect(l2.length).toBe(30);
    for (const s of l2 as { stall_code: string; stall_depth_ft: number }[]) {
      expect(s.stall_depth_ft).toBeGreaterThanOrEqual(designLength);
    }
  });

  it("the L2 pitch in the renderer matches the one the seed declares, and caps the width square to the car", () => {
    // sitePlan.ts lays each column out at L2_ROW_PITCH; buildLayoutSeed.mjs reads the
    // same constant to cap a declared dimension. This measures the ACTUAL spacing out
    // of the seed and checks the declared footprint is the cap that spacing implies.
    // Since 2026-09-28 an L2 stall is ANGLED 60° to its lane (heading 60 on a west
    // column, 300 on an east one): consecutive cars stand side by side but staggered,
    // so the pitch caps the WIDTH as measured square to the car (pitch x sin 60), and
    // the depth runs along the car to the canopy spine.
    const seed = JSON.parse(readFileSync("unreal/layoutSeed.json", "utf8"));
    const clearance = seed.meta.clearance_ft;
    type Row = { canopy_side: string; stall_type: string; relative_y: number; stall_depth_ft: number;
                 stall_width_ft: number; heading_degrees: number; canopy_code: string };
    const col = (side: string) => (seed.stalls as Row[])
      .filter((s) => s.stall_type === "l2" && s.canopy_side === side && s.canopy_code === "CANOPY-02")
      .sort((a, b) => b.relative_y - a.relative_y); // north to south
    const west = col("W"), east = col("E");
    expect(west.length).toBe(8);
    expect(east.length).toBe(7);
    const pitch = Math.abs(west[0].relative_y - west[1].relative_y);
    expect(pitch).toBeCloseTo(L2_ROW_PITCH * UNIT_FT, 6);
    for (const c of [west, east]) {
      for (let i = 1; i < c.length; i++) {
        expect(Math.abs(c[i - 1].relative_y - c[i].relative_y)).toBeCloseTo(pitch, 6);
      }
    }
    // the east column sits half a pitch behind the west one
    expect(west[0].relative_y - east[0].relative_y).toBeCloseTo(pitch / 2, 6);
    const square = pitch * Math.sin(Math.PI / 3);
    for (const s of [...west, ...east]) {
      expect(s.heading_degrees).toBe(s.canopy_side === "W" ? 60 : 300);
      expect(s.stall_width_ft).toBeCloseTo(Math.min(10, square - clearance), 6);
      // long enough for the design vehicle, and stopped short of the spine
      expect(s.stall_depth_ft).toBeGreaterThanOrEqual(seed.meta.design_vehicle_ft.length);
      expect(s.stall_depth_ft).toBeLessThanOrEqual(20);
    }
  });

  it("the DCFC stalls are angled too, leaning toward their canopy spine and north, at the DCFC pitch", () => {
    // Since 2026-09-28 (sitePlan.chargingStalls): heading 60 on canopy A's west column,
    // 300 on its east column, rows DCFC_ROW_PITCH (14u, 22.0 ft) apart and level across
    // the spine. The columns are where they always were.
    const seed = JSON.parse(readFileSync("unreal/layoutSeed.json", "utf8"));
    const dcfc = (seed.stalls as { canopy_side: string; stall_type: string; relative_x: number; relative_y: number;
                                   stall_depth_ft: number; stall_width_ft: number; heading_degrees: number }[])
      .filter((s) => s.stall_type === "dcfc");
    expect(dcfc.length).toBe(10);
    for (const s of dcfc) {
      expect(s.heading_degrees).toBe(s.canopy_side === "W" ? 60 : 300);
      expect(s.stall_width_ft).toBeCloseTo(10, 6);
      expect(s.stall_depth_ft).toBeGreaterThanOrEqual(seed.meta.design_vehicle_ft.length);
      expect(s.stall_depth_ft).toBeLessThanOrEqual(20);
    }
    expect(new Set(dcfc.map((s) => s.relative_x.toFixed(4)))).toEqual(new Set(["141.2894", "163.2677"]));
    const ys = [...new Set(dcfc.map((s) => s.relative_y.toFixed(4)))].map(Number).sort((a, b) => b - a);
    expect(ys.length).toBe(5);
    for (let i = 1; i < ys.length; i++) expect(ys[i - 1] - ys[i]).toBeCloseTo(DCFC_ROW_PITCH * UNIT_FT, 3);
  });

  it("refuses to measure an aisle between runs that are not facing columns", () => {
    // Fail safe: a row that steps along x has no 'east face', and silently returning a
    // number for it would paint a lane through the row.
    expect(() => clearAisleBetween("S1", "S2")).toThrow();
    expect(() => clearAisleBetween("TW", "NOPE")).toThrow();
  });
});
