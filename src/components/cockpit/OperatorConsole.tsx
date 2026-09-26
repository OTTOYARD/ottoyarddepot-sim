// ============================================================================
// OperatorConsole — the OTTO-TWIN cockpit control surface.
// Renders ENTIRELY from the backend variability catalog (GET /variability/catalog),
// so every wired engine variable appears as a real, adjustable control:
//   · Run control: scenario picker · Start/Stop · Play/Pause/Step + speed (keyless)
//   · Quick presets: Chaos Mode · Reset to calibrated
//   · Variability: Compact (primary vars) + per-domain Advanced expanders (all ~37)
//       - rate vars      → single × slider
//       - continuous     → simple slider; expand → shift / spread / floor / ceiling
//       - policy         → selector
//   · Injections: DR call · charger fault — only events with a real engine door
// No operator key (open on the private link). No Depot Structure tab.
// Writes shape the run's profile live via PUT /variability { knobs }.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play, Pause, Square, Zap, BatteryWarning, AlertTriangle,
  RotateCcw, ChevronRight, ChevronDown, Activity, FlaskConical, Info, Sun, Snowflake, Gauge, Loader2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { twin, DOMAIN_LABELS, type CatalogVar, type Scenario, type KnobType } from "@/lib/ottoTwin";
import { startDemoRun, stopAndReset } from "@/lib/blackbox";
import { useTwinStore } from "@/store/twinStore";
import { useSimulationStore } from "@/store/simulationStore";
import { useWorldStore } from "@/store/worldStore";
import type { CoverageVerdict } from "@/lib/ottoq/coverage";
import { useTwinControl, MAX_SPEED_X } from "@/hooks/useTwinControl";

// ── knob helpers (read/write the profile JSONB shape) ──
type Knobs = Record<string, any>;
const getRate   = (k: Knobs, key: string) => Number(k?._rates?.[key] ?? 1);
const getPolicy = (k: Knobs, key: string) => String(k?._policy?.[key] ?? "calibrated");
const getCont   = (k: Knobs, key: string, kt: KnobType, dflt: number) =>
  Number(k?.[key]?.[kt] ?? dflt);
// Chaos Mode is the __chaos__ template's signature (spread ×2.5 AND rates ×3). It used to be
// "any global spread above 1", so every busy_day run — whose own template carries spread 1.4 —
// showed Chaos ON while chaos was off.
const CHAOS_GLOBAL = { spread_mult: 2.5, rate_mult: 3 };
const isChaos   = (k: Knobs) =>
  Number(k?._global?.spread_mult ?? 1) >= CHAOS_GLOBAL.spread_mult &&
  Number(k?._global?.rate_mult ?? 1) >= CHAOS_GLOBAL.rate_mult;

function withRate(k: Knobs, key: string, v: number): Knobs {
  // _global is kept: it belongs to the scenario (busy_day's spread 1.4) or to Chaos Mode, and
  // moving one slider used to delete it silently.
  const next = JSON.parse(JSON.stringify(k ?? {}));
  next._rates = { ...(next._rates ?? {}) };
  if (v === 1) delete next._rates[key]; else next._rates[key] = v;
  return next;
}
function withPolicy(k: Knobs, key: string, v: string): Knobs {
  // _global is kept: it belongs to the scenario (busy_day's spread 1.4) or to Chaos Mode, and
  // moving one slider used to delete it silently.
  const next = JSON.parse(JSON.stringify(k ?? {}));
  next._policy = { ...(next._policy ?? {}) };
  if (v === "calibrated") delete next._policy[key]; else next._policy[key] = v;
  return next;
}
function withCont(k: Knobs, key: string, kt: KnobType, v: number, neutral: number): Knobs {
  // _global is kept: it belongs to the scenario (busy_day's spread 1.4) or to Chaos Mode, and
  // moving one slider used to delete it silently.
  const next = JSON.parse(JSON.stringify(k ?? {}));
  const cur = { ...(next[key] ?? {}) };
  if (v === neutral) delete cur[kt]; else cur[kt] = v;
  if (Object.keys(cur).length === 0) delete next[key]; else next[key] = cur;
  return next;
}

