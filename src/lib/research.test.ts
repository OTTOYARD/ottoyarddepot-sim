// research.test.ts — the Research tab's words and numbers: metric formatting, CT times, phase grouping, the payload.
//
// The metrics are the research wing's own JSON, so the formatter is tested on the shapes it writes (the served capture
// of 2026-11-03, src/components/tabs/__fixtures__/researchFeed.served1103.json) and on the shapes it may write next.
import { describe, expect, it } from "vitest";
import served from "@/components/tabs/__fixtures__/researchFeed.served1103.json";
import type { ResearchFinding } from "@/lib/ottoTwin";
import {
  MISSING,
  ctTime,
  formatMetricValue,
  formatNumber,
  groupByPhase,
  humanizeKey,
  kindLabel,
  metricLines,
  phaseLabel,
  readResearchFeed,
  shortRunId,
  statusLabel,
} from "./research";

const SERVED = readResearchFeed(served);
const bySlug = (slug: string) => SERVED.findings.find((f) => f.slug === slug)!;

const finding = (over: Partial<ResearchFinding>): ResearchFinding => ({
  slug: "p0-x", phase: "P0", item: "P0.0", kind: "measurement", status: "measured", title: "A finding title",
  summary: "A summary.", metrics: {}, evidence: null, run_ids: [], measured_at: null,
  updated_at: "2026-11-03T15:00:00+00:00", ...over,
});

describe("metric keys in words", () => {
  it("humanizes snake_case, keeps names and units in their own case, and reads ci95 as a 95% CI", () => {
    expect(humanizeKey("equal_prices")).toBe("Equal prices");
    expect(humanizeKey("depends_on_price")).toBe("Depends on price");
    expect(humanizeKey("auc")).toBe("AUC");
    expect(humanizeKey("auc_ci95_by_key")).toBe("AUC 95% CI by key");
    expect(humanizeKey("brier_skill_ci95_by_key")).toBe("Brier skill 95% CI by key");
    expect(humanizeKey("uptime_pct")).toBe("Uptime %");
    expect(humanizeKey("kw_peak_15min")).toBe("kW peak 15min"); // a unit first keeps its case: never "KW"
    expect(humanizeKey("decisions")).toBe("Decisions");
  });

  it("never puts a product name on screen, even inside a key", () => {
    expect(humanizeKey("cuopt_calls")).toBe("The GPU planner calls");
    expect(humanizeKey("nvidia_nemotron_passes")).toBe("The agent model passes");
    expect(humanizeKey("cpsat_wins")).toBe("The lexicographic planner wins");
  });
});

describe("metric values", () => {
  it("formats numbers with grouped thousands, up to 4 decimals and a real minus", () => {
    expect(formatNumber(370)).toBe("370");
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatNumber(0.6535)).toBe("0.6535");
    expect(formatNumber(1234.56789)).toBe("1,234.5679");
    expect(formatNumber(-0.0608)).toBe("−0.0608");
    expect(formatNumber(0.000123)).toBe("0.000123"); // a small number never reads as 0
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(Number.NaN)).toBe(MISSING);
  });

  it("reads [lo, hi] as a range, and says 'to' when an end is negative", () => {
    expect(formatMetricValue([0.5803, 0.707])).toBe("0.5803–0.707");
    expect(formatMetricValue([12, 1500])).toBe("12–1,500");
    expect(formatMetricValue([-0.0608, 0.0998])).toBe("−0.0608 to 0.0998");
  });

  it("draws every other JSON value as text, and leaves numbers written as text alone", () => {
    expect(formatMetricValue(42)).toBe("42");
    expect(formatMetricValue(null)).toBe(MISSING);
    expect(formatMetricValue(true)).toBe("yes");
    expect(formatMetricValue(false)).toBe("no");
    expect(formatMetricValue([])).toBe("none");
    expect(formatMetricValue([1, 2, 3])).toBe("1 · 2 · 3");
    expect(formatMetricValue([1234, 5678, 9])).toBe("1,234 · 5,678 · 9"); // a comma list would misread here
    expect(formatMetricValue("0793")).toBe("0793");
    expect(formatMetricValue("20261103155140")).toBe("20261103155140");
    expect(formatMetricValue("CP-SAT")).toBe("The lexicographic planner");
  });

  it("shows a timestamp in a metric as CT, never raw UTC", () => {
    expect(formatMetricValue("2026-11-03T15:40:54+00:00")).toBe("Nov 3, 9:40 AM CT");
    expect(formatMetricValue("2026-11-03")).toBe("2026-11-03"); // a date with no time has no time zone to convert
  });
});

