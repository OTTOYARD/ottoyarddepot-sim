// liveFeed.test.ts — the Agent tab's live stream, on the read-only capture of run 1ccad49b.
import { describe, expect, it } from "vitest";
import fx from "@/components/tabs/__fixtures__/ottoqRun.1ccad49b.json";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import type { DispositionRow } from "@/lib/ottoqFunnel";
import { namesFromRows, offerBatches, tickClocks } from "@/lib/agentStream";
import { GROUP_AT, carLine, liveFeed, siteLine, type FeedLine } from "./liveFeed";

const feed = fx.feed as unknown as ActivityFeedRow[];
const disp = fx.dispositions as unknown as DispositionRow[];
const batches = offerBatches(disp, namesFromRows(feed), tickClocks(feed)).filter((b) => !b.quiet);
const items = liveFeed(feed, batches);
const flat = items.flatMap((i): FeedLine[] => (i.kind === "group" ? i.lines : [i]));

describe("live feed", () => {
  it("gives every car decision and site decision one line, never a paragraph", () => {
    for (const r of feed) {
      if (r.action === "orchestrator_agent") continue;
      const l = siteLine(r) ?? carLine(r);
      if (r.vehicle_id || r.action === "bess_dispatch") expect(l, `${r.action}`).not.toBeNull();
      if (l) {
        expect(l.text.length).toBeLessThan(110);
        expect(l.text).not.toMatch(/\bundefined\b|\bnull\b|NaN/);
      }
    }
  });

  it("says where a car is sent, by the stall the record names", () => {
    const r = feed.find((x) => (x.rationale as Record<string, unknown>)?.verb === "assign_stall" && x.target === "NASH-L2-STALL-12")!;
    expect(carLine(r)!.text).toBe(`${r.display_name} → standard charger 12 to charge · 90% now`);
    const d = feed.find((x) => (x.rationale as Record<string, unknown>)?.verb === "deploy")!;
    expect(carLine(d)!.text).toMatch(new RegExp(`^${d.display_name} dispatched at \\d+% \\(needs \\d+% to leave\\)$`));
    const w = feed.find((x) => x.reason === "no_compatible_available_stall")!;
    expect(carLine(w)!.text).toBe(`${w.display_name} waits: no compatible stall free yet`);
  });

  it("puts the newest tick first, and folds a burst of one kind in one tick into one tile", () => {
    const ticks = flat.map((l) => l.tick ?? -1);
    expect(ticks).toEqual([...ticks].sort((a, b) => b - a));
    const groups = items.filter((i) => i.kind === "group");
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      if (g.kind !== "group") continue;
      expect(g.lines.length).toBeGreaterThanOrEqual(GROUP_AT);
      expect(new Set(g.lines.map((l) => l.tick)).size).toBe(1);
      expect(new Set(g.lines.map((l) => l.verb)).size).toBe(1);
    }
  });

  it("shows a held car's repeated wait once", () => {
    const held = flat.filter((l) => l.kind === "car" && l.tone === "held").map((l) => `${l.carId}|${l.text}`);
    expect(new Set(held).size).toBe(held.length);
  });

  it("carries the agent passes and the planners' offers in the same stream", () => {
    expect(flat.filter((l) => l.kind === "agent").length).toBe(feed.filter((r) => r.action === "orchestrator_agent").length);
    expect(flat.filter((l) => l.kind === "offers").length).toBe(batches.length);
  });

  it("names the site battery as the site battery, never as a car", () => {
    for (const l of flat.filter((x) => x.kind === "energy")) expect(l.text).toMatch(/^Site battery/);
    expect(flat.some((l) => /^A car: Battery/.test(l.text))).toBe(false);
  });
});
