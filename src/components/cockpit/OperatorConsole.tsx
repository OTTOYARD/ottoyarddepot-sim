// ============================================================================
// OperatorConsole — the backend-driven control surface for OTTO-TWIN.
// AV-only (contracted fleets: Waymo / Tesla / Zoox). Four groups:
//   Run Control · Variability (distribution-shapers + Chaos) · Injections · Structure
// Reads live state from twinStore; mutates the twin via the otto-twin-control API.
// Control actions require the operator key (stored in localStorage, never hardcoded).
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Square, StepForward, Zap, CloudRain, BatteryWarning, AlertTriangle, KeyRound, Sliders, Activity, Building2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { twin, getOperatorKey, setOperatorKey, type Scenario } from '@/lib/ottoTwin';
import { useTwinStore } from '@/store/twinStore';

// ── primitives ──
const Group = ({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) => (
  <div className="border-b border-white/[0.06]">
    <div className="flex items-center gap-2 px-3 py-2 bg-canvas-elev/40 border-l-2 border-l-brand-red">
      <Icon size={13} className="text-brand-red" />
      <span className="font-display text-[11px] uppercase tracking-[0.08em] text-ink">{title}</span>
    </div>
    <div className="px-3 py-3 flex flex-col gap-2.5">{children}</div>
  </div>
);

const ShaperRow = ({ label, value, min, max, step, unit, neutral, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  neutral: number; onCommit: (v: number) => void;
}) => {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  const pct = ((local - min) / (max - min)) * 100;
  const neutralPct = ((neutral - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-dim">{label}</span>
        <span className={`font-mono text-[11px] cc-num ${local === neutral ? 'text-ink-faint' : 'text-ink'}`}>
          {local > neutral && local !== neutral ? '+' : ''}{step < 1 ? local.toFixed(1) : local}{unit}
        </span>
      </div>
      <div className="relative">
        <Slider
          min={min} max={max} step={step} value={[local]}
          onValueChange={([v]) => setLocal(v)}
          onValueCommit={([v]) => onCommit(v)}
        />
        {/* neutral tick */}
        <span className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-white/20 pointer-events-none"
              style={{ left: `${neutralPct}%` }} />
      </div>
    </div>
  );
};

// ── component ──
export const OperatorConsole = () => {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const setActiveSimRunId = useTwinStore((s) => s.setActiveSimRunId);
  const snapshot = useTwinStore((s) => s.snapshot);
  const layout = useTwinStore((s) => s.layout);

  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState('normal_day');
  const [seed, setSeed] = useState('');
  const [opKey, setOpKeyState] = useState(getOperatorKey() ?? '');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    twin.scenarios().then((d) => setScenarios(d.scenarios)).catch(() => {/* reads public; ignore */});
  }, []);

  const hasKey = !!getOperatorKey();
  const runId = activeSimRunId;
  const knobs = (snapshot?.variability ?? {}) as Record<string, any>;
  const isChaos = (knobs?._global?.spread_mult ?? 1) > 1;

  const guardKey = useCallback(() => {
    if (!getOperatorKey()) { toast.error('Operator key required for control actions'); return false; }
    return true;
  }, []);

  // ── run control ──
  const startScenario = async () => {
    if (!guardKey()) return;
    setBusy('start');
    try {
      const res = await twin.start(selected, seed ? Number(seed) : undefined);
      setActiveSimRunId(res.sim_run_id);
      toast.success(`Started ${selected}`, { description: res.sim_run_id });
    } catch (e: any) { toast.error('Start failed', { description: e.message }); }
    finally { setBusy(null); }
  };
  const stopRun = async () => {
    if (!runId || !guardKey()) return;
    setBusy('stop');
    try { await twin.stop(runId); toast.success('Run stopped'); }
    catch (e: any) { toast.error('Stop failed', { description: e.message }); }
    finally { setBusy(null); }
  };
  const stepRun = async () => {
    if (!runId || !guardKey()) return;
    setBusy('step');
    try { await twin.tick(runId); toast.success('Advanced one tick'); }
    catch (e: any) { toast.error('Tick failed', { description: e.message }); }
    finally { setBusy(null); }
  };

  // ── variability ──
  const putKnobs = async (next: Record<string, unknown>) => {
    if (!runId || !guardKey()) return;
    try { await twin.setVariability(runId, { knobs: next }); }
    catch (e: any) { toast.error('Variability update failed', { description: e.message }); }
  };
  const toggleChaos = async (on: boolean) => {
    if (!runId || !guardKey()) return;
    try {
      await twin.setVariability(runId, { template: on ? '__chaos__' : '__default__' });
      toast.success(on ? 'Chaos Mode engaged — variance ×2.5, rates ×3' : 'Reset to calibrated baseline');
    } catch (e: any) { toast.error('Toggle failed', { description: e.message }); }
  };

  // read current shaper values from server knobs (fallback neutral)
  const ambientShift = knobs?.ambient_temp_c?.shift ?? 0;
  const cloudFloor   = knobs?.cloud_cover_pct?.floor ?? 0;
  const lmpSpread    = knobs?.lmp_usd_mwh?.spread ?? 1;
  const incidentRate = knobs?._rates?.incident ?? 1;
  const dtcRate      = knobs?._rates?.dtc ?? 1;
  const arrivalRate  = knobs?._rates?.arrival ?? 1;

  // build a fresh knob object from the current server knobs + one override path
  const shape = (mutate: (k: any) => void) => {
    const next: any = JSON.parse(JSON.stringify(knobs ?? {}));
    delete next._global;          // manual shaping exits chaos
    if (!next._rates) next._rates = {};
    mutate(next);
    putKnobs(next);
  };

  // ── injections ──
  const inject = async (label: string, fn: () => Promise<unknown>) => {
    if (!runId || !guardKey()) return;
    setBusy(label);
    try { await fn(); toast.success(`Injected: ${label}`); }
    catch (e: any) { toast.error(`${label} failed`, { description: e.message }); }
    finally { setBusy(null); }
  };

  // ── structure (read-only, from layout) ──
  const structure = useMemo(() => {
    const stalls = layout?.stalls ?? [];
    const byType = (t: string) => stalls.filter((s) => s.type === t).length;
    return { dcfc: byType('dcfc'), l2: byType('l2'), staging: byType('staging'), total: stalls.length,
             structures: layout?.structures?.length ?? 0 };
  }, [layout]);

  return (
    <ScrollArea className="flex-1">
      {/* RUN CONTROL */}
      <Group icon={Activity} title="Run Control">
        <div className="flex items-center gap-2">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-8 flex-1 text-xs bg-canvas-elev border-white/[0.06]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-canvas-panel border-white/10">
              {scenarios.map((s) => (
                <SelectItem key={s.scenario_code} value={s.scenario_code} className="text-xs">
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="seed" className="h-8 w-16 text-xs font-mono bg-canvas-elev border-white/[0.06]"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={startScenario} disabled={busy === 'start'}
            className="flex-1 h-8 bg-brand-red hover:bg-brand-deep text-white text-xs font-medium">
            <Play size={13} /> Start
          </Button>
          <Button onClick={stopRun} disabled={!runId || busy === 'stop'} variant="outline"
            className="h-8 border-white/[0.06] text-ink-dim hover:text-ink text-xs">
            <Square size={13} />
          </Button>
          <Button onClick={stepRun} disabled={!runId || busy === 'step'} variant="outline"
            className="h-8 border-white/[0.06] text-ink-dim hover:text-ink text-xs">
            <StepForward size={13} />
          </Button>
        </div>
        {runId && (
          <div className="flex items-center justify-between text-[10px] font-mono text-ink-faint">
            <span>run {runId.slice(0, 8)}</span>
            <span>{snapshot?.run?.status ?? '—'} · t{snapshot?.run?.tick_count ?? 0}</span>
          </div>
        )}
      </Group>

      {/* OPERATOR KEY */}
      <Group icon={KeyRound} title="Operator Key">
        <div className="flex items-center gap-2">
          <Input
            type="password" value={opKey} onChange={(e) => setOpKeyState(e.target.value)}
            placeholder="paste operator key…"
            className="h-8 flex-1 text-xs font-mono bg-canvas-elev border-white/[0.06]"
          />
          <Button
            onClick={() => { setOperatorKey(opKey.trim()); toast.success(opKey.trim() ? 'Operator key saved' : 'Operator key cleared'); }}
            variant="outline" className="h-8 border-white/[0.06] text-ink-dim hover:text-ink text-xs">
            Save
          </Button>
        </div>
        <span className={`text-[10px] ${hasKey ? 'text-state-go' : 'text-ink-faint'}`}>
          {hasKey ? '● key stored — controls enabled' : '○ reads work without a key; controls need it'}
        </span>
        <span className="text-[10px] text-ink-faint">Internal/demo only — stored in this browser. Harden before public exposure.</span>
      </Group>

      {/* VARIABILITY */}
      <Group icon={Sliders} title="Variability — Distribution Shapers">
        <div className="flex items-center justify-between pb-1">
          <div className="flex flex-col">
            <span className="text-[12px] text-ink font-medium">Chaos Mode</span>
            <span className="text-[10px] text-ink-faint">global variance ×2.5 · rates ×3</span>
          </div>
          <Switch checked={isChaos} onCheckedChange={toggleChaos} disabled={!runId} />
        </div>
        <div className="h-px bg-white/[0.06] my-1" />
        <ShaperRow label="Ambient temp shift" value={ambientShift} min={-30} max={30} step={1} unit="°C"
          neutral={0} onCommit={(v) => shape((k) => { if (v === 0) delete k.ambient_temp_c; else k.ambient_temp_c = { ...(k.ambient_temp_c||{}), shift: v }; })} />
        <ShaperRow label="Cloud floor" value={cloudFloor} min={0} max={100} step={5} unit="%"
          neutral={0} onCommit={(v) => shape((k) => { if (v === 0) delete k.cloud_cover_pct; else k.cloud_cover_pct = { ...(k.cloud_cover_pct||{}), floor: v }; })} />
        <ShaperRow label="LMP volatility" value={lmpSpread} min={0.5} max={3} step={0.1} unit="×"
          neutral={1} onCommit={(v) => shape((k) => { if (v === 1) delete k.lmp_usd_mwh; else k.lmp_usd_mwh = { ...(k.lmp_usd_mwh||{}), spread: v }; })} />
        <ShaperRow label="Incident rate" value={incidentRate} min={0} max={10} step={0.5} unit="×"
          neutral={1} onCommit={(v) => shape((k) => { k._rates.incident = v; })} />
        <ShaperRow label="DTC rate" value={dtcRate} min={0} max={10} step={0.5} unit="×"
          neutral={1} onCommit={(v) => shape((k) => { k._rates.dtc = v; })} />
        <ShaperRow label="Arrival rate" value={arrivalRate} min={0} max={5} step={0.5} unit="×"
          neutral={1} onCommit={(v) => shape((k) => { k._rates.arrival = v; })} />
      </Group>

      {/* INJECTIONS */}
      <Group icon={Zap} title="Injections">
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => inject('DR Call', () => twin.injectDrCall(runId!, { duration_min: 120, cap_kw: 500, reason: 'manual' }))}
            disabled={!runId || !!busy} variant="outline" className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-[11px] justify-start">
            <BatteryWarning size={13} className="text-state-warn" /> DR Call
          </Button>
          <Button onClick={() => inject('Brownout', () => twin.injectFault(runId!, { kind: 'grid_brownout', payload: { voltage_v: 385 } }))}
            disabled={!runId || !!busy} variant="outline" className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-[11px] justify-start">
            <Zap size={13} className="text-brand-hot" /> Brownout
          </Button>
          <Button onClick={() => inject('Charger Fault', () => twin.injectFault(runId!, { kind: 'charger_offline' }))}
            disabled={!runId || !!busy} variant="outline" className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-[11px] justify-start">
            <AlertTriangle size={13} className="text-state-warn" /> Charger Fault
          </Button>
          <Button onClick={() => inject('Weather Storm', () => twin.injectFault(runId!, { kind: 'weather_storm' }))}
            disabled={!runId || !!busy} variant="outline" className="h-9 border-white/[0.06] text-ink-dim hover:text-ink text-[11px] justify-start">
            <CloudRain size={13} className="text-state-info" /> Storm
          </Button>
        </div>
      </Group>

      {/* STRUCTURE (read-only) */}
      <Group icon={Building2} title="Depot Structure">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['DCFC', structure.dcfc], ['L2', structure.l2], ['Staging', structure.staging]].map(([l, v]) => (
            <div key={l as string} className="bg-canvas-elev/50 border border-white/[0.06] rounded py-1.5">
              <div className="font-mono text-[15px] text-ink cc-num">{v as number}</div>
              <div className="font-display text-[9px] uppercase tracking-wide text-ink-faint">{l as string}</div>
            </div>
          ))}
        </div>
        <span className="text-[10px] text-ink-faint">
          {structure.total} stalls · {structure.structures} structures · OTTOYARD Nashville Flagship
        </span>
      </Group>
    </ScrollArea>
  );
};