describe("metric lines", () => {
  it("draws the served P0.0 metrics in natural key order, ranges as lo–hi", () => {
    expect(metricLines(bySlug("p0-referee-key-clustered").metrics)).toEqual([
      { label: "AUC", value: "0.6535", depth: 0 },
      { label: "AUC 95% CI by key", value: "0.5803–0.707", depth: 0 },
      { label: "AUC 95% CI independent", value: "0.5971–0.71", depth: 0 },
      { label: "Brier skill", value: "0.0294", depth: 0 },
      { label: "Brier skill 95% CI by key", value: "−0.0608 to 0.0998", depth: 0 },
      { label: "Decisions", value: "370", depth: 0 },
      { label: "Keys", value: "18", depth: 0 },
      { label: "Runs", value: "25", depth: 0 },
    ]);
  });

  it("draws a nested object as a heading line and its entries one level deeper", () => {
    const lines = metricLines(bySlug("p0-yardstick-priced").metrics);
    const at = lines.findIndex((l) => l.label === "Equal prices");
    expect(lines[at]).toEqual({ label: "Equal prices", value: null, depth: 0 });
    expect(lines.slice(at + 1, at + 6)).toEqual([
      { label: "Agent better", value: "102", depth: 1 },
      { label: "Kernel better", value: "185", depth: 1 },
      { label: "Same", value: "42", depth: 1 },
      { label: "Taken", value: "29", depth: 1 },
      { label: "Taken helped", value: "12", depth: 1 },
    ]);
    expect(lines.find((l) => l.label === "Depends on price")).toEqual({ label: "Depends on price", value: "140", depth: 0 });
    expect(lines).toHaveLength(12);
  });

  it("goes as deep as the JSON goes, numbers lists of objects, and never throws", () => {
    expect(metricLines({ a: { b: { c: 1 } }, list: [{ x: 1 }, 2], empty: {}, none: null })).toEqual([
      { label: "A", value: null, depth: 0 },
      { label: "B", value: null, depth: 1 },
      { label: "C", value: "1", depth: 2 },
      { label: "Empty", value: "none", depth: 0 },
      { label: "List", value: null, depth: 0 },
      { label: "1", value: null, depth: 1 },
      { label: "X", value: "1", depth: 2 },
      { label: "2", value: "2", depth: 1 },
      { label: "None", value: MISSING, depth: 0 },
    ]);
    expect(metricLines({})).toEqual([]);
    expect(metricLines(null)).toEqual([]);
    expect(metricLines([1, 2])).toEqual([]);
    expect(metricLines(bySlug("p0-research-area-live").metrics)).toEqual([
      { label: "Ledger", value: "20261103155140", depth: 0 },
      { label: "Migration", value: "0793", depth: 0 },
    ]);
  });
});

describe("CT times", () => {
  it("shows an instant in CDT (UTC-5) as Central time", () => {
    expect(ctTime("2026-10-08T14:05:00Z")).toBe("Oct 8, 9:05 AM CT");
    expect(ctTime("2026-07-04T03:15:00+00:00")).toBe("Jul 3, 10:15 PM CT"); // the day moves back with the clock
  });

  it("shows an instant in CST (UTC-6) as Central time", () => {
    expect(ctTime("2026-11-03T15:40:54+00:00")).toBe("Nov 3, 9:40 AM CT");
    expect(ctTime("2026-11-03T15:54:27.379869+00:00")).toBe("Nov 3, 9:54 AM CT"); // Postgres writes microseconds
  });

  it("follows the change from CDT to CST on Nov 1, 2026", () => {
    expect(ctTime("2026-11-01T06:30:00Z")).toBe("Nov 1, 1:30 AM CT"); // CDT
    expect(ctTime("2026-11-01T07:30:00Z")).toBe("Nov 1, 1:30 AM CT"); // CST, an hour of UTC later
  });

  it("answers null for a missing or unreadable time", () => {
    expect(ctTime(null)).toBeNull();
    expect(ctTime(undefined)).toBeNull();
    expect(ctTime("")).toBeNull();
    expect(ctTime("not a time")).toBeNull();
  });
});

