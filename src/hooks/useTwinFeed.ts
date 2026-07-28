// ============================================================================
// useTwinFeed — loads the static depot layout once, then polls the live
// snapshot frame every POLL_MS. Server-authoritative state; the renderer
// interpolates between frames (Phase 2). Sets connected=false on error.
// ============================================================================
import { useEffect, useRef } from "react";
import { twin, NASHVILLE_DEPOT, type TwinEventsWindow } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";
import { useWorldStore } from "@/store/worldStore";
import { packChannels } from "@/lib/ottoq/channels";
import { auditCoverage } from "@/lib/ottoq/coverage";

const POLL_MS = 1500;
const DISCOVER_MS = 4000;
// The events window is a run-to-date AGGREGATE over the whole event log, so it
// is far heavier than a snapshot and its numbers move slowly — a fault rate
// does not change between two 1.5s frames. Refresh it on its own slower clock
// and reuse the last one in between.
const EVENTS_MS = 15000;
const isLiveRunStatus = (s: string) =>
  ["running", "active", "paused"].includes(String(s).toLowerCase());

export function useTwinFeed(depotId: string = NASHVILLE_DEPOT) {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const setLayout = useTwinStore((s) => s.setLayout);
  const setSnapshot = useTwinStore((s) => s.setSnapshot);
  const setConnected = useTwinStore((s) => s.setConnected);

  // Load static layout once per depot
  useEffect(() => {
    let cancelled = false;
    twin.layout(depotId)
      .then((l) => { if (!cancelled) setLayout(l); })
      .catch((e) => { console.error("twin.layout failed", e); });
    return () => { cancelled = true; };
  }, [depotId, setLayout]);

  // Robust active-run discovery (ALWAYS-ON — the OperatorConsole auto-attach only
  // runs while the side panel is mounted, so a collapsed panel left the twin IDLE
  // even with a live run). Polls for the live run and adopts it whenever the
  // current one has gone stale (completed/superseded) or none is set — so a fresh
  // run (including one started out-of-band) attaches, a run switch never strands
  // the prior completed run's frozen frame on screen (the "dozens of parked cars"),
  // and a run the operator is actively watching LIVE is never hijacked. Adopting
  // does NOT resume the backend clock (Chase: the sim must not auto-start).
  useEffect(() => {
    const setActiveSimRunId = useTwinStore.getState().setActiveSimRunId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const discover = async () => {
      try {
        const { runs } = await twin.runs(10);
        if (cancelled) return;
        const live = runs.find((r) => isLiveRunStatus(String(r.status)));
        const cur = useTwinStore.getState().activeSimRunId;
        if (live && live.sim_run_id !== cur) {
          const curStillLive = runs.some(
            (r) => r.sim_run_id === cur && isLiveRunStatus(String(r.status)),
          );
          if (!cur || !curStillLive) setActiveSimRunId(live.sim_run_id);
        }
      } catch { /* offline / transient — retry next tick */ }
      finally { if (!cancelled) timer = setTimeout(discover, DISCOVER_MS); }
    };
    discover();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Latest events-window aggregate + when we last asked for one.
  const events = useRef<TwinEventsWindow | null>(null);
  const eventsAt = useRef(0);

  // Poll snapshot while a run is active
  useEffect(() => {
    if (!activeSimRunId) {
      setConnected(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // A new run has its own event history; carrying the previous run's rates
    // into it would attribute one world's faults to another.
    events.current = null;
    eventsAt.current = 0;

    const poll = async () => {
      try {
        // Refresh the aggregate on its own cadence, and NEVER let it break the
        // frame: on failure the last known window is reused, and if there has
        // never been one the bundle packs with null reliability blocks — which
        // the coverage audit grades dark rather than calm.
        if (Date.now() - eventsAt.current >= EVENTS_MS) {
          eventsAt.current = Date.now();
          twin.eventsWindow(activeSimRunId)
            .then((w) => { if (!w?.error) events.current = w; })
            .catch(() => { /* keep the previous window; it carries its own last_at */ });
        }
        const snap = await twin.snapshot(activeSimRunId);
        if (cancelled) return;
        if (snap.error) {
          setConnected(false);
        } else {
          setSnapshot(snap);
          setConnected(true);
          // Same frame, second consumer: pack it into the OTTO-Q channel
          // bundle. Done here rather than in a separate poll so the renderer
          // and the orchestrator can never disagree about which tick they are
          // looking at. Packing is pure and cheap; a throw must not kill the
          // render feed, so it is contained.
          try {
            const bundle = packChannels(snap, useTwinStore.getState().layout, new Date(), events.current);
            // Pass the catalog captured at boot so per-frame coverage can still
            // detect registry drift; recomputing without it silently dropped
            // that signal on every frame after the first.
            const keys = useWorldStore.getState().catalogKeys ?? undefined;
            useWorldStore.getState().publishFrame(bundle, auditCoverage(bundle, keys));
          } catch (err) {
            console.error("channel packing failed", err);
          }
        }
      } catch (e) {
        if (!cancelled) setConnected(false);
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_MS);
      }
    };

    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeSimRunId, setSnapshot, setConnected]);
}
