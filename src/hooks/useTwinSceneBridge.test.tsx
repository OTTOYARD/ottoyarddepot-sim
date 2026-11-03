// ============================================================================
// THE IDLE TWIN DRAWS THE DEPOT THE TWIN HAS (useTwinSceneBridge).
//
// From otto-q-core 0763 (applied 10:11 PM CT, 2026-10-22) the twin depot has 30 robotic fast
// chargers and no standard charger. The renderer drew them only while a run was live:
// the bridge read the layout's charger build only with a run, so the idle twin (the
// cockpit before Start, and the live view the other cockpits frame) drew canopies B and
// C as 30 standard chargers, with no OTTO-CHARGE ARM and no OTTO-CLEAN ARM. Chase,
// 2026-11-02: "I don't see the overhead robovacuums or robotic charge arms in the other
// 2 stall sections within the twin simulator."
//
// Played against the layout as the twin served it on 2026-11-02
// (__fixtures__/twinLayout.served1102.json), the bridge must:
//   · with no run, read the twin depot's layout and draw its 30 fast chargers, ten under
//     each canopy, each with a charge arm and a cleaning arm on the 2D plan, and no L2;
//   · when the read fails, keep the build as drawn and ask again;
//   · drop an idle read that lands after a run started: the run's own layout decides.
// ============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { useTwinStore } from "@/store/twinStore";
import { useDepotStore } from "@/store/depotStore";
import { twinMotionDriver } from "@/engine/TwinMotionDriver";
import { CHARGER_BUILDS, chargerBuild, setChargerBuild } from "@/lib/chargerBuild";
import { CANOPIES } from "@/lib/sitePlan";
import { FastChargerRobots2D } from "@/components/canvas/Robots2D";
import served from "@/engine/__fixtures__/twinLayout.served1102.json";

const { layout } = vi.hoisted(() => ({ layout: vi.fn() }));
vi.mock("@/lib/ottoTwin", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ottoTwin")>();
  return { ...real, twin: { ...real.twin, layout } };
});

import { IDLE_LAYOUT_RETRY_MS, useTwinSceneBridge } from "./useTwinSceneBridge";

type Layout = { stalls: { id: string; code: string; type: string; x?: number | null; y?: number | null }[] };
const SERVED: Layout = { stalls: served.stalls };
/** A layout whose census is the 20-post build (only the census matters to a dropped read). */
const DCFC20: Layout = {
  stalls: [...Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, code: `NASH-DCFC-STALL-${i + 1}`, type: "dcfc" })),
    ...Array.from({ length: 15 }, (_, i) => ({ id: `l${i}`, code: `NASH-L2-STALL-${i + 16}`, type: "l2" }))],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  layout.mockReset();
  useTwinStore.getState().reset();
  twinMotionDriver.clear();
  setChargerBuild("as_built");
  useDepotStore.getState().regenerateStalls(10, 30, 3, 115, 2);
});

/** The canopy a plan x stands under: A, B or C. */
const canopyAt = (x: number) =>
  CANOPIES.reduce((b, c) => (Math.abs(c.cx - x) < Math.abs(b.cx - x) ? c : b), CANOPIES[0]).id;
/** Count per canopy. */
const perCanopy = (xs: number[]) => xs.reduce<Record<string, number>>((m, x) => {
  const k = canopyAt(x);
  m[k] = (m[k] ?? 0) + 1;
  return m;
}, {});
const chargers = () => {
  const stalls = useDepotStore.getState().stalls;
  return {
    dcfc: stalls.filter((s) => s.type === "dcfc"),
    l2: stalls.filter((s) => s.type === "l2"),
  };
};

