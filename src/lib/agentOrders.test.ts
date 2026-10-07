// agentOrders.test.ts — the agent's charge-line order on screen (otto-q-core 0614, agent v23), from the first run that
// took it: run 0bbdcc07's real records (src/components/tabs/__fixtures__/agentOrders.0bbdcc07.json). A pass finds its
// order by the chain id its feed row carries; the orb, the stream line, the plate's counts and the strip all read it.
import { describe, expect, it } from "vitest";
import fx from "@/components/tabs/__fixtures__/agentOrders.0bbdcc07.json";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import { agentPass, orderIndex, NO_ORDERS, type OrderIndex } from "./agentStream";
import { agentOrderView, type AgentOrderUsage, type RunLearning } from "./runLearning";
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
