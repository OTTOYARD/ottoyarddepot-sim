// ============================================================================
// The motion subscriber: OTTO-Q names a stall and a deadline, the driver owns
// everything else — and refuses, by name, whatever it cannot physically do.
// ============================================================================
import { describe, it, expect, beforeEach } from "vitest";
import { twinMotionDriver } from "./TwinMotionDriver";
import type { TwinSnapshot } from "@/lib/ottoTwin";

const CLOCK = "2026-07-27T14:00:00.000Z";

// The renderer's ledger picks a free stall from its own zone-ordered list, so a
// vehicle can land on any of the ten DCFC stalls. Map them all, or a reverse
// lookup in the tests below hits a hole that has nothing to do with the code.
const TWIN_STALLS = [
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `uuid-dcfc-${i + 1}`, code: `NASH-DCFC-STALL-${i + 1}`, type: "dcfc",
  })),
  { id: "uuid-l2-1", code: "NASH-L2-STALL-1", type: "l2" },
];

/** renderer stall id ("DCFC-06") → the twin uuid that maps to it */
function twinIdFor(renderStallId: string): string {
  const n = Number(renderStallId.split("-")[1]);
  const hit = TWIN_STALLS.find((s) => s.code.endsWith(`-${n}`) && renderStallId.startsWith("DCFC"));
  if (!hit) throw new Error(`no twin stall maps to ${renderStallId}`);
  return hit.id;
}

function snapshot(vehicles: { id: string; state: string; stall?: string | null; soc?: number }[]): TwinSnapshot {
  return {
    run: { sim_run_id: "run-1", scenario: "normal_day", status: "running", sim_clock: CLOCK, tick_count: 3, time_scale: 60, seed: 1 },
    fleet: {
      counts: {}, total: vehicles.length,
      vehicles: vehicles.map((v) => ({
        id: v.id, av_id: `AV-${v.id}`, make: "waymo", platform: "jag",
        state: v.state, soc: v.soc ?? 40, stall_id: v.stall ?? null,
      })),
    },
    stalls_status: [], energy: null, bess: null, weather: null, grid: null,
    counters: {}, recent_events: [], variability: {},
  } as unknown as TwinSnapshot;
}

/** Fresh driver state, layout loaded, one vehicle parked in the scene. */
function seedScene(vehicles = [{ id: "v1", state: "charging_dcfc" }]) {
  twinMotionDriver.clear();
  twinMotionDriver.setTwinStallMap(TWIN_STALLS);
  twinMotionDriver.reconcile(snapshot(vehicles));
}

