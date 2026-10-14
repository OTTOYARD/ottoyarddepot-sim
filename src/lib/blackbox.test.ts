// The Black Box download: the export token in a header (never the public key, never the URL), every page followed
// to the last, the token cleared on a 401, and a walk that breaks part way says INCOMPLETE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlackbox, getBlackboxToken } from "@/lib/blackbox";
import { OTTOQ_ANON_KEY } from "@/lib/ottoTwin";

const RUN = "d3938f36-6f60-4c70-8ab3-7d503185f8d0";
const TOKEN = "a".repeat(64);

type Page = { status?: number; cursor?: string | null; body?: string; name?: string };

/** A fetch Response as the edge function sends it: Content-Disposition, and X-OTTOQ-Next-Cursor unless cursor is null. */
function reply({ status = 200, cursor = "none", body = "{}", name }: Page) {
  const headers: Record<string, string> = {};
  if (name) headers["content-disposition"] = `attachment; filename="${name}"`;
  if (cursor !== null) headers["x-ottoq-next-cursor"] = cursor;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
    blob: async () => ({ size: body.length, text: async () => body }) as unknown as Blob,
  };
}

let saved: string[];

beforeEach(() => {
  localStorage.clear();
  saved = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("downloadBlackbox", () => {
  it("sends the export token and not the public key, and follows the cursor page by page until none", async () => {
    localStorage.setItem("otto_blackbox_token", TOKEN);
    const c1 = `v1.1.120.ottoq_comms_messages.${RUN}`;
    const c2 = `v1.2.0.ottoq_decisions.${RUN}`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ cursor: c1, name: "ottoq-blackbox-d3938f36-2026-10-14-15-00-00.json" }))
      .mockResolvedValueOnce(reply({ cursor: c2, name: "ottoq-blackbox-d3938f36-2026-10-14-15-00-02-p1.json" }))
      .mockResolvedValueOnce(reply({ cursor: "none", name: "ottoq-blackbox-d3938f36-2026-10-14-15-00-04-p2.json" }));
    vi.stubGlobal("fetch", fetchMock);
    const progress: number[] = [];

    const result = await downloadBlackbox(RUN, (n) => progress.push(n));

    expect(result).toEqual({ files: 3 });
    expect(progress).toEqual([1, 2, 3]);
    expect(saved).toEqual([
      "ottoq-blackbox-d3938f36-2026-10-14-15-00-00.json",
      "ottoq-blackbox-d3938f36-2026-10-14-15-00-02-p1.json",
      "ottoq-blackbox-d3938f36-2026-10-14-15-00-04-p2.json",
    ]);
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls[0]).toMatch(new RegExp(`/functions/v1/ottoq-run-blackbox\\?run=${RUN}$`));
    expect(urls[1]).toBe(`${urls[0]}&cursor=${encodeURIComponent(c1)}`);
    expect(urls[2]).toBe(`${urls[0]}&cursor=${encodeURIComponent(c2)}`);
    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(url).not.toContain(TOKEN);                                   // never in the URL (the logs keep it)
      expect(init.headers).toEqual({ "x-ottoq-export-token": TOKEN });    // and nothing else: no apikey, no Bearer
      expect(JSON.stringify(init)).not.toContain(OTTOQ_ANON_KEY);
    }
  });

  it("asks for the token once when none is kept, keeps it trimmed, and calls nothing without one", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce(`  ${TOKEN}  `).mockReturnValueOnce(null);
    const fetchMock = vi.fn().mockResolvedValue(reply({ cursor: "none" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadBlackbox(RUN)).resolves.toEqual({ files: 1 });
    expect(getBlackboxToken()).toBe(TOKEN);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ "x-ottoq-export-token": TOKEN });
    expect(saved).toEqual(["ottoq-blackbox-d3938f36.json"]);              // no Content-Disposition: the fallback name

    await downloadBlackbox(RUN);                                           // kept: not asked again
    expect(prompt).toHaveBeenCalledTimes(1);

    localStorage.clear();
    fetchMock.mockClear();
    await expect(downloadBlackbox(RUN)).rejects.toThrow("Black Box needs the export token; nothing was downloaded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears the kept token on a 401, so the next press asks again", async () => {
    localStorage.setItem("otto_blackbox_token", TOKEN);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ status: 401, body: '{"error":"unauthorized"}' })));

    const err = await downloadBlackbox(RUN).catch((e: Error) => e);

    expect(String(err)).toMatch(/Black Box token refused \(401\)\. Press again and paste the current token\./);
    expect(String(err)).not.toContain("INCOMPLETE");                       // nothing was saved, so nothing is partial
    expect(getBlackboxToken()).toBeNull();
    expect(saved).toEqual([]);
  });

  it("says INCOMPLETE, and how many files it saved, when the walk breaks part way", async () => {
    const c1 = `v1.1.40.ottoq_decisions.${RUN}`;
    const cases: [string, (f: ReturnType<typeof vi.fn>) => void, RegExp][] = [
      ["a server error", (f) => f.mockResolvedValueOnce(reply({ status: 500, body: '{"error":"meta failed"}' })),
        /Black Box download failed \(500\): \{"error":"meta failed"\}; 1 file\(s\) saved, the bundle is INCOMPLETE/],
      ["the network", (f) => f.mockRejectedValueOnce(new TypeError("Failed to fetch")),
        /Failed to fetch; 1 file\(s\) saved, the bundle is INCOMPLETE/],
      ["a 401 between pages", (f) => f.mockResolvedValueOnce(reply({ status: 401 })),
        /token refused \(401\); 1 file\(s\) saved, the bundle is INCOMPLETE/],
    ];
    for (const [what, second, expected] of cases) {
      localStorage.setItem("otto_blackbox_token", TOKEN);
      saved = [];
      const fetchMock = vi.fn().mockResolvedValueOnce(reply({ cursor: c1 }));
      second(fetchMock);
      vi.stubGlobal("fetch", fetchMock);
      const progress: number[] = [];

      const err = await downloadBlackbox(RUN, (n) => progress.push(n)).catch((e: Error) => e);

      expect(String(err), what).toMatch(expected);
      expect(saved, what).toHaveLength(1);
      expect(progress, what).toEqual([1]);
      expect(fetchMock, what).toHaveBeenCalledTimes(2);
    }
  });

  it("reads the cursor from the body when the header is not readable, and stops where the body says", async () => {
    localStorage.setItem("otto_blackbox_token", TOKEN);
    const c1 = `v1.1.7.ottoq_decisions.${RUN}`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ cursor: null, body: JSON.stringify({ export_paging: { next_cursor: c1 } }) }))
      .mockResolvedValueOnce(reply({ cursor: null, body: JSON.stringify({ export_paging: { next_cursor: null } }) }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadBlackbox(RUN)).resolves.toEqual({ files: 2 });
    expect(String(fetchMock.mock.calls[1][0])).toContain(`&cursor=${encodeURIComponent(c1)}`);
    expect(saved).toEqual(["ottoq-blackbox-d3938f36.json", "ottoq-blackbox-d3938f36-p1.json"]);

    // a body it cannot read either: the file is kept, and the walk does not claim to be whole
    fetchMock.mockReset().mockResolvedValueOnce(reply({ cursor: null, body: "not json" }));
    await expect(downloadBlackbox(RUN)).rejects.toThrow(/saved 1 file\(s\) but cannot tell whether more follow; the bundle may be INCOMPLETE/);
  });

  it("says INCOMPLETE when the header is missing and the body carries no export_paging, rather than calling it whole", async () => {
    localStorage.setItem("otto_blackbox_token", TOKEN);
    const c1 = `v1.1.7.ottoq_decisions.${RUN}`;
    const unknown: [string, string][] = [
      ["no export_paging key (an unexpected shape, or the unpaged v7)", JSON.stringify({ sim_run_id: RUN, data: {} })],
      ["export_paging without next_cursor", JSON.stringify({ export_paging: { page: 0 } })],
      ["export_paging that is not an object", JSON.stringify({ export_paging: "done" })],
      ["a next_cursor that is not a cursor", JSON.stringify({ export_paging: { next_cursor: 7 } })],
      ["a JSON body that is not an object", "null"],
    ];
    for (const [what, body] of unknown) {
      saved = [];
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ cursor: null, body })));
      await expect(downloadBlackbox(RUN), what).rejects.toThrow(
        /Black Box saved 1 file\(s\) but cannot tell whether more follow; the bundle may be INCOMPLETE/);
      expect(saved, what).toHaveLength(1);                                 // the page it got is still saved
    }
    // the same on a later page: the count says how far it got
    saved = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ cursor: c1 }))
      .mockResolvedValueOnce(reply({ cursor: "", body: JSON.stringify({ data: {} }) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadBlackbox(RUN)).rejects.toThrow(/Black Box saved 2 file\(s\) but cannot tell whether more follow/);
    expect(saved).toHaveLength(2);
  });
});
