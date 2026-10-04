// liveFeed.test.ts — the Agent tab's live stream, on the read-only capture of run 1ccad49b.
import { describe, expect, it } from "vitest";
import fx from "@/components/tabs/__fixtures__/ottoqRun.1ccad49b.json";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import type { DispositionRow } from "@/lib/ottoqFunnel";
import { namesFromRows, offerBatches, tickClocks } from "@/lib/agentStream";
import board from "@/components/tabs/__fixtures__/depotOwnerBoard.0608.json";
import { mergeCommands, ownerFeedLines, type OwnerCommand } from "@/lib/ownerBoard";
import { GROUP_AT, carLine, liveFeed, siteLine, withOwnerLines, type FeedItem, type FeedLine } from "./liveFeed";

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

// ── owners' agents' commands in the stream (otto-q-core 0608) ────────────────────────────────────────────────────
// The 0608 capture's commands, moved onto this run: sent at the sim clock of tick 90 (four), and of tick 94 (two).
describe("owners' agents' lines", () => {
  const clocks = tickClocks(feed);
  const RUN = fx.sim_run_id;
  const onRun = (cs: readonly OwnerCommand[]) => cs.map((c, i) => ({ ...c, sim_run_id: RUN, sim_clock: clocks.get(i < 2 ? 94 : 90)! }));
  const live = onRun(board.live.commands as unknown as OwnerCommand[]);
  const owners = ownerFeedLines(mergeCommands([], live), RUN);
  const merged = liveFeed(feed, batches, owners);
  const t = (x: { at: string | null }) => Date.parse(x.at ?? "");

  it("each joins the stream once, after every decision written at or before its sim clock and before the next tick's", () => {
    const at = merged.map((i, k) => ({ i, k }));
    const lines = at.filter(({ i }) => i.kind === "owner");
    expect(lines).toHaveLength(6);
    for (const { i, k } of lines) {
      for (const { i: o } of at.slice(0, k)) if (o.kind !== "owner" && o.at) expect(t(o)).toBeGreaterThan(t(i));
      for (const { i: o } of at.slice(k + 1)) if (o.kind !== "owner" && o.at) expect(t(o)).toBeLessThanOrEqual(t(i));
    }
    expect(new Set(merged.map((i) => i.key)).size).toBe(merged.length);
  });

  it("keeps commands sent at one sim clock newest sent first, and never folds one into a tile", () => {
    const own = merged.filter((i): i is FeedLine => i.kind === "owner");
    expect(own.map((l) => l.key)).toEqual(owners.map((l) => l.key));
    for (const g of merged) if (g.kind === "group") expect(g.lines.some((l) => l.kind === "owner")).toBe(false);
  });

  it("leaves the rest of the stream exactly as it was", () => {
    expect(merged.filter((i) => i.kind !== "owner")).toEqual(items);
    expect(liveFeed(feed, batches, [])).toEqual(items);
  });

  it("shows a command once however many polls deliver it, with where it stands now", () => {
    let kept = mergeCommands([], live);
    kept = mergeCommands(kept, live); // the next poll: the same page
    kept = mergeCommands(kept, onRun(board.ended.commands as unknown as OwnerCommand[])); // the run then ended
    const again = liveFeed(feed, batches, ownerFeedLines(kept, RUN)).filter((i): i is FeedLine => i.kind === "owner");
    expect(again.map((l) => l.key)).toEqual(owners.map((l) => l.key));
    expect(again.filter((l) => l.owner!.code).every((l) => l.owner!.note === "lifted: the run ended (completed)")).toBe(true);
  });

  it("a command sent after the newest decision goes first; one with no sim clock goes last", () => {
    const top: FeedLine = { ...owners[0], key: "u-new", at: new Date(t(items.find((i) => i.at)!) + 60_000).toISOString() };
    const loose: FeedLine = { ...owners[0], key: "u-loose", at: null };
    const out: FeedItem[] = withOwnerLines(items, [top, loose]);
    expect(out[0].key).toBe("u-new");
    expect(out[out.length - 1].key).toBe("u-loose");
  });
});