describe("motion subscriber — accepting orchestration", () => {
  beforeEach(() => seedScene());

  it("accepts a stall assignment for a vehicle in the scene", () => {
    expect(twinMotionDriver.acceptStallCommand({
      command_id: "cmd-1", vehicle_id: "v1",
      twin_stall_id: "uuid-dcfc-2", not_after_sim: null,
    })).toBe(true);
    expect(twinMotionDriver.commandedAssignments).toEqual([
      { vehicle_id: "v1", stall_id: "DCFC-02", arrived: false },
    ]);
  });

  it("refuses a vehicle that is not in the scene, and says so", () => {
    const r = twinMotionDriver.acceptStallCommand({
      command_id: "cmd-1", vehicle_id: "ghost",
      twin_stall_id: "uuid-dcfc-1", not_after_sim: null,
    });
    expect(r).toContain("not present in the rendered scene");
  });

  it("refuses a stall the renderer does not draw", () => {
    const r = twinMotionDriver.acceptStallCommand({
      command_id: "cmd-1", vehicle_id: "v1",
      twin_stall_id: "uuid-l2-999", not_after_sim: null,
    });
    expect(r).toContain("does not map to a rendered stall");
  });

  it("refuses a command with no stall", () => {
    expect(twinMotionDriver.acceptStallCommand({
      command_id: "cmd-1", vehicle_id: "v1",
      twin_stall_id: null, not_after_sim: null,
    })).toContain("no stall id");
  });

  it("refuses a stall another vehicle already holds, naming the blocker", () => {
    seedScene([
      { id: "v1", state: "charging_dcfc" },
      { id: "v2", state: "charging_dcfc" },
    ]);
    const assignments = twinMotionDriver.commandedAssignments;
    expect(assignments).toHaveLength(0); // nothing commanded yet
    // v2 holds whichever DCFC stall the ledger gave it; command v1 onto it.
    const taken = twinMotionDriver.stallHeldBy("v2");
    expect(taken).toBeTruthy();
    expect(twinMotionDriver.acceptStallCommand({
      command_id: "cmd-1", vehicle_id: "v1",
      twin_stall_id: twinIdFor(taken!), not_after_sim: null,
    })).toContain("already held by v2");
  });

  it("re-issuing the same command is accepted idempotently", () => {
    const args = {
      command_id: "cmd-1", vehicle_id: "v1",
      twin_stall_id: "uuid-dcfc-2", not_after_sim: null,
    };
    expect(twinMotionDriver.acceptStallCommand(args)).toBe(true);
    expect(twinMotionDriver.acceptStallCommand(args)).toBe(true);
    expect(twinMotionDriver.commandedAssignments).toHaveLength(1);
    expect(twinMotionDriver.drainMotionOutcomes()).toHaveLength(0);
  });

  it("a new command supersedes the old one and closes it in the ledger", () => {
    twinMotionDriver.acceptStallCommand({
      command_id: "cmd-1", vehicle_id: "v1",
      twin_stall_id: "uuid-dcfc-2", not_after_sim: null,
    });
    twinMotionDriver.acceptStallCommand({
      command_id: "cmd-2", vehicle_id: "v1",
      twin_stall_id: "uuid-dcfc-1", not_after_sim: null,
    });
    const outcomes = twinMotionDriver.drainMotionOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].command_id).toBe("cmd-1");
    expect(outcomes[0].reason).toContain("superseded by cmd-2");
  });

  it("refuses everything before the layout has loaded", () => {
    twinMotionDriver.clear();
    twinMotionDriver.reconcile(snapshot([{ id: "v1", state: "charging_dcfc" }]));
    expect(twinMotionDriver.acceptStallCommand({
      command_id: "cmd-1", vehicle_id: "v1",
      twin_stall_id: "uuid-dcfc-1", not_after_sim: null,
    })).toContain("layout has not loaded");
  });
});

describe("motion subscriber — outcomes are drained, never left dangling", () => {
  beforeEach(() => seedScene());

  // NOT COVERED HERE: closing a dangling command when a vehicle DESPAWNS.
  // That cleanup lives in the driver's private animation step (a car is only
  // removed once it physically reaches the egress or ages out), which a unit
  // test cannot reach without driving the rAF loop through many seconds of
  // simulated taxiing. The code is present and defensive — see the `remove`
  // loop in TwinMotionDriver.step — but it is exercised by the running app,
  // not by this file. Flagged rather than faked.

  it("draining twice returns nothing the second time", () => {
    twinMotionDriver.acceptStallCommand({
      command_id: "cmd-1", vehicle_id: "v1",
      twin_stall_id: "uuid-dcfc-2", not_after_sim: null,
    });
    twinMotionDriver.acceptStallCommand({
      command_id: "cmd-2", vehicle_id: "v1",
      twin_stall_id: "uuid-dcfc-1", not_after_sim: null,
    });
    expect(twinMotionDriver.drainMotionOutcomes()).toHaveLength(1);
    expect(twinMotionDriver.drainMotionOutcomes()).toHaveLength(0);
  });

  it("clearing the scene drops every outstanding assignment", () => {
    twinMotionDriver.acceptStallCommand({
      command_id: "cmd-1", vehicle_id: "v1",
      twin_stall_id: "uuid-dcfc-2", not_after_sim: null,
    });
    twinMotionDriver.clear();
    expect(twinMotionDriver.commandedAssignments).toHaveLength(0);
    expect(twinMotionDriver.drainMotionOutcomes()).toHaveLength(0);
  });
});
