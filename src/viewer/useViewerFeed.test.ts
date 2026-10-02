// useViewerFeed.test.ts — which run the live view shows, and what it says about it. The twin API is stubbed; every
// stub is a read, and the test asserts the hook calls nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { TwinSnapshot } from "@/lib/ottoTwin";

const TWIN_DEPOT = "11111111-1111-1111-1111-111111111111";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

const api = {
  runs: vi.fn(),
  runContext: vi.fn(),
  snapshot: vi.fn(),
};
vi.mock("@/lib/ottoTwin", async (orig) => {
  const real = await orig<typeof import("@/lib/ottoTwin")>();
  return { ...real, twin: api };
});

const { useTwinStore } = await import("@/store/twinStore");
const { useViewerFeed, viewStateOf, POLL_MS, DISCOVER_MS } = await import("./useViewerFeed");

const snap = (run: string, status: string, states: string[] = ["charging_dcfc", "deployed", "staged_awaiting_service"]): TwinSnapshot => ({
  run: { sim_run_id: run, scenario: "busy_day", status, sim_clock: "2026-10-02T14:05:00Z", tick_count: 3, time_scale: 60, seed: 1 },
  fleet: { counts: {}, total: states.length, vehicles: states.map((s, i) => ({ id: `v${i}`, av_id: `v${i}`, make: "x", platform: "y", state: s, soc: 50, stall_id: null })) },
} as unknown as TwinSnapshot);

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  useTwinStore.getState().reset();
  api.runs.mockReset(); api.runContext.mockReset(); api.snapshot.mockReset();
  api.runContext.mockImplementation(async (id: string) => ({ sim_run_id: id, depot_id: TWIN_DEPOT, status: "running" }));
});
afterEach(() => { vi.useRealTimers(); });

describe("what the view says", () => {
  const base = { check: "ok" as const, snapshot: null, snapFailed: false, everConnected: true };
  it("names each state in turn", () => {
    expect(viewStateOf({ ...base, runId: null, everConnected: false })).toEqual({ kind: "connecting" });
    expect(viewStateOf({ ...base, runId: null })).toEqual({ kind: "no_run" });
    expect(viewStateOf({ ...base, runId: A })).toEqual({ kind: "connecting" });
    expect(viewStateOf({ ...base, runId: A, snapFailed: true })).toEqual({ kind: "offline", runId: A });
    expect(viewStateOf({ ...base, runId: A, check: "not_found" })).toEqual({ kind: "not_found", runId: A });
    expect(viewStateOf({ ...base, runId: A, check: "other_depot" })).toEqual({ kind: "other_depot", runId: A });
    expect(viewStateOf({ ...base, runId: A, snapshot: snap(A, "completed") })).toEqual({ kind: "ended", runId: A, status: "completed" });
  });

  it("counts only the cars on site: deployed and away cars are not drawn", () => {
    expect(viewStateOf({ ...base, runId: A, snapshot: snap(A, "running", ["charging_l2", "deployed", "offline", "en_route_to_depot", "in_wash_bay"]) }))
      .toEqual({ kind: "live", runId: A, status: "running", simClock: "2026-10-02T14:05:00Z", cars: 2 });
  });

  it("never reads another run's snapshot as this run's", () => {
    expect(viewStateOf({ ...base, runId: A, snapshot: snap(B, "running") })).toEqual({ kind: "connecting" });
  });
});

describe("a pinned view", () => {
  it("shows that run, at the twin's cadence while it is live, and never looks for another", async () => {
    api.snapshot.mockImplementation(async (id: string) => snap(id, "running"));
    const { result } = renderHook(() => useViewerFeed(A, true));
    await flush();
    expect(useTwinStore.getState().activeSimRunId).toBe(A);
    expect(result.current).toMatchObject({ kind: "live", runId: A, cars: 2 });
    const n = api.snapshot.mock.calls.length;
    await flush(POLL_MS * 3 + 10);
    expect(api.snapshot.mock.calls.length).toBeGreaterThanOrEqual(n + 3);
    expect(api.runs).not.toHaveBeenCalled();
  });

  it("refuses a run from another depot: it is named, and no snapshot of it is drawn", async () => {
    api.runContext.mockResolvedValue({ sim_run_id: A, depot_id: "22222222-2222-2222-2222-222222222222", status: "running" });
    api.snapshot.mockImplementation(async (id: string) => snap(id, "running"));
    const { result } = renderHook(() => useViewerFeed(A, true));
    await flush(POLL_MS * 2);
    expect(result.current).toEqual({ kind: "other_depot", runId: A });
    expect(useTwinStore.getState().snapshot).toBeNull();
  });

  it("names a run that does not exist", async () => {
    api.runContext.mockResolvedValue({ error: "sim_run not found" });
    const { result } = renderHook(() => useViewerFeed(A, true));
    await flush();
    expect(result.current).toEqual({ kind: "not_found", runId: A });
  });

  it("holds a paused run still, as the twin does", async () => {
    api.snapshot.mockImplementation(async (id: string) => snap(id, "paused"));
    renderHook(() => useViewerFeed(A, true));
    await flush();
    expect(useTwinStore.getState().paused).toBe(true);
  });

  it("reads slowly while hidden: nothing on screen would move", async () => {
    api.snapshot.mockImplementation(async (id: string) => snap(id, "running"));
    renderHook(() => useViewerFeed(A, false));
    await flush();
    const n = api.snapshot.mock.calls.length;
    await flush(POLL_MS * 4);
    expect(api.snapshot.mock.calls.length).toBe(n);
  });
});

describe("a following view", () => {
  it("is empty with no run, and takes the live run when one starts", async () => {
    api.runs.mockResolvedValueOnce({ runs: [{ sim_run_id: B, status: "completed" }] });
    api.snapshot.mockImplementation(async (id: string) => snap(id, "running"));
    const { result } = renderHook(() => useViewerFeed(null, true));
    await flush();
    expect(result.current).toEqual({ kind: "no_run" });
    api.runs.mockResolvedValue({ runs: [{ sim_run_id: A, status: "running" }, { sim_run_id: B, status: "completed" }] });
    await flush(DISCOVER_MS + 10);
    expect(useTwinStore.getState().activeSimRunId).toBe(A);
    expect(result.current).toMatchObject({ kind: "live", runId: A });
  });

  it("never swaps a run it is showing live for another live run", async () => {
    api.runs.mockResolvedValue({ runs: [{ sim_run_id: A, status: "running" }] });
    api.snapshot.mockImplementation(async (id: string) => snap(id, "running"));
    renderHook(() => useViewerFeed(null, true));
    await flush();
    expect(useTwinStore.getState().activeSimRunId).toBe(A);
    api.runs.mockResolvedValue({ runs: [{ sim_run_id: B, status: "running" }, { sim_run_id: A, status: "running" }] });
    await flush(DISCOVER_MS + 10);
    expect(useTwinStore.getState().activeSimRunId).toBe(A);
  });

  it("moves on from an ended run to the next live one", async () => {
    api.runs.mockResolvedValue({ runs: [{ sim_run_id: A, status: "running" }] });
    api.snapshot.mockImplementation(async (id: string) => snap(id, "running"));
    renderHook(() => useViewerFeed(null, true));
    await flush();
    api.runs.mockResolvedValue({ runs: [{ sim_run_id: B, status: "running" }, { sim_run_id: A, status: "completed" }] });
    await flush(DISCOVER_MS + 10);
    expect(useTwinStore.getState().activeSimRunId).toBe(B);
  });
});
