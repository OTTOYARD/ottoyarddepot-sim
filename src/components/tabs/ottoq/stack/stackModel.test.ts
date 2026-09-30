// stackModel.test.ts — the 3D stack places only what engine records carry, where the site puts it.
// Fixture: the read-only capture of run 1ccad49b (../../__fixtures__/ottoqRun.1ccad49b.json).
import { describe, expect, it } from "vitest";
import fx from "../../__fixtures__/ottoqRun.1ccad49b.json";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import type { DispositionRow, FunnelCardVehicle } from "@/lib/ottoqFunnel";
import { generateStallsV2 } from "@/lib/sitePlan";
import {
  BARS_PER_LANE, ENTRY_POINT, EXIT_POINT, PLATES, REPLAY_PER, SITE_COUNTS, TILE_COLS, TILE_ROWS, ZONE, ZONES,
  PLATE_D, PLATE_MARGIN, PLATE_W, agentModel, barTone, carZone, plateTags, decideModel, decisionDest, depotModel, plannerModel, plateLabels, recordKeys, replayEvents,
  stackModel, stallNumber, takeNewEvents, zoneCapacity,
} from "./stackModel";

const feed = fx.feed as unknown as ActivityFeedRow[];
const disp = fx.dispositions as unknown as DispositionRow[];
const cardsB = fx.cards_b as unknown as FunnelCardVehicle[];
const row = (over: Partial<ActivityFeedRow>): ActivityFeedRow => ({
  occurred_at: "2026-09-29T13:00:00Z", vehicle_id: "v1", display_name: "Car-1", action: "stall_assignment", engine: "deterministic_v1",
  target: null, outcome: "enacted", rationale: {}, reason: null, decision_seq: 1, tick_seq: 1, ...over,
});

describe("plates", () => {
  it("stack in the order a decision falls through the engine", () => {
    // propose → optimise → choose → check → carry out: the safety check is the last gate before the depot
    expect(PLATES.map((p) => p.id)).toEqual(["agent", "planners", "decide", "safety", "depot"]);
    for (let i = 1; i < PLATES.length; i++) expect(PLATES[i].y).toBeLessThan(PLATES[i - 1].y);
  });
});

describe("agent plate", () => {
  const m = agentModel(feed);
  const passRows = feed.filter((r) => r.action === "orchestrator_agent");

  it("draws one sphere per agent pass, and nothing else", () => {
    expect(m.passes).toHaveLength(passRows.length);
    expect(new Set(m.passes.map((p) => p.key)).size).toBe(m.passes.length);
    expect(m.passes.filter((p) => p.newest)).toHaveLength(1);
  });

  it("marks a pass amber exactly when the model did not answer or the pass did not enact", () => {
    const held = passRows.filter((r) => r.outcome !== "enacted" || (typeof r.rationale?.model_error === "string" && r.rationale.model_error)).length;
    expect(m.passes.filter((p) => p.tone === "held")).toHaveLength(held);
  });

  it("joins each pass to the objective it chose, and to the pass before it", () => {
    const objectives = new Set(passRows.map((r) => String(r.rationale?.objective ?? "—")));
    expect(m.hubs.map((h) => h.key).sort()).toEqual([...objectives].sort().slice(0, 3));
    expect(m.hubEdges).toHaveLength(m.passes.length);
    expect(m.chainEdges).toHaveLength(Math.max(0, m.passes.length - 1));
    for (const p of m.passes) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(4.5);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(2.8);
    }
  });

  it("draws nothing when there has been no pass", () => {
    expect(agentModel([]).passes).toEqual([]);
  });
});

describe("planners plate", () => {
  const lanes = plannerModel(disp);

  it("gives each planner a lane, and one planner one lane even under two engine names", () => {
    expect(lanes.map((l) => l.word)).toEqual(["CP-SAT", "the greedy planner", "the service-priority planner"]);
    expect(lanes.reduce((s, l) => s + l.total, 0)).toBe(disp.length);
  });

  it("shows each lane's newest offers, one bar per ledger row, coloured by its disposition", () => {
    const byKey = new Map(disp.map((d) => [`p${d.disposition_id}`, d]));
    for (const l of lanes) {
      expect(l.bars.length).toBeLessThanOrEqual(BARS_PER_LANE);
      const ids = l.bars.map((b) => Number(b.key.slice(1)));
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      for (const b of l.bars) expect(b.tone).toBe(barTone(byKey.get(b.key)!));
    }
  });

  it("never colours a declined or replaced offer as a refusal", () => {
    for (const d of disp) {
      const t = barTone(d);
      if (d.abstained) expect(t).toBe("declined");
      if (t === "refused") expect(d.status === "refused" && !d.abstained).toBe(true);
    }
  });
});

