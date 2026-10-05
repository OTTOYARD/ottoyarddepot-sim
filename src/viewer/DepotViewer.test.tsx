// DepotViewer.test.tsx — the live view page: what it says, which camera it asks the scene for, and whom it listens to.
// The 3D scene is stubbed (jsdom has no WebGL); the stub records what the page asks of it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ViewState } from "./protocol";
import type { SceneViewer } from "@/components/canvas/DepotScene3D";

const S: { state: ViewState; scene: SceneViewer | null; pins: (string | null)[] } = { state: { kind: "no_run" }, scene: null, pins: [] };
vi.mock("./useViewerFeed", () => ({
  useViewerFeed: (pin: string | null) => { S.pins.push(pin); return S.state; },
}));
vi.mock("@/hooks/useTwinSceneBridge", () => ({ useTwinSceneBridge: () => undefined }));
vi.mock("@/components/canvas/DepotScene3D", () => ({
  default: ({ viewer }: { viewer: SceneViewer }) => { S.scene = viewer; return <div data-testid="scene" />; },
}));

const { default: DepotViewer } = await import("./DepotViewer");
const { stateWords } = await import("./viewWords");
const { VIEWER_CAMS } = await import("./viewerCams");

const RUN = "8a1e12ae-b64b-4b6e-a82d-370f6f58315c";
let parentPost: ReturnType<typeof vi.fn>;
const realParent = window.parent, realTop = window.top;

function frameWith(search: string) {
  window.history.replaceState(null, "", `/view.html${search}`);
  parentPost = vi.fn();
  const fake = { postMessage: parentPost } as unknown as Window;
  Object.defineProperty(window, "parent", { configurable: true, value: fake });
  Object.defineProperty(window, "top", { configurable: true, value: fake });
  return fake;
}

beforeEach(() => {
  S.state = { kind: "no_run" }; S.scene = null; S.pins = [];
  // jsdom draws no WebGL: say it can, so the page mounts the (stubbed) scene
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ getExtension: () => null }) as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, "parent", { configurable: true, value: realParent });
  Object.defineProperty(window, "top", { configurable: true, value: realTop });
  window.history.replaceState(null, "", "/");
});

describe("the live view's words", () => {
  it("says what it shows in every state", () => {
    expect(stateWords({ kind: "no_run" }).text).toBe("No run is active · the depot is empty until a run starts");
    expect(stateWords({ kind: "live", runId: RUN, status: "running", simClock: "2026-10-02T19:05:00Z", cars: 41 }).text)
      .toBe("Live · run 8a1e12ae · sim 2:05 PM CT · 41 cars on site");
    expect(stateWords({ kind: "live", runId: RUN, status: "paused", simClock: null, cars: 1 }))
      .toEqual({ tone: "warn", text: "Paused · run 8a1e12ae · 1 car on site" });
    expect(stateWords({ kind: "ended", runId: RUN, status: "completed" }).text).toBe("Run 8a1e12ae ended: completed · the twin cleared the depot");
    expect(stateWords({ kind: "other_depot", runId: RUN }).text).toBe("Run 8a1e12ae is not a twin-depot run");
  });
});

