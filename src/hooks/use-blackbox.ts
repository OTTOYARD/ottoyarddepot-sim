// ============================================================================
// use-blackbox — React state for the OTTO-Q Black Box flight recorder.
// Wraps the lifecycle in src/lib/blackbox.ts: discovers the latest operator
// run on mount, polls while recording, and exposes start / stop / download /
// startNew actions. Backend status is the source of truth for the phase.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DECKS, fetchLatestRun, phaseFor, startDemoRun, stopAndReset, downloadBlackbox,
  type BlackboxRun, type BlackboxPhase,
} from "@/lib/blackbox";

const POLL_MS = 3500;
const DEFAULT_SPEED_X = 1;

export function useBlackbox() {
  const [run, setRun] = useState<BlackboxRun | null>(null);
  const [scenario, setScenario] = useState<string>(DECKS[0].code);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED_X);
  const [busy, setBusy] = useState<null | "start" | "stop" | "download">(null);
  const [downloading, setDownloading] = useState(false);
  // After Stop, force the "stopped" view until the operator starts a new run,
  // even though a completed row keeps being the "latest".
  const [newRunRequested, setNewRunRequested] = useState(false);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const latest = await fetchLatestRun();
      if (mounted.current) setRun(latest);
    } catch { /* transient read hiccup — keep last known */ }
  }, []);

  // Discover on mount.
  useEffect(() => { refresh(); }, [refresh]);

  const phase: BlackboxPhase = newRunRequested ? "idle" : phaseFor(run);

  // Poll while recording so tick_count / status stay live.
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, refresh]);

  const start = useCallback(async () => {
    setBusy("start");
    try {
      const res = await startDemoRun(scenario, speed);
      setNewRunRequested(false);
      setRun({
        sim_run_id: res.sim_run_id,
        scenario_code: res.scenario ?? scenario,
        status: "running",
        tick_count: 0,
        demo_speed_x: res.demo_speed_x ?? speed,
      });
      await refresh();
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [scenario, speed, refresh]);

  const stop = useCallback(async () => {
    if (!run) return;
    setBusy("stop");
    try {
      await stopAndReset(run.sim_run_id);
      await refresh();
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [run, refresh]);

  const download = useCallback(async () => {
    if (!run) return;
    setBusy("download");
    setDownloading(true);
    try {
      await downloadBlackbox(run.sim_run_id);
    } finally {
      if (mounted.current) { setBusy(null); setDownloading(false); }
    }
  }, [run]);

  // Return to the Idle recorder view (a completed run stays downloadable until
  // the next Start purges it).
  const startNew = useCallback(() => setNewRunRequested(true), []);

  return {
    phase, run, scenario, speed, busy, downloading, decks: DECKS,
    setScenario, setSpeed,
    start, stop, download, startNew, refresh,
  };
}
