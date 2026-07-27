// ============================================================================
// orchestrationStore — the decision trace.
//
// Holds what OTTO-Q decided each tick, what it chose NOT to do and why, and
// what the twin said back. This is the record an operator reads during a demo
// and the record an OEM asks for afterwards, so it keeps suppressions and
// rejections as first-class content rather than as error handling.
//
// Bounded on purpose: a long run would otherwise accumulate every batch in
// memory. The full history belongs in the Black Box bundle, not here.
// ============================================================================
import { create } from "zustand";
import type { CommandBatch } from "@/lib/ottoq/commands";
import type { AdvisorRun } from "@/lib/ottoq/pipeline";
import type { LedgerStats, TransmitResult } from "@/lib/ottoq/commandBus";
import type { EnergyControllerState } from "@/lib/ottoq/energyController";

export interface OrchestrationPass {
  tick: number;
  batch: CommandBatch;
  advisorRuns: AdvisorRun[];
  trace: string[];
  transmit: TransmitResult;
  /** commands that timed out at the start of this pass */
  expired: number;
  ledger: LedgerStats;
  /** what the site energy controller is actually delivering this frame */
  energy: EnergyControllerState;
}

const HISTORY_LIMIT = 60;

interface OrchestrationState {
  passes: OrchestrationPass[];
  latest: OrchestrationPass | null;
  /** cumulative counters for the run */
  totals: { issued: number; accepted: number; rejected: number; suppressed: number; expired: number };
  lastError: string | null;

  recordPass: (pass: OrchestrationPass) => void;
  recordError: (message: string) => void;
  reset: () => void;
}

const EMPTY = {
  passes: [] as OrchestrationPass[],
  latest: null as OrchestrationPass | null,
  totals: { issued: 0, accepted: 0, rejected: 0, suppressed: 0, expired: 0 },
  lastError: null as string | null,
};

export const useOrchestrationStore = create<OrchestrationState>((set) => ({
  ...EMPTY,

  recordPass: (pass) =>
    set((s) => ({
      passes: [...s.passes.slice(-(HISTORY_LIMIT - 1)), pass],
      latest: pass,
      totals: {
        issued: s.totals.issued + pass.transmit.sent,
        accepted: s.totals.accepted + pass.transmit.accepted,
        rejected: s.totals.rejected + pass.transmit.rejected,
        suppressed: s.totals.suppressed + pass.batch.suppressed.length,
        expired: s.totals.expired + pass.expired,
      },
      lastError: null,
    })),

  recordError: (lastError) => set({ lastError }),

  reset: () => set({ ...EMPTY, passes: [] }),
}));
