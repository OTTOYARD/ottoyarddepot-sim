// ============================================================================
// worldStore — the OTTO-Q-facing view of the world.
//
// twinStore holds the RAW twin frame (what the renderer draws). This store
// holds the PACKED frame (what the orchestrator consumes) plus the boot record
// that says whether the world was ever fully loaded in the first place.
//
// Kept separate from twinStore on purpose: the renderer must keep drawing a
// degraded world (that is the point of a twin), while OTTO-Q must be able to
// refuse to orchestrate one. Same frame, two different tolerances.
// ============================================================================
import { create } from "zustand";
import type { ChannelBundle } from "@/lib/ottoq/contracts";
import type { CoverageReport } from "@/lib/ottoq/coverage";
import type { WorldBootReport } from "@/lib/ottoq/worldBoot";

export type WorldPhase =
  /** no run adopted */
  | "idle"
  /** bootWorld() in flight */
  | "loading"
  /** boot finished, every required stage + channel green */
  | "ready"
  /** boot finished with at least one required blocker */
  | "incomplete"
  /** boot threw before producing a report */
  | "failed";

interface WorldState {
  phase: WorldPhase;
  /** the boot record for the CURRENT run — attach to the Black Box bundle */
  boot: WorldBootReport | null;
  /** most recent packed frame */
  bundle: ChannelBundle | null;
  /** coverage recomputed on the latest frame (boot coverage is the tick-0 one) */
  coverage: CoverageReport | null;
  /** monotonic count of frames packed this run — a real liveness signal */
  framesPacked: number;
  /**
   * Catalog var_keys captured at boot. Per-frame coverage is recomputed every
   * 1.5s and used to OVERWRITE the boot report's coverage — which meant the
   * drift fields (the only signal that the backend registry and our bindings
   * have diverged) were computed once and then thrown away, and rendered
   * nowhere. Cached here so every frame can still check drift.
   */
  catalogKeys: string[] | null;
  /** last error from a boot attempt */
  error: string | null;

  beginBoot: () => void;
  completeBoot: (boot: WorldBootReport, bundle: ChannelBundle | null, catalogKeys: string[] | null) => void;
  failBoot: (error: string) => void;
  publishFrame: (bundle: ChannelBundle, coverage: CoverageReport | null) => void;
  reset: () => void;
}

const EMPTY = {
  phase: "idle" as WorldPhase,
  boot: null,
  bundle: null,
  coverage: null,
  framesPacked: 0,
  catalogKeys: null,
  error: null,
};

export const useWorldStore = create<WorldState>((set) => ({
  ...EMPTY,

  beginBoot: () => set({ ...EMPTY, phase: "loading" }),

  completeBoot: (boot, bundle, catalogKeys) =>
    set({
      catalogKeys,
      phase: boot.ready ? "ready" : "incomplete",
      boot,
      bundle,
      coverage: boot.coverage,
      framesPacked: bundle ? 1 : 0,
      error: null,
    }),

  failBoot: (error) => set({ ...EMPTY, phase: "failed", error }),

  // Frames arrive on every poll. They update the packed view but never change
  // `phase`: a channel that drops out mid-run is visible in bundle.status, and
  // re-grading the whole boot on one bad frame would make the gate flap.
  publishFrame: (bundle, coverage) =>
    set((s) => ({
      bundle,
      coverage: coverage ?? s.coverage,
      framesPacked: s.framesPacked + 1,
    })),

  reset: () => set({ ...EMPTY }),
}));
