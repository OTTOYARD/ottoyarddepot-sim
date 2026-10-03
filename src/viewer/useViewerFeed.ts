// ============================================================================
// useViewerFeed — the live view's reads: the run it shows, and that run's snapshot, and nothing else.
//
// The cockpit's own feed (src/hooks/useTwinFeed.ts) also pulls four run-to-date aggregates and packs the OTTO-Q
// channel bundle on every frame. A picture of the depot needs none of that, and two cockpits framing the view should
// not double what the twin itself reads, so this reads only what the motion driver draws from: the snapshot.
//
//   pinned (?run=)   that run and no other. It is checked once: a run that does not exist, or that ran at a depot other
//                    than the twin depot, is named and not drawn (CLAUDE.md rule 8: one site).
//   following        the live run at the twin depot, found the way the twin finds it (newest running/active/paused),
//                    every DISCOVER_MS. A run the view is showing live is never swapped for another; one that has
//                    ended gives way to the next live run, as in the twin.
//
// Polling slows to IDLE_MS while the view is hidden or its run has ended: nothing on screen would move. Read-only by
// construction: twin.runs, twin.runContext and twin.snapshot are reads, and this file calls nothing else.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { twin, NASHVILLE_DEPOT, type TwinSnapshot } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";
import type { ViewState } from "./protocol";

export const POLL_MS = 1500;     // the twin's own snapshot cadence
export const IDLE_MS = 15000;    // hidden, or an ended run: nothing moves
export const DISCOVER_MS = 4000; // the twin's own discovery cadence

const LIVE = new Set(["running", "active", "paused"]);
export const isLive = (status: string | null | undefined) => LIVE.has(String(status ?? "").toLowerCase());
const AWAY = new Set(["deployed", "offline", "en_route_to_depot"]);

/** The view's state, from what the reads returned. Pure, so every case is tested without a network. */
export function viewStateOf(i: {
  runId: string | null;
  check: "ok" | "not_found" | "other_depot" | "pending" | "failed";
  snapshot: TwinSnapshot | null;
  /** A snapshot read for this run has failed since its last success. */
  snapFailed: boolean;
  everConnected: boolean;
}): ViewState {
  if (!i.runId) return i.everConnected ? { kind: "no_run" } : { kind: "connecting" };
  if (i.check === "not_found") return { kind: "not_found", runId: i.runId };
  if (i.check === "other_depot") return { kind: "other_depot", runId: i.runId };
  const run = i.snapshot?.run;
  if (!run || run.sim_run_id !== i.runId) return i.snapFailed ? { kind: "offline", runId: i.runId } : { kind: "connecting" };
  if (!isLive(run.status)) return { kind: "ended", runId: i.runId, status: run.status };
  const cars = (i.snapshot?.fleet?.vehicles ?? []).filter((v) => !AWAY.has(v.state)).length;
  return { kind: "live", runId: i.runId, status: run.status, simClock: run.sim_clock ?? null, cars };
}

export function useViewerFeed(pin: string | null, visible: boolean): ViewState {
  const runId = useTwinStore((s) => s.activeSimRunId);
  const snapshot = useTwinStore((s) => s.snapshot);
  const [snapFailed, setSnapFailed] = useState(false);
  const [check, setCheck] = useState<"ok" | "not_found" | "other_depot" | "pending" | "failed">("pending");
  const [everConnected, setEverConnected] = useState(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const checked = useRef(new Map<string, "ok" | "not_found" | "other_depot">());

  // Which run: the pinned one, or the live one at the twin depot.
  useEffect(() => {
    const store = useTwinStore.getState();
    if (pin) {
      store.setActiveSimRunId(pin);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const discover = async () => {
      try {
        const { runs } = await twin.runs(10);
        if (cancelled) return;
        setEverConnected(true);
        const live = runs.find((r) => isLive(r.status));
        const cur = useTwinStore.getState().activeSimRunId;
        const curLive = runs.some((r) => r.sim_run_id === cur && isLive(r.status));
        if (live && live.sim_run_id !== cur && (!cur || !curLive)) useTwinStore.getState().setActiveSimRunId(live.sim_run_id);
      } catch { /* offline: the next pass retries */ }
      finally { if (!cancelled) timer = setTimeout(discover, visibleRef.current ? DISCOVER_MS : IDLE_MS); }
    };
    void discover();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pin]);

  // Is the run one the view may draw: does it exist, and is it at the twin depot? Asked once per run.
  useEffect(() => {
    if (!runId) { setCheck("pending"); return; }
    const known = checked.current.get(runId);
    if (known) { setCheck(known); return; }
    setCheck("pending");
    let cancelled = false;
    twin.runContext(runId).then((ctx) => {
      if (cancelled) return;
      setEverConnected(true);
      const verdict = ctx?.error ? (/not found/i.test(String(ctx.error)) ? "not_found" : null)
        : ctx?.depot_id && ctx.depot_id !== NASHVILLE_DEPOT ? "other_depot" : "ok";
      if (!verdict) { setCheck("failed"); return; }
      checked.current.set(runId, verdict);
      setCheck(verdict);
    }, () => { if (!cancelled) setCheck("failed"); });
    return () => { cancelled = true; };
  }, [runId]);

  // The run's snapshot, at the twin's cadence while it can be seen and is live.
  useEffect(() => {
    const store = useTwinStore.getState();
    if (!runId || check === "not_found" || check === "other_depot") {
      store.setSnapshot(null);
      store.setConnected(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setSnapFailed(false);
    const poll = async () => {
      let next = IDLE_MS;
      try {
        const snap = await twin.snapshot(runId);
        if (cancelled) return;
        setEverConnected(true);
        if (snap?.error) {
          useTwinStore.getState().setConnected(false);
          setSnapFailed(true);
        } else {
          setSnapFailed(false);
          useTwinStore.getState().setSnapshot(snap);
          useTwinStore.getState().setConnected(true);
          // A run paused on the twin holds still here too: the driver interpolates on its own clock otherwise.
          useTwinStore.getState().setPaused(String(snap.run?.status).toLowerCase() === "paused");
          if (isLive(snap.run?.status) && visibleRef.current) next = POLL_MS;
        }
      } catch {
        if (!cancelled) { useTwinStore.getState().setConnected(false); setSnapFailed(true); }
      } finally {
        if (!cancelled) timer = setTimeout(poll, next);
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [runId, check]);

  // Seen again after being hidden: read now rather than at the end of an idle wait.
  const [wake, setWake] = useState(0);
  useEffect(() => { if (visible) setWake((n) => n + 1); }, [visible]);
  useEffect(() => {
    if (!wake || !runId || check !== "ok") return;
    let cancelled = false;
    twin.snapshot(runId).then((snap) => {
      if (cancelled || snap?.error) return;
      useTwinStore.getState().setSnapshot(snap);
      useTwinStore.getState().setConnected(true);
    }, () => {});
    return () => { cancelled = true; };
  }, [wake]); // eslint-disable-line react-hooks/exhaustive-deps

  return viewStateOf({ runId, check, snapshot, snapFailed, everConnected });
}
