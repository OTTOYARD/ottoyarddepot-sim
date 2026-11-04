import { afterEach, describe, expect, it, vi } from "vitest";
import { NASHVILLE_DEPOT, OTTOQ_ANON_KEY, OTTOQ_SUPABASE_URL, twin } from "@/lib/ottoTwin";

// The Research tab reads otto-q-core 0793's feed the way the app reads its other anon RPCs: a POST to PostgREST with the
// anon key, nothing else. It is a read; the tab has no write path.
describe("the research feed transport", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("POSTs ottoq_research_feed for the twin depot with the anon key", async () => {
    const feed = { depot_id: NASHVILLE_DEPOT, read_at: "2026-11-03T16:24:01+00:00", findings: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => feed });
    vi.stubGlobal("fetch", fetchMock);

    await expect(twin.researchFeed()).resolves.toEqual(feed);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${OTTOQ_SUPABASE_URL}/rest/v1/rpc/ottoq_research_feed`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ p_depot: "11111111-1111-1111-1111-111111111111" });
    expect(init.headers).toMatchObject({ apikey: OTTOQ_ANON_KEY, authorization: `Bearer ${OTTOQ_ANON_KEY}` });
  });

  it("asks for another depot when given one, and fails loudly on an HTTP error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(twin.researchFeed("22222222-2222-2222-2222-222222222222")).rejects.toThrow(
      "rpc ottoq_research_feed failed: 404 not found",
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      p_depot: "22222222-2222-2222-2222-222222222222",
    });
  });
});
