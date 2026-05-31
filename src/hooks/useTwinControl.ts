// ============================================================================
// useTwinControl — client-driven Play/Pause/Step for the live twin.
// When "playing", repeatedly POSTs /tick (keyless) so the sim advances in real
// time; the snapshot poll (useTwinFeed) renders each new frame. Speed controls
// tick cadence. Pausing stops the loop. (Closing the tab pauses — fine for a
// demo the operator runs.)
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { twin } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";

export function useTwinControl() {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);          // 1–10×; higher = more frequent ticks
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const stepOnce = useCallback(async () => {
    if (!activeSimRunId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await twin.tick(activeSimRunId); }
    catch { /* surfaced via snapshot connected=false */ }
    finally { inFlight.current = false; setBusy(false); }
  }, [activeSimRunId]);

  // Play loop: cadence = clamp(2400/speed) ms, min 600ms
  useEffect(() => {
    if (!playing || !activeSimRunId) return;
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      await stepOnce();
      if (cancelled) return;
      const delay = Math.max(600, Math.round(2400 / speed));
      timer.current = setTimeout(loop, delay);
    };
    loop();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [playing, speed, activeSimRunId, stepOnce]);

  // Auto-pause if the run goes away
  useEffect(() => { if (!activeSimRunId) setPlaying(false); }, [activeSimRunId]);

  return {
    playing, speed, busy,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    toggle: () => setPlaying((p) => !p),
    step: stepOnce,
    setSpeed,
  };
}
