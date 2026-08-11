import { describe, it, expect } from "vitest";
import type { TwinSnapshot, TwinVehicle, TwinVisitCard } from "@/lib/ottoTwin";
import {
  classifyAtomStatus,
  prettifyService,
  serviceLabel,
  isCriticalUrgency,
  readVisitCard,
  readVehicleWorkflow,
  readWorkflowFromSnapshot,
} from "@/lib/visitWorkflow";

// ---------------------------------------------------------------------------
// FIXTURES ARE REAL WIRE SHAPES. These are the exact objects
// `ottoq_twin_snapshot` produced on gxdrcyphqjzjsuhxuqtg for run
// 53660b86-4359-4473-898b-77e3df95d3a3 (captured 2026-08-11), with only the
// row status flipped from the archived 'superseded' to the 'in_progress' /
// 'open' a live run publishes. Inventing a plausible-looking shape here would
// make these tests assert against a fiction.
// ---------------------------------------------------------------------------

/** Mid-workflow: one atom done, two still owed, charge planned. */
const MID_WORKFLOW: TwinVisitCard = {
  visit_id: "ea632e4b-ead6-49ab-9e7a-0d37e86625bc",
  visit_status: "in_progress",
  archetype: "std_mixed",
  urgency: "standard",
  arrived_at: "2026-08-11T17:55:28.962438+00:00",
  target_soc: 89,
  soc_at_arrival: 42,
  est_charge_min: 81,
  atoms: [
    { svc: "charge", status: "pending", must_do: true, est_min: 81 },
    { svc: "readiness_check", status: "pending", must_do: true, est_min: 3 },
    { svc: "interior_inspection", status: "done", must_do: true, est_min: 3 },
  ],
};

/** Everything cleared — the founder's "ready for dispatch" end state. */
const ALL_DONE: TwinVisitCard = {
  visit_id: "d34a942e-216d-4c3f-a0e5-d5ffac662691",
  visit_status: "in_progress",
  archetype: "C_overnight",
  urgency: "overnight_hold",
  arrived_at: "2026-08-11T08:01:44.817765+00:00",
  target_soc: 80,
  soc_at_arrival: 97,
  est_charge_min: null,
  atoms: [
    { svc: "readiness_check", status: "done", must_do: true, est_min: 3 },
    { svc: "interior_inspection", status: "done", must_do: true, est_min: 4 },
    { svc: "perimeter_walkaround", status: "done", must_do: true, est_min: 13 },
  ],
};

function vehicle(over: Partial<TwinVehicle>): TwinVehicle {
  return {
    id: "b97789b5-3963-497d-9ca7-5b65e0168234",
    av_id: "AV-0001",
    make: "Waymo",
    platform: "waymo",
    state: "CHARGING",
    soc: 61,
    stall_id: null,
    ...over,
  };
}

function snapshotWith(vehicles: TwinVehicle[]): TwinSnapshot {
  return {
    run: {
      sim_run_id: "53660b86-4359-4473-898b-77e3df95d3a3",
      scenario: "twin_demo",
      status: "running",
      sim_clock: "2026-08-11T18:00:00+00:00",
      tick_count: 12,
      time_scale: 60,
      seed: 424242,
    },
    fleet: { counts: {}, total: vehicles.length, vehicles },
    stalls_status: [],
    energy: null,
    bess: null,
    weather: null,
    grid: null,
    counters: {},
    recent_events: [],
    variability: {},
  };
}

describe("classifyAtomStatus", () => {
  it("reads the statuses OTTO-Q actually writes", () => {
    expect(classifyAtomStatus("done")).toBe("done");
    expect(classifyAtomStatus("in_progress")).toBe("active");
    expect(classifyAtomStatus("pending")).toBe("pending");
    expect(classifyAtomStatus("cancelled")).toBe("dropped");
    expect(classifyAtomStatus("skipped")).toBe("dropped");
  });

  it("treats a missing status as pending — the same COALESCE decide_tick uses", () => {
    expect(classifyAtomStatus(undefined)).toBe("pending");
    expect(classifyAtomStatus(null)).toBe("pending");
    expect(classifyAtomStatus("")).toBe("pending");
  });

  it("files an UNKNOWN status as still-owed, never as done", () => {
    // A status this build has never seen must not be silently ticked off.
    expect(classifyAtomStatus("awaiting_tech_greenlight")).toBe("pending");
    expect(classifyAtomStatus("DONE")).toBe("done"); // case is normalised
  });
});

