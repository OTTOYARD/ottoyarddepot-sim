// ============================================================================
// RunBootSplash — the DRAW PHASE loading screen.
//
// Every run opens with a Monte Carlo boot draw (ottoq_run_boot_draw): 116
// per-vehicle condition cards + ~20 world variables, recorded in
// ottoq_sim_runs.payload->boot_draw. When the twin adopts a run this splash
// shows THAT hand — the world OTTO-Q is about to orchestrate — for a few
// seconds while the first snapshots stream in, then fades out.
//
// Honesty rules: renders ONLY values present in the boot manifest (RPC
// ottoq_twin_boot_manifest); if a run has no boot_draw (pre-draw-phase runs)
// it dismisses immediately. Purely additive — no store writes, no engine work.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { OTTOQ_SUPABASE_URL, OTTOQ_ANON_KEY } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";

const MIN_HAND_MS = 4500;    // the drawn hand stays readable at least this long
const MAX_SHOW_MS = 9000;    // never block the map longer than this
const NO_DRAW_SKIP_MS = 900; // old runs without a boot draw: get out of the way

interface CondStat { min: number; avg: number; max: number }
interface BootManifest {
  sim_run_id: string;
  scenario: string | null;
  status: string | null;
  random_seed: number | string | null;
  boot_draw: {
    ok?: boolean;
    seed?: number | string;
    draw_ms?: number;
    vehicles_drawn?: number;
    world_day0?: Record<string, number | null>;
    fleet_condition?: Record<string, CondStat>;
  } | null;
}

const COND_LABELS: Record<string, { label: string; unit: string }> = {
  veh_battery_soh_pct:      { label: "Battery health",    unit: "%" },
  veh_consumption_scalar:   { label: "Energy burn",       unit: "×" },
  veh_charge_curve_scalar:  { label: "Charge speed",      unit: "×" },
  veh_soil_rate:            { label: "Soiling rate",      unit: "×" },
  veh_pm_interval_km:       { label: "Maintenance due",   unit: "km" },
  veh_calib_interval_h:     { label: "Calibration due",   unit: "h" },
  veh_service_speed_scalar: { label: "Service duration",  unit: "×" },
  veh_wash_cadence_cycles:  { label: "Wash cadence",      unit: "cyc" },
};

const WORLD_CHIPS: Array<{ key: string; label: string; unit: string; digits: number }> = [
  { key: "ambient_temp_c",  label: "Temp",     unit: "°C",    digits: 1 },
  { key: "precip_mm",       label: "Precip",   unit: "mm",    digits: 1 },
  { key: "grid_demand_mw",  label: "Grid",     unit: "MW",    digits: 0 },
  { key: "lmp_usd_mwh",     label: "Energy $", unit: "$/MWh", digits: 0 },
  { key: "cloud_cover_pct", label: "Cloud",    unit: "",      digits: 2 },
  { key: "staffing_level",  label: "Staffing", unit: "",      digits: 2 },
];

