// useOwnerBoard — the one read of otto-q-core 0608 for the whole cockpit. The client is mocked: nothing here reaches a
// backend. The board is the real capture (__fixtures__/depotOwnerBoard.0608.json), moved onto the run the twin shows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import capture from "@/components/tabs/__fixtures__/depotOwnerBoard.0608.json";
import type { DepotOwnerBoard } from "@/lib/ownerBoard";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/ottoQClient", () => ({ ottoQ: { rpc } }));

const { useTwinStore } = await import("@/store/twinStore");
const { useOwnerBoardStore } = await import("@/store/ownerBoardStore");
const { useOwnerBoard, OWNER_BOARD_POLL_MS, OWNER_BOARD_RETRY_MS } = await import("./useOwnerBoard");

const RUN = "run-on-screen";
const board = (): DepotOwnerBoard => {
  const live = capture.live as unknown as DepotOwnerBoard;
  return { ...live, run: { ...live.run!, sim_run_id: RUN }, commands: live.commands!.map((c) => ({ ...c, sim_run_id: RUN })) };
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers();
  useTwinStore.setState({ activeSimRunId: RUN, paused: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rpc.mockReset();
  useTwinStore.setState({ activeSimRunId: null, paused: false });
  useOwnerBoardStore.getState().reset(null);
});

describe("useOwnerBoard", () => {
  it("asks 0608 for the twin depot, and fills the store when it answers for the run on screen", async () => {
    rpc.mockResolvedValue({ data: board(), error: null, status: 200 });
    renderHook(() => useOwnerBoard());
    await flush();
    expect(rpc).toHaveBeenCalledWith("ottoq_depot_owner_board", { p_depot_id: "11111111-1111-1111-1111-111111111111", p_limit: 30 });
    const s = useOwnerBoardStore.getState();
    expect(s.status).toBe("ok");
    expect(s.marked.size).toBe(4);
    expect(s.commands).toHaveLength(6);
  });

  it("polls on the decision stream's cadence, and an unchanged answer hands the views nothing new", async () => {
    rpc.mockResolvedValue({ data: board(), error: null, status: 200 });
    renderHook(() => useOwnerBoard());
    await flush();
    const first = useOwnerBoardStore.getState();
    await advance(OWNER_BOARD_POLL_MS);
    expect(rpc).toHaveBeenCalledTimes(2);
    const second = useOwnerBoardStore.getState();
    expect(second.board).toBe(first.board);
    expect(second.marked).toBe(first.marked);
    expect(second.commands).toBe(first.commands);
  });

  it("404 / PGRST202: not switched on yet, and asked again only after a minute", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.ottoq_depot_owner_board" }, status: 404 });
    renderHook(() => useOwnerBoard());
    await flush();
    expect(useOwnerBoardStore.getState().status).toBe("not_enabled");
    await advance(OWNER_BOARD_POLL_MS);
    expect(rpc).toHaveBeenCalledTimes(1);
    await advance(OWNER_BOARD_RETRY_MS);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("401 / 42501: not granted; any other failure keeps what was read last", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied for function ottoq_depot_owner_board" }, status: 401 });
    renderHook(() => useOwnerBoard());
    await flush();
    expect(useOwnerBoardStore.getState().status).toBe("not_granted");
    expect(useOwnerBoardStore.getState().board).toBeNull();

    rpc.mockResolvedValueOnce({ data: board(), error: null, status: 200 });
    await advance(OWNER_BOARD_RETRY_MS);
    expect(useOwnerBoardStore.getState().status).toBe("ok");

    rpc.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" }, status: 500 });
    await advance(OWNER_BOARD_POLL_MS);
    expect(useOwnerBoardStore.getState().status).toBe("error");
    expect(useOwnerBoardStore.getState().marked.size).toBe(4);

    // the same board as before the failure is news again: the error clears
    rpc.mockResolvedValueOnce({ data: board(), error: null, status: 200 });
    await advance(OWNER_BOARD_POLL_MS);
    expect(useOwnerBoardStore.getState().status).toBe("ok");
  });

  it("a depot the board does not know is its refusal, in its words", async () => {
    rpc.mockResolvedValue({ data: capture.unknown_depot, error: null, status: 200 });
    renderHook(() => useOwnerBoard());
    await flush();
    expect(useOwnerBoardStore.getState().status).toBe("refused");
    expect(useOwnerBoardStore.getState().message).toBe("No such depot.");
  });

  it("asks nothing while the run is paused or there is no run, and a new run starts clean", async () => {
    rpc.mockResolvedValue({ data: board(), error: null, status: 200 });
    useTwinStore.setState({ paused: true });
    const { rerender } = renderHook(() => useOwnerBoard());
    await flush();
    expect(rpc).not.toHaveBeenCalled();

    act(() => useTwinStore.setState({ paused: false }));
    rerender();
    await flush();
    expect(useOwnerBoardStore.getState().commands).toHaveLength(6);

    act(() => useTwinStore.setState({ activeSimRunId: "another-run" }));
    rerender();
    expect(useOwnerBoardStore.getState().runId).toBe("another-run");
    await flush();
    // the board answers for RUN, not for the run now on screen: its settings mark no car, and its commands stay out of
    // this run's feed (ownerFeedLines filters on sim_run_id)
    expect(useOwnerBoardStore.getState().marked.size).toBe(0);

    act(() => useTwinStore.setState({ activeSimRunId: null }));
    rerender();
    const calls = rpc.mock.calls.length;
    await advance(OWNER_BOARD_POLL_MS * 3);
    expect(rpc.mock.calls.length).toBe(calls);
    expect(useOwnerBoardStore.getState().status).toBe("idle");
  });
});
