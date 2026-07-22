// ============================================================================
// useTwinFeed — loads the static depot layout once, then polls the live
// snapshot frame every POLL_MS. Server-authoritative state; the renderer
// interpolates between frames (Phase 2). Sets connected=false on error.
// ============================================================================
import { useEffect } from "react";
import { twin, NASHVILLE_DEPOT } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";

const POLL_MS = 1500;
const DISCOVER_MS = 4000;
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

  // Poll snapshot while a run is active
  useEffect(() => {
    if (!activeSimRunId) {
      setConnected(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const snap = await twin.snapshot(activeSimRunId);
        if (cancelled) return;
        if (snap.error) {
          setConnected(false);
        } else {
          setSnapshot(snap);
          setConnected(true);
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
