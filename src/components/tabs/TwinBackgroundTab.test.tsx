// TwinBackgroundTab.test.tsx — the Background tab draws the engine's own rows as read on 2026-10-02 (fixture beside
// this file), names the source of every live figure, and says "—" where a source has not answered.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import fx from "./__fixtures__/background.2026-10-02.json";
import type { BackgroundFacts } from "@/hooks/useBackgroundFacts";

const S: { facts: BackgroundFacts; manifest: unknown } = { facts: null as unknown as BackgroundFacts, manifest: null };
vi.mock("@/hooks/useBackgroundFacts", () => ({
  useBackgroundFacts: () => ({ facts: S.facts, loading: false }),
  useBootManifest: () => ({ manifest: S.manifest, runId: "8a1e12ae-b64b-4b6e-a82d-370f6f58315c" }),
}));
vi.mock("@/hooks/useValueSummary", () => ({ useValueSummary: () => ({ summary: null, error: null, loading: false }) }));

const { useTwinStore } = await import("@/store/twinStore");
const { useSimulationStore } = await import("@/store/simulationStore");
const { TwinBackgroundTab } = await import("./TwinBackgroundTab");

const full = (): BackgroundFacts => ({
  datasets: fx.datasets as never, distributions: fx.distributions as never, feedPlans: fx.feed_plans as never,
  catalog: fx.catalog as never, ledger: fx.ledger as never, rules: fx.rules as never, posture: fx.posture as never,
  canon: fx.canon as never, tariffs: fx.tariffs as never, classes: fx.classes as never,
  readAt: "2026-10-02T21:11:00Z", failed: [],
});

beforeEach(() => {
  S.facts = full();
  S.manifest = {
    sim_run_id: "8a1e12ae-b64b-4b6e-a82d-370f6f58315c", random_seed: 171717,
    boot_draw: { seed: 171717, vehicles_drawn: 116, fleet_condition: { veh_battery_soh_pct: { min: 84.2, avg: 92.6, max: 99.1 } } },
  };
  useTwinStore.setState({ activeSimRunId: "8a1e12ae-b64b-4b6e-a82d-370f6f58315c", snapshot: null });
});
afterEach(() => cleanup());

