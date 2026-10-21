// ============================================================================
// THE 20-POST BUILD THROUGH THE MOTION DRIVER (otto-q-core 0759, Chase's call).
//
// The renderer never chooses a build: it draws the one the twin's layout describes
// (chargerBuild.ts). So this hands the driver a twin layout with canopy B re-striped
// (20 fast chargers, 15 standard) and asserts what follows from it alone:
//   · the driver switches the renderer to the 20-post build and regenerates the depot;
//   · each twin fast charger maps to the renderer stall standing where it stands;
//   · cars sent to canopy B's new fast chargers dock exactly, in two waves so the second
//     drives past the first's parked bodies, touching no parked car and no structure;
//   · a layout as built switches it back.
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

describe("the 20-post build, drawn because the twin's layout has it", () => {
  it("switches to it from the layout's census, and maps every fast charger by where it stands", () => {
    twinMotionDriver.clear();
    expect(chargerBuild()).toBe("as_built");
    const layout = twinLayout(20, 15);
    twinMotionDriver.setTwinStallMap(layout);
    expect(chargerBuild()).toBe("dcfc20");
    const stalls = useDepotStore.getState().stalls;
    expect(stalls.filter((s) => s.type === "dcfc").length).toBe(CHARGER_BUILDS.dcfc20.dcfc);
    expect(stalls.filter((s) => s.type === "l2").length).toBe(CHARGER_BUILDS.dcfc20.l2);
    for (const t of layout.filter((s) => s.type === "dcfc" || s.type === "l2")) {
      expect(twinMotionDriver.rendererStallFor(t.id), t.code).toBe(t.code.slice(5));
    }
  });

  it("docks every car sent to canopy B's new fast chargers, past parked ones, touching no car and no structure", () => {
    twinMotionDriver.clear();
    twinMotionDriver.setTwinStallMap(twinLayout(20, 15));
    const r = dockCanopyInWaves(1, "dcfc20");
    expect(r.canopyStalls.length).toBe(10);
    expect(r.notDocked).toEqual([]);
    // the first snapshot places its cars parked; every second-wave car drove in from the gate
    for (const v of r.secondWave) {
      expect(v.moved, v.id).toBe(true);
      expect(v.farthest, v.id).toBeGreaterThan(40);
    }
    expect(r.touches).toEqual([]);
    expect(r.hits).toEqual([]);
  });

  it("switches back when the twin's layout is as built", () => {
    twinMotionDriver.clear();
    twinMotionDriver.setTwinStallMap(twinLayout(10, 30));
    expect(chargerBuild()).toBe("as_built");
    const stalls = useDepotStore.getState().stalls;
    expect(stalls.filter((s) => s.type === "dcfc").length).toBe(10);
    expect(stalls.filter((s) => s.type === "l2").length).toBe(30);
  });
});