// per-knob-type slider range (catalog defines the primary; these fill the rest)
function rangeFor(v: CatalogVar, kt: KnobType): { min: number; max: number; step: number; neutral: number } {
  if (kt === "spread")  return { min: 0.5, max: 3, step: 0.1, neutral: 1 };
  if (kt === "rate")    return { min: v.min_value ?? 0, max: v.max_value ?? 5, step: v.step ?? 0.25, neutral: v.neutral_value ?? 1 };
  // shift / floor / ceiling use the catalog's defined range. Defaults (= "off"):
  // shift→neutral, floor→min (no lower clamp), ceiling→max (no upper clamp).
  const neutral = kt === "shift" ? (v.neutral_value ?? 0) : kt === "ceiling" ? (v.max_value ?? 100) : (v.min_value ?? 0);
  return { min: v.min_value ?? 0, max: v.max_value ?? 100, step: v.step ?? 1, neutral };
}
const fmt = (n: number, step: number) => (step < 1 ? n.toFixed(step < 0.1 ? 2 : 1) : String(n));
const fmtAxis = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toString() : Math.abs(n) >= 1 ? n.toFixed(0) : n.toFixed(1));
const isLiveRunStatus = (status: string) => ["running", "active", "paused"].includes(status.toLowerCase());

// inverse standard-normal CDF (Acklam) — lets us deterministically inverse-CDF
// sample a base distribution, exactly like the backend's sample_shaped().
function invNorm(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p <= 1 - pl) { const q = p - 0.5, r = q*q; return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1); }
  const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// Build a histogram of the SHAPED distribution: base Gaussian around the
// calibrated neutral, then mean + (x-mean)*spread + shift, clamped to floor/ceiling
// — mirrors the backend apply_profile(). Illustrative base spread; recomputes live.
function shapedBins(v: CatalogVar, knobs: Knobs, bins = 22, samples = 200) {
  const lo = v.min_value ?? 0, hi = v.max_value ?? 100;
  if (!(hi > lo)) return null;
  const mean = v.neutral_value ?? (lo + hi) / 2;
  const baseSigma = (hi - lo) * 0.15;
  const k = knobs?.[v.var_key] ?? {};
  const globalSpread = Number(knobs?._global?.spread_mult ?? 1);
  const shift = Number(k.shift ?? 0);
  const spread = Number(k.spread ?? 1) * globalSpread;
  const floor = k.floor != null ? Number(k.floor) : lo;
  const ceil = k.ceiling != null ? Number(k.ceiling) : hi;
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < samples; i++) {
    const p = (i + 0.5) / samples;
    let x = mean + invNorm(p) * baseSigma;
    x = mean + (x - mean) * spread + shift;     // shape
    x = Math.min(ceil, Math.max(floor, x));      // clamp
    let bi = Math.floor(((x - lo) / (hi - lo)) * bins);
    bi = Math.min(bins - 1, Math.max(0, bi));
    counts[bi]++;
  }
  const maxC = Math.max(...counts, 1);
  return { counts, maxC, lo, hi, mean };
}

