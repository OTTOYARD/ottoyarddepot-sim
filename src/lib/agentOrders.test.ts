// agentOrders.test.ts — the agent's charge-line order on screen (otto-q-core 0614, agent v23), from the first run that
// took it: run 0bbdcc07's real records (src/components/tabs/__fixtures__/agentOrders.0bbdcc07.json). A pass finds its
// order by the chain id its feed row carries; the orb, the stream line, the plate's counts and the strip all read it.
import { describe, expect, it } from "vitest";
import fx from "@/components/tabs/__fixtures__/agentOrders.0bbdcc07.json";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import { agentPass, orderIndex, NO_ORDERS, type OrderIndex } from "./agentStream";
import { agentOrderView, hindsightWords, verdictText, verdictWords, type AgentOrderUsage, type RunLearning } from "./runLearning";
import { liveFeed } from "./liveFeed";
import { agentModel, plateLabels } from "@/components/tabs/ottoq/stack/stackModel";

const feed = fx.feed as unknown as ActivityFeedRow[];
const usage = fx.usage as unknown as AgentOrderUsage;
const learning = fx.learning as unknown as RunLearning;
const orders = orderIndex(usage);
const chainOf = (r: ActivityFeedRow) => String((r.rationale as { chain_id?: string }).chain_id ?? "");

describe("a pass finds its order by its chain id", () => {
  it("indexes every order the read returned", () => {
    expect(orders.size).toBe(usage.by_order!.length);
    expect(feed.every((r) => orders.has(chainOf(r)))).toBe(true);   // every pass in the capture sent an order
  });

  it("is green, and says how many cars, when its order seated cars", () => {
    const r = feed.find((x) => (orders.get(chainOf(x))?.seats_by_rank ?? 0) > 0)!;
    const o = orders.get(chainOf(r))!;
    const p = agentPass(r, orders);
    expect(p.hue).toBe("seated");
    expect(p.order).toBe(o);
    expect(p.headline).toBe(`The agent ordered the charge line and the decide path seated ${o.seats_by_rank} ${o.seats_by_rank === 1 ? "car" : "cars"} by it`);
    expect(p.outcome.join(" ")).toMatch(/^.*It ordered the charge line: \d+ cars?/);
    expect(p.outcome.join(" ")).toMatch(/The decide path seated \d+ cars? in its order/);
    expect(p.outcome.join(" ")).not.toMatch(/undefined|NaN|null/);
  });

  it("is the agent's white, and says no car was seated, when its order seated none", () => {
    const r = feed.find((x) => (orders.get(chainOf(x))?.seats_by_rank ?? 0) === 0)!;
    const p = agentPass(r, orders);
    expect(p.hue).toBe("answered");
    expect(p.headline).toMatch(/^The agent read the depot and ordered the charge line: \d+ cars?$/);
    expect(p.outcome).toContain("No car has been seated by its order.");
  });

  it("is red when the decide path kept none of the cars it named", () => {
    const r = feed[0];
    const refused = new Map([[chainOf(r), { chain_id: chainOf(r), status: "rejected", offered: 3, accepted: 0, seats_by_rank: 0 }]]);
    const p = agentPass(r, refused);
    expect(p.hue).toBe("refused");
    expect(p.outcome.join(" ")).toMatch(/kept none of the 3 cars it named/);
  });

  it("reads an index handed in by .map as no orders, not as an order index", () => {
    // TypeScript refuses `.map(agentPass)`; a plain-JS caller could still hand the index in, so the guard is exercised
    const ps = feed.map((r, i) => agentPass(r, i as unknown as OrderIndex));
    expect(ps.every((p) => p.order === null && p.hue === "answered")).toBe(true);
    expect(agentPass(feed[0], NO_ORDERS).hue).toBe("answered");
  });

  it("puts the order into the live feed's agent line", () => {
    const lines = liveFeed(feed, [], [], orders).flatMap((i) => ("lines" in i ? i.lines : [i]));
    const seatedLine = lines.find((l) => l.kind === "agent" && l.pass?.hue === "seated");
    expect(seatedLine?.text).toMatch(/^ordered the charge line and the decide path seated \d+ cars? by it$/);
  });
});

