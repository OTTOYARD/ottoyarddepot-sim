// ============================================================================
// TURN RADIUS — do cars drive round corners, or pivot through them?
//
// The founder, 2026-09-27: "No vehicles spinning while they turn or park."
// A car's heading follows its rail's tangent, so how tight a car turns is a
// property of the rail's corner fillets. Measured here on the replayed motion,
// per car-step: effective radius = distance travelled / heading change. A body
// 10.2u long turning at R < 5u rotates about a point inside its own length —
// that is what reads as a spin, however smooth the frames are.
//
//     before (2026-09-27)   fresh0922 63% of all turning at R < 5u · busyday 60%
//     after  (2026-09-28)   fresh0922 27%                          · busyday 23%
//     L2 head-in (same day) fresh0922 27.9%, crab 1.05% of travel  · busyday 23.6%, crab 0.61%
//                           (crab was 2.0% / 0.9%: L2 cars no longer slide into their stalls)
//
// What moved it (RailFlow.roundCorners / TwinMotionDriver.gapEntry):
//   • the gap-lane mouth routed to a point 1.2u BEHIND a westbound car, so it
//     hairpinned before turning north — it now turns once, on its own lane line;
//   • fillets measured their legs to the next WAYPOINT, and graph nodes on a
//     straight road capped a corner's radius — legs now run between real corners;
//   • corners take up to a 2.4u cut (R 5.8u at 90°) where parked cars and
//     structures allow, instead of a flat 1.2u (R 2.9u).
// Ratcheted just above the measurement. What remains is mostly stall sidesteps
// and the gate turn-in, which need layout room (the site plan), not a number here.
// ============================================================================
import { describe, expect, it } from "vitest";
import { replayFlow } from "./__fixtures__/flowReplay";
import { gapEntry } from "./TwinMotionDriver";
import { SOUTH_LANE_Y } from "@/lib/sitePlan";

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface TurnReport { turningDeg: number; tightShare: number; crabShare: number; spinSteps: number }

function measure(name: "fresh0922" | "busyday"): TurnReport {
  const last = new Map<string, { x: number; y: number; h: number }>();
  let deg = 0, tight = 0, travel = 0, crab = 0, spin = 0;
  replayFlow(name, {
    maxWallMs: name === "fresh0922" ? 420_000 : undefined,
    onStep: (poses) => {
      for (const p of poses) {
        const q = last.get(p.id);
        last.set(p.id, { x: p.x, y: p.y, h: p.heading });
        if (!q) continue;
        const dx = p.x - q.x, dy = p.y - q.y, ds = Math.hypot(dx, dy);
        const dh = Math.abs(wrap(p.heading - q.h));
        if (ds > 5) continue;                       // a spawn / re-placement, not motion
        if (ds < 1e-3) { if (dh > 1e-4) spin++; continue; }
        travel += ds;
        if (ds > 0.02) {
          let c = Math.abs(wrap(Math.atan2(dy, dx) - p.heading));
          if (c > Math.PI / 2) c = Math.PI - c;     // a reversing car moves tail-first
          if (c > (20 * Math.PI) / 180) crab += ds;
        }
        if (dh > 1e-4) {
          const d = (dh * 180) / Math.PI;
          deg += d;
          if (ds / dh < 5) tight += d;
        }
      }
    },
  });
  return { turningDeg: deg, tightShare: tight / deg, crabShare: crab / travel, spinSteps: spin };
}

describe("cars drive round corners instead of pivoting through them (replayed motion)", () => {
  for (const fixture of ["fresh0922", "busyday"] as const) {
    it(`${fixture}: under 32% of all turning is tighter than R = 5u`, () => {
      const r = measure(fixture);
      console.log(`${fixture}: ${r.turningDeg.toFixed(0)}° of turning · ${(100 * r.tightShare).toFixed(1)}% at R < 5u · crab>20° ${(100 * r.crabShare).toFixed(2)}% of travel · spin steps ${r.spinSteps}`);
      expect(r.turningDeg).toBeGreaterThan(10_000); // the replay really exercised turning
      expect(r.tightShare).toBeLessThanOrEqual(0.32);
      expect(r.crabShare).toBeLessThanOrEqual(0.035);
      expect(r.spinSteps).toBe(0); // a stopped car never rotates
    }, 180_000);
  }
});

describe("gapEntry — a charger-bound car turns into its gap lane once", () => {
  const gx = 126.5;

  it("moves the junction vertex onto the gap line at the car's own lane, and drops the point behind it", () => {
    // westbound on the south boulevard (lane line y = 168.8), routed to (gx, SOUTH_LANE_Y - 2)
    const route = [{ x: 180, y: 168.8 }, { x: 126.63, y: 168.8 }, { x: gx, y: SOUTH_LANE_Y - 2 }];
    const out = gapEntry(route, gx);
    expect(out).toEqual([{ x: 180, y: 168.8 }, { x: gx, y: 168.8 }]);
    // nothing SOUTH of the lane line: the old entry point sat 1.2u behind the car
    expect(Math.max(...out.map((p) => p.y))).toBeLessThanOrEqual(168.8);
  });

  it("drives on along the lane to the corner when the last vertex is far from the gap", () => {
    const route = [{ x: 60, y: 175.2 }, { x: 70, y: 175.2 }, { x: gx, y: SOUTH_LANE_Y - 2 }];
    expect(gapEntry(route, gx)).toEqual([{ x: 60, y: 175.2 }, { x: 70, y: 175.2 }, { x: gx, y: 175.2 }]);
  });

  it("leaves a route that does not arrive along the south boulevard alone", () => {
    const route = [{ x: 60, y: 100 }, { x: 80, y: 120 }, { x: gx, y: SOUTH_LANE_Y - 2 }];
    expect(gapEntry(route, gx)).toEqual(route);
  });
});
