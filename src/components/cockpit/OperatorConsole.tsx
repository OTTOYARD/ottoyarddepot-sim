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
//   · Injections: DR call · brownout · charger fault · storm
// No operator key (open on the private link). No Depot Structure tab.
// Writes shape the run's profile live via PUT /variability { knobs }.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play, Pause, StepForward, Square, Zap, CloudRain, BatteryWarning, AlertTriangle,
  RotateCcw, ChevronRight, ChevronDown, Activity, FlaskConical, Info,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { twin, DOMAIN_LABELS, type CatalogVar, type Scenario, type KnobType } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";
import { useTwinControl } from "@/hooks/useTwinControl";

// ── knob helpers (read/write the profile JSONB shape) ──
type Knobs = Record<string, any>;
const getRate   = (k: Knobs, key: string) => Number(k?._rates?.[key] ?? 1);
const getPolicy = (k: Knobs, key: string) => String(k?._policy?.[key] ?? "calibrated");
const getCont   = (k: Knobs, key: string, kt: KnobType, dflt: number) =>
  Number(k?.[key]?.[kt] ?? dflt);
const isChaos   = (k: Knobs) => Number(k?._global?.spread_mult ?? 1) > 1;

function withRate(k: Knobs, key: string, v: number): Knobs {
  const next = JSON.parse(JSON.stringify(k ?? {})); delete next._global;
  next._rates = { ...(next._rates ?? {}) };
  if (v === 1) delete next._rates[key]; else next._rates[key] = v;
  return next;
}
function withPolicy(k: Knobs, key: string, v: string): Knobs {
  const next = JSON.parse(JSON.stringify(k ?? {})); delete next._global;
  next._policy = { ...(next._policy ?? {}) };
  if (v === "calibrated") delete next._policy[key]; else next._policy[key] = v;
  return next;
}
function withCont(k: Knobs, key: string, kt: KnobType, v: number, neutral: number): Knobs {
  const next = JSON.parse(JSON.stringify(k ?? {})); delete next._global;
  const cur = { ...(next[key] ?? {}) };
  if (v === neutral) delete cur[kt]; else cur[kt] = v;
  if (Object.keys(cur).length === 0) delete next[key]; else next[key] = cur;
  return next;
}

// per-knob-type slider range (catalog defines the primary; these fill the rest)
function rangeFor(v: CatalogVar, kt: KnobType): { min: number; max: number; step: number; neutral: number } {
  if (kt === "spread")  return { min: 0.5, max: 3, step: 0.1, neutral: 1 };
  if (kt === "rate")    return { min: v.min_value ?? 0, max: v.max_value ?? 5, step: v.step ?? 0.25, neutral: v.neutral_value ?? 1 };
  // shift / floor / ceiling use the catalog's defined range
  return { min: v.min_value ?? 0, max: v.max_value ?? 100, step: v.step ?? 1, neutral: kt === "shift" ? (v.neutral_value ?? 0) : (v.min_value ?? 0) };
}
const fmt = (n: number, step: number) => (step < 1 ? n.toFixed(step < 0.1 ? 2 : 1) : String(n));

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
function VarControl({ v, knobs, expanded, onToggleExpand, commit }: {
  v: CatalogVar; knobs: Knobs; expanded: boolean; onToggleExpand: () => void;
  commit: (next: Knobs) => void;
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
    </div>
  );

  if (!v.wired) return <div className="py-1 opacity-50">{header}</div>;

  if (v.kind === "policy") {
    return (
      <div className="flex flex-col gap-1.5 py-1">
        {header}
        <Select value={getPolicy(knobs, v.var_key)} onValueChange={(val) => commit(withPolicy(knobs, v.var_key, val))}>
          <SelectTrigger className="h-7 text-xs bg-canvas-elev border-white/[0.06]"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-canvas-panel border-white/10">
            {(v.select_options ?? ["calibrated"]).map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
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
        </div>
      )}
    </div>
  );
}