describe("the stack's agent plate", () => {
  it("colours each orb by its pass's order", () => {
    const m = agentModel(feed, orders);
    const want = feed.slice(0, m.passes.length).filter((r) => (orders.get(chainOf(r))?.seats_by_rank ?? 0) > 0).length;
    expect(m.passes.filter((p) => p.hue === "seated").length).toBe(want);
    expect(m.passes.filter((p) => p.hue === "held").length).toBe(0);    // no pass fell back in the capture
    expect(agentModel(feed).passes.every((p) => p.hue === "answered")).toBe(true);
  });

  it("counts each pass once: answered, seated cars, order refused or fell back", () => {
    const stack = { agent: { objective: "readiness_first", chains: 30, fallbacks: 2 }, shield: null };
    const l = plateLabels({ rows: feed, dispositions: [], stack, activity: null, orders: usage });
    const stat = (w: string) => l.agent.stats.find((s) => s.word === w)?.n;
    const refused = (usage.orders ?? 0) - (usage.orders_accepted ?? 0);
    expect(stat("seated cars")).toBe(usage.orders_seating);
    expect(stat("fell back")).toBe(2);
    expect(stat("answered")).toBe(30 - 2 - (usage.orders_seating ?? 0) - refused);
    expect(l.agent.foot).toMatch(new RegExp(`Its orders seated ${usage.seats_by_rank} cars in the charge line`));
    // a run that takes no order: the plate reads as it did before 0614
    const before = plateLabels({ rows: feed, dispositions: [], stack, activity: null });
    expect(before.agent.stats.map((s) => s.word)).toEqual(["answered", "fell back"]);
  });
});

