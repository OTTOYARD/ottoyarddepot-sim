// ottoqFunnel.test.ts — the funnel is shaped from real engine records and never invents.
// Fixture: a read-only capture of run 1ccad49b (src/components/tabs/__fixtures__/ottoqRun.1ccad49b.json).
import { describe, expect, it } from "vitest";
import fx from "@/components/tabs/__fixtures__/ottoqRun.1ccad49b.json";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import {
  LAYERS, carsFromCards, latestByCar, layerOverviews, newSparks, openNeeds, rowTone, sparkFromDisposition, sparkFromRow,
  stackSlice, stateLayer, tallyDispositions, type DispositionRow, type FunnelCardVehicle,
} from "./ottoqFunnel";

const feed = fx.feed as unknown as ActivityFeedRow[];
const disp = fx.dispositions as unknown as DispositionRow[];
const cardsB = fx.cards_b as unknown as FunnelCardVehicle[];
const row = (over: Partial<ActivityFeedRow>): ActivityFeedRow => ({
  occurred_at: "2026-09-29T13:00:00Z", vehicle_id: "v1", display_name: "Car-1", action: "stall_assignment", engine: "deterministic_v1",
  target: null, outcome: "enacted", rationale: {}, reason: null, decision_seq: 1, tick_seq: 1, ...over,
});

describe("layers", () => {
  it("follow the engine: the decide path chooses, then the shield checks the choice", () => {
    const ids = LAYERS.map((l) => l.id);
    expect(ids).toEqual(["arriving", "needs", "proposers", "decide", "shield", "booked", "service", "ready"]);
    expect(LAYERS.filter((l) => l.kind === "think").map((l) => l.id)).toEqual(["proposers", "decide", "shield"]);
  });

  it("map every in-depot vehicle_state, and nothing outside the depot", () => {
    expect(stateLayer({ state: "arrived_at_gate" })).toBe("arriving");
    expect(stateLayer({ state: "staged_awaiting_service" })).toBe("needs");
    expect(stateLayer({ state: "staged_awaiting_service", stall: { code: "S1", kind: "staging" } })).toBe("booked");
    expect(stateLayer({ state: "charging_dcfc" })).toBe("service");
    expect(stateLayer({ state: "staged_for_departure" })).toBe("ready");
    expect(stateLayer({ state: "deployed" })).toBeNull();
    expect(stateLayer({ state: "offline" })).toBeNull();
    expect(stateLayer({ state: "something_new" })).toBeNull();
  });
});

describe("cars", () => {
  it("draws every in-depot car of the captured frame, in its layer", () => {
    const cars = carsFromCards(cardsB, latestByCar(feed));
    // 116 cars: 21 deployed are outside; the other 95 are drawn.
    expect(cars).toHaveLength(95);
    const by = (l: string) => cars.filter((c) => c.layer === l).length;
    expect(by("arriving")).toBe(7 + 5);
    expect(by("service")).toBe(30 + 8 + 4 + 1);
    expect(by("ready")).toBe(21);
    expect(by("needs") + by("booked")).toBe(19);
    expect(by("proposers") + by("decide") + by("shield")).toBe(0); // cars never rest in a thinking layer
  });

  it("never paints a Ready car green without a battery reading at or above its target (rule 9)", () => {
    const base: FunnelCardVehicle = { vehicle_id: "r", display_name: "R", state: "staged_for_departure", soc: null, target_soc: 100 };
    const ok = row({ vehicle_id: "r", action: "task_start", rationale: { verb: "promote_ready" } });
    const latest = new Map([["r", ok]]);
    expect(carsFromCards([base], latest)[0].tone).toBe("idle");
    expect(carsFromCards([{ ...base, soc: 88 }], latest)[0]).toMatchObject({ tone: "held", why: "battery 88% of its 100% target" });
    expect(carsFromCards([{ ...base, soc: 100, card: { needs: [{ svc: "exterior_wash", status: "pending" }] } }], latest)[0].tone).toBe("held");
    expect(carsFromCards([{ ...base, soc: 100, card: { needs: [{ svc: "charge", status: "done" }] } }], latest)[0].tone).toBe("ok");
  });

  it("counts any need that is not done as open", () => {
    expect(openNeeds({ vehicle_id: "x", display_name: null, state: null, soc: null, target_soc: null,
      card: { needs: [{ svc: "a", status: "done" }, { svc: "b", status: "deferred" }, { svc: "c", status: null }] } })).toEqual(["b", "c"]);
  });

  it("colours a car by its newest decision", () => {
    expect(rowTone(row({ outcome: "overridden_to_default" }))).toBe("refused");
    expect(rowTone(row({ outcome: "noop_no_candidate" }))).toBe("held");
    expect(rowTone(row({ rationale: { verb: "hold_in_queue" } }))).toBe("held");
    expect(rowTone(row({}))).toBe("ok");
    const latest = latestByCar([row({ decision_seq: 1, outcome: "noop_no_candidate" }), row({ decision_seq: 2, occurred_at: "2026-09-29T13:01:00Z" })]);
    expect(latest.get("v1")?.decision_seq).toBe(2);
  });
});

