import { Settings, Truck, BatteryCharging, Layers, DollarSign, Battery, Sun, Radio } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { useTwinStore } from '@/store/twinStore';
import logo from '@/assets/logo.png';

// ── helpers ──
const fmtClock = (iso?: string) => {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
};
const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const n = (v: unknown, digits = 0): string =>
  typeof v === 'number' && isFinite(v) ? v.toFixed(digits) : '—';

// ── telemetry cell ──
const Cell = ({ icon: Icon, label, value, unit }: {
  icon: React.ElementType; label: string; value: string; unit?: string;
}) => (
  <div className="flex items-center gap-2 px-3 border-l border-white/[0.06] first:border-l-0">
    <Icon size={14} className="text-ink-dim shrink-0" />
    <div className="flex flex-col leading-none">
      <span className="font-display text-[9px] uppercase tracking-[0.08em] text-ink-faint">{label}</span>
      <span className="font-mono text-[13px] text-ink cc-num">
        {value}{unit && <span className="text-ink-dim text-[10px] ml-0.5">{unit}</span>}
      </span>
    </div>
  </div>
);

const StatusChip = ({ status }: { status?: string }) => {
  const map: Record<string, string> = {
    running:   'text-state-go border-state-go/30 bg-state-go/5',
    completed: 'text-ink-dim border-white/10 bg-white/5',
    paused:    'text-state-warn border-state-warn/30 bg-state-warn/5',
  };
  const cls = map[status ?? ''] ?? 'text-ink-dim border-white/10 bg-white/5';
  return (
    <span className={`px-2 py-0.5 rounded border font-mono text-[10px] uppercase tracking-wide ${cls}`}>
      {status ?? 'idle'}
    </span>
  );
};

export const TopBar = () => {
  const { viewMode, setViewMode, status: legacyStatus } = useSimulationStore();
  const snapshot  = useTwinStore((s) => s.snapshot);
  const connected = useTwinStore((s) => s.connected);

  const run = snapshot?.run;
  // Only show fleet numbers when a live snapshot actually carries them; without
  // this a missing/errored frame renders a literal "0" that reads as "nothing
  // is charging/deployed" — indistinguishable from a real zero. `undefined`
  // makes n() render "—" instead, so an empty feed is honest.
  const hasFleet = !!snapshot?.fleet?.counts;
  const counts = snapshot?.fleet?.counts ?? {};
  const deployed = hasFleet ? (counts['deployed'] ?? 0) : undefined;
  const charging = hasFleet ? ((counts['charging_dcfc'] ?? 0) + (counts['charging_l2'] ?? 0)) : undefined;
  const staged   = hasFleet ? (counts['staged_awaiting_service'] ?? 0) : undefined;
  const lmp     = snapshot?.grid?.['lmp_usd_mwh'];
  const bessSoc = snapshot?.bess?.['soc_pct'];
  const solar   = snapshot?.energy?.['solar_kw'];

  return (
    <div className="h-14 bg-canvas-raised border-b border-white/[0.06] flex items-center px-4 shrink-0 z-20">
      {/* Brand */}
      <div className="flex items-center gap-3 shrink-0">
        <img src={logo} alt="OTTOYARD" className="h-7 w-7 shrink-0" />
        <div className="flex flex-col leading-none">
          <span className="font-display text-white font-semibold text-[17px] tracking-tight">OTTOYARD</span>
          <span className="font-display text-ink-faint text-[9px] uppercase tracking-[0.14em]">OTTO-TWIN · Command Center</span>
        </div>
        {run?.scenario && (
          <span className="ml-1 px-2 py-0.5 rounded border border-white/[0.06] bg-canvas-elev font-mono text-[10px] text-ink-dim">
            {run.scenario}
          </span>
        )}
        <StatusChip status={run?.status ?? (legacyStatus !== 'idle' ? legacyStatus : undefined)} />
      </div>

      {/* Clock */}
      <div className="flex items-center gap-3 ml-5 shrink-0">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-white text-lg tracking-wide cc-num">{fmtClock(run?.sim_clock)}</span>
          <span className="font-mono text-ink-faint text-[10px]">{fmtDate(run?.sim_clock)}</span>
        </div>
        {run && (
          <span className="font-mono text-ink-dim text-[11px] cc-num">
            t{run.tick_count} · {run.time_scale}×
          </span>
        )}
      </div>

      {/* Telemetry strip */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center bg-canvas-panel/60 border border-white/[0.06] rounded-md py-1">
          <Cell icon={Truck}           label="Deployed" value={n(deployed)} />
          <Cell icon={BatteryCharging} label="Charging" value={n(charging)} />
          <Cell icon={Layers}          label="Staged"   value={n(staged)} />
          <Cell icon={DollarSign}      label="LMP"      value={n(lmp, 0)} unit="$/MWh" />
          <Cell icon={Battery}         label="BESS"     value={n(bessSoc, 0)} unit="%" />
          <Cell icon={Sun}             label="Solar"    value={n(solar, 0)} unit="kW" />
        </div>
      </div>

      {/* Right: connection status + view toggle. Run transport lives in the
          Run Control tab (Start = create run · Play/Pause/Step = advance time).
          The legacy offline-demo engine buttons were removed — they drove a
          separate fake client engine and conflicted with the live backend. */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5 px-2">
          <Radio size={13} className={connected ? 'text-state-go' : 'text-ink-faint'} />
          <span className={`font-mono text-[10px] ${connected ? 'text-state-go' : 'text-ink-faint'}`}>
            {connected ? 'LIVE' : '—'}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {(['2d', '3d', 'photoreal'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`px-2 py-1 text-[11px] font-mono rounded transition-colors ${
                viewMode === m
                  ? 'bg-brand-red text-white'
                  : 'text-ink-dim border border-white/[0.06] hover:text-ink'
              }`}
            >
              {m === 'photoreal' ? 'RTX' : m.toUpperCase()}
            </button>
          ))}
        </div>

        <button className="p-2 text-ink-dim hover:text-ink hover:bg-white/5 rounded-md transition-colors" title="Settings">
          <Settings size={16} />
        </button>
      </div>
    </div>
  );
};
