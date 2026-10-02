// protocol.test.ts — the live view's URL and its messages: what it accepts, from whom, and what it drops.
import { describe, expect, it } from "vitest";
import { COCKPIT_SOURCE, isTrustedOrigin, parseViewerParams, readParentMessage } from "./protocol";

const RUN = "8A1E12AE-B64B-4B6E-A82D-370F6F58315C";

describe("the view's URL", () => {
  it("defaults to following the live run from the south-east corner, turning, unframed", () => {
    expect(parseViewerParams("")).toEqual({ run: null, cam: "se", spin: true, embed: false });
  });

  it("pins a run (lower-cased), takes a known camera, and reads spin and embed", () => {
    expect(parseViewerParams(`?run=${RUN}&cam=pole&spin=0&embed=1`)).toEqual({
      run: RUN.toLowerCase(), cam: "pole", spin: false, embed: true,
    });
  });

  it("drops a malformed run and an unknown camera rather than guessing", () => {
    expect(parseViewerParams("?run=not-a-run&cam=drone")).toMatchObject({ run: null, cam: "se" });
    expect(parseViewerParams("?run=8a1e12ae-b64b-4b6e-a82d-370f6f58315").run).toBeNull();
  });
});

describe("who may steer the view", () => {
  it("trusts the cockpits and the twin as published, their Lovable previews, and a developer's machine", () => {
    for (const o of [
      "https://ottoyard-orchestra-av.lovable.app",
      "https://ottoyard-otto-pulse.lovable.app",
      "https://ottoyarddepot-sim.lovable.app",
      "https://id-preview--1f2e3d4c.lovable.app",
      "https://5a6b7c8d.lovableproject.com",
      "http://localhost:8080",
      "http://127.0.0.1:5173",
    ]) expect(isTrustedOrigin(o), o).toBe(true);
  });

  it("trusts nothing else: other hosts, look-alikes, plain http off this machine, and junk", () => {
    for (const o of [
      "https://evil.example.com",
      "https://lovable.app.evil.com",
      "https://notlovable.app",
      "http://ottoyard-otto-pulse.lovable.app",
      "http://192.168.1.4:8080",
      "null",
      "",
    ]) expect(isTrustedOrigin(o), o).toBe(false);
  });

  it("trusts an origin named in the deployment's own list", () => {
    expect(isTrustedOrigin("https://pulse.ottoyard.com", ["https://pulse.ottoyard.com"])).toBe(true);
    expect(isTrustedOrigin("https://pulse.ottoyard.com")).toBe(false);
  });
});

describe("messages from the frame", () => {
  it("reads the three commands exactly as the contract states them", () => {
    expect(readParentMessage({ source: COCKPIT_SOURCE, type: "visibility", visible: false }))
      .toEqual({ source: COCKPIT_SOURCE, type: "visibility", visible: false });
    expect(readParentMessage({ source: COCKPIT_SOURCE, type: "run", runId: RUN }))
      .toEqual({ source: COCKPIT_SOURCE, type: "run", runId: RUN.toLowerCase() });
    expect(readParentMessage({ source: COCKPIT_SOURCE, type: "run", runId: null }))
      .toEqual({ source: COCKPIT_SOURCE, type: "run", runId: null });
    expect(readParentMessage({ source: COCKPIT_SOURCE, type: "camera", cam: "top" }))
      .toEqual({ source: COCKPIT_SOURCE, type: "camera", cam: "top" });
  });

  it("drops anything else: another sender, a bad field, an unknown command", () => {
    for (const m of [
      null, "visible", 42,
      { source: "someone-else", type: "visibility", visible: false },
      { source: COCKPIT_SOURCE, type: "visibility", visible: "no" },
      { source: COCKPIT_SOURCE, type: "run", runId: "abc" },
      { source: COCKPIT_SOURCE, type: "camera", cam: "drone" },
      { source: COCKPIT_SOURCE, type: "start_run" },
    ]) expect(readParentMessage(m)).toBeNull();
  });
});