describe("sparks", () => {
  it("send a refused choice to the safety check, red", () => {
    expect(sparkFromRow(row({ outcome: "overridden_to_default" }))).toMatchObject({ from: "decide", to: "shield", tone: "refused" });
  });

  it("send an enacted stall choice to Booked, and a hold nowhere", () => {
    expect(sparkFromRow(row({ rationale: { verb: "assign_stall" } }))).toMatchObject({ from: "decide", to: "booked", tone: "ok" });
    expect(sparkFromRow(row({ outcome: "noop_no_candidate" }))).toMatchObject({ from: "decide", to: "decide", tone: "held" });
  });

  it("keep the site battery and the challenger out of the funnel", () => {
    expect(sparkFromRow(row({ action: "bess_dispatch" }))).toBeNull();
    expect(sparkFromRow(row({ action: "challenger_flag" }))).toBeNull();
  });

  it("mark an agent pass that fell back amber, never red", () => {
    const fell = feed.find((r) => r.action === "orchestrator_agent" && r.outcome !== "enacted")!;
    expect(sparkFromRow(fell)).toMatchObject({ from: "proposers", tone: "held" });
    const ok = feed.find((r) => r.action === "orchestrator_agent" && r.outcome === "enacted")!;
    expect(sparkFromRow(ok)?.tone).toBe("ok");
  });

  it("never colour an abstention, a supersession or an expiry as a refusal", () => {
    for (const d of disp) {
      const s = sparkFromDisposition(d);
      if (d.abstained || d.status === "superseded" || d.status === "expired") expect(s.tone).toBe("idle");
      if (s.tone === "refused") expect(d.status === "refused" && !d.abstained).toBe(true);
      if (s.tone === "ok") expect(d.status === "enacted" && !d.abstained).toBe(true);
    }
  });

  it("play only records not seen before, oldest first, capped", () => {
    const a = sparkFromRow(row({ decision_seq: 1, occurred_at: "2026-09-29T13:02:00Z" }))!;
    const b = sparkFromRow(row({ decision_seq: 2, occurred_at: "2026-09-29T13:01:00Z" }))!;
    expect(newSparks(new Set([a.key]), [a, b]).map((s) => s.key)).toEqual([b.key]);
    expect(newSparks(new Set(), [a, b]).map((s) => s.key)).toEqual([b.key, a.key]);
    expect(newSparks(new Set(), [a, b], 1).map((s) => s.key)).toEqual([a.key]);
  });
});

describe("overviews", () => {
  it("read the evidence ledger for offers, and the run's own counts", () => {
    const t = tallyDispositions(disp);
    // run 1ccad49b, measured 2026-09-30: 1 enacted, 25 refused (2 CP-SAT + 23 greedy), 32 superseded, 1 expired, 44 abstained
    expect(t).toEqual({ enacted: 1, refused: 25, superseded: 32, expired: 1, abstained: 44, total: 103 });
    const o = layerOverviews({ vehicles: cardsB, rows: feed, dispositions: disp, stack: stackSlice(fx.stack as never), cardsRead: true });
    expect(o.proposers).toBe("Agent: readiness first, 15 passes, 2 fell back · offers 1 enacted, 25 refused");
    expect(o.shield).toBe("14,143 checks · 0 refused");
    expect(o.arriving).toBe("5 on the way · 7 at the gate");
    expect(o.service).toBe("38 charging · 1 in wash or detail · 0 in service bays");
  });

  it("say a source has not answered instead of printing zero", () => {
    const o = layerOverviews({ vehicles: null, rows: [], dispositions: null, stack: null, cardsRead: false });
    expect(o.arriving).toBe("Waiting for the depot cards");
    expect(o.proposers).toBe("Agent: — · offers —");
    expect(o.shield).toBe("Checks: —");
    expect(Object.values(o).join(" ")).not.toMatch(/\b0\b/);
  });
});