// ── section wrapper ──
const Group = ({ icon: Icon, title, children, right }: { icon: React.ElementType; title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="border-b border-white/[0.06]">
    <div className="flex items-center gap-2 px-3 py-2 bg-canvas-elev/40 border-l-2 border-l-brand-red">
      <Icon size={13} className="text-brand-red" />
      <span className="font-display text-[11px] uppercase tracking-[0.08em] text-ink">{title}</span>
      {right}
    </div>
    <div className="px-3 py-2.5 flex flex-col gap-2">{children}</div>
  </div>
);

// ── main ──
export const OperatorConsole = () => {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const setActiveSimRunId = useTwinStore((s) => s.setActiveSimRunId);
  const snapshot = useTwinStore((s) => s.snapshot);
  const ctrl = useTwinControl();

  const [catalog, setCatalog] = useState<CatalogVar[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState("normal_day");
  const [knobs, setKnobs] = useState<Knobs>({});
  const [expandedVars, setExpandedVars] = useState<Set<string>>(new Set());
  const [openDomains, setOpenDomains] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const runId = activeSimRunId;

  useEffect(() => { twin.catalog().then((d) => setCatalog(d.catalog)).catch(() => {}); }, []);
  useEffect(() => { twin.scenarios().then((d) => setScenarios(d.scenarios)).catch(() => {}); }, []);
  // sync local knobs from the live profile whenever the run/profile changes
  useEffect(() => { if (snapshot?.variability) setKnobs(snapshot.variability as Knobs); }, [snapshot?.variability, runId]);

  const commit = useCallback(async (next: Knobs) => {
    setKnobs(next);
    if (!runId) { toast.error("Start a run first"); return; }
    try { await twin.setVariability(runId, { knobs: next }); }
    catch (e: any) { toast.error("Update failed", { description: e.message }); }
  }, [runId]);

  const startScenario = async () => {
    setBusy("start");
    try {
      const res = await twin.start(selected);
      setActiveSimRunId(res.sim_run_id);
      toast.success(`Started ${selected}`);
    } catch (e: any) { toast.error("Start failed", { description: e.message }); }
    finally { setBusy(null); }
  };
  const stopRun = async () => { if (!runId) return; setBusy("stop"); try { await twin.stop(runId); ctrl.pause(); toast.success("Run stopped"); } catch (e: any) { toast.error("Stop failed", { description: e.message }); } finally { setBusy(null); } };

  const toggleChaos = async (on: boolean) => {
    if (!runId) { toast.error("Start a run first"); return; }
    try { await twin.setVariability(runId, { template: on ? "__chaos__" : "__default__" }); toast.success(on ? "Chaos Mode — variance ×2.5, rates ×3" : "Reset to calibrated baseline"); }
    catch (e: any) { toast.error("Failed", { description: e.message }); }
  };
  const resetCalibrated = async () => {
    if (!runId) return;
    try { await twin.setVariability(runId, { template: "__default__" }); setKnobs({}); toast.success("Reset to calibrated"); }
    catch (e: any) { toast.error("Reset failed", { description: e.message }); }
  };

  const inject = async (label: string, fn: () => Promise<unknown>) => {
    if (!runId) { toast.error("Start a run first"); return; }
    setBusy(label);
    try { await fn(); toast.success(`Injected: ${label}`); }
    catch (e: any) { toast.error(`${label} failed`, { description: e.message }); }
    finally { setBusy(null); }
  };

  const primary = catalog.filter((v) => v.is_primary);
  const byDomain = useMemo(() => {
    const m: Record<string, CatalogVar[]> = {};
    for (const v of catalog) (m[v.domain] ??= []).push(v);
    return m;
  }, [catalog]);
  const wiredCount = catalog.filter((v) => v.wired).length;

  const renderVar = (v: CatalogVar) => (
    <VarControl key={v.var_key} v={v} knobs={knobs} expanded={expandedVars.has(v.var_key)}
      onToggleExpand={() => setExpandedVars((s) => { const n = new Set(s); n.has(v.var_key) ? n.delete(v.var_key) : n.add(v.var_key); return n; })}
      commit={commit} />
  );

  return (
    <ScrollArea className="flex-1">
      {/* RUN CONTROL */}
      <Group icon={Activity} title="Run Control">
        <div className="flex items-center gap-2">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-8 flex-1 text-xs bg-canvas-elev border-white/[0.06]"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-canvas-panel border-white/10">
              {scenarios.map((s) => <SelectItem key={s.scenario_code} value={s.scenario_code} className="text-xs">{s.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={startScenario} disabled={busy === "start"} className="h-8 bg-brand-red hover:bg-brand-deep text-white text-xs">Start</Button>
          <Button onClick={stopRun} disabled={!runId} variant="outline" className="h-8 border-white/[0.06] text-ink-dim hover:text-ink"><Square size={13} /></Button>
        </div>
        {/* transport */}
        <div className="flex items-center gap-2 pt-1">
          <Button onClick={ctrl.toggle} disabled={!runId} className="h-8 flex-1 bg-canvas-elev hover:bg-white/10 text-ink text-xs border border-white/[0.06]">
            {ctrl.playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
          </Button>
          <Button onClick={ctrl.step} disabled={!runId || ctrl.playing} variant="outline" className="h-8 border-white/[0.06] text-ink-dim hover:text-ink"><StepForward size={14} /></Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ink-faint uppercase tracking-wide w-10">Speed</span>
          <Slider className="flex-1" min={1} max={10} step={1} value={[ctrl.speed]} onValueChange={([v]) => ctrl.setSpeed(v)} />
          <span className="font-mono text-[11px] text-ink cc-num w-7 text-right">{ctrl.speed}×</span>
        </div>
        {runId && <div className="text-[10px] font-mono text-ink-faint">run {runId.slice(0,8)} · {snapshot?.run?.status ?? "—"} · t{snapshot?.run?.tick_count ?? 0}{ctrl.playing && " · ▶ live"}</div>}
      </Group>

      {/* QUICK PRESETS */}
      <Group icon={FlaskConical} title="Quick Presets">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[12px] text-ink">Chaos Mode</span>
            <span className="text-[10px] text-ink-faint">global variance ×2.5 · all event rates ×3</span>
          </div>
          <Switch checked={isChaos(knobs)} onCheckedChange={toggleChaos} disabled={!runId} />
        </div>
        <Button onClick={resetCalibrated} disabled={!runId} variant="outline" className="h-7 w-full border-white/[0.06] text-ink-dim hover:text-ink text-[11px]">
          <RotateCcw size={12} /> Reset to calibrated baseline
        </Button>
      </Group>

      {/* VARIABILITY — COMPACT (primary) */}
      <Group icon={Activity} title="Variability — Primary"
        right={<span className="ml-auto font-mono text-[9px] text-ink-faint">{wiredCount}/{catalog.length} live</span>}>
        {primary.map(renderVar)}
        <span className="text-[10px] text-ink-faint pt-1">Each slider reshapes a real-world distribution the engine samples every tick — neutral = calibrated. Expand a variable for shift / spread / floor / ceiling.</span>
      </Group>

      {/* VARIABILITY — ADVANCED per domain */}
      {Object.keys(DOMAIN_LABELS).filter((d) => byDomain[d]?.length).map((d) => {
        const open = openDomains.has(d);
        return (
          <div key={d} className="border-b border-white/[0.06]">
            <button onClick={() => setOpenDomains((s) => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; })}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02]">
              {open ? <ChevronDown size={13} className="text-ink-dim" /> : <ChevronRight size={13} className="text-ink-dim" />}
              <span className="font-display text-[11px] uppercase tracking-[0.06em] text-ink-dim">{DOMAIN_LABELS[d]}</span>
              <span className="ml-auto font-mono text-[9px] text-ink-faint">{byDomain[d].filter((v) => v.wired).length}/{byDomain[d].length}</span>
            </button>
            {open && <div className="px-3 pb-3 flex flex-col gap-1">{byDomain[d].map(renderVar)}</div>}
          </div>
        );
      })}

      {/* INJECTIONS */}
      <Group icon={Zap} title="Injections">
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => inject("DR Call", () => twin.injectDrCall(runId!, { duration_min: 120, cap_kw: 500, reason: "manual" }))} disabled={!runId || !!busy} variant="outline" className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-[11px] justify-start"><BatteryWarning size={13} className="text-state-warn" /> DR Call</Button>
          <Button onClick={() => inject("Brownout", () => twin.injectFault(runId!, { kind: "grid_brownout", payload: { voltage_v: 385 } }))} disabled={!runId || !!busy} variant="outline" className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-[11px] justify-start"><Zap size={13} className="text-brand-hot" /> Brownout</Button>
          <Button onClick={() => inject("Charger Fault", () => twin.injectFault(runId!, { kind: "charger_offline" }))} disabled={!runId || !!busy} variant="outline" className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-[11px] justify-start"><AlertTriangle size={13} className="text-state-warn" /> Charger Fault</Button>
          <Button onClick={() => inject("Weather Storm", () => twin.injectFault(runId!, { kind: "weather_storm" }))} disabled={!runId || !!busy} variant="outline" className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-[11px] justify-start"><CloudRain size={13} className="text-state-info" /> Storm</Button>
        </div>
      </Group>
    </ScrollArea>
  );
};
