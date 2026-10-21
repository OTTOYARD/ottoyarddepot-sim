// ============================================================================
// A charger build-out through the motion driver: the twin layout a build-out
// writes, and cars sent to one canopy's fast chargers in two waves.
//
// The renderer never chooses a build (chargerBuild.ts): it draws the one the
// twin's layout describes. So a build-out test hands the driver a twin layout
// whose census is the build-out's, and drives cars onto the canopy the
// build-out re-striped. The second wave docks between the first wave's parked
// bodies, so every second-wave car drives in past parked cars; each wave is
// checked against every parked car and every built structure on the way.
//
// Shared by TwinMotionDriver.dcfc20.test.ts (canopy B) and
// TwinMotionDriver.dcfc30.test.ts (canopy C).
// ============================================================================
import { twinMotionDriver } from "../TwinMotionDriver";
import { poseStore } from "../motion/poseStore";
import { useDepotStore } from "@/store/depotStore";
import { CANOPIES, LOT, UNIT_FT, generateStallsV2 } from "@/lib/sitePlan";
import { allStructureSolids, bodyHitsBox } from "@/lib/structurePlan";
import { bodiesOverlap } from "./replay";
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
export function twinLayout(dcfc: number, l2: number) {
  return generateStallsV2(dcfc, l2, 3, 113, 2).map((s) => {
    const f = toFeet(s.position.x, s.position.y);
    return { id: `twin-${s.id}`, code: `NASH-${s.id}`, type: TWIN_TYPE[s.type], x: f.x, y: f.y };
  });
}

export interface BuildoutCar { id: string; state: string; stall_id: string }

export function buildoutSnap(vehicles: BuildoutCar[], t: string, runId = "buildout"): TwinSnapshot {
  return {
    run: { sim_run_id: runId, scenario: "busy_day", status: "running", sim_clock: t, tick_count: 1, time_scale: 1, seed: 1, speed_x: 1 },
    legs: [],
    fleet: {
      counts: {}, total: vehicles.length,
      vehicles: vehicles.map((v, i) => ({ id: v.id, av_id: `AV-${i}`, make: "Zoox", platform: "robotaxi", state: v.state, soc: 20, stall_id: v.stall_id })),
    },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null, counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

export interface DockResult {
  /** fast chargers on the canopy, west column then east, north to south */
  canopyStalls: string[];
  /** cars not standing on their stall (within 2u) with no route left, at the end */
  notDocked: string[];
  /** a moving car's body overlapping a parked car's */
  touches: string[];
  /** a moving car's body inside a built structure */
  hits: string[];
  /** second-wave cars, each with whether it was seen moving and the farthest it was seen from its stall */
  secondWave: { id: string; moved: boolean; farthest: number }[];
}

/**
 * Send cars to every fast charger on canopy `canopyIndex` (0 = A, 1 = B, 2 = C; or several) of
 * the layout the driver has mapped, in two waves: the odd rows first (placed parked by the first
 * snapshot), then the even rows between them, which drive in from the gate past the parked bodies.
 * Given several canopies, every canopy's second wave drives in at once.
 */
export function dockCanopyInWaves(canopyIndex: number | readonly number[], runId = "buildout"): DockResult {
  const dt = 0.05;
  useDepotStore.setState({ stalls: useDepotStore.getState().stalls.map((s) => ({ ...s, status: "available" as const })) });
  const canopies = (typeof canopyIndex === "number" ? [canopyIndex] : canopyIndex).map((i) => CANOPIES[i]);
  const stalls = useDepotStore.getState().stalls
    .filter((s) => s.type === "dcfc" && canopies.some((c) => Math.abs(s.position.x - c.cx) < 10))
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  // rows alternate within each column (a column is five stalls at one x)
  const rank = (s: (typeof stalls)[number]) => stalls.filter((o) => o.position.x === s.position.x && o.position.y < s.position.y).length;
  const first = stalls.filter((s) => rank(s) % 2 === 1);
  const second = stalls.filter((s) => rank(s) % 2 === 0);
  const vehicles: BuildoutCar[] = first.map((s, i) => ({ id: `w1-${i}`, state: "charging_dcfc", stall_id: `twin-${s.id}` }));
  const solids = allStructureSolids();
  const entries = (twinMotionDriver as unknown as Internals).entries;
  const touches: string[] = [];
  const hits: string[] = [];
  const moved = new Set<string>();
  const farthest = new Map<string, number>();
  const run = (seconds: number, t: string) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 2) {
      twinMotionDriver.reconcile(buildoutSnap(vehicles, t, runId));
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

  const now = useDepotStore.getState().stalls;
  const notDocked: string[] = [];
  for (const v of vehicles) {
    const e = entries.get(v.id);
    const st = now.find((s) => s.id === v.stall_id.slice(5))!;
    const p = e ? (poseStore.get(v.id) ?? e.car) : null;
    const d = p ? Math.hypot(p.x - st.position.x, p.y - st.position.y) : Infinity;
    if (!e || e.tracker || d > 2) notDocked.push(`${v.id}->${st.id} d=${d.toFixed(1)}`);
  }
  return {
    canopyStalls: stalls.map((s) => s.id),
    notDocked,
    touches: [...new Set(touches)],
    hits: [...new Set(hits)],
    secondWave: vehicles.filter((x) => x.id.startsWith("w2-")).map((v) => ({ id: v.id, moved: moved.has(v.id), farthest: farthest.get(v.id) ?? 0 })),
  };
}