describe("Background tab", () => {
  it("has every section Chase asked for, in order, with a nav to each", () => {
    render(<TwinBackgroundTab />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "What you see",
      "OTTO-Q and the twin",
      "Public data",
      "Monte Carlo worlds, made reproducible",
      "The agentic system",
      "The safety harness",
      "What it solves",
      "The technical edge",
      "Distribution and commercialization of AV fleets",
      "Why it is agnostic",
      "Live facts, read from the engine",
    ]);
    const nav = screen.getByRole("navigation", { name: "Background sections" });
    expect(within(nav).getAllByRole("button")).toHaveLength(11);
  });

  it("lists every public source with its link, and how it reached the twin", () => {
    render(<TwinBackgroundTab />);
    const data = screen.getByRole("region", { name: "Public data" });
    const caltech = within(data).getByRole("link", { name: /ACN-Data Adaptive Charging Network Dataset/ });
    expect(caltech.getAttribute("href")).toBe("https://ev.caltech.edu/dataset");
    expect(caltech.getAttribute("rel")).toContain("noopener");
    expect(within(data).getAllByText("fitted to published statistics").length).toBe(4);
    expect(within(data).getAllByText("live public API, refit weekly").length).toBe(2);
    expect(within(data).getByText("a declared assumption until real fleet data exists")).toBeTruthy();
    expect(within(data).getByRole("link", { name: /NES GSA tariff/ }).getAttribute("href")).toMatch(/^https:\/\/www\.nespower\.com\//);
    expect(within(data).getByText(/public\.ottoq_calibration_datasets/)).toBeTruthy();
  });

  it("shows this run's Monte Carlo hand, named as this run's", () => {
    render(<TwinBackgroundTab />);
    const mc = screen.getByRole("region", { name: "Monte Carlo worlds, made reproducible" });
    expect(within(mc).getByText(/116 cars, each with its own condition · battery health 84\.2% to 99\.1% \(mean 92\.6%\)/)).toBeTruthy();
    expect(within(mc).getByText(/ottoq_twin_boot_manifest\(run 8a1e12ae\)/)).toBeTruthy();
    expect(within(mc).getByText(/47 variables, each drawn on its own clock/)).toBeTruthy();
  });

  it("quantifies every model and solver from the ledger, with its source", () => {
    render(<TwinBackgroundTab />);
    const ag = screen.getByRole("region", { name: "The agentic system" });
    expect(within(ag).getByText("12,627 agent decisions recorded · 12,185 applied · 440 fell back to the deterministic objective")).toBeTruthy();
    expect(within(ag).getByText("1,165 calls answered · 5,093 proposals returned")).toBeTruthy();
    expect(within(ag).getByText(/public\.ottoq_intelligence_ledger/)).toBeTruthy();
  });

  it("reads the shield's posture from the derivation, and the canon as it stands", () => {
    render(<TwinBackgroundTab />);
    const sh = screen.getByRole("region", { name: "The safety harness" });
    expect(within(sh).getByText(/30 rules/)).toBeTruthy();
    expect(within(sh).getByText(/Points that refuse \(5\):/)).toBeTruthy();
    expect(within(sh).getByText(/Now: 9 of 9 certification columns passing and current, last certified Oct 2, 3:26 PM CT\./)).toBeTruthy();
    expect(within(sh).getAllByText("Not yet live").length).toBe(1);
  });

  it("says — where a source has not answered, never 0, and names what failed", () => {
    S.facts = { ...full(), ledger: null, canon: null, rules: null, failed: ["ottoq_intelligence_ledger", "ottoq_determinism_canon"] };
    render(<TwinBackgroundTab />);
    const facts = screen.getByRole("region", { name: "Live facts, read from the engine" });
    expect(within(facts).getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(within(facts).getByText(/Did not answer on the last read: ottoq_intelligence_ledger, ottoq_determinism_canon/)).toBeTruthy();
    expect(screen.getByText("The intelligence ledger did not answer. —")).toBeTruthy();
  });

  // Chase, 2026-10-02: "I don't want you to directly reference each of those perspective viewers." The page explains
  // itself to whoever reads it.
  it("addresses no reader by type", () => {
    const { container } = render(<TwinBackgroundTab />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/investor|\bfor (an? )?OEMs?\b|\bfor (a )?fleet owners?\b|\bfor (a )?customers?\b|\bfor (a )?partners?\b/i);
  });

  it("argues its edge from the engine, and links and dates every outside fact it leans on", () => {
    render(<TwinBackgroundTab />);
    const edge = screen.getByRole("region", { name: "The technical edge" });
    const hrefs = within(edge).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining([
      "https://github.com/ocpi/ocpi/blob/v2.3.0/mod_cdrs.asciidoc",
      "https://evroaming.org/ocpi-downloads/",
    ]));
    // Chase, 2026-10-07: no product named on screen, so a vendor's document is dated here and linked only in the code
    // comment beside the card. A link would name the product in its address.
    expect(hrefs.filter((h) => /nvidia|cuopt|or-tools|minizinc/i.test(h ?? ""))).toEqual([]);
    for (const a of within(edge).getAllByRole("link")) expect(a.getAttribute("rel")).toContain("noopener");
    // each outside source names the version it was read at and the day it was checked
    expect(within(edge).getAllByText(/checked Oct 2, 2026/).length).toBe(3);
    expect(within(edge).getByText(/the solver maker's own documentation, release 26\.08/)).toBeTruthy();
    expect(within(edge).getByText(/OCPI 2\.2\.1 and 2\.3\.0, the released versions/)).toBeTruthy();
    // and says what is not built rather than implying it
    expect(within(edge).getByText(/Pricing of those records against\s+the tariff is in development/)).toBeTruthy();
    expect(within(edge).getByText(/Intelligence is not a substitute for capacity/)).toBeTruthy();
  });

  // Chase, 2026-10-07: "I want to remove all specific tool naming from our descriptions." Rendered, with every fact
  // read, so an engine key that reaches the screen ("nvidia_nemotron") fails here too, not only a written name.
  it("names no vendor product and no engine key for one, anywhere on the page", () => {
    const { container } = render(<TwinBackgroundTab />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/nemotron|cuopt|cp-?sat|or-tools|omniverse|isaac sim|forward_lex/i);
    expect(text).toMatch(/NVIDIA open model/);
    expect(text).toMatch(/proprietary|built its own safety layer/i);
  });

  it("opens the Value and Agent tabs from its links", () => {
    render(<TwinBackgroundTab />);
    fireEvent.click(screen.getByRole("button", { name: /Open the Value tab/ }));
    expect(useSimulationStore.getState().activeTab).toBe("value");
    fireEvent.click(screen.getByRole("button", { name: "Agent tab" }));
    expect(useSimulationStore.getState().activeTab).toBe("agent");
  });

  it("writes no figure that is not read live: every digit in its prose comes from a source or names a thing", () => {
    S.facts = { datasets: null, distributions: null, feedPlans: null, catalog: null, ledger: null, rules: null, posture: null,
      canon: null, tariffs: null, classes: null, readAt: null, failed: [] };
    S.manifest = null;
    useTwinStore.setState({ activeSimRunId: null, snapshot: null });
    const { container } = render(<TwinBackgroundTab />);
    container.querySelectorAll("style").forEach((el) => el.remove()); // the scroll area's own CSS
    container.querySelectorAll("[data-ordinal]").forEach((el) => el.remove()); // list numbering, not figures
    let text = container.textContent ?? "";
    // names, versions and dated document references, not counts
    for (const re of [/\b3D\b/g, /OCPP 2\.0\.1/g, /\b100%/g, /VDA 5050/g, /Aug 22, 2026/g, /\bL[12]\b/g,
      /release 26\.08/g, /OCPI 2\.2\.1 and 2\.3\.0/g, /Oct 2, 2026/g]) text = text.replace(re, "");
    const hits = [...text.matchAll(/.{0,40}\d.{0,20}/g)].map((m) => m[0]);
    expect(hits).toEqual([]);
  });
});