describe("the learning strip's order section", () => {
  it("says what stands and what the orders did, from the same read the agent makes", () => {
    const v = agentOrderView(learning)!;
    const u = learning.agent_order!.usage!;
    expect(v.tone).toBe((u.seats_by_rank ?? 0) > 0 ? "ok" : "held");
    expect(v.headline).toMatch(/^The agent's order stands: \d+ cars/);
    expect(v.facts[0]).toBe(`Orders: ${u.orders}, ${u.orders_seating} of them seated cars · ${u.seats_by_rank} cars seated in the agent's order`);
    expect(v.head.length).toBe(learning.agent_order!.order!.head!.length);
    expect(v.head[0].text).toMatch(/^1\. \S+ · (fast charger|L2|either charger)/);
    expect([v.headline, ...v.facts, ...v.head.map((h) => h.text)].join(" ")).not.toMatch(/undefined|NaN|null|nemotron|cp-?sat|cuopt/i);
  });

  it("is absent on a run that takes no order, and quiet before the first one", () => {
    const { agent_order: _ignored, ...without } = learning;
    expect(agentOrderView(without as RunLearning)).toBeNull();
    const none = agentOrderView({ ok: true, agent_order: { live: false, order: null, usage: { orders: 0, seats_by_rank: 0 } } })!;
    expect(none.tone).toBe("idle");
    expect(none.headline).toMatch(/has not ordered the charge line yet/);
  });
});

// otto-q-core 0618: the kernel projects the line under the agent's order and under its own before it takes the order
describe("the kernel's check on an order", () => {
  it("is red, and says the kernel kept its own order and why, when the check refused it", () => {
    const r = feed[0];
    const m = new Map([[chainOf(r), { chain_id: chainOf(r), status: "refused", verdict: "line_ready_later", offered: 12, accepted: 11, seats_by_rank: 0 }]]);
    const p = agentPass(r, m);
    expect(p.hue).toBe("refused");
    expect(p.headline).toBe("The kernel checked the agent's charge order and kept its own");
    expect(p.outcome.join(" ")).toContain("It ordered the charge line (11 cars). The kernel checked it and kept its own order: it would have had the line ready later than the kernel's own order.");
    expect(p.outcome.join(" ")).not.toMatch(/No car has been seated|undefined|null/);
  });

  it("says the check took the order, and why, before what the order seated", () => {
    const r = feed.find((x) => (orders.get(chainOf(x))?.seats_by_rank ?? 0) > 0)!;
    const o = { ...orders.get(chainOf(r))!, verdict: "line_ready_sooner" };
    const p = agentPass(r, new Map([[chainOf(r), o]]));
    expect(p.hue).toBe("seated");
    const text = p.outcome.join(" ");
    expect(text).toContain("The kernel checked it and took it: it had the line ready sooner than the kernel's own order.");
    expect(text.indexOf("took it")).toBeLessThan(text.indexOf("The decide path seated"));
  });

  it("names every verdict in words, and an unknown one plainly", () => {
    for (const v of ["line_ready_sooner", "no_worse", "more_cars_ready_by_due", "line_ready_later", "fewer_cars_ready_by_due",
                     "more_cars_ready_by_due_but_line_much_later", "projection_failed", "no_projection",
                     // otto-q-core 0620: the rolled-forward check's reasons
                     "same_as_kernel", "wins_most_futures", "worse_in_expected_future", "no_better_in_expected_future",
                     "not_enough_futures_won", "rollout_failed", "no_rollout"]) {
      expect(verdictWords(v)).toMatch(/^it /);
    }
    expect(verdictWords("something_new")).toBe("something new");
    expect(verdictWords(null)).toBeNull();
  });

  it("does not call a refused last order the standing one on the learning strip", () => {
    const a = learning.agent_order!;
    const o = { ...a.order!, status: "refused" };
    const u = { ...a.usage!, orders_refused: 4, by_order: [{ order_id: o.order_id, status: "refused", verdict: "fewer_cars_ready_by_due" }] };
    const v = agentOrderView({ ...learning, agent_order: { ...a, live: true, order: o, usage: u } })!;
    expect(v.headline).toBe("The kernel checked the agent's last order and kept its own: it would have got fewer cars ready by their due time. An earlier order of the agent's still stands.");
    expect(v.head).toEqual([]);
    expect(v.facts[0]).toContain(" · 4 refused by the kernel's check · ");
    const lapsed = agentOrderView({ ...learning, agent_order: { ...a, live: false, order: o, usage: u } })!;
    expect(lapsed.headline).toMatch(/kept its own: .*\. The decide path seats cars in its own order\.$/);
  });
});

// otto-q-core 0620: the check rolls the line forward over sampled futures; 0621: each order replayed with what happened
describe("the rolled-forward check and the hindsight", () => {
  it("says how many futures an order won against the bar", () => {
    expect(verdictText({ verdict: "not_enough_futures_won", futures_won: 7, futures: 12, need: 10 }))
      .toBe("it beat the kernel's own order in 7 of 12 futures, short of the 10 the check asks");
    expect(verdictText({ verdict: "wins_most_futures", futures_won: 11, futures: 12, need: 10 }))
      .toBe("it beat the kernel's own order in the expected future and in 11 of 12 futures");
    expect(verdictText({ verdict: "worse_in_expected_future", futures_won: 6, futures: 12, need: 10 }))
      .toBe("it lost to the kernel's own order in the expected future (6 of 12 futures won)");
    // one future: nothing was sampled, so no count
    expect(verdictText({ verdict: "same_as_kernel", futures_won: 0, futures: 1, need: 1 })).toMatch(/^it would have seated the same cars/);
    expect(verdictText({ verdict: "line_ready_later" })).toBe("it would have had the line ready later than the kernel's own order");
    expect(verdictText(null)).toBeNull();
  });

  it("says what hindsight found, and nothing for an order that changed nothing", () => {
    expect(hindsightWords("right_take")).toMatch(/beat the kernel's own order: the check was right to take it/);
    expect(hindsightWords("wrong_take")).toMatch(/lost to the kernel's own order: the check should not have taken it/);
    expect(hindsightWords("missed_win")).toMatch(/the check refused a winner/);
    expect(hindsightWords("right_refusal")).toMatch(/the check was right to refuse it/);
    expect(hindsightWords("neutral_take")).toMatch(/tied/);
    expect(hindsightWords("no_decision")).toBeNull();
    expect(hindsightWords(null)).toBeNull();
  });

  it("puts the futures and the hindsight in the agent's pass", () => {
    const r = feed[0];
    const o = { chain_id: chainOf(r), status: "refused", verdict: "not_enough_futures_won", futures_won: 8, futures: 12, need: 10,
                offered: 9, accepted: 9, seats_by_rank: 0, hindsight: "missed_win", moves: ["due_rescue_fast"] };
    const p = agentPass(r, new Map([[chainOf(r), o]]));
    const text = p.outcome.join(" ");
    expect(text).toContain("The kernel checked it and kept its own order: it beat the kernel's own order in 8 of 12 futures, short of the 10 the check asks.");
    expect(text).toContain("In what actually happened it would have beaten the kernel's own order: the check refused a winner.");
    expect(text.indexOf("8 of 12")).toBeLessThan(text.indexOf("In what actually happened"));
  });

  it("counts the run's orders in hindsight on the learning strip", () => {
    const a = learning.agent_order!;
    const u = { ...a.usage!, hindsight: { graded: 9, right_take: 1, neutral_take: 1, wrong_take: 0, missed_win: 2, right_refusal: 3, no_decision: 2 } };
    const v = agentOrderView({ ...learning, agent_order: { ...a, usage: u } })!;
    expect(v.facts).toContain("In hindsight (9 orders replayed with what actually happened): taken 2 · won 1 · tied 1 · lost 0 · refused that would have won 2");
    const none = agentOrderView(learning)!;
    expect(none.facts.join(" ")).not.toMatch(/In hindsight/);
  });
});