describe("service labels", () => {
  it("uses operator wording for known services", () => {
    expect(serviceLabel("interior_deep_clean")).toBe("Interior deep clean");
    expect(serviceLabel("charge")).toBe("Charge");
  });

  it("still renders a service nobody taught it about", () => {
    expect(serviceLabel("battery_cell_balance")).toBe("Battery cell balance");
    expect(prettifyService("")).toBe("Service");
  });
});

describe("isCriticalUrgency", () => {
  it("escalates only recognised critical words", () => {
    expect(isCriticalUrgency("critical")).toBe(true);
    expect(isCriticalUrgency("overdue")).toBe(true);
    expect(isCriticalUrgency("standard")).toBe(false);
    expect(isCriticalUrgency("overnight_hold")).toBe(false);
    // An unknown word must not turn the card red on a guess.
    expect(isCriticalUrgency("brand_new_urgency")).toBe(false);
    expect(isCriticalUrgency(null)).toBe(false);
  });
});

describe("readVisitCard — a car mid-workflow", () => {
  const w = readVisitCard(MID_WORKFLOW);

  it("publishes the bullet list in the order OTTO-Q wrote it", () => {
    expect(w.items.map((i) => i.svc)).toEqual([
      "charge",
      "readiness_check",
      "interior_inspection",
    ]);
  });

  it("checks off exactly the atoms marked done", () => {
    expect(w.items.map((i) => i.state)).toEqual(["pending", "pending", "done"]);
    expect(w.doneCount).toBe(1);
    expect(w.clearedCount).toBe(1);
    expect(w.totalCount).toBe(3);
    expect(w.allComplete).toBe(false);
  });

  it("points 'next' at the first queued atom when nothing is in progress", () => {
    // no atom is in progress in this fixture, so there is no ACTIVE index.
    // (This used to assert nextIndex===0 — a first-pending GUESS at what OTTO-Q
    // would do next, which measured wrong on 83% of real visits.)
    expect(w.activeIndex).toBe(-1);
    expect(w.items.some((i) => i.current)).toBe(false);
  });

  it("carries the header numbers through unchanged", () => {
    expect(w.card.soc_at_arrival).toBe(42);
    expect(w.card.target_soc).toBe(89);
    expect(w.card.est_charge_min).toBe(81);
  });
});

describe("readVisitCard — an atom in progress", () => {
  const w = readVisitCard({
    ...MID_WORKFLOW,
    atoms: [
      { svc: "charge", status: "in_progress", must_do: true, est_min: 81 },
      { svc: "interior_inspection", status: "in_progress", must_do: true, est_min: 3 },
      { svc: "readiness_check", status: "pending", must_do: true, est_min: 3 },
    ],
  });

  it("highlights EVERY in-progress atom — services run concurrently", () => {
    expect(w.items.filter((i) => i.current).map((i) => i.svc)).toEqual([
      "charge",
      "interior_inspection",
    ]);
  });

  it("reports WHICH atom is actually running", () => {
    // the fixture has an atom in progress, so activeIndex names IT. The old assertion
    // here was -1, meaning "suppress the next-guess" — there is no next-guess any more.
    expect(w.activeIndex).toBe(0);
  });
});

describe("readVisitCard — everything done", () => {
  const w = readVisitCard(ALL_DONE);

  it("reports ready for dispatch", () => {
    expect(w.allComplete).toBe(true);
    expect(w.clearedCount).toBe(3);
    expect(w.totalCount).toBe(3);
    expect(w.activeIndex).toBe(-1);
  });
});

