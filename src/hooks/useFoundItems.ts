// useFoundItems — the items the cleaning arms found in cabins this run, read from the twin and handed to the renderer.
//
// The engine decides and records each one (otto-q-core 0814: public.ottoq_cabin_found_items_feed). This hook reads the
// feed while a run is on screen and gives it to the motion driver, which holds the arm still for as long as the twin
// says an attendant has not secured the item. It writes nothing. An attendant confirms in OTTO-PULSE, not here.
//
// A database without 0814 answers "function not found": the list stays empty and nothing stops, as before.
import { useEffect } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { useTwinStore } from "@/store/twinStore";
import { twinMotionDriver } from "@/engine/TwinMotionDriver";
import type { FoundItemsFeed } from "@/lib/ottoCleanArm/foundItems";

/** A stop lasts 60 to 90 sim seconds, 8 to 11 real seconds at 8x: the poll must be shorter than that. */
const POLL_MS = 2500;

export function useFoundItems() {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  useEffect(() => {
    if (!activeSimRunId) { twinMotionDriver.setFoundItems([]); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { data, error } = await ottoQ.rpc("ottoq_cabin_found_items_feed", { p_sim_run_id: activeSimRunId, p_limit: 100 });
        if (!cancelled && !error && data) twinMotionDriver.setFoundItems((data as FoundItemsFeed).items ?? []);
      } catch { /* the feed is not there or did not answer: keep what we have */ }
      finally { if (!cancelled) timer = setTimeout(poll, POLL_MS); }
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); twinMotionDriver.setFoundItems([]); };
  }, [activeSimRunId]);
}
