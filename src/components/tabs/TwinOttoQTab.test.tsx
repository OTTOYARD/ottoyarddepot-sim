// TwinOttoQTab.test.tsx — the OTTO-Q and Agent tabs render run 1ccad49b's real records, and say "—" where a source has
// not answered. Hooks are stubbed to the read-only capture in __fixtures__/ottoqRun.1ccad49b.json.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import fx from "./__fixtures__/ottoqRun.1ccad49b.json";
import type { ActivityFeedRow } from "@/store/activityFeedStore";

vi.mock("@/lib/ottoQClient", () => ({
  ottoQ: { rpc: vi.fn().mockResolvedValue({ data: [], error: null }), from: vi.fn() },
}));

const S = {
  cards: { vehicles: null as unknown, status: "waiting" as "waiting" | "ok" | "other_run", simClock: null as string | null, error: null },
  disp: { rows: null as unknown, error: null },
  stack: null as unknown,
};
vi.mock("@/hooks/useActivityFeed", () => ({ useActivityFeed: () => undefined }));
vi.mock("@/hooks/useDepotCards", () => ({ useDepotCards: () => S.cards }));
vi.mock("@/hooks/useDispositions", () => ({ useDispositions: () => S.disp }));
vi.mock("@/hooks/useIntelligenceStack", () => ({ useIntelligenceStack: () => ({ stack: S.stack }) }));
vi.mock("@/hooks/useSecondLoop", () => ({
  useSecondLoop: () => ({ challenger: fx.challenger, learning: fx.learning, error: null, loading: false, simRunId: fx.sim_run_id }),
}));
vi.mock("@/hooks/useDecisionTrail", () => ({
  TWIN_DEPOT_ID: "11111111-1111-1111-1111-111111111111",
  useDecisionTrail: () => ({ simRunId: fx.sim_run_id, simClock: null, cards: [], cardMemory: new Map(), runRows: [], runRowsCapped: false,
    carRows: [], decisions: [], proposals: [], choices: [], error: null, loading: true }),
}));

const { useTwinStore } = await import("@/store/twinStore");
const { useActivityFeedStore } = await import("@/store/activityFeedStore");
const { TwinOttoQTab } = await import("./TwinOttoQTab");
const { TwinAgentTab } = await import("./TwinAgentTab");

beforeEach(() => {
  useTwinStore.setState({ activeSimRunId: fx.sim_run_id, paused: false });
  useActivityFeedStore.getState().setRows(fx.feed as unknown as ActivityFeedRow[]);
  S.cards = { vehicles: fx.cards_b, status: "ok", simClock: fx.sim_clock_b, error: null };
  S.disp = { rows: fx.dispositions, error: null };
  S.stack = fx.stack;
});
afterEach(() => { cleanup(); });

