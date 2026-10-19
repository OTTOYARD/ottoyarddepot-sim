// readFeed: the car's feed is a list of rows or an error, never a reply the card would spread in render (a fixture
// playback's { error } did exactly that, and the 3D view fell with it).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/ottoQClient", () => ({ ottoQ: { rpc } }));

import { readFeed } from "./useDecisionTrail";

beforeEach(() => { rpc.mockReset(); });

describe("readFeed", () => {
  it("answers the feed's rows", async () => {
    const rows = [{ occurred_at: "2026-10-19T19:00:00+00:00", action: "stall_assignment" }];
    rpc.mockResolvedValueOnce({ data: rows, error: null });
    await expect(readFeed({ p_sim_run_id: "r" })).resolves.toEqual(rows);
    expect(rpc).toHaveBeenCalledWith("ottoq_activity_feed_v2", { p_sim_run_id: "r" });
  });

  it("answers no rows for an empty reply", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(readFeed({ p_sim_run_id: "r" })).resolves.toEqual([]);
  });

  it("falls back to the plain feed on a backend without 0536", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not found" } });
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(readFeed({ p_sim_run_id: "r" })).resolves.toEqual([]);
    expect(rpc).toHaveBeenLastCalledWith("ottoq_activity_feed", { p_sim_run_id: "r" });
  });

  it("refuses a reply that is not a list, so its caller shows an error instead of drawing it", async () => {
    rpc.mockResolvedValueOnce({ data: { error: "fixture playback" }, error: null });
    await expect(readFeed({ p_sim_run_id: "r" })).rejects.toThrow("The activity feed did not answer with a list of rows.");
  });
});