// ── live "shape preview" histogram for a continuous variable ──
function ShapeHistogram({ v, knobs }: { v: CatalogVar; knobs: Knobs }) {
  const sig = JSON.stringify(knobs?.[v.var_key] ?? {}) + (knobs?._global?.spread_mult ?? 1);
  const data = useMemo(() => shapedBins(v, knobs), [v, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  const { counts, maxC, lo, hi, mean } = data;
  const W = 100, H = 30, bw = W / counts.length;
  const meanX = ((mean - lo) / (hi - lo)) * W;
  return (
    <div className="mt-1.5">
      <span className="text-[9px] text-ink-faint uppercase tracking-wide">shape preview · sampled distribution</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-8 bg-white/[0.02] rounded mt-0.5">
        {counts.map((c: number, i: number) => {
          const h = (c / maxC) * (H - 2);
          return <rect key={i} x={i * bw + 0.4} y={H - h} width={bw - 0.8} height={h} fill="#C8102E" opacity={0.3 + 0.55 * (c / maxC)} rx={0.4} />;
        })}
        <line x1={meanX} y1={0} x2={meanX} y2={H} stroke="#E7EAF0" strokeWidth={0.5} strokeDasharray="1.5 1.5" opacity={0.5} />
      </svg>
      <div className="flex justify-between text-[8px] text-ink-faint font-mono">
        <span>{fmtAxis(lo)}{v.unit ?? ""}</span>
        <span>{fmtAxis(hi)}{v.unit ?? ""}</span>
      </div>
    </div>
  );
}

// ── one slider row ──
function KnobSlider({ label, value, min, max, step, neutral, unit, onCommit }: {
  label?: string; value: number; min: number; max: number; step: number; neutral: number; unit?: string | null;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const neutralPct = ((neutral - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        {label && <span className="text-[10px] text-ink-faint uppercase tracking-wide">{label}</span>}
        <span className={`ml-auto font-mono text-[11px] cc-num ${local === neutral ? "text-ink-faint" : "text-ink"}`}>
          {local > neutral ? "+" : ""}{fmt(local, step)}{unit && <span className="text-ink-faint ml-0.5">{unit}</span>}
        </span>
      </div>
      <div className="relative">
        <Slider min={min} max={max} step={step} value={[local]}
          onValueChange={([v]) => setLocal(v)} onValueCommit={([v]) => onCommit(v)} />
        <span className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-white/25 pointer-events-none" style={{ left: `${neutralPct}%` }} />
      </div>
    </div>
  );
}

// ── one variable control (rate / continuous+expand / policy) ──
function VarControl({ v, knobs, expanded, onToggleExpand, commit, verdict }: {
  v: CatalogVar; knobs: Knobs; expanded: boolean; onToggleExpand: () => void;
  commit: (next: Knobs) => void;
  /** whether this knob's effect actually reaches OTTO-Q on the live frame */
  verdict?: CoverageVerdict;
}) {
  const dirty = useMemo(() => {
    if (!v.wired) return false;
    if (v.kind === "rate")   return getRate(knobs, v.var_key) !== 1;
    if (v.kind === "policy") return getPolicy(knobs, v.var_key) !== "calibrated";
    return !!knobs?.[v.var_key] && Object.keys(knobs[v.var_key]).length > 0;
  }, [v, knobs]);

  const header = (
    <div className="flex items-center gap-1.5">
      <span className={`text-[12px] ${v.wired ? "text-ink" : "text-ink-faint italic"}`}>{v.label}</span>
      {dirty && <span className="w-1.5 h-1.5 rounded-full bg-brand-red" />}
      <TooltipProvider><Tooltip>
        <TooltipTrigger asChild><Info size={11} className="text-ink-faint/60 hover:text-ink-dim" /></TooltipTrigger>
        <TooltipContent className="max-w-[240px] bg-canvas-elev border-white/10 text-ink text-[11px]">{v.definition}</TooltipContent>
      </Tooltip></TooltipProvider>
      {!v.wired && <span className="ml-auto text-[9px] text-ink-faint border border-white/10 rounded px-1">engine support coming</span>}
      {/*
        `wired` is a REGISTRY flag — it says the variable is registered, not
        that moving it changes anything OTTO-Q can see. These badges carry the
        measured verdict from the live frame instead, so a slider that does
        nothing says so at the point of use rather than looking operational.
      */}
      {v.wired && verdict === "unobservable" && (
        <TooltipProvider><Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto text-[9px] text-brand-red/80 border border-brand-red/30 rounded px-1 cursor-default">no effect</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[260px] bg-canvas-elev border-white/10 text-ink text-[11px]">
            Registered, but nothing on any OTTO-Q channel moves when this changes.
            Adjusting it will not alter what the orchestrator sees.
          </TooltipContent>
        </Tooltip></TooltipProvider>
      )}
      {v.wired && verdict === "dark" && (
        <TooltipProvider><Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto text-[9px] text-ink-faint border border-white/10 rounded px-1 cursor-default">unlit</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[260px] bg-canvas-elev border-white/10 text-ink text-[11px]">
            This variable has a channel field, but it has not resolved on the current
            frame — usually because the run has not produced that signal yet.
          </TooltipContent>
        </Tooltip></TooltipProvider>
      )}
    </div>
  );

  if (!v.wired) return <div className="py-1 opacity-50">{header}</div>;

  if (v.kind === "policy") {
    return (
      <div className="flex flex-col gap-1.5 py-1">
        {header}
        <Select value={getPolicy(knobs, v.var_key)} onValueChange={(val) => commit(withPolicy(knobs, v.var_key, val))}>
          <SelectTrigger className="h-7 text-xs bg-canvas-elev border-white/[0.06]"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-canvas-panel border-white/10 text-ink">
            {(v.select_options ?? ["calibrated"]).map((o) => <SelectItem key={o} value={o} className="text-xs text-ink focus:bg-white/10 focus:text-white">{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (v.kind === "rate") {
    const r = rangeFor(v, "rate");
    return (
      <div className="flex flex-col gap-1 py-1">
        {header}
        <KnobSlider value={getRate(knobs, v.var_key)} {...r} unit="×"
          onCommit={(val) => commit(withRate(knobs, v.var_key, val))} />
      </div>
    );
  }

  // continuous: simple slider (first knob type) + expand to all knob types
  const primaryKt = (v.knob_types.includes("shift") ? "shift" : v.knob_types[0]) as KnobType;
  const pr = rangeFor(v, primaryKt);
  return (
    <div className="flex flex-col gap-1 py-1">
      <div className="flex items-center justify-between">
        {header}
        <button onClick={onToggleExpand} className="text-ink-faint hover:text-ink-dim ml-1">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      </div>
      {!expanded && (
        <KnobSlider value={getCont(knobs, v.var_key, primaryKt, pr.neutral)} {...pr} unit={primaryKt === "shift" ? v.unit : ""}
          onCommit={(val) => commit(withCont(knobs, v.var_key, primaryKt, val, pr.neutral))} />
      )}
      {expanded && (
        <div className="flex flex-col gap-2 pl-2 border-l border-white/[0.06]">
          {v.knob_types.map((kt) => {
            const r = rangeFor(v, kt);
            return <KnobSlider key={kt} label={kt} value={getCont(knobs, v.var_key, kt, r.neutral)} {...r}
              unit={kt === "shift" ? v.unit : kt === "spread" ? "×" : v.unit}
              onCommit={(val) => commit(withCont(knobs, v.var_key, kt, val, r.neutral))} />;
          })}
          <ShapeHistogram v={v} knobs={knobs} />
        </div>
      )}
    </div>
  );
}

// ── collapsible section wrapper ──
const Group = ({ icon: Icon, title, children, right, defaultOpen = true }: {
  icon: React.ElementType; title: string; children: React.ReactNode; right?: React.ReactNode; defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.06]">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-canvas-elev/40 border-l-2 border-l-brand-red hover:bg-canvas-elev/70 transition-colors">
        {open ? <ChevronDown size={12} className="text-ink-dim" /> : <ChevronRight size={12} className="text-ink-dim" />}
        <Icon size={13} className="text-brand-red" />
        <span className="font-display text-[11px] uppercase tracking-[0.08em] text-ink">{title}</span>
        {right}
      </button>
      {open && <div className="px-3 py-2.5 flex flex-col gap-2">{children}</div>}
    </div>
  );
};

// Curated quick-launch scenarios (operator one-click). A chip is hidden if its deck isn't in
// the backend scenario list. busy_day leads: it is the scenario the engine is validated on.
const FEATURED: { code: string; label: string; icon: React.ElementType; tint: string }[] = [
  { code: "busy_day",                    label: "Busy Day",       icon: Gauge,          tint: "text-brand-red" },
  { code: "normal_day",                  label: "Normal Day",     icon: Activity,       tint: "text-ink-dim" },
  { code: "heat_wave",                   label: "Heat Wave",      icon: Sun,            tint: "text-brand-hot" },
  { code: "winter_storm",                label: "Winter Storm",   icon: Snowflake,      tint: "text-state-info" },
  { code: "dr_event_cascade",            label: "DR Cascade",     icon: BatteryWarning, tint: "text-state-warn" },
  { code: "charger_outage_morning_rush", label: "Charger Outage", icon: AlertTriangle,  tint: "text-state-warn" },
];

// Scenarios the backend lists that are NOT runnable twin scenarios, kept out of the picker:
//   hardware_live          — the hardware lab's live-robot run, not a simulation.
//   grid_brownout_at_peak  — its headline event never fires: the brownout was meant to come from
//                            the Brownout injection, which only ever wrote an event nothing reads.
//                            What remains is an LMP-volatility knob under a misleading title.
const HIDDEN_SCENARIOS = new Set(["hardware_live", "grid_brownout_at_peak"]);

// ── main ──
export const OperatorConsole = () => {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const setActiveSimRunId = useTwinStore((s) => s.setActiveSimRunId);
  const snapshot = useTwinStore((s) => s.snapshot);
  // The run's status and speed are adopted inside useTwinControl (it follows the snapshot, and a
  // local change wins for a few seconds), so a reload onto a running run shows Pause, not Resume.
  const ctrl = useTwinControl();

  const [catalog, setCatalog] = useState<CatalogVar[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [templates, setTemplates] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState("busy_day");
  const [knobs, setKnobs] = useState<Knobs>({});
  const [expandedVars, setExpandedVars] = useState<Set<string>>(new Set());
  const [openDomains, setOpenDomains] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const runId = activeSimRunId;

  // While a run is live the picker shows THAT run's scenario — it used to show whatever was
  // last clicked (default "Normal Day") over a busy_day run.
  const runScenario = runId ? snapshot?.run?.scenario ?? null : null;
  const shownScenario = runScenario ?? selected;
  const pickable = useMemo(() => scenarios.filter((s) => !HIDDEN_SCENARIOS.has(s.scenario_code)), [scenarios]);

  useEffect(() => { twin.catalog().then((d) => setCatalog(d.catalog)).catch(() => {}); }, []);
  useEffect(() => { twin.scenarios().then((d) => setScenarios(d.scenarios)).catch(() => {}); }, []);
  useEffect(() => {
    twin.templates().then((d) => setTemplates(new Set(d.templates.map((t) => t.name)))).catch(() => {});
  }, []);
  // Auto-attach on load: if the backend already has a live run (page reload, second screen),
  // adopt it. The controls then show that run's real scenario, speed and pause state; nothing
  // here starts a run on its own.
  useEffect(() => {
    let cancelled = false;
    twin.runs(10).then(({ runs }) => {
      if (cancelled || useTwinStore.getState().activeSimRunId) return;
      const live = runs.find((r) => isLiveRunStatus(String(r.status)));
      if (!live) return;
      setActiveSimRunId(live.sim_run_id);
      toast.success("Joined the live run", { description: live.scenario });
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // sync local knobs from the live profile whenever the run/profile changes
  useEffect(() => { if (snapshot?.variability) setKnobs(snapshot.variability as Knobs); }, [snapshot?.variability, runId]);

  const commit = useCallback(async (next: Knobs) => {
    setKnobs(next);
    if (!runId) { toast.error("Start a run first"); return; }
    try { await twin.setVariability(runId, { knobs: next }); }
    catch (e: unknown) { toast.error("Update failed", { description: e instanceof Error ? e.message : String(e) }); }
  }, [runId]);

  const startScenario = async (code: string = selected) => {
    setBusy("start");
    try {
      // ONE authoritative start path (src/lib/blackbox.ts → control edge). startDemoRun
      // adopts the new sim_run_id into the twin store, so the feed begins rendering it.
      await startDemoRun(code, 1);
      ctrl.play();      // Start also begins the clock — "press Start and watch it run"
      // Fresh runs open at 3×: watchable without touching a control. Opening at 1× read as a
      // frozen depot (run 7d8da1ca advanced 3.6 sim-minutes in 3.7 real minutes). The slider
      // goes to 8×, the backend's own playback ceiling; past it, time must JUMP, not speed up.
      ctrl.setSpeed(3);
      const title = scenarios.find((s) => s.scenario_code === code)?.title ?? code;
      toast.success(`Started ${title}`);
    } catch (e: unknown) { toast.error("Start failed", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  };
  // Quick cards only SELECT the scenario — nothing runs until Start is pressed.
  const quickLaunch = (code: string) => setSelected(code);
  // ONE authoritative stop path: ottoq_sim_stop_and_reset freezes the run, empties the depot
  // and keeps the run downloadable from the Runs tab.
  const stopRun = async () => {
    if (!runId) return;
    setBusy("stop");
    try {
      await stopAndReset(runId);
      ctrl.pause();
      useSimulationStore.getState().setActiveTab("history");
      toast.success("Run stopped — depot reset", { description: "Its Black Box is on the Runs tab." });
    } catch (e: unknown) { toast.error("Stop failed", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  };

  // The scenario's own template is its calibrated baseline (busy_day: arrivals ×2, SoC −30, spread
  // 1.4). "Reset" used to apply __default__ — a NEUTRAL profile — which silently turned a busy
  // day into a normal one while the header still said busy_day.
  const baselineTemplate = runScenario && templates.has(runScenario) ? runScenario : "__default__";
  const toggleChaos = async (on: boolean) => {
    if (!runId) { toast.error("Start a run first"); return; }
    try {
      // ON merges chaos over the scenario instead of replacing it; OFF returns to the baseline.
      if (on) await twin.setVariability(runId, { merge: { _global: CHAOS_GLOBAL } });
      else await twin.setVariability(runId, { template: baselineTemplate });
      toast.success(on ? "Chaos Mode — variance ×2.5, event rates ×3, on top of the scenario"
                       : "Chaos off — back to the scenario baseline");
    } catch (e: unknown) { toast.error("Failed", { description: e instanceof Error ? e.message : String(e) }); }
  };
  const resetBaseline = async () => {
    if (!runId) return;
    try { await twin.setVariability(runId, { template: baselineTemplate }); toast.success("Reset to the scenario baseline"); }
    catch (e: unknown) { toast.error("Reset failed", { description: e instanceof Error ? e.message : String(e) }); }
  };

  const inject = async (label: string, fn: () => Promise<unknown>,
                        describe?: (r: Record<string, unknown> | null) => string | undefined) => {
    if (!runId) { toast.error("Start a run first"); return; }
    setBusy(label);
    try {
      const r = await fn();
      const row = r && typeof r === "object" ? (r as Record<string, unknown>) : null;
      toast.success(`Injected: ${label}`, { description: describe?.(row) });
    }
    catch (e: unknown) { toast.error(`${label} failed`, { description: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  };

  const primary = catalog.filter((v) => v.is_primary);
  const byDomain = useMemo(() => {
    const m: Record<string, CatalogVar[]> = {};
    for (const v of catalog) (m[v.domain] ??= []).push(v);
    return m;
  }, [catalog]);
  const wiredCount = catalog.filter((v) => v.wired).length;

  // THE NUMBER THIS PANEL USED TO SHOW WAS `wiredCount/catalog.length` — the
  // registry counting itself, which reads 47/47 while a third of those knobs
  // moved a world OTTO-Q could not observe. Show the MEASURED coverage from the
  // live frame instead, and keep the registry count only as a secondary note.
  const coverage = useWorldStore((s) => s.coverage);
  const verdictOf = useMemo(() => {
    const m: Record<string, CoverageVerdict> = {};
    for (const v of coverage?.variables ?? []) m[v.var_key] = v.verdict;
    return m;
  }, [coverage]);
  const domainCoverage = useMemo(() => {
    const m: Record<string, { observed: number; total: number }> = {};
    for (const d of coverage?.by_domain ?? []) m[d.domain] = { observed: d.observed, total: d.total };
    return m;
  }, [coverage]);

  const renderVar = (v: CatalogVar) => (
    <VarControl key={v.var_key} v={v} knobs={knobs} verdict={verdictOf[v.var_key]} expanded={expandedVars.has(v.var_key)}
      onToggleExpand={() => setExpandedVars((s) => { const n = new Set(s); if (n.has(v.var_key)) n.delete(v.var_key); else n.add(v.var_key); return n; })}
      commit={commit} />
  );

  return (
    <ScrollArea className="flex-1">
      {/* RUN CONTROL */}
      <Group icon={Activity} title="Run Control">
        {/* Featured scenarios — a click SELECTS; press Start to run it */}
        <span className="text-[10px] text-ink-faint uppercase tracking-wide">Scenario</span>
        <div className="grid grid-cols-2 gap-1.5 pb-1">
          {FEATURED.filter((f) => pickable.some((s) => s.scenario_code === f.code)).map((f) => {
            const active = shownScenario === f.code;
            return (
              <button key={f.code} onClick={() => quickLaunch(f.code)} disabled={busy === "start" || !!runId}
                className={`flex items-center gap-1.5 h-9 px-2 rounded border text-[11px] text-left transition-colors disabled:opacity-50 ${active ? "border-brand-red bg-brand-red/10 text-ink" : "border-white/[0.06] bg-canvas-elev hover:bg-white/10 text-ink-dim hover:text-ink"}`}>
                <f.icon size={13} className={f.tint} />
                <span className="truncate">{f.label}</span>
              </button>
            );
          })}
        </div>
        {/* Scenario picker — Start runs this selection. */}
        <Select value={shownScenario} onValueChange={setSelected} disabled={!!runId}>
          <SelectTrigger className="h-8 w-full text-xs bg-canvas-elev border-white/[0.06]"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-canvas-panel border-white/10 text-ink">
            {pickable.map((s) => <SelectItem key={s.scenario_code} value={s.scenario_code} className="text-xs text-ink focus:bg-white/10 focus:text-white">{s.title}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* ONE state-driven transport, no stray always-visible Play button:
              · no run  → Start simulation
              · running → Pause + Stop
              · paused  → Resume + Stop
            Start uses an explicit no-arg call — onClick otherwise passes the
            click EVENT as `code` and silently broke Start. */}
        {!runId ? (
          <Button onClick={() => startScenario()} disabled={busy === "start"}
            className="h-9 w-full bg-brand-red hover:bg-brand-deep text-white text-xs font-display uppercase tracking-[0.06em]">
            {busy === "start" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {busy === "start" ? "Starting…" : "Start simulation"}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button onClick={ctrl.toggle}
              className="h-9 flex-1 bg-canvas-elev hover:bg-white/10 text-ink text-xs border border-white/[0.06]">
              {ctrl.playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
            </Button>
            <Button onClick={stopRun} disabled={busy === "stop"} variant="outline"
              className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-xs">
              {busy === "stop" ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />} Stop
            </Button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ink-faint uppercase tracking-wide w-10">Speed</span>
          <Slider className="flex-1" min={1} max={MAX_SPEED_X} step={1} value={[ctrl.speed]} onValueChange={([v]) => ctrl.setSpeed(v)} />
          <span className="font-mono text-[11px] text-ink cc-num w-7 text-right">{ctrl.speed}×</span>
        </div>
        {runId && (
          <div className="text-[10px] font-mono text-ink-faint">
            run {runId.slice(0,8)} · {snapshot?.run?.status ?? "—"} · t{snapshot?.run?.tick_count ?? 0}
            {typeof snapshot?.run?.speed_x === "number" && ` · ${snapshot.run.speed_x}× on the run`}
            <div className="text-ink-faint/70">Stop the run to choose another scenario.</div>
          </div>
        )}
      </Group>

      {/* QUICK PRESETS */}
      <Group icon={FlaskConical} title="Quick Presets">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[12px] text-ink">Chaos Mode</span>
            <span className="text-[10px] text-ink-faint">variance ×2.5 · event rates ×3, on top of the scenario</span>
          </div>
          <Switch checked={isChaos(knobs)} onCheckedChange={toggleChaos} disabled={!runId} />
        </div>
        <Button onClick={resetBaseline} disabled={!runId} variant="outline" className="h-7 w-full border-white/[0.06] text-ink-dim hover:text-ink text-[11px]">
          <RotateCcw size={12} /> Reset to the scenario baseline
        </Button>
      </Group>

      {/* VARIABILITY — COMPACT (primary) */}
      <Group icon={Activity} title="Variability — Primary"
        right={
          <TooltipProvider><Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto font-mono text-[9px] text-ink-faint cursor-default">
                {coverage
                  ? `${coverage.observed}/${coverage.total} observable`
                  : `${wiredCount}/${catalog.length} registered`}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px] bg-canvas-elev border-white/10 text-ink text-[11px]">
              {coverage
                ? `Measured on the live frame: ${coverage.observed} of ${coverage.total} variables have an effect
                   OTTO-Q can actually see. ${coverage.dark} unlit, ${coverage.unobservable} with no channel at all.
                   (${wiredCount}/${catalog.length} are registered as wired — a different question.)`
                : "No live frame yet — showing the registry count, which says a variable exists, not that its effect reaches OTTO-Q."}
            </TooltipContent>
          </Tooltip></TooltipProvider>
        }>
        {primary.map(renderVar)}
        <span className="text-[10px] text-ink-faint pt-1">Each slider reshapes a real-world distribution the engine samples every tick — neutral = calibrated. Expand a variable for shift / spread / floor / ceiling.</span>
      </Group>

      {/* VARIABILITY — ADVANCED per domain */}
      {Object.keys(DOMAIN_LABELS).filter((d) => byDomain[d]?.length).map((d) => {
        const open = openDomains.has(d);
        return (
          <div key={d} className="border-b border-white/[0.06]">
            <button onClick={() => setOpenDomains((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; })}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02]">
              {open ? <ChevronDown size={13} className="text-ink-dim" /> : <ChevronRight size={13} className="text-ink-dim" />}
              <span className="font-display text-[11px] uppercase tracking-[0.06em] text-ink-dim">{DOMAIN_LABELS[d]}</span>
              <span className="ml-auto font-mono text-[9px] text-ink-faint">
                {domainCoverage[d]
                  ? `${domainCoverage[d].observed}/${domainCoverage[d].total}`
                  : `${byDomain[d].filter((v) => v.wired).length}/${byDomain[d].length}`}
              </span>
            </button>
            {open && <div className="px-3 pb-3 flex flex-col gap-1">{byDomain[d].map(renderVar)}</div>}
          </div>
        );
      })}

      {/* INJECTIONS — only events the engine has a door for. Brownout and Storm used to sit here and
          wrote an event (Charger Fault wrote a SOLAR-INVERTER event) that no engine function reads;
          each showed "Injected" and changed nothing. They return when the engine has a door. */}
      <Group icon={Zap} title="Injections">
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => inject("DR Call", () => twin.injectDrCall(runId!, { duration_min: 120, cap_kw: 500, reason: "manual" }),
              () => "500 kW cap for 120 sim-minutes")}
            disabled={!runId || !!busy} variant="outline" className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-[11px] justify-start"><BatteryWarning size={13} className="text-state-warn" /> DR Call</Button>
          <Button onClick={() => inject("Charger Fault", () => twin.injectFault(runId!, { kind: "charger_offline" }),
              (r) => r?.stall_code ? `${r.stall_code} faulted${r.had_vehicle ? " with a car on it" : ""} — back in ${r.repair_minutes} sim-min` : undefined)}
            disabled={!runId || !!busy} variant="outline" className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-[11px] justify-start"><AlertTriangle size={13} className="text-state-warn" /> Charger Fault</Button>
        </div>
        <span className="text-[10px] text-ink-faint">DR Call issues a real demand-response cap. Charger Fault takes a DC fast charger at this depot offline (vehicles on it are replanned) and a technician returns it after an hour of sim time.</span>
      </Group>
    </ScrollArea>
  );
};
