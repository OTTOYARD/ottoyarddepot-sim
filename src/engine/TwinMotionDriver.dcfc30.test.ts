// ============================================================================
// THE 30-POST BUILD THROUGH THE MOTION DRIVER (otto-q-core 0763 after 0759, Chase's
// call of 2026-10-21: every L2 swapped for a robotic fast charger).
//
// Handed a twin layout with canopies B and C re-striped (30 fast chargers, no standard
// charger), the driver must:
//   · switch the renderer to the 30-post build and regenerate the depot with no L2;
//   · map each twin fast charger to the renderer stall standing where it stands;
//   · dock cars on canopy C's new fast chargers exactly, in two waves, the second driving
//     in past the first's parked bodies, touching no parked car and no structure — and the
//     same on canopy B, whose east column now shares its gap lane with canopy C's fast
//     chargers rather than its L2s;
//   · go from the 20-post build to this one, and back to as built, on the layout alone.
// ============================================================================
import { describe, it, expect, afterAll } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import { useDepotStore } from "@/store/depotStore";
import { CHARGER_BUILDS, chargerBuild, setChargerBuild } from "@/lib/chargerBuild";
import { dockCanopyInWaves, twinLayout } from "./__fixtures__/buildout";

afterAll(() => {
  setChargerBuild("as_built");
  useDepotStore.getState().regenerateStalls(10, 30, 3, 115, 2);
});

describe("the 30-post build, drawn because the twin's layout has it", () => {
  it("switches to it from the layout's census, draws no L2, and maps every fast charger by where it stands", () => {
    twinMotionDriver.clear();
    expect(chargerBuild()).toBe("as_built");
    // the layout endpoint (ottoq_twin_depot_layout) serves every stall at the depot, so it also serves the ten spaces
    // 0759 and 0763 retire: stall_type parking, no position. The renderer draws none of them and counts none.
    const retired = Array.from({ length: 10 }, (_, i) => ({
      id: `twin-retired-${i}`, code: `NASH-L2-STALL-${i < 5 ? 11 + i : 26 + i}`, type: "parking", x: null, y: null,
    }));
    const layout = [...twinLayout(30, 0), ...retired];
    expect(layout.filter((s) => s.type === "l2")).toEqual([]);
    twinMotionDriver.setTwinStallMap(layout);
    for (const r of retired) expect(twinMotionDriver.rendererStallFor(r.id), r.code).toBeUndefined();
    expect(chargerBuild()).toBe("dcfc30");
    const stalls = useDepotStore.getState().stalls;
    expect(stalls.filter((s) => s.type === "dcfc").length).toBe(CHARGER_BUILDS.dcfc30.dcfc);
    expect(stalls.filter((s) => s.type === "l2").length).toBe(0);
    for (const t of layout.filter((s) => s.type === "dcfc")) {
      expect(twinMotionDriver.rendererStallFor(t.id), t.code).toBe(t.code.slice(5));
    }
  });

  for (const [canopy, name] of [[2, "C"], [1, "B"]] as const) {
    it(`docks every car sent to canopy ${name}'s fast chargers, past parked ones, touching no car and no structure`, () => {
      twinMotionDriver.clear();
      twinMotionDriver.setTwinStallMap(twinLayout(30, 0));
      const r = dockCanopyInWaves(canopy, "dcfc30");
      expect(r.canopyStalls.length).toBe(10);
      expect(r.notDocked).toEqual([]);
      for (const v of r.secondWave) {
        expect(v.moved, v.id).toBe(true);
        expect(v.farthest, v.id).toBeGreaterThan(40);
      }
      expect(r.touches).toEqual([]);
      expect(r.hits).toEqual([]);
    });
  }

  it("docks a full depot: thirty cars on thirty posts, every canopy's second wave driving in at once", () => {
    twinMotionDriver.clear();
    twinMotionDriver.setTwinStallMap(twinLayout(30, 0));
    const r = dockCanopyInWaves([0, 1, 2], "dcfc30-full");
    expect(r.canopyStalls.length).toBe(30);
    expect(r.notDocked).toEqual([]);
    expect(r.secondWave.length).toBe(18);
    for (const v of r.secondWave) expect(v.moved, v.id).toBe(true);
    expect(r.touches).toEqual([]);
    expect(r.hits).toEqual([]);
  });

  it("goes from the 20-post build to this one and back to as built, on the layout alone", () => {
    twinMotionDriver.clear();
    twinMotionDriver.setTwinStallMap(twinLayout(20, 15));
    expect(chargerBuild()).toBe("dcfc20");
    twinMotionDriver.setTwinStallMap(twinLayout(30, 0));
    expect(chargerBuild()).toBe("dcfc30");
    twinMotionDriver.setTwinStallMap(twinLayout(10, 30));
    expect(chargerBuild()).toBe("as_built");
    const stalls = useDepotStore.getState().stalls;
    expect(stalls.filter((s) => s.type === "dcfc").length).toBe(10);
    expect(stalls.filter((s) => s.type === "l2").length).toBe(30);
  });
});
