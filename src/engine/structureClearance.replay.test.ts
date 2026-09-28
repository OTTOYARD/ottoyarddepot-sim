// ============================================================================
// STRUCTURE CLEARANCE — does any moving car pass through a wall, a door jamb, a
// lift, a wash brush, a canopy column or a carport column?
//
// structurePlan.test.ts proves the OPENINGS line up with the site plan's routes.
// This proves they line up with the motion the cockpit actually draws: the rail
// router (LaneGraph offsets, dock blends, back-outs) replayed from captured runs,
// sampled DURING motion (AGENTS.md: "sample during motion, not after the scene
// settles"), with the oriented 4.2 x 10.2 body — never centre distance.
// ============================================================================
import { describe, expect, it } from "vitest";
import { replayFlow } from "./__fixtures__/flowReplay";
import { allStructureSolids, bodyHitsRect, type Rect } from "@/lib/structurePlan";

const SOLIDS = allStructureSolids();
const REACH = Math.hypot(10.2 / 2, 4.2 / 2) + 0.1;

function near(r: Rect, x: number, y: number): boolean {
  return x > r.x0 - REACH && x < r.x1 + REACH && y > r.y0 - REACH && y < r.y1 + REACH;
}

interface ProbeResult { samples: number; hits: Record<string, number>; hitCars: Record<string, Set<string>> }

function probe(run: () => void, sink: ProbeResult) {
  return (poses: { id: string; x: number; y: number; heading: number; moving: boolean }[]) => {
    for (const p of poses) {
      sink.samples++;
      for (const k of SOLIDS) {
        if (!near(k.r, p.x, p.y)) continue;
        // 0.05u of shrink absorbs float noise on a body sliding along a face
        if (bodyHitsRect(p, k.r, 0.05)) {
          const kind = k.kind.replace(/-\d+$/, "");
          sink.hits[kind] = (sink.hits[kind] ?? 0) + 1;
          (sink.hitCars[kind] ??= new Set()).add(p.id);
        }
      }
    }
    void run;
  };
}

function runProbe(name: "fresh0922" | "busyday"): ProbeResult {
  const res: ProbeResult = { samples: 0, hits: {}, hitCars: {} };
  replayFlow(name, {
    maxWallMs: name === "fresh0922" ? 420_000 : undefined,
    onStep: probe(() => undefined, res),
  });
  return res;
}

describe("no moving car passes through a built structure (replayed motion)", () => {
  for (const fixture of ["fresh0922", "busyday"] as const) {
    it(`${fixture}: zero body-structure intersections`, () => {
      const r = runProbe(fixture);
      const summary = Object.entries(r.hits).map(([k, n]) => `${k}: ${n} samples / ${r.hitCars[k].size} cars`);
      console.log(`${fixture}: ${r.samples} car-samples; ${summary.length ? summary.join(" · ") : "no intersections"}`);
      expect(r.samples).toBeGreaterThan(10_000);
      expect(summary).toEqual([]);
    }, 180_000);
  }
});
