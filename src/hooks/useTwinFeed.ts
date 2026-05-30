// ============================================================================
// useTwinFeed — loads the static depot layout once, then polls the live
// snapshot frame every POLL_MS. Server-authoritative state; the renderer
// interpolates between frames (Phase 2). Sets connected=false on error.
// ============================================================================
import { useEffect } from "react";
import { twin, NASHVILLE_DEPOT } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";

const POLL_MS = 1500;

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