export function RunBootSplash() {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const connected = useTwinStore((s) => s.connected);
  const [manifest, setManifest] = useState<BootManifest | null>(null);
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef(0);
  const handAtRef = useRef(0); // when the drawn hand became visible
  const runRef = useRef<string | null>(null);

  // adopt-a-run → show + fetch the hand. Deliberately NO first-run guard and a
  // cancel-tolerant retry loop: React StrictMode double-mounts effects in dev,
  // and a guard + cancel pair can strand the fetch (cancelled on mount #1,
  // skipped on mount #2). The RPC is an idempotent read — fetching twice is
  // harmless; never fetching is the bug.
  useEffect(() => {
    if (!activeSimRunId) return;
    if (activeSimRunId !== runRef.current) {
      runRef.current = activeSimRunId;
      shownAtRef.current = Date.now();
      handAtRef.current = 0;
      setManifest(null);
      setVisible(true);
    }
    let cancelled = false;
    let attempts = 0;
    const fetchManifest = async () => {
      attempts += 1;
      try {
        // (verified: 200 + boot_draw.ok on live runs; keep this path plain-fetch)
        // plain fetch, deliberately NOT supabase-js: its request pipeline can
        // stall pre-dispatch in dev (StrictMode + multi-client), and this is a
        // single anonymous read — no client machinery wanted on the boot path.
        const r = await fetch(`${OTTOQ_SUPABASE_URL}/rest/v1/rpc/ottoq_twin_boot_manifest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: OTTOQ_ANON_KEY,
            Authorization: `Bearer ${OTTOQ_ANON_KEY}`,
          },
          body: JSON.stringify({ p_sim_run_id: activeSimRunId }),
        });
        const data = r.ok ? await r.json() : null;
        if (cancelled) return;
        const m = data as BootManifest | null;
        if (m?.boot_draw?.ok) {
          if (!handAtRef.current) handAtRef.current = Date.now();
          setManifest(m);
        }
        // boot draw can land a beat after the run row appears — retry briefly
        else if (attempts < 5) setTimeout(fetchManifest, 700);
        else setManifest(m ?? null);
      } catch {
        if (!cancelled && attempts < 5) setTimeout(fetchManifest, 700);
      }
    };
    fetchManifest();
    return () => { cancelled = true; };
  }, [activeSimRunId]);

  // dismissal clock: min-show elapsed + feed connected, hard cap, fast-skip
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => {
      const elapsed = Date.now() - shownAtRef.current;
      const hasDraw = !!manifest?.boot_draw?.ok;
      const handShownFor = handAtRef.current ? Date.now() - handAtRef.current : 0;
      if (elapsed > MAX_SHOW_MS) setVisible(false);
      else if (!hasDraw && manifest !== null && elapsed > NO_DRAW_SKIP_MS) setVisible(false);
      // dismiss only once the DRAWN HAND has been readable, not just the shell
      else if (hasDraw && connected && handShownFor > MIN_HAND_MS) setVisible(false);
    }, 200);
    return () => clearInterval(t);
  }, [visible, manifest, connected]);

  if (!visible || !activeSimRunId) return null;
  const draw = manifest?.boot_draw;
  const cond = draw?.fleet_condition ?? {};
  const world = draw?.world_day0 ?? {};

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-canvas-base/95 backdrop-blur-sm">
      <div className="w-[560px] max-w-[92%] rounded-lg border border-white/10 bg-black/60 p-6 font-mono text-white shadow-2xl">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[11px] tracking-[0.25em] text-white/50">OTTO-TWIN · MONTE CARLO BOOT</div>
            <div className="mt-1 text-lg font-bold tracking-wide" style={{ color: "#C8102E" }}>
              DRAWING WORLD
            </div>
          </div>
          <div className="text-right text-[11px] leading-5 text-white/60">
            {manifest?.scenario && <div>{manifest.scenario}</div>}
            {draw?.seed != null && <div>seed {draw.seed}</div>}
          </div>
        </div>

        {!draw?.ok ? (
          <div className="mt-6 text-xs text-white/50">attaching to run…</div>
        ) : (
          <>
            <div className="mt-4 flex gap-6 text-xs text-white/80">
              <span>
                <span className="text-white/40">fleet drawn </span>
                {draw.vehicles_drawn ?? "—"} vehicles
              </span>
              <span>
                <span className="text-white/40">draw time </span>
                {draw.draw_ms != null ? `${draw.draw_ms} ms` : "—"}
              </span>
            </div>

            {/* per-vehicle condition hand */}
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
              {Object.entries(COND_LABELS).map(([key, meta]) => {
                const s = cond[key];
                if (!s) return null;
                return (
                  <div key={key} className="flex items-baseline justify-between text-[11px]">
                    <span className="text-white/50">{meta.label}</span>
                    <span className="tabular-nums text-white/90">
                      {s.min}–{s.max}
                      <span className="text-white/40"> {meta.unit}</span>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* world day-0 chips */}
            <div className="mt-4 flex flex-wrap gap-2">
              {WORLD_CHIPS.map(({ key, label, unit, digits }) => {
                const v = world[key];
                if (v == null || Number.isNaN(Number(v))) return null;
                return (
                  <span key={key}
                        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/70">
                    {label} <span className="text-white/95">{Number(v).toFixed(digits)}</span>
                    {unit && <span className="text-white/40"> {unit}</span>}
                  </span>
                );
              })}
            </div>

            <div className="mt-5 h-1 w-full overflow-hidden rounded bg-white/10">
              <div className="h-full w-1/3 animate-[bootsweep_1.4s_ease-in-out_infinite] rounded"
                   style={{ background: "#C8102E" }} />
            </div>
            <style>{`@keyframes bootsweep { 0% { margin-left: -33%; } 100% { margin-left: 100%; } }`}</style>
          </>
        )}
      </div>
    </div>
  );
}
