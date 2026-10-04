// ============================================================================
// ownerBoardStore — what owners' agents have set at the twin depot (otto-q-core 0608), for every view that draws it:
// the Q card's chips, the Agent tab's lines, the marker on the car in 2D and 3D, the bottom bar's agent count.
//
// Polled once for the whole cockpit (useOwnerBoard). The board is replaced only when its content changed, the set of
// marked cars only when its membership changed, and commands ACCUMULATE per run, one per command_id (mergeCommands), so
// a poll that returns the same page re-renders nothing and a command never shows twice.
// ============================================================================
import { create } from "zustand";
import {
  isBoard, markedVehicleIds, mergeCommands, sameIds,
  type DepotOwnerBoard, type OwnerBoardProblem, type OwnerBoardReply, type OwnerCommand,
} from "@/lib/ownerBoard";

export type OwnerBoardStatus = "idle" | "ok" | "refused" | OwnerBoardProblem;

interface OwnerBoardState {
  /** The run the twin showed when these reads were made. */
  runId: string | null;
  status: OwnerBoardStatus;
  message: string | null;
  board: DepotOwnerBoard | null;
  /** Cars with an owner setting in force on that run; empty when the board describes another run. */
  marked: ReadonlySet<string>;
  /** Every command read while the twin showed that run, newest sent first. */
  commands: OwnerCommand[];
  receive: (runId: string, reply: OwnerBoardReply | null) => void;
  fail: (runId: string, problem: OwnerBoardProblem, message: string) => void;
  reset: (runId: string | null) => void;
}

const NONE: ReadonlySet<string> = new Set<string>();

export const useOwnerBoardStore = create<OwnerBoardState>((set) => ({
  runId: null,
  status: "idle",
  message: null,
  board: null,
  marked: NONE,
  commands: [],

  receive: (runId, reply) =>
    set((s) => {
      if (s.runId !== runId) return {}; // an answer for a run the twin has since left
      if (!isBoard(reply)) {
        const message = (typeof reply?.message === "string" && reply.message) || (typeof reply?.error === "string" && reply.error.replace(/_/g, " ")) || null;
        return { status: "refused", message, board: null, marked: NONE, commands: [] };
      }
      const marked = markedVehicleIds(reply, runId);
      return {
        status: "ok",
        message: null,
        board: reply,
        marked: sameIds(s.marked, marked) ? s.marked : marked,
        commands: mergeCommands(s.commands, reply.commands),
      };
    }),

  // Not installed or not granted: nothing is known. Any other failure keeps what was read last, and says so.
  fail: (runId, problem, message) =>
    set((s) => {
      if (s.runId !== runId) return {};
      if (problem === "error") return { status: "error", message };
      return { status: problem, message, board: null, marked: NONE, commands: [] };
    }),

  reset: (runId) => set({ runId, status: "idle", message: null, board: null, marked: NONE, commands: [] }),
}));