describe("OTTO-Q tab", () => {
  it("draws the eight layers in the engine's order, each with its line", () => {
    render(<TwinOttoQTab />);
    const list = screen.getByRole("list", { name: "OTTO-Q layers" });
    // each layer row is its own button plus the "i" beside it; the layer buttons are the ones with words in them
    const labels = within(list).getAllByRole("button").filter((b) => !/^About /.test(b.getAttribute("aria-label") ?? "")).map((b) => b.textContent ?? "");
    expect(labels.map((l) => l.match(/^(Arriving|Needs|Proposers|Decide|Safety check|Booked|Service|Ready)/)?.[1]))
      .toEqual(["Arriving", "Needs", "Proposers", "Decide", "Safety check", "Booked", "Service", "Ready"]);
    expect(screen.getByText("5 on the way · 7 at the gate")).toBeTruthy();
    expect(screen.getByText("14,143 checks · 0 refused")).toBeTruthy();
    expect(screen.getByText(/21 cars are out working and not drawn/)).toBeTruthy();
  });

  it("opens a layer: its cars, and its newest decisions in words", () => {
    render(<TwinOttoQTab />);
    fireEvent.click(screen.getByRole("button", { name: /^Ready/ }));
    const detail = screen.getByRole("region", { name: "Ready layer" });
    expect(within(detail).getByText("21 cars here")).toBeTruthy();
    // the captured frame carries no battery for in-depot cars, so no Ready car is claimed ready
    expect(within(detail).getAllByText("battery not reported").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^Proposers/ }));
    const p = screen.getByRole("region", { name: "Proposers layer" });
    expect(within(p).getAllByText(/offer from the greedy planner was refused|Agent: /).length).toBeGreaterThan(0);
  });

  it("puts an \"i\" beside every layer, which explains it without opening it", async () => {
    render(<TwinOttoQTab />);
    const list = screen.getByRole("list", { name: "OTTO-Q layers" });
    const infos = within(list).getAllByRole("button", { name: /^About the .* layer$/ });
    expect(infos).toHaveLength(8);
    fireEvent.click(within(list).getByRole("button", { name: "About the Decide layer" }));
    const card = await screen.findByRole("article", { name: "About the Decide layer" });
    for (const h of ["Why it is there", "What it does", "What it technically is", "Why it was built this way"]) {
      expect(within(card).getByText(h)).toBeTruthy();
    }
    expect(within(card).getByText(/public\.ottoq_decide_tick, driven by pg_cron/)).toBeTruthy();
    // the card names the run its live line is for
    expect(within(card).getByText(`On this run (${fx.sim_run_id.slice(0, 8)})`)).toBeTruthy();
    // and the layer itself did not open underneath it
    expect(screen.queryByRole("region", { name: "Decide layer" })).toBeNull();
  });

  it("explains the Proposers row as the agent and the planners together, and links to the Background tab", async () => {
    const { useSimulationStore } = await import("@/store/simulationStore");
    render(<TwinOttoQTab />);
    fireEvent.click(screen.getByRole("button", { name: "About the Proposers layer" }));
    expect(await screen.findByRole("article", { name: "About the Agent layer" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "About the Planners layer" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /The whole system, on the Background tab/ })[0]);
    expect(useSimulationStore.getState().activeTab).toBe("background");
  });

  it("says a source has not answered instead of drawing zeros", () => {
    S.cards = { vehicles: null, status: "waiting", simClock: null, error: null };
    S.disp = { rows: null, error: null };
    S.stack = null;
    useActivityFeedStore.getState().setRows([]);
    render(<TwinOttoQTab />);
    expect(screen.getAllByText("Waiting for the depot cards").length).toBeGreaterThan(0);
    expect(screen.getByText("Agent: — · offers —")).toBeTruthy();
    expect(screen.getByText("Cars outside the depot: —", { exact: false })).toBeTruthy();
  });

  it("says so when the depot is running another run", () => {
    S.cards = { vehicles: null, status: "other_run", simClock: null, error: null };
    render(<TwinOttoQTab />);
    expect(screen.getByText(/The depot is not running this run right now/)).toBeTruthy();
  });

  it("with no run, explains itself and draws nothing", () => {
    act(() => useTwinStore.setState({ activeSimRunId: null }));
    render(<TwinOttoQTab />);
    expect(screen.getByText(/No simulation is active/)).toBeTruthy();
  });
});

describe("Agent tab", () => {
  it("writes each pass as sentences, and counts the loop from its records", () => {
    render(<TwinAgentTab />);
    fireEvent.click(screen.getByRole("tab", { name: "Agent passes" }));
    expect(screen.getByText(/15 passes this run, 2 fell back to the deterministic path/)).toBeTruthy();
    expect(screen.getAllByText("The agent read the depot and chose to get cars ready first").length).toBeGreaterThan(0);
    expect(screen.getAllByText("The agent fell back to the deterministic path").length).toBeGreaterThan(0);
    const loop = screen.getByRole("region", { name: "The loop" });
    expect(within(loop).getByText("59")).toBeTruthy(); // offers: 103 dispositions less 44 abstentions
    expect(within(loop).getByText("1 / 25")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/undefined|NaN|\[object Object\]/);
    expect(screen.getByText("ended")).toBeTruthy();
    // the run in the fixture has ended: no stale board is offered as current
    expect(screen.getByRole("region", { name: "What the agent reads" }).textContent).toMatch(/this run is not running/);
  });

  it("opens on the live stream: one line per decision, saying where each car goes", () => {
    render(<TwinAgentTab />);
    const live = screen.getByRole("region", { name: "Live decisions" });
    expect(within(live).getAllByText(/→ standard charger 12 to charge · 90% now/).length).toBeGreaterThan(0);
    expect(within(live).getAllByText(/dispatched at 100% \(needs 80% to leave\)/).length).toBeGreaterThan(0);
    expect(within(live).queryByText(/^A car: Battery/)).toBeNull();
    fireEvent.click(within(live).getByRole("button", { name: "Agent" }));
    expect(within(live).getAllByText("read the depot and chose to get cars ready first").length).toBeGreaterThan(0);
    expect(within(live).queryByText(/→ standard charger/)).toBeNull();
  });

  it("learning says OTTO-Q does not experiment in production, and that estimates are not built", () => {
    render(<TwinAgentTab />);
    fireEvent.click(screen.getByRole("tab", { name: "Learning" }));
    expect(screen.getByText(/never by OTTO-Q in production/)).toBeTruthy();
    expect(screen.getByText(/Overnight estimates .* are not built yet/)).toBeTruthy();
  });
});