describe("decide plate", () => {
  it("tiles the newest car decisions, newest first, and nothing that is not about a car", () => {
    const tiles = decideModel(feed);
    expect(tiles.length).toBeLessThanOrEqual(TILE_COLS * TILE_ROWS);
    const keys = new Set(tiles.map((t) => t.key));
    expect(keys.size).toBe(tiles.length);
    const nonCar = feed.filter((r) => r.action === "bess_dispatch" || r.action === "orchestrator_agent").map((r) => `d${r.decision_seq}`);
    for (const k of nonCar) expect(keys.has(k)).toBe(false);
  });

  it("sends an enacted decision's bead where the decision sent the car", () => {
    expect(decisionDest(row({ rationale: { verb: "assign_stall", stall_type: "l2" } }))).toBe("l2");
    expect(decisionDest(row({ rationale: { verb: "assign_stall", stall_type: "dcfc" } }))).toBe("dcfc");
    expect(decisionDest(row({ action: "redeployment", rationale: { verb: "deploy" } }))).toBe("exit");
    expect(decisionDest(row({ action: "task_start", rationale: { verb: "promote_ready" } }))).toBe("ready");
    expect(decisionDest(row({ outcome: "noop_no_candidate", rationale: { verb: "assign_stall" } }))).toBeNull();
    expect(decisionDest(row({ outcome: "overridden_to_default", rationale: { verb: "assign_stall" } }))).toBeNull();
  });
});