describe("the live view page", () => {
  it("opens on the camera the URL asks for, and moves to another when one is tapped", async () => {
    window.history.replaceState(null, "", "/view.html?cam=ne&spin=0");
    render(<DepotViewer />);
    await screen.findByTestId("scene");
    expect(S.scene!.framing).toMatchObject({ position: VIEWER_CAMS.ne.position, kind: "orbit", n: 1 });
    expect(S.scene!.spin).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Pole" }));
    expect(S.scene!.framing).toMatchObject({ position: VIEWER_CAMS.pole.position, kind: "pole", n: 2 });
    // the same camera again frames again (a new shot after the viewer moved the view)
    fireEvent.click(screen.getByRole("button", { name: "Pole" }));
    expect(S.scene!.framing!.n).toBe(3);
  });

  it("stops spinning the moment someone takes hold of the view", async () => {
    window.history.replaceState(null, "", "/view.html");
    render(<DepotViewer />);
    await screen.findByTestId("scene");
    expect(S.scene!.spin).toBe(true);
    act(() => S.scene!.onInteract!());
    expect(S.scene!.spin).toBe(false);
  });

  it("links back to the twin on the run it shows, unless a cockpit frames it", async () => {
    S.state = { kind: "live", runId: RUN, status: "running", simClock: null, cars: 3 };
    window.history.replaceState(null, "", "/view.html");
    render(<DepotViewer />);
    await screen.findByTestId("scene");
    expect(screen.getByRole("link", { name: /OTTO-TWIN/ }).getAttribute("href")).toBe(`${window.location.origin}/?run=${RUN}`);
    cleanup();
    frameWith("?embed=1");
    render(<DepotViewer />);
    await screen.findByTestId("scene");
    expect(screen.queryByRole("link", { name: /OTTO-TWIN/ })).toBeNull();
  });

  it("tells its frame it is ready and what it shows", async () => {
    frameWith(`?run=${RUN}&embed=1`);
    S.state = { kind: "live", runId: RUN, status: "running", simClock: null, cars: 3 };
    render(<DepotViewer />);
    await screen.findByTestId("scene");
    const sent = parentPost.mock.calls.map((c) => c[0]);
    expect(sent).toContainEqual({ source: "otto-twin-view", type: "ready" });
    expect(sent).toContainEqual({ source: "otto-twin-view", type: "state", state: S.state });
    expect(S.pins[0]).toBe(RUN);
  });

  it("takes commands from a trusted frame: stop drawing, another camera, another run", async () => {
    const parent = frameWith(`?run=${RUN}&embed=1`);
    render(<DepotViewer />);
    await screen.findByTestId("scene");
    const send = (data: unknown, origin = "https://ottoyard-otto-pulse.lovable.app") =>
      act(() => { window.dispatchEvent(new MessageEvent("message", { data, origin, source: parent as unknown as MessageEventSource })); });
    send({ source: "otto-cockpit", type: "visibility", visible: false });
    expect(S.scene!.paused).toBe(true);
    send({ source: "otto-cockpit", type: "visibility", visible: true });
    expect(S.scene!.paused).toBe(false);
    send({ source: "otto-cockpit", type: "camera", cam: "top" });
    expect(S.scene!.framing).toMatchObject({ position: VIEWER_CAMS.top.position });
    send({ source: "otto-cockpit", type: "run", runId: null });
    expect(S.pins.at(-1)).toBeNull();
    // the next state it posts goes to the frame's own origin, now that the frame has spoken
    S.state = { kind: "ended", runId: RUN, status: "completed" };
    fireEvent.click(screen.getByRole("button", { name: "SE" }));
    expect(parentPost.mock.calls.at(-1)).toEqual([{ source: "otto-twin-view", type: "state", state: S.state }, "https://ottoyard-otto-pulse.lovable.app"]);
  });

  it("ignores commands from anywhere else, or from a window that is not its frame", async () => {
    const parent = frameWith(`?run=${RUN}&embed=1`);
    render(<DepotViewer />);
    await screen.findByTestId("scene");
    act(() => { window.dispatchEvent(new MessageEvent("message", {
      data: { source: "otto-cockpit", type: "visibility", visible: false }, origin: "https://evil.example.com", source: parent as unknown as MessageEventSource,
    })); });
    expect(S.scene!.paused).toBe(false);
    act(() => { window.dispatchEvent(new MessageEvent("message", {
      data: { source: "otto-cockpit", type: "visibility", visible: false }, origin: "https://ottoyard-otto-pulse.lovable.app", source: window as unknown as MessageEventSource,
    })); });
    expect(S.scene!.paused).toBe(false);
  });

  it("says so when the browser cannot draw 3D, and tells its frame", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    frameWith("?embed=1");
    render(<DepotViewer />);
    expect(screen.getByRole("alert").textContent).toMatch(/cannot draw the 3D depot/);
    expect(parentPost.mock.calls.map((c) => c[0])).toContainEqual({ source: "otto-twin-view", type: "webgl_unavailable" });
  });
});
