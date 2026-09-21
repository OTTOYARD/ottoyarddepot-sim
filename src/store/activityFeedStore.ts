// activityFeedStore — the OTTO-Q decision STREAM.
//
// This used to be a snapshot: every 4-second poll called setRows() and replaced
// the array wholesale. That is wrong for the thing it is rendering. The feed is
// a stream of decisions arriving over time, and replacing it every poll has
// three consequences a viewer actually feels:
//
//   1. Nothing is ever "new". Re-rendering 200 identical rows gives the eye no
//      signal that OTTO-Q just decided something, which is the entire point of
//      watching it.
//   2. Scrollback is fragile. React reconciles a whole new array, so a viewer
//      reading something four minutes old can have the ground move under them.
//   3. Anything that ages past the RPC's 200-row limit vanishes silently, even
//      though the viewer was looking at it.
//
// So rows ACCUMULATE here, newest first, deduped on a stable identity, capped
// at STREAM_CAP. Merging is idempotent: re-merging the same page is a no-op, so
// a poll that returns an unchanged page changes nothing and re-renders nothing.
//
// Chase, 2026-09-21: "I want more of a real time feed of OTTO-Q solvers almost
// like a live stream of comments and decisions that are coming through and
// being proposed or enacted. If I pause the depot or the simulation at any
// given point that should also pause the intelligence live stream ... so that I
// can toggle over to it and scroll through recent decisions or proposals."
//
// The freeze half lives in useActivityFeed (it stops polling while the sim is
// paused). What lives HERE is the guarantee that freezing loses nothing: the
// accumulated rows are retained across a pause, so the scrollback he wants to
// read is still there when he toggles over to it.
import { create } from "zustand";

export interface ActivityFeedRow {
  occurred_at: string;
  vehicle_id: string;
  display_name: string;
  action: string;
  engine: string;
  target: string;
  outcome: string;
  rationale: Record<string, unknown> | null;
  reason: string | null;
}

/** Newest-first cap. 200 is one RPC page; 600 keeps roughly three pages of
 *  scrollback so a paused viewer can read past what the last poll returned. */
export const STREAM_CAP = 600;

/**
 * Stable identity for a feed row.
 *
 * ottoq_activity_feed returns no id column, so identity has to be composed. The
 * tuple below is the one the engine can actually keep distinct: one vehicle
 * cannot have two decisions of the same action against the same target at the
 * same instant. occurred_at alone is NOT enough — a single tick decides many
 * vehicles and they share a timestamp, so keying on it would collapse a whole
 * tick into one row.
 */
export function rowKey(r: ActivityFeedRow): string {
  return `${r.occurred_at}|${r.vehicle_id}|${r.action}|${r.target ?? ""}`;
}

interface State {
  rows: ActivityFeedRow[];
  /** Keys that arrived on the most recent merge — lets the view mark them new
   *  without diffing the whole list in render. Empty after a no-op merge. */
  arrivedKeys: string[];
  /** True while the sim is paused: the stream is frozen and still scrollable. */
  frozen: boolean;
  error: string | null;
  /** Merge a poll page into the stream. Idempotent. */
  mergeRows: (rows: ActivityFeedRow[]) => void;
  /** Replace the stream outright. Used when the run changes or clears — a new
   *  run's decisions must never be appended to the previous run's. */
  setRows: (rows: ActivityFeedRow[]) => void;
  setFrozen: (frozen: boolean) => void;
  setError: (err: string | null) => void;
}

export const useActivityFeedStore = create<State>((set) => ({
  rows: [],
  arrivedKeys: [],
  frozen: false,
  error: null,

  mergeRows: (incoming) =>
    set((state) => {
      if (!incoming?.length) return { arrivedKeys: [], error: null };

      const seen = new Set(state.rows.map(rowKey));
      const fresh = incoming.filter((r) => !seen.has(rowKey(r)));
      if (!fresh.length) {
        // Nothing new. Return the SAME rows reference so subscribers do not
        // re-render, and clear arrivedKeys so a stale highlight does not stick.
        return { arrivedKeys: [], error: null };
      }

      // Newest first. The RPC already orders by occurred_at desc, but it is
      // sorted again here rather than trusted: a merge mixes two pages, and a
      // stream that renders out of order is worse than one that renders late.
      const merged = [...fresh, ...state.rows]
        .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : 0))
        .slice(0, STREAM_CAP);

      return { rows: merged, arrivedKeys: fresh.map(rowKey), error: null };
    }),

  setRows: (rows) => set({ rows, arrivedKeys: [], error: null }),
  setFrozen: (frozen) => set({ frozen }),
  setError: (error) => set({ error }),
}));
