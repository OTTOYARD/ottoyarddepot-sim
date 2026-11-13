import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// LET THE WORKER BREATHE BETWEEN TESTS. A test file whose tests are long, synchronous computations (the per-vehicle
// robot proofs run 60 to 120 s a file) never returns to the event loop: the runner only awaits microtasks between
// synchronous tests, so the worker cannot read the main process's replies, and after 60 s vitest reports
// "Timeout calling onTaskUpdate" and fails a run in which every test passed (CI and local, 2026-11-13). One turn of
// the event loop after each test is enough. The real setImmediate is taken here, before any test installs fake timers.
const realSetImmediate = globalThis.setImmediate;
afterEach(() => new Promise<void>((resolve) => { realSetImmediate(resolve); }));
