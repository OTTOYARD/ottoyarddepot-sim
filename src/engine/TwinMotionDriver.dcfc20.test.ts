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
import { poseStore } from "./motion/poseStore";
import { useDepotStore } from "@/store/depotStore";
import { CHARGER_BUILDS, chargerBuild, setChargerBuild } from "@/lib/chargerBuild";
import { CANOPIES, LOT, UNIT_FT, generateStallsV2 } from "@/lib/sitePlan";
import { allStructureSolids, bodyHitsBox } from "@/lib/structurePlan";
import { bodiesOverlap } from "./__fixtures__/replay";
import type { TwinSnapshot } from "@/lib/ottoTwin";

type Internals = {
  entries: Map<string, {
    car: { x: number; y: number; heading: number };
    tracker: { s: number; total: number; stationaryFor: number } | null;
    reverse?: unknown;
    stallId: string | null;
  }>;
};

/** plan units -> the layout endpoint's feet (the inverse of sitePlan.planFromDbFeet) */
const toFeet = (x: number, y: number) => ({ x: (x - LOT.x) * UNIT_FT, y: (LOT.y + LOT.h - y) * UNIT_FT });
const TWIN_TYPE: Record<string, string> = { dcfc: "dcfc", l2: "l2", wash: "wash_bay", service: "service_bay", staging: "staging" };

/** A twin layout for a build: every stall the renderer would draw for it, in the database's
 *  shape (type names, coordinates in feet), with twin ids of its own. */
function twinLayout(dcfc: number, l2: number) {
  return generateStallsV2(dcfc, l2, 3, 113, 2).map((s) => {
    const f = toFeet(s.position.x, s.position.y);
    return { id: `twin-${s.id}`, code: `NASH-${s.id}`, type: TWIN_TYPE[s.type], x: f.x, y: f.y };
  });
}

interface V { id: string; state: string; stall_id: string }
function snap(vehicles: V[], t: string): TwinSnapshot {
  return {
    run: { sim_run_id: "dcfc20", scenario: "busy_day", status: "running", sim_clock: t, tick_count: 1, time_scale: 1, seed: 1, speed_x: 1 },
    legs: [],
    fleet: {
      counts: {}, total: vehicles.length,
      vehicles: vehicles.map((v, i) => ({ id: v.id, av_id: `AV-${i}`, make: "Zoox", platform: "robotaxi", state: v.state, soc: 20, stall_id: v.stall_id })),
    },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null, counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

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
    const dt = 0.05;
    twinMotionDriver.clear();
    twinMotionDriver.setTwinStallMap(twinLayout(20, 15));
    useDepotStore.setState({ stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })) });
    const B = CANOPIES[1];
    const bStalls = useDepotStore.getState().stalls
      .filter((s) => s.type === "dcfc" && Math.abs(s.position.x - B.cx) < 10)
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
    expect(bStalls.length).toBe(10);
    // odd rows first, then the even rows between them: every second-wave car docks between parked neighbours
    const first = bStalls.filter((_, i) => i % 2 === 1);
    const second = bStalls.filter((_, i) => i % 2 === 0);
    const vehicles: V[] = first.map((s, i) => ({ id: `w1-${i}`, state: "charging_dcfc", stall_id: `twin-${s.id}` }));
    const solids = allStructureSolids();
    const entries = (twinMotionDriver as unknown as Internals).entries;
    const touches: string[] = [];
    const hits: string[] = [];
    /** cars seen driving, and the farthest each was seen from its stall: the second wave must drive in */
    const moved = new Set<string>();
    const farthest = new Map<string, number>();
    const run = (seconds: number, t: string) => {
      for (let elapsed = 0; elapsed < seconds; elapsed += 2) {
        twinMotionDriver.reconcile(snap(vehicles, t));
        for (let i = 0; i < 2 / dt; i++) {
          twinMotionDriver.tickMotion(dt);
          if (i % 4) continue;
          const bodies = [...entries.entries()].map(([id, e]) => {
            const p = poseStore.get(id) ?? { x: e.car.x, y: e.car.y, heading: e.car.heading };
            return { id, x: p.x, y: p.y, h: p.heading, moving: !!e.tracker };
          });
          for (const m of bodies) {
            const st = vehicles.find((v) => v.id === m.id);
            const stall = st ? useDepotStore.getState().stalls.find((s) => s.id === st.stall_id.slice(5)) : undefined;
            if (stall) farthest.set(m.id, Math.max(farthest.get(m.id) ?? 0, Math.hypot(m.x - stall.position.x, m.y - stall.position.y)));
            if (!m.moving) continue;
            moved.add(m.id);
            for (const q of bodies) {
              if (q.moving || q.id === m.id || Math.abs(m.x - q.x) > 11 || Math.abs(m.y - q.y) > 11) continue;
              if (bodiesOverlap(m, q)) touches.push(`${m.id} x ${q.id}`);
            }
            for (const k of solids) {
              if (Math.abs(k.box.cx - m.x) > 14 || Math.abs(k.box.cy - m.y) > 14) continue;
              if (bodyHitsBox({ x: m.x, y: m.y, heading: m.h }, k.box, 0)) hits.push(`${m.id} x ${k.kind}`);
            }
          }
        }
      }
    };
    run(240, "2026-10-19T19:00:00Z");
    second.forEach((s, i) => vehicles.push({ id: `w2-${i}`, state: "charging_dcfc", stall_id: `twin-${s.id}` }));
    run(600, "2026-10-19T19:10:00Z");

    const stalls = useDepotStore.getState().stalls;
    const notDocked: string[] = [];
    for (const v of vehicles) {
      const e = entries.get(v.id);
      const st = stalls.find((s) => s.id === v.stall_id.slice(5))!;
      const p = e ? (poseStore.get(v.id) ?? e.car) : null;
      const d = p ? Math.hypot(p.x - st.position.x, p.y - st.position.y) : Infinity;
      if (!e || e.tracker || d > 2) notDocked.push(`${v.id}->${st.id} d=${d.toFixed(1)}`);
    }
    expect(notDocked).toEqual([]);
    // the first snapshot places its cars parked; every second-wave car drove in from the gate
    for (const v of vehicles.filter((x) => x.id.startsWith("w2-"))) {
      expect(moved.has(v.id), v.id).toBe(true);
      expect(farthest.get(v.id) ?? 0, v.id).toBeGreaterThan(40);
    }
    expect([...new Set(touches)]).toEqual([]);
    expect([...new Set(hits)]).toEqual([]);
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
