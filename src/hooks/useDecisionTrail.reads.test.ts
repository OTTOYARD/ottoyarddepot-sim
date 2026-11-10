// useDecisionTrail: what the hook asks the engine for. The client is mocked: nothing here reaches a backend.
//
// The hook used to read the whole run's decision feed as well (up to 5,000 rows, then every 20 s) for the old
// Intelligence tab's depot funnel, which no screen has drawn since 2026-09-30. These tests hold that a car's trail
// reads that car and the depot's cards, and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

type Answer = { data: unknown; error: unknown };
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/ottoQClient", () => ({ ottoQ: { rpc, from } }));

const { useTwinStore } = await import("@/store/twinStore");
const { useDecisionTrail, TWIN_DEPOT_ID } = await import("./useDecisionTrail");

const RUN = "run-on-screen";
const CAR = "car-1";
const row = { occurred_at: "2026-11-07T15:00:00Z", vehicle_id: CAR, display_name: "Waymo-AV-012", action: "stall_assignment", decision_seq: 7 };
const state: { feed: Answer } = { feed: { data: [row], error: null } };

/** A PostgREST query: every filter returns the query, and awaiting its limit answers. */
const query = (answer: Answer) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order"]) q[m] = () => q;
  q.limit = () => Promise.resolve(answer);
  return q;
};
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); for (let i = 0; i < 6; i++) await Promise.resolve(); });
const calls = (fn: string) => rpc.mock.calls.filter((c) => c[0] === fn).map((c) => c[1] as Record<string, unknown>);

beforeEach(() => {
  vi.useFakeTimers();
  state.feed = { data: [row], error: null };
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "ottoq_depot_cards") return { data: { sim_run_id: RUN, sim_clock: "2026-11-07T15:00:00Z", vehicles: [] }, error: null };
    if (fn === "ottoq_activity_feed_v2") return state.feed;
    if (fn === "ottoq_decision_options") return { data: { choices: [] }, error: null };
    return { data: null, error: null };
  });
  from.mockImplementation(() => query({ data: [], error: null }));
  useTwinStore.setState({ activeSimRunId: RUN, paused: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rpc.mockReset();
  from.mockReset();
  useTwinStore.setState({ activeSimRunId: null, paused: false });
});

describe("useDecisionTrail reads", () => {
  it("reads the depot's cards and the picked car, and never the whole run's feed", async () => {
    const { result } = renderHook(() => useDecisionTrail(CAR));
    await flush();
    expect(calls("ottoq_depot_cards")).toEqual([{ p_depot_id: TWIN_DEPOT_ID, p_fleet_operator_id: null }]);
    expect(calls("ottoq_activity_feed_v2")).toEqual([
      { p_sim_run_id: RUN, p_vehicle_id: CAR, p_limit: 1000, p_changes_only: true, p_window_ticks: 1_000_000 },
    ]);
    expect(calls("ottoq_decision_options")).toEqual([{ p_sim_run_id: RUN, p_vehicle_id: CAR }]);
    expect(from.mock.calls.map((c) => c[0])).toEqual(["ottoq_decisions", "ottoq_external_proposals"]);
    expect(result.current.carRows).toEqual([row]);
    expect(result.current.error).toBeNull();

    // 24 s on: the car at 8, 16 and 24 s, the cards at 10 and 20 s. Every feed read names the car.
    await advance(24_000);
    const feed = calls("ottoq_activity_feed_v2");
    expect(feed).toHaveLength(4);
    expect(feed.every((a) => a.p_vehicle_id === CAR)).toBe(true);
    expect(calls("ottoq_depot_cards")).toHaveLength(3);
  });

  it("with no car picked, reads the cards only", async () => {
    renderHook(() => useDecisionTrail(null));
    await flush();
    await advance(24_000);
    expect(calls("ottoq_activity_feed_v2")).toEqual([]);
    expect(from).not.toHaveBeenCalled();
    expect(calls("ottoq_depot_cards")).toHaveLength(3);
  });

  it("a paused run issues no reads", async () => {
    useTwinStore.setState({ activeSimRunId: RUN, paused: true });
    renderHook(() => useDecisionTrail(CAR));
    await flush();
    await advance(24_000);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps a failed read's error until the car's reads answer again", async () => {
    state.feed = { data: null, error: { message: "canceling statement due to statement timeout" } };
    const { result } = renderHook(() => useDecisionTrail(CAR));
    await flush();
    expect(result.current.error).toBe("canceling statement due to statement timeout");
    // the cards answer at 10 s: that is not the car's read, so the error stands
    await advance(10_000);
    expect(calls("ottoq_depot_cards")).toHaveLength(2);
    expect(result.current.error).toBe("canceling statement due to statement timeout");
    // the car's reads answer at 16 s
    state.feed = { data: [row], error: null };
    await advance(6_000);
    expect(result.current.error).toBeNull();
    expect(result.current.carRows).toEqual([row]);
  });
});
