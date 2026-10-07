// ============================================================================
// MOTION AUDIT, ON DEMAND — the before/after table for every capture.
//
// Skipped in `npm run verify` (it replays 1h57m of the founder's run, several
// minutes of compute). Run it to measure a change:
//
//   MOTION_AUDIT=1 npx vitest run src/engine/motionAudit.measure.test.ts
//   MOTION_AUDIT=chase1006 ...            # one capture by name
//   MOTION_AUDIT_OUT=/tmp/audit.json ...  # also write every report as JSON
//
// Definitions: __fixtures__/motionAudit.ts. The ratchets that run on every verify
// are in motionAudit.replay.test.ts (windows of these captures).
// ============================================================================
import { describe, it } from "vitest";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { auditFixture, formatAudit, type AuditReport } from "./__fixtures__/motionAudit";
import { probeArrivals, summarize, OVERSHOOT_TOL } from "./__fixtures__/arrivalProbe";
import type { FlowOptions } from "./__fixtures__/flowReplay";

const RUNS: [string, "busyday" | "fresh0922" | "live0922" | "live0922rec" | "chase1006", FlowOptions][] = [
  ["busyday", "busyday", {}],
  ["fresh0922 @8x", "fresh0922", { maxWallMs: 420_000 }],
  ["fresh0922 @3x", "fresh0922", { playAt: 3, maxWallMs: 1_120_000 }],
  ["live0922", "live0922", { maxWallMs: 900_000 }],
  ["live0922rec", "live0922rec", { maxWallMs: 600_000 }],
  ["chase1006 30min", "chase1006", { maxWallMs: 1_800_000 }],
  ["chase1006", "chase1006", {}],
];

const want = process.env.MOTION_AUDIT;
const out = process.env.MOTION_AUDIT_OUT;

describe.runIf(!!want)("motion audit (on demand)", () => {
  // (a skipped describe still runs this body to collect it)
  const pick = (want ?? "").split(",").filter(Boolean);
  for (const [label, fixture, opts] of RUNS) {
    if (want !== "1" && !pick.some((w) => label.startsWith(w))) continue;
    it(label, () => {
      const t0 = Date.now();
      const r: AuditReport = auditFixture(fixture, opts, label);
      const arr = probeArrivals(fixture, opts);
      const over = arr.arrivals.filter((a) => a.overshootU > OVERSHOOT_TOL).length;
      console.log(`${formatAudit(r)}\n  arrivals ${arr.arrivals.length}, overshoot ${over}\n${summarize(label, arr)}\n  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      if (out) {
        const all = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
        const { flow, events, overlapHotspots, ...rest } = r;
        all[label] = {
          ...rest,
          flow: { wallSeconds: flow.wallSeconds, motionSeconds: flow.motionSeconds, geometry: flow.geometry, viewer: flow.viewer,
                  stoppedFraction: flow.flow.stoppedFraction, finishedTrips: flow.flow.finishedTrips, lockCycleSteps: flow.flow.lockCycleSteps },
          arrivals: arr.arrivals.length, overshoot: over,
          hotspots: [...overlapHotspots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
          events,
        };
        writeFileSync(out, JSON.stringify(all, null, 1));
      }
    }, 3_600_000);
  }
});