describe("the idle twin draws the chargers the twin's layout has", () => {
  it("the served layout is the 30-post build: 30 fast chargers on three canopies, no L2", () => {
    const types = SERVED.stalls.reduce<Record<string, number>>((m, s) => ((m[s.type] = (m[s.type] ?? 0) + 1), m), {});
    expect(types).toEqual({ dcfc: 30, parking: 10, wash_bay: 3, service_bay: 2, staging: 113 });
    expect(new Set(served.stalls.filter((s) => s.type === "dcfc").map((s) => s.canopy)))
      .toEqual(new Set(["CANOPY-01", "CANOPY-02", "CANOPY-03"]));
  });

  it("with no run: reads the twin depot's layout and draws 30 robotic fast chargers, ten under each canopy", async () => {
    layout.mockResolvedValue(SERVED);
    expect(chargerBuild()).toBe("as_built");
    expect(perCanopy(chargers().dcfc.map((s) => s.position.x))).toEqual({ A: 10 }); // as drawn before the fix
    renderHook(() => useTwinSceneBridge());
    await waitFor(() => expect(chargerBuild()).toBe("dcfc30"));
    // the twin depot's layout, the only test site (CLAUDE.md rule 8): the read names no other depot
    expect(layout).toHaveBeenCalledTimes(1);
    expect(layout.mock.calls[0]).toEqual([]);
    const { dcfc, l2 } = chargers();
    expect(dcfc.length).toBe(CHARGER_BUILDS.dcfc30.dcfc);
    expect(l2).toEqual([]);
    expect(perCanopy(dcfc.map((s) => s.position.x))).toEqual({ A: 10, B: 10, C: 10 });

    // The 2D plan draws an OTTO-CHARGE ARM and an OTTO-CLEAN ARM on every one of them
    // (the 3D view draws one of each per fast charger from the same stalls: DepotScene3D's roboticStalls).
    const c = render(<svg><FastChargerRobots2D /></svg>).container;
    const at = (attr: string) => [...c.querySelectorAll(`[${attr}]`)].map((g) => g.getAttribute(attr)!);
    const xOf = new Map(dcfc.map((s) => [s.id, s.position.x]));
    expect(at("data-charge-arm").sort()).toEqual(dcfc.map((s) => s.id).sort());
    expect(at("data-clean-arm").sort()).toEqual(dcfc.map((s) => s.id).sort());
    expect(perCanopy(at("data-charge-arm").map((id) => xOf.get(id)!))).toEqual({ A: 10, B: 10, C: 10 });
    expect(perCanopy(at("data-clean-arm").map((id) => xOf.get(id)!))).toEqual({ A: 10, B: 10, C: 10 });
  });

  it("a read that fails keeps the build as drawn and is asked again", async () => {
    vi.useFakeTimers();
    layout.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ stalls: [] }).mockResolvedValue(SERVED);
    renderHook(() => useTwinSceneBridge());
    await act(async () => { await Promise.resolve(); });
    expect(layout).toHaveBeenCalledTimes(1);
    expect(chargerBuild()).toBe("as_built");
    // an empty layout is no answer either: the build stays and the read is asked again
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_LAYOUT_RETRY_MS); });
    expect(layout).toHaveBeenCalledTimes(2);
    expect(chargerBuild()).toBe("as_built");
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_LAYOUT_RETRY_MS); });
    expect(layout).toHaveBeenCalledTimes(3);
    expect(chargerBuild()).toBe("dcfc30");
    // landed: no more reads while the twin stays idle
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * IDLE_LAYOUT_RETRY_MS); });
    expect(layout).toHaveBeenCalledTimes(3);
  });

  it("drops an idle read that lands after a run started: the run's layout decides", async () => {
    let landIdle: (l: Layout) => void = () => {};
    let landRun: (l: Layout) => void = () => {};
    layout
      .mockImplementationOnce(() => new Promise<Layout>((r) => { landIdle = r; }))
      .mockImplementationOnce(() => new Promise<Layout>((r) => { landRun = r; }));
    renderHook(() => useTwinSceneBridge());
    expect(layout).toHaveBeenCalledTimes(1);
    act(() => useTwinStore.getState().setActiveSimRunId("run-1"));
    expect(layout).toHaveBeenCalledTimes(2);
    // the idle read lands late, with a different build: dropped
    await act(async () => { landIdle(DCFC20); await Promise.resolve(); });
    expect(chargerBuild()).toBe("as_built");
    // the run's read lands: its build is drawn and its stalls mapped
    await act(async () => { landRun(SERVED); await Promise.resolve(); });
    expect(chargerBuild()).toBe("dcfc30");
    const first = served.stalls.find((s) => s.code === "NASH-DCFC-STALL-21")!;
    expect(twinMotionDriver.rendererStallFor(first.id)).toBe("DCFC-21");
  });
});