describe("depot base", () => {
  it("sizes every charger and bay zone from the site plan's real stalls", () => {
    const c: Record<string, number> = {};
    for (const s of generateStallsV2()) c[s.type] = (c[s.type] ?? 0) + 1;
    expect(SITE_COUNTS).toEqual({ dcfc: c.dcfc, l2: c.l2, wash: c.wash, service: c.service });
    expect(zoneCapacity(ZONE.dcfc)).toBe(c.dcfc);
    expect(zoneCapacity(ZONE.l2)).toBe(c.l2);
    expect(zoneCapacity(ZONE.wash)).toBe(c.wash);
    expect(zoneCapacity(ZONE.service)).toBe(c.service);
    expect(ZONE.dcfc.cols * ZONE.dcfc.rows).toBeGreaterThanOrEqual(c.dcfc);
    expect(ZONE.l2.cols * ZONE.l2.rows).toBeGreaterThanOrEqual(c.l2);
  });

  it("keeps the founder's gates: cars enter at the east and leave by the west", () => {
    expect(ENTRY_POINT.x).toBeGreaterThan(4);
    expect(EXIT_POINT.x).toBeLessThan(-4);
    const cx = (id: keyof typeof ZONE) => ZONE[id].x0 + ((ZONE[id].cols - 1) * ZONE[id].px) / 2;
    expect(cx("gate")).toBeGreaterThan(0);
    expect(cx("road")).toBeGreaterThan(4);
    expect(cx("ready")).toBeLessThan(0);
    // both gates are on the south edge
    expect(ENTRY_POINT.z).toBeLessThan(0); // the approach lane's far end; it runs south to the east gate
    expect(EXIT_POINT.z).toBeGreaterThan(2.5);
  });

  it("puts no zone on top of another", () => {
    const boxes = ZONES.map((z) => ({ id: z.id, x0: z.x0 - z.px / 2, x1: z.x0 + (z.cols - 0.5) * z.px, z0: z.z0 - z.pz / 2, z1: z.z0 + (z.rows - 0.5) * z.pz }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  });

  it("places every car of the captured frame in the zone its state names, one car per slot", () => {
    const m = depotModel(cardsB, new Map());
    // the engine's own count at 04:41:47 UTC: 30 L2, 8 DCFC, 4 holding, 1 detail bay, 21 ready, 19 waiting (2 booked), 7 gate, 5 en route
    expect(m.counts).toMatchObject({ l2: 30, dcfc: 8, hold: 4, wash: 1, ready: 21, waiting: 17, booked: 2, gate: 7, road: 5, service: 0, repair: 0 });
    expect(m.pucks).toHaveLength(95); // 116 less 21 deployed
    expect(m.overflow).toEqual({});
    const slots = new Set(m.pucks.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`));
    expect(slots.size).toBe(m.pucks.length);
  });

  it("seats a charger car in its own numbered stall when its card names one", () => {
    const v = (id: string, code: string | null): FunnelCardVehicle => ({ vehicle_id: id, display_name: id, state: "charging_dcfc", soc: null, target_soc: 100, stall: { id, code, kind: "dcfc" } });
    const m = depotModel([v("a", "NASH-DCFC-STALL-03"), v("b", null)], new Map());
    const a = m.pucks.find((p) => p.id === "a")!;
    const z = ZONE.dcfc;
    expect(a.x).toBeCloseTo(z.x0 + (2 % z.cols) * z.px);
    expect(a.z).toBeCloseTo(z.z0 + Math.floor(2 / z.cols) * z.pz);
    expect(stallNumber("NASH-L2-STALL-12")).toBe(12);
    expect(stallNumber(null)).toBeNull();
  });

  it("reports cars past a zone's slots instead of hiding them", () => {
    const many = Array.from({ length: SITE_COUNTS.service + 2 }, (_, i): FunnelCardVehicle => ({ vehicle_id: `s${i}`, display_name: null, state: "in_service_bay", soc: null, target_soc: null }));
    const m = depotModel(many, new Map());
    expect(m.overflow.service).toBe(2);
    expect(m.counts.service).toBe(SITE_COUNTS.service + 2);
  });

  it("names the cars that left, so only they are shown leaving, and says when the cards have not answered", () => {
    const m = depotModel(cardsB, new Map());
    expect(m.deployed.size).toBe(21);
    for (const id of m.deployed) expect(m.pucks.some((p) => p.id === id)).toBe(false);
    expect(m.read).toBe(true);
    const none = depotModel([], new Map(), false);
    expect(none.read).toBe(false);
    expect(none.pucks).toEqual([]);
  });

  it("draws no car that is outside the depot", () => {
    expect(carZone({ state: "deployed" })).toBeNull();
    expect(carZone({ state: "offline" })).toBeNull();
    expect(carZone({ state: "staged_awaiting_service", stall: { code: "X", kind: "staging" } })).toBe("booked");
  });
});

describe("plate labels", () => {
  it("read the run's own counts, the safety figure first on its plate", () => {
    const stack = { agent: { objective: "readiness_first", chains: 15, fallbacks: 2 }, shield: { evaluations: 14143, refused: 0 } };
    const cars = [{ layer: "arriving" }, { layer: "service" }, { layer: "service" }, { layer: "ready" }];
    const l = plateLabels({ rows: feed, dispositions: disp, stack, cars });
    expect(l.agent.line).toBe("15 passes · 2 fell back");
    // 103 ledger rows less 44 declined: 59 offers, 1 enacted, 25 refused (run 1ccad49b, measured 2026-09-30)
    expect(l.planners.line).toBe("59 offers · 1 used · 25 refused");
    expect(l.decide.line).toMatch(/^\d+ enacted · \d+ held$/);
    expect(l.safety.line).toBe("14,143 checks · 0 blocked");
    expect(l.depot.line).toBe("4 cars · 2 in service · 1 ready");
    expect(PLATES.map((p) => l[p.id].title)).toEqual(["Agent", "Planners", "Decide", "Safety", "Depot"]);
  });

  it("say a source has not answered instead of printing zero", () => {
    const l = plateLabels({ rows: [], dispositions: null, stack: null, cars: null });
    expect(l.agent.line).toBe("Passes: —");
    expect(l.planners.line).toBe("Offers: —");
    expect(l.decide.line).toBe("No decisions yet");
    expect(l.safety.line).toBe("Checks: —");
    expect(l.depot.line).toBe("Waiting for the depot cards");
    expect(Object.values(l).map((x) => x.line).join(" ")).not.toMatch(/\b0\b/);
  });
});

describe("events", () => {
  it("plays nothing that was already there when the tab opened", () => {
    const seen = new Set(recordKeys(feed, disp));
    expect(takeNewEvents(seen, feed, disp)).toEqual([]);
  });

  it("plays each new record once, in the order the engine wrote it", () => {
    const older = feed.slice(40), olderDisp = disp.slice(30);
    const seen = new Set(recordKeys(older, olderDisp));
    const first = takeNewEvents(seen, feed, disp);
    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first.map((e) => e.key)).size).toBe(first.length);
    expect(takeNewEvents(seen, feed, disp)).toEqual([]);
    const decisions = first.filter((e) => e.kind === "decision").map((e) => Date.parse(e.at ?? ""));
    expect(decisions).toEqual([...decisions].sort((a, b) => a - b));
    const offers = first.filter((e) => e.kind === "offer").map((e) => Number(e.key.slice(1)));
    expect(offers).toEqual([...offers].sort((a, b) => a - b));
    // A flood is capped at 48 plays a read; the rest still appear on their plates, they just do not play.
    expect(first.length).toBeLessThanOrEqual(48);
    expect(first.filter((e) => e.kind === "offer").length).toBeGreaterThan(0);
    for (const d of disp.slice(0, 30)) expect(seen.has(`p${d.disposition_id}`)).toBe(true);
  });

  it("never makes an event of the site battery or of a challenger row", () => {
    const seen = new Set<string>();
    const ev = takeNewEvents(seen, [row({ action: "bess_dispatch", vehicle_id: "b" }), row({ action: "challenger_flag", decision_seq: 2 })], null);
    expect(ev).toEqual([]);
  });
});

describe("replay", () => {
  const model = stackModel(cardsB, new Map(), feed, disp, true);
  const ev = replayEvents(model, feed, disp);
  const onPlates = new Set([
    ...model.agent.passes.map((p) => p.key),
    ...model.tiles.map((t) => t.key),
    ...model.planners.flatMap((l) => l.bars.map((b) => b.key)),
  ]);

  it("plays only records whose object is on a plate, each once", () => {
    expect(ev.length).toBeGreaterThan(0);
    expect(new Set(ev.map((e) => e.key)).size).toBe(ev.length);
    for (const e of ev) expect(onPlates.has(e.key)).toBe(true);
  });

  it("plays the newest of each kind, no more than its share", () => {
    const kinds = (k: string) => ev.filter((e) => e.kind === k);
    expect(kinds("pass").length).toBe(Math.min(REPLAY_PER.pass, model.agent.passes.length));
    expect(kinds("decision").length).toBe(Math.min(REPLAY_PER.decision, model.tiles.length));
    expect(kinds("offer").length).toBeLessThanOrEqual(REPLAY_PER.offer);
    expect(kinds("offer").length).toBeGreaterThan(0);
    // the newest decision on the plate is the last decision replayed
    const lastDecision = kinds("decision").at(-1)!;
    expect(lastDecision.key).toBe(model.tiles[0].key);
    const offerIds = kinds("offer").map((e) => Number(e.key.slice(1)));
    const barIds = model.planners.flatMap((l) => l.bars.map((b) => Number(b.key.slice(1)))).sort((a, b) => b - a);
    expect(Math.max(...offerIds)).toBe(barIds[0]);
  });

  it("keeps the order the records were written in, and spreads the offers through the rest", () => {
    const timed = ev.filter((e) => e.kind !== "offer").map((e) => Date.parse(e.at ?? ""));
    expect(timed).toEqual([...timed].sort((a, b) => a - b));
    const offerIds = ev.filter((e) => e.kind === "offer").map((e) => Number(e.key.slice(1)));
    expect(offerIds).toEqual([...offerIds].sort((a, b) => a - b));
    const firstOffer = ev.findIndex((e) => e.kind === "offer");
    const lastOffer = ev.map((e) => e.kind).lastIndexOf("offer");
    expect(firstOffer).toBeLessThan(ev.length / 3);
    expect(lastOffer).toBeGreaterThan((2 * ev.length) / 3);
  });

  it("has nothing to replay before any record has been read", () => {
    const empty = stackModel([], new Map(), [], null, false);
    expect(replayEvents(empty, [], null)).toEqual([]);
  });
});

describe("nothing falls off a plate", () => {
  const model = stackModel(cardsB, new Map(), feed, disp, true);
  const inside = (x: number, z: number, r: number) =>
    Math.abs(x) + r <= PLATE_W / 2 && Math.abs(z) + r <= PLATE_D / 2;

  it("every depot slot, zone by zone, sits inside the base with room for its car", () => {
    for (const z of ZONES) {
      const cap = zoneCapacity(z);
      for (let i = 0; i < Math.max(cap, z.cols * z.rows); i++) {
        if (i >= cap && z.fixed) break;
        const x = z.x0 + (i % z.cols) * z.px, zz = z.z0 + Math.floor(i / z.cols) * z.pz;
        expect(inside(x, zz, PLATE_MARGIN), `${z.id} slot ${i} at (${x.toFixed(2)}, ${zz.toFixed(2)})`).toBe(true);
      }
    }
    for (const p of model.depot.pucks) expect(inside(p.x, p.z, PLATE_MARGIN), p.name).toBe(true);
    expect(inside(ENTRY_POINT.x, ENTRY_POINT.z, 0.1)).toBe(true);
    expect(inside(EXIT_POINT.x, EXIT_POINT.z, 0.1)).toBe(true);
  });

  it("every sphere, bar and tile sits inside its plate", () => {
    for (const p of model.agent.passes) expect(inside(p.x, p.z, p.r)).toBe(true);
    for (const l of model.planners) for (const b of l.bars) expect(inside(b.x, l.z, 0.35)).toBe(true);
    for (const t of model.tiles) expect(inside(t.x, t.z, 0.34)).toBe(true);
  });

  it("puts no two depot zones on top of each other", () => {
    const box = (z: typeof ZONES[number]) => {
      const rows = z.fixed ? Math.ceil(zoneCapacity(z) / z.cols) : z.rows;
      return { x0: z.x0 - z.px / 2, x1: z.x0 + (z.cols - 0.5) * z.px, z0: z.z0 - z.pz / 2, z1: z.z0 + (rows - 0.5) * z.pz };
    };
    for (const a of ZONES) for (const b of ZONES) {
      if (a.id >= b.id) continue;
      const A = box(a), B = box(b);
      const overlap = A.x0 < B.x1 - 0.01 && B.x0 < A.x1 - 0.01 && A.z0 < B.z1 - 0.01 && B.z0 < A.z1 - 0.01;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  });
});

describe("tags on a zoomed plate", () => {
  const model = stackModel(cardsB, new Map(), feed, disp, true);
  const tags = plateTags(model, { evaluations: 14143, refused: 0 });

  it("name every depot zone with its real count, and chargers and bays against their stalls", () => {
    for (const z of ZONES) {
      const t = tags.depot.find((x) => x.key === z.id)!;
      expect(t.text).toBe(z.label);
      if (z.fixed) expect(t.sub).toBe(`${model.depot.counts[z.id]} of ${zoneCapacity(z)}`);
      else expect(t.sub).toBe(String(model.depot.counts[z.id]));
    }
  });

  it("say — for a zone count before the cards have answered, never 0", () => {
    const empty = plateTags(stackModel([], new Map(), [], null, false), null);
    for (const t of empty.depot.filter((x) => x.sub != null)) expect(t.sub).toBe("—");
    expect(empty.safety[0].text).toBe("Checks: —");
  });

  it("name each planner's lane and each objective the agent chose", () => {
    expect(tags.planners.filter((t) => t.key !== "newest").map((t) => t.key)).toEqual(model.planners.map((l) => l.word));
    expect(tags.agent.map((t) => t.key)).toEqual(model.agent.hubs.map((h) => h.key));
    expect(tags.safety[0]).toMatchObject({ text: "14,143 checks", sub: "0 blocked this run" });
  });

  it("stay on their plate", () => {
    for (const list of Object.values(tags)) for (const t of list) {
      expect(Math.abs(t.x)).toBeLessThanOrEqual(PLATE_W / 2);
      expect(Math.abs(t.z)).toBeLessThanOrEqual(PLATE_D / 2);
    }
  });
});
