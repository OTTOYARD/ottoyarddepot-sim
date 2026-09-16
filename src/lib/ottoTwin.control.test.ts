import { beforeEach, describe, expect, it, vi } from "vitest";
import { twin } from "@/lib/ottoTwin";

describe("OTTO-Twin control transport", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("routes Sim Start through the service-role control edge", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        data: {
          ok: true,
          sim_run_id: "run-123",
          scenario: "busy_day",
          scenario_code: "busy_day",
          demo_speed_x: 1,
          real_seconds_per_tick: 6,
          runs_for_sim_days: 1,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await twin.start("busy_day", 9162028, 1, 1);

    expect(result.sim_run_id).toBe("run-123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/otto-twin-control\/scenarios\/start$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      scenario_code: "busy_day",
      seed: 9162028,
      speed_x: 1,
      days: 1,
    });
  });

  it("routes playback speed through the service-role control edge", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { speed_x: 3 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await twin.setPlayback("run-123", "live", 3);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/sim_runs\/run-123\/playback$/);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ mode: "live", speed_x: 3 });
  });
});