describe("readVisitCard — dropped work is not completed work", () => {
  const w = readVisitCard({
    ...MID_WORKFLOW,
    atoms: [
      { svc: "charge", status: "done", must_do: true, est_min: 81 },
      { svc: "exterior_wash", status: "cancelled", must_do: false, est_min: 9 },
    ],
  });

  it("counts a cancelled atom as cleared but NOT as done", () => {
    expect(w.doneCount).toBe(1);
    expect(w.clearedCount).toBe(2);
    expect(w.allComplete).toBe(true);
    expect(w.items[1].state).toBe("dropped");
  });
});

describe("readVisitCard — an OPEN visit with no work on it", () => {
  const w = readVisitCard({ ...MID_WORKFLOW, atoms: [] });

  it("never reports 'all complete' for an empty manifest", () => {
    // Nothing to finish is not the same as everything finished.
    expect(w.totalCount).toBe(0);
    expect(w.allComplete).toBe(false);
    expect(w.activeIndex).toBe(-1);
  });
});

describe("readVehicleWorkflow — absence stays absence", () => {
  it("an OLDER BACKEND that omits `visit` reads as unpublished, not empty", () => {
    expect(readVehicleWorkflow(vehicle({})).kind).toBe("unpublished");
  });

  it("an explicit null reads as 'no open visit'", () => {
    expect(readVehicleWorkflow(vehicle({ visit: null })).kind).toBe("no_visit");
  });

  it("a missing vehicle reads as unpublished", () => {
    expect(readVehicleWorkflow(undefined).kind).toBe("unpublished");
    expect(readVehicleWorkflow(null).kind).toBe("unpublished");
  });
});

describe("readWorkflowFromSnapshot", () => {
  const snap = snapshotWith([
    vehicle({ id: "veh-mid", visit: MID_WORKFLOW }),
    vehicle({ id: "veh-done", visit: ALL_DONE }),
    vehicle({ id: "veh-idle", visit: null }),
    vehicle({ id: "veh-legacy" }),
  ]);

  it("joins on TwinVehicle.id, the same id the renderer hovers on", () => {
    const w = readWorkflowFromSnapshot(snap, "veh-mid");
    expect(w.kind).toBe("visit");
    if (w.kind === "visit") expect(w.card.visit_id).toBe(MID_WORKFLOW.visit_id);
  });

  it("keeps the four readings distinct", () => {
    expect(readWorkflowFromSnapshot(snap, "veh-done").kind).toBe("visit");
    expect(readWorkflowFromSnapshot(snap, "veh-idle").kind).toBe("no_visit");
    expect(readWorkflowFromSnapshot(snap, "veh-legacy").kind).toBe("unpublished");
    expect(readWorkflowFromSnapshot(snap, "veh-not-in-fleet").kind).toBe("unpublished");
  });

  it("is total over a broken or absent snapshot", () => {
    expect(readWorkflowFromSnapshot(null, "veh-mid").kind).toBe("unpublished");
    expect(readWorkflowFromSnapshot(snap, null).kind).toBe("unpublished");
    // A snapshot that came back as an error payload has no fleet at all.
    const broken = { error: "sim_run not found" } as unknown as TwinSnapshot;
    expect(readWorkflowFromSnapshot(broken, "veh-mid").kind).toBe("unpublished");
  });

  it("survives a malformed atom instead of taking the card down", () => {
    const junk = snapshotWith([
      vehicle({
        id: "veh-junk",
        visit: {
          ...MID_WORKFLOW,
          atoms: [
            { svc: "charge", status: "pending", must_do: true, est_min: null },
            // shapes the wire could carry if a generator regressed
            {} as never,
            { svc: "wash", status: 7, must_do: "yes", est_min: "abc" } as never,
          ],
        },
      }),
    ]);
    const w = readWorkflowFromSnapshot(junk, "veh-junk");
    expect(w.kind).toBe("visit");
    if (w.kind !== "visit") return;
    expect(w.items).toHaveLength(3);
    expect(w.items[1].svc).toBe("unknown");
    expect(w.items[1].state).toBe("pending");
    expect(w.items[1].mustDo).toBe(false);
    expect(w.items[2].estMin).toBeNull();
    expect(w.items[2].mustDo).toBe(false);
    expect(w.allComplete).toBe(false);
  });
});