describe("phases", () => {
  it("groups by phase, Phase 0 first, each phase newest first, whatever order the answer came in", () => {
    const groups = groupByPhase([
      finding({ slug: "p1-old", phase: "P1", updated_at: "2026-11-01T10:00:00+00:00" }),
      finding({ slug: "p2-only", phase: "P2", updated_at: "2026-11-03T10:00:00+00:00" }),
      finding({ slug: "p0-old", phase: "P0", updated_at: "2026-11-02T10:00:00+00:00" }),
      finding({ slug: "p1-new", phase: "P1", updated_at: "2026-11-03T12:00:00+00:00" }),
      finding({ slug: "p0-new", phase: "P0", updated_at: "2026-11-03T09:00:00+00:00" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Phase 0", "Phase 1", "Phase 2"]);
    expect(groups.map((g) => g.findings.map((f) => f.slug))).toEqual([
      ["p0-new", "p0-old"],
      ["p1-new", "p1-old"],
      ["p2-only"],
    ]);
  });

  it("breaks a tie on the same update time by slug, as the feed does", () => {
    const [g] = groupByPhase([...SERVED.findings].reverse());
    expect(g.findings.map((f) => f.slug)).toEqual(SERVED.findings.map((f) => f.slug));
    expect(g.findings.map((f) => f.slug)).toEqual([
      "p0-lab-building",
      "p0-referee-key-clustered",
      "p0-research-area-live",
      "p0-safety-model-building",
      "p0-yardstick-priced",
    ]);
  });

  it("names a phase", () => {
    expect(phaseLabel("P0")).toBe("Phase 0");
    expect(phaseLabel("P9")).toBe("Phase 9");
    expect(phaseLabel("")).toBe("No phase");
  });
});

describe("labels, run ids and the payload", () => {
  it("names every status and kind, and passes an unknown one through as words", () => {
    expect(["in_progress", "measured", "built", "recommended", "shipped", "not_verified"].map(statusLabel)).toEqual([
      "In progress", "Measured", "Built", "Recommended", "Shipped", "Not verified",
    ]);
    expect(["measurement", "build", "safety", "recommendation", "lab"].map(kindLabel)).toEqual([
      "Measurement", "Build", "Safety", "Recommendation", "Lab",
    ]);
    expect(statusLabel("on_hold")).toBe("On hold");
  });

  it("shortens a run id to 8 characters", () => {
    expect(shortRunId("8c0b2e04-8ea9-49a8-bfed-bed10ddfbc8b")).toBe("8c0b2e04");
  });

  it("reads the served capture as it came", () => {
    expect(SERVED.depot_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(SERVED.findings).toHaveLength(5);
    expect(bySlug("p0-safety-model-building").run_ids).toEqual(["8c0b2e04-8ea9-49a8-bfed-bed10ddfbc8b"]);
    expect(bySlug("p0-lab-building").measured_at).toBeNull();
  });

  it("calls an answer with no findings list an error, never an empty tab", () => {
    expect(() => readResearchFeed(null)).toThrow(/cannot read/);
    expect(() => readResearchFeed({ depot_id: "d" })).toThrow(/cannot read/);
    expect(readResearchFeed({ depot_id: "d", read_at: "t", findings: [] }).findings).toEqual([]);
  });

  it("leaves out a retracted finding and mends fields it cannot draw", () => {
    const feed = readResearchFeed({
      depot_id: "d",
      read_at: "t",
      findings: [
        { slug: "gone", status: "retracted", phase: "P0", title: "Retracted", summary: "s", updated_at: "t" },
        { slug: "odd", status: "measured", phase: "P0", title: "Odd", summary: "s", updated_at: "t",
          metrics: [1, 2], run_ids: ["abc", 7, ""], evidence: "  ", measured_at: "" },
        "not a finding",
      ],
    });
    expect(feed.findings.map((f) => f.slug)).toEqual(["odd"]);
    expect(feed.findings[0]).toMatchObject({ metrics: {}, run_ids: ["abc"], evidence: null, measured_at: null });
  });
});
