// ============================================================================
// TwinRoboticsTab — the depot's robots as engineering CAD: every part, to the last screw and washer.
//
// Chase, 2026-11-07: "a robotics tab ... where you can click within the robotics tab and see individual operational CAD
// engineering from a microscopic or screw by screw integration ... a breakout feature for each where you can see each
// individual major robotic, or mechanical or engineering function".
//
// What it reads: public/cad/manifest.json and each robot's bill of materials and GLB, built by cad/build.py from the
// twin's own robot specs (src/lib/robotics/cadSpec.ts). Nothing here reads the run: it is DESIGN DATA, not live, and
// the banner says so. Pose presets and the run steps come from the twin's own code (catalog.ts), so the CAD moves the
// way the depot's robots move. Opening the tab widens the panel to full width on a desktop (Esc returns it).
// ============================================================================
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Box, Download, Eye, EyeOff, Loader2, Maximize2, Pause, Play, RotateCcw, Scissors, Search, Wrench } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { useSimulationStore } from '@/store/simulationStore';
import { usePhoneSheet } from '@/components/phone/phoneStore';
import { CadViewer, type CadJointSummary, type CadViewState, type SectionAxis, type ViewDir } from '@/components/robotics/CadViewer';
import {
  CATEGORY_LABEL, FUNCTIONS, JOINT_LABEL, ROBOT_INFO, ROBOT_KEYS, cadUrl, cycleScript, cycleSteps, fastenerIds, fetchBom, fetchClash, fetchManifest, filterLines,
  fmtKg, fmtMB, fmtNm, posePresets, qtyIn, type Bom, type BomLine, type BomSubsystem, type ClashReport, type Manifest, type RobotKey,
} from '@/lib/robotics/catalog';

let autoExpanded = false;

const DEFAULT_VIEW: Omit<CadViewState, 'angles'> = {
  explode: 0, isolate: null, selected: null, showFasteners: true, showCar: true, section: 'off', sectionAt: 0,
  view: 'iso', fitKey: 0,
};

// ── small pieces ───────────────────────────────────────────────────────────

function Banner() {
  return (
    <div role="note" data-testid="robotics-banner"
      className="flex items-start gap-2 rounded border border-dashed border-sky-300/40 bg-sky-300/[0.06] px-2.5 py-2">
      <Wrench size={14} aria-hidden className="mt-0.5 shrink-0 text-sky-300" />
      <p className="min-w-0 text-[11.5px] leading-5 text-ink">
        <span className="font-semibold text-sky-200">Engineering CAD. Design data, not live.</span>{' '}
        Each robot has every part in the model, to the last screw and washer. The twin uses the same dimensions.
      </p>
    </div>
  );
}

function Chip({ active, onClick, children, testId }: { active?: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} aria-pressed={!!active}
      className={`rounded border px-2 py-1 text-[11px] leading-4 transition-colors ${active
        ? 'border-brand-red/60 bg-brand-red/15 text-ink' : 'border-white/[0.08] bg-white/[0.03] text-ink-dim hover:text-ink hover:bg-white/[0.06]'}`}>
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white/[0.03] px-2 py-1.5">
      <div className="font-display text-[9px] uppercase tracking-[0.08em] text-ink-dim">{label}</div>
      <div className="font-mono text-[13px] tabular-nums text-ink">{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="font-display text-[10px] uppercase tracking-[0.08em] text-ink-dim">{children}</h4>;
}

class ViewerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-ink-dim">
        The 3D view did not start on this device. The parts list below still works.
      </div>;
    }
    return this.props.children;
  }
}

// ── the parts list and the part card ───────────────────────────────────────

function PartRow({ line, sub, selected, onSelect }: { line: BomLine; sub: string | null; selected: boolean; onSelect: () => void }) {
  const q = qtyIn(line, sub);
  return (
    <li>
      <button type="button" onClick={onSelect} data-testid="bom-line" data-part={line.id} aria-pressed={selected}
        className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left transition-colors ${selected ? 'bg-brand-red/15' : 'hover:bg-white/[0.05]'}`}>
        <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink">{q}×</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11.5px] text-ink">{line.name}</span>
          <span className="block truncate font-mono text-[10px] text-ink-dim">
            {[line.standard, line.grade, line.material.split(',')[0]].filter(Boolean).join(' · ')}
          </span>
        </span>
        {line.torqueNm != null && <span className="shrink-0 font-mono text-[10px] tabular-nums text-amber-200">{line.torqueNm} N·m</span>}
      </button>
    </li>
  );
}

function PartCard({ line, subs, onIsolate, onClose }: {
  line: BomLine; subs: BomSubsystem[]; onIsolate: (sub: string) => void; onClose: () => void;
}) {
  const subName = (id: string) => subs.find((s) => s.id === id)?.name ?? id;
  const rows: [string, string][] = [
    ['Part id', line.id],
    ['Type', `${CATEGORY_LABEL[line.category] ?? line.category} · ${line.make === 'buy' ? 'bought' : 'made'}`],
    ...(line.standard ? [['Standard', line.standard] as [string, string]] : []),
    ...(line.size ? [['Size', line.size] as [string, string]] : []),
    ...(line.grade ? [['Grade', line.grade] as [string, string]] : []),
    ['Material', line.material],
    ['Quantity', `${line.qty}`],
    ['Mass', `${fmtKg(line.massKg)} each · ${fmtKg(line.totalMassKg)} in all`],
    ...(line.torqueNm != null ? [['Tightening torque', `${line.torqueNm} N·m (VDI 2230, friction 0.12)`] as [string, string]] : []),
    ...Object.entries(line.spec).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v] as [string, string]),
  ];
  return (
    <article data-testid="part-card" className="space-y-2 rounded-lg border border-brand-red/30 bg-canvas-panel p-3">
      <header className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 break-words text-[13px] font-semibold leading-snug text-ink">{line.name}</h4>
        <button type="button" onClick={onClose} aria-label="Close the part card" className="shrink-0 text-[11px] text-ink-dim hover:text-ink">Close</button>
      </header>
      {line.function && <p className="text-[11.5px] leading-5 text-ink-dim">{line.function}</p>}
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[11px] leading-4">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-dim">{k}</dt>
            <dd className="min-w-0 break-words font-mono text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1">
        <SectionTitle>Where it is used</SectionTitle>
        <div className="flex flex-wrap gap-1">
          {line.uses.map((u) => (
            <Chip key={u.sub} onClick={() => onIsolate(u.sub)}>{subName(u.sub)} · {u.qty}</Chip>
          ))}
        </div>
      </div>
    </article>
  );
}

// ── the tab ────────────────────────────────────────────────────────────────

export function TwinRoboticsTab() {
  const expanded = useSimulationStore((s) => s.isPanelExpanded && s.isPanelOpen);
  const setPanelExpanded = useSimulationStore((s) => s.setPanelExpanded);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [robot, setRobot] = useState<RobotKey>('charge_arm');
  const [bom, setBom] = useState<Bom | null>(null);
  const [clash, setClash] = useState<ClashReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [poseId, setPoseId] = useState<string>('');
  const [view, setView] = useState<Omit<CadViewState, 'angles'>>(DEFAULT_VIEW);
  const [query, setQuery] = useState('');
  const [fastFilter, setFastFilter] = useState<'all' | 'only' | 'none'>('all');
  const [status, setStatus] = useState<{ loading: boolean; progress: number; error: string | null; parts: number }>({ loading: true, progress: 0, error: null, parts: 0 });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cyc, setCyc] = useState<{ t: number; step: number }>({ t: 0, step: 0 });
  const [joints, setJoints] = useState<CadJointSummary[]>([]);
  const [manual, setManual] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!autoExpanded && typeof window !== 'undefined' && window.innerWidth >= 1200) {
      autoExpanded = true;
      setPanelExpanded(true);
    }
  }, [setPanelExpanded]);

  useEffect(() => {
    let live = true;
    fetchManifest().then((m) => { if (live) setManifest(m); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const entry = manifest?.robots.find((r) => r.key === robot) ?? null;
  useEffect(() => {
    if (!entry) return;
    let live = true;
    setBom(null); setClash(null);
    fetchBom(entry).then((b) => { if (live) setBom(b); }).catch((e: Error) => { if (live) setError(e.message); });
    fetchClash(entry).then((c) => { if (live) setClash(c); });
    return () => { live = false; };
  }, [entry]);

  const presets = useMemo(() => posePresets(robot), [robot]);
  useEffect(() => {
    setPoseId(presets[0].id); setView((v) => ({ ...DEFAULT_VIEW, fitKey: v.fitKey + 1 })); setQuery('');
    setPlaying(false); setManual({}); setCyc({ t: 0, step: 0 });
  }, [robot, presets]);
  const script = useMemo(() => cycleScript(robot), [robot]);
  const angles = useMemo(
    () => ({ ...(presets.find((p) => p.id === poseId)?.angles ?? presets[0].angles), ...manual }),
    [presets, poseId, manual],
  );
  const fasteners = useMemo(() => (bom ? fastenerIds(bom) : new Set<string>()), [bom]);
  const state: CadViewState = useMemo(() => ({ ...view, angles }), [view, angles]);
  const subs = bom?.subsystems ?? [];
  const isolated = subs.find((s) => s.id === view.isolate) ?? null;
  const lines = useMemo(() => (bom ? filterLines(bom.lines, { sub: view.isolate, query, fasteners: fastFilter }) : []), [bom, view.isolate, query, fastFilter]);
  const selectedLine = bom?.lines.find((l) => l.id === view.selected) ?? null;
  const steps = useMemo(() => cycleSteps(robot), [robot]);
  const set = (p: Partial<Omit<CadViewState, 'angles'>>) => setView((v) => ({ ...v, ...p }));
  const isolate = (sub: string | null) => set({ isolate: sub === view.isolate ? null : sub });
  const pickFunction = (fid: string) => {
    const f = FUNCTIONS.find((x) => x.id === fid)!;
    if (f.robot !== robot) setRobot(f.robot);
    setTimeout(() => setView((v) => ({ ...v, isolate: f.subs[0] })), 0);
  };

  // ── pieces of the layout ──
  const picker = (
    <div className="flex flex-wrap gap-1" data-testid="robot-picker">
      {ROBOT_KEYS.map((k) => (
        <Chip key={k} active={k === robot} onClick={() => setRobot(k)} testId={`robot-${k}`}>
          <span className="font-semibold">{ROBOT_INFO[k].name}</span>
          <span className="ml-1 text-ink-dim">{ROBOT_INFO[k].short}</span>
        </Chip>
      ))}
    </div>
  );

  const functions = (
    <div className="space-y-1">
      <SectionTitle>Find by function</SectionTitle>
      <div className="flex flex-wrap gap-1" data-testid="function-chips">
        {FUNCTIONS.map((f) => (
          <Chip key={f.id} onClick={() => pickFunction(f.id)} active={f.robot === robot && f.subs.includes(view.isolate ?? '')}>{f.label}</Chip>
        ))}
      </div>
    </div>
  );

  const step = script.steps[cyc.step] ?? script.steps[0];
  const cycleBar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.06] px-2 py-1.5 text-[11px]" data-testid="cycle-bar">
      <button type="button" onClick={() => {
        setPlaying(!playing);
        setView((v) => (playing ? { ...v, frameCar: false } : { ...v, selected: null, isolate: null, explode: 0, frameCar: true, fitKey: v.fitKey + 1 }));
      }}
        data-testid="cycle-play" aria-pressed={playing}
        className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${playing ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100' : 'border-white/[0.1] bg-white/[0.04] text-ink hover:bg-white/[0.08]'}`}>
        {playing ? <Pause size={11} aria-hidden /> : <Play size={11} aria-hidden />} {playing ? 'Pause the cycle' : 'Run the cycle'}
      </button>
      <div className="flex items-center gap-1">
        {[1, 2, 4, 8].map((x) => <Chip key={x} active={speed === x} onClick={() => setSpeed(x)} testId={`speed-${x}`}>{x}×</Chip>)}
      </div>
      <div className="min-w-0 flex-1" data-testid="cycle-step">
        <div className="truncate text-ink">
          Step {cyc.step + 1} of {script.steps.length}: {step.label}{step.short ? ' (shown short)' : ''}
        </div>
        <div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-white/[0.06]">
          <div className="h-full bg-brand-red/70" style={{ width: `${(100 * cyc.t) / script.total}%` }} />
        </div>
      </div>
    </div>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.06] px-2 py-2 text-[11px]" data-testid="cad-toolbar">
      <div className="flex items-center gap-1">
        <span className="text-ink-dim">Pose</span>
        {presets.map((p) => <Chip key={p.id} active={!playing && p.id === poseId} onClick={() => { setPlaying(false); setManual({}); setPoseId(p.id); set({ frameCar: false }); }} testId={`pose-${p.id}`}>{p.label}</Chip>)}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-ink-dim">View</span>
        {(['iso', 'front', 'side', 'top'] as ViewDir[]).map((d) => (
          <Chip key={d} active={view.view === d} onClick={() => set({ view: d, fitKey: view.fitKey + 1 })}>{d === 'iso' ? 'Iso' : d.charAt(0).toUpperCase() + d.slice(1)}</Chip>
        ))}
        <Chip onClick={() => set({ fitKey: view.fitKey + 1 })}><Maximize2 size={11} className="inline" aria-hidden /> Fit</Chip>
      </div>
      <label className="flex min-w-[150px] items-center gap-2">
        <span className="text-ink-dim">Explode</span>
        <Slider data-testid="explode" value={[view.explode]} min={0} max={1} step={0.01} onValueChange={(v) => set({ explode: v[0] })} className="w-28" />
      </label>
      <div className="flex items-center gap-1">
        <Scissors size={12} aria-hidden className="text-ink-dim" />
        {(['off', 'x', 'z'] as SectionAxis[]).map((a) => (
          <Chip key={a} active={view.section === a} onClick={() => set({ section: a })} testId={`section-${a}`}>{a === 'off' ? 'No cut' : `Cut ${a.toUpperCase()}`}</Chip>
        ))}
        {view.section !== 'off' && (
          <Slider value={[view.sectionAt]} min={-1} max={1} step={0.01} onValueChange={(v) => set({ sectionAt: v[0] })} className="w-24" />
        )}
      </div>
      <div className="flex items-center gap-1">
        <Chip active={view.showFasteners} onClick={() => set({ showFasteners: !view.showFasteners })} testId="toggle-fasteners">
          {view.showFasteners ? <Eye size={11} className="inline" aria-hidden /> : <EyeOff size={11} className="inline" aria-hidden />} Fasteners
        </Chip>
        <Chip active={view.showCar} onClick={() => set({ showCar: !view.showCar })}>Car</Chip>
        <Chip onClick={() => { setView({ ...DEFAULT_VIEW, fitKey: view.fitKey + 1 }); setPoseId(presets[0].id); setManual({}); setPlaying(false); }}><RotateCcw size={11} className="inline" aria-hidden /> Reset</Chip>
      </div>
    </div>
  );

  const viewer = (
    <div className="relative h-full min-h-[260px] w-full overflow-hidden" data-testid="cad-viewer">
      {entry && (
        <ViewerBoundary>
          <CadViewer robot={robot} glb={entry.files.glb} state={state} fasteners={fasteners}
            onPick={(id) => set({ selected: id })} onStatus={setStatus}
            cycle={{ script, playing, speed }} onCycle={(t, st) => setCyc({ t, step: st })} onJoints={setJoints} />
        </ViewerBoundary>
      )}
      {(status.loading || status.error) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded bg-black/60 px-3 py-2 text-[12px] text-ink">
            {status.error ? `The model did not load: ${status.error}` : (
              <span className="inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" aria-hidden />
                Load the model {Math.round(status.progress * 100)}%</span>
            )}
          </div>
        </div>
      )}
      {selectedLine && (
        <div className="pointer-events-none absolute left-2 top-2 max-w-[60%] rounded bg-black/55 px-2 py-1 text-[11px] text-ink" data-testid="selected-label">
          <span className="font-semibold">{selectedLine.name}</span> · {selectedLine.qty}× · {selectedLine.size}. The rest shows as a ghost.
        </div>
      )}
      {isolated && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/55 px-2 py-1 text-[11px] text-ink">
          Shown: {isolated.name}. The rest is a ghost.
        </div>
      )}
    </div>
  );

  const jointPanel = joints.length > 0 && (
    <div className="space-y-1" data-testid="joint-panel">
      <SectionTitle>Move the joints</SectionTitle>
      <ul className="space-y-1.5">
        {joints.map((j) => {
          const v = angles[j.name] ?? j.stowed;
          const rev = j.kind === 'revolute';
          return (
            <li key={j.name} className="space-y-0.5" data-testid="joint" data-joint={j.name}>
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-ink">{JOINT_LABEL[j.name] ?? j.name}</span>
                <span className="font-mono tabular-nums text-ink-dim">{rev ? `${(v * 180 / Math.PI).toFixed(0)}°` : `${Math.round(v * 1000)} mm`}</span>
              </div>
              <Slider value={[v]} min={j.limits[0]} max={j.limits[1]} step={rev ? 0.005 : 0.002} disabled={playing}
                onValueChange={(x) => setManual((m) => ({ ...m, [j.name]: x[0] }))} />
            </li>
          );
        })}
      </ul>
    </div>
  );

  const subsystemList = (
    <div className="space-y-1">
      <SectionTitle>Major functions</SectionTitle>
      <ul className="space-y-0.5" data-testid="subsystem-list">
        {subs.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => isolate(s.id)} data-testid="subsystem" data-sub={s.id} aria-pressed={view.isolate === s.id}
              className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left transition-colors ${view.isolate === s.id ? 'bg-brand-red/15' : 'hover:bg-white/[0.05]'}`}>
              <span className="min-w-0 truncate text-[12px] text-ink">{s.name}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-dim">{s.partCount} parts · {s.fastenerCount} screws</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const overview = bom && entry && (
    <div className="space-y-3" data-testid="robot-overview">
      <div className="space-y-1">
        <h3 className="text-[14px] font-semibold text-ink">{ROBOT_INFO[robot].name}</h3>
        {ROBOT_INFO[robot].summary.map((s, i) => <p key={i} className="text-[11.5px] leading-5 text-ink-dim">{s}</p>)}
      </div>
      <div className="grid grid-cols-2 gap-1.5" data-testid="robot-totals">
        <Stat label="Parts" value={bom.totals.parts.toLocaleString('en-US')} />
        <Stat label="Different parts" value={`${bom.totals.uniqueParts}`} />
        <Stat label="Screws, nuts, washers, pins" value={bom.totals.fasteners.toLocaleString('en-US')} />
        <Stat label="Mass" value={fmtKg(bom.totals.massKg)} />
      </div>
      {bom.notes.torque_budget && (
        <div className="space-y-1" data-testid="load-check">
          <SectionTitle>Load check (from the CAD masses)</SectionTitle>
          <ul className="space-y-1 text-[11px] leading-4 text-ink">
            <li>
              J2 shoulder: gravity {fmtNm(bom.notes.torque_budget.J2.torqueNm)} at full reach. A gas spring carries most of it.
              The gear sees {fmtNm(bom.notes.torque_budget.J2.gearWorstNm)} at worst, of {fmtNm(bom.notes.torque_budget.J2.repeatedPeakNm)} (×{bom.notes.torque_budget.J2.margin}).
            </li>
            <li>
              J3 elbow: {fmtNm(bom.notes.torque_budget.J3.torqueNm)} at full reach, of {fmtNm(bom.notes.torque_budget.J3.repeatedPeakNm)} (×{bom.notes.torque_budget.J3.margin}).
            </li>
            {bom.notes.torque_budget.serviceWindowJ2Deg && (
              <li className="text-ink-dim">
                At the charge ports the twin serves, J2 stays between {bom.notes.torque_budget.serviceWindowJ2Deg.min}° and {bom.notes.torque_budget.serviceWindowJ2Deg.max}°.
              </li>
            )}
          </ul>
        </div>
      )}
      {clash && (
        <div className="space-y-1" data-testid="clash-check">
          <SectionTitle>Clash check (every part against every other)</SectionTitle>
          <p className="text-[11px] leading-4 text-ink">
            {clash.clashes.length === 0 ? 'No clash' : `${clash.clashes.length} clash${clash.clashes.length === 1 ? '' : 'es'}`}
            {' and '}{clash.floating.length === 0 ? 'no loose part' : `${clash.floating.length} loose group${clash.floating.length === 1 ? '' : 's'}`}
            {' at '}{clash.poses.length} poses: the stowed pose and the twin's own poses for this machine.
          </p>
          <p className="text-[10.5px] leading-4 text-ink-dim">
            Expected overlaps, counted and not clashes: {clash.counts.thread} screws in tapped holes the CAD does not draw,
            {' '}{clash.counts.seal} seals in their grooves, {clash.counts.ring} retaining rings{clash.counts.mesh ? `, ${clash.counts.mesh} gear meshes` : ''}.
            {clash.floating.length === 0
              ? ' Each part touches the part that holds it, so no part hangs in the air.'
              : ' A loose group touches no part that holds it.'}
          </p>
          {clash.clashes.length > 0 && (
            <ul className="space-y-0.5" data-testid="clash-list">
              {clash.clashes.slice(0, 12).map((c) => (
                <li key={`${c.a.item}|${c.b.item}`}>
                  <button type="button" onClick={() => set({ selected: c.a.part })} className="w-full rounded px-1.5 py-0.5 text-left text-[10.5px] leading-4 text-ink hover:bg-white/[0.05]">
                    {c.a.name} and {c.b.name}: {Math.round(c.volumeMm3).toLocaleString('en-US')} mm³
                    {c.poses.includes('stowed') ? ', stowed' : `, at ${c.poses.length} pose${c.poses.length === 1 ? '' : 's'}`}
                  </button>
                </li>
              ))}
              {clash.clashes.length > 12 && (
                <li className="px-1.5 text-[10.5px] leading-4 text-ink-dim">And {clash.clashes.length - 12} more in the report.</li>
              )}
            </ul>
          )}
          {clash.floating.length > 0 && (
            <ul className="space-y-0.5" data-testid="loose-list">
              {clash.floating.slice(0, 6).map((g) => (
                <li key={g[0].item}>
                  <button type="button" onClick={() => set({ selected: g[0].part })} className="w-full rounded px-1.5 py-0.5 text-left text-[10.5px] leading-4 text-ink hover:bg-white/[0.05]">
                    Loose: {g[0].name}{g.length > 1 ? ` and ${g.length - 1} more` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="space-y-1" data-testid="cycle-steps">
        <SectionTitle>How it runs (the twin's steps)</SectionTitle>
        <ol className="space-y-0.5 text-[11px] leading-4">
          {steps.map((s, i) => (
            <li key={s.id} className="flex items-baseline gap-2">
              <span className="w-5 shrink-0 text-right font-mono tabular-nums text-ink-dim">{i + 1}</span>
              <span className="min-w-0 flex-1 text-ink">{s.label}</span>
              <span className="shrink-0 font-mono tabular-nums text-ink-dim">{s.seconds != null ? `${s.seconds} s` : ''}{s.note ? ` ${s.note}` : ''}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="space-y-1" data-testid="downloads">
        <SectionTitle>Files</SectionTitle>
        <div className="flex flex-wrap gap-1">
          <a href={cadUrl(entry.files.step)} download className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-ink hover:bg-white/[0.06]">
            <Download size={11} aria-hidden /> CAD (STEP, {fmtMB(entry.bytes.stepZip)})</a>
          <a href={cadUrl(entry.files.csv)} download className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-ink hover:bg-white/[0.06]">
            <Download size={11} aria-hidden /> Parts list (CSV)</a>
          <a href={cadUrl(entry.files.glb)} download className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-ink hover:bg-white/[0.06]">
            <Box size={11} aria-hidden /> 3D model (GLB, {fmtMB(entry.bytes.glb)})</a>
        </div>
      </div>
    </div>
  );

  const subsystemDetail = isolated && (
    <div className="space-y-2" data-testid="subsystem-detail">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">{isolated.name}</h3>
        <button type="button" onClick={() => isolate(null)} className="shrink-0 text-[11px] text-ink-dim hover:text-ink">Show all</button>
      </div>
      <p className="text-[11.5px] leading-5 text-ink-dim">{isolated.function}</p>
      {isolated.how.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11.5px] leading-5 text-ink">{isolated.how.map((h, i) => <li key={i}>{h}</li>)}</ul>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Parts" value={`${isolated.partCount}`} />
        <Stat label="Fasteners" value={`${isolated.fastenerCount}`} />
        <Stat label="Mass" value={fmtKg(isolated.massKg)} />
      </div>
      {Object.keys(isolated.specs).length > 0 && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[11px] leading-4">
          {Object.entries(isolated.specs).map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-ink-dim">{k.charAt(0).toUpperCase() + k.slice(1)}</dt><dd className="font-mono text-ink">{v}</dd></div>
          ))}
        </dl>
      )}
    </div>
  );

  const partsList = (
    <div className="flex min-h-0 flex-col gap-2" data-testid="parts-list">
      <div className="flex items-center gap-2">
        <SectionTitle>{isolated ? `Parts in ${isolated.name}` : 'Every part'}</SectionTitle>
        <span className="font-mono text-[10px] text-ink-dim">{lines.length} kinds · {lines.reduce((a, l) => a + qtyIn(l, view.isolate), 0)} pieces</span>
      </div>
      <label className="flex items-center gap-1.5 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1">
        <Search size={12} aria-hidden className="text-ink-dim" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a part: M8, bearing, 12.9 …" aria-label="Find a part"
          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-ink-dim" data-testid="part-search" />
      </label>
      <div className="flex flex-wrap gap-1">
        <Chip active={fastFilter === 'all'} onClick={() => setFastFilter('all')}>All</Chip>
        <Chip active={fastFilter === 'only'} onClick={() => setFastFilter('only')} testId="filter-fasteners">Fasteners only</Chip>
        <Chip active={fastFilter === 'none'} onClick={() => setFastFilter('none')}>No fasteners</Chip>
      </div>
      <ul className="space-y-0.5">
        {lines.map((l) => (
          <PartRow key={l.id} line={l} sub={view.isolate} selected={view.selected === l.id} onSelect={() => set({ selected: view.selected === l.id ? null : l.id })} />
        ))}
        {bom && lines.length === 0 && <li className="px-2 py-2 text-[11.5px] text-ink-dim">No part matches.</li>}
      </ul>
    </div>
  );

  if (error) {
    return <div className="p-4 text-[12px] text-ink-dim" data-testid="robotics-error">{error}</div>;
  }

  // ── layout: three columns at full width, one stacked column at 420 px ──
  if (expanded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="robotics-tab" data-layout="wide">
        <div className="space-y-2 border-b border-white/[0.06] px-3 py-2">
          <Banner />
          <div className="flex flex-wrap items-start justify-between gap-3">{picker}{functions}</div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[290px,minmax(0,1fr),380px]">
          <ScrollArea className="min-h-0 border-r border-white/[0.06]">
            <div className="space-y-4 p-3">{subsystemList}{subsystemDetail || overview}{jointPanel}</div>
          </ScrollArea>
          <div className="flex min-h-0 flex-col">{toolbar}{cycleBar}<div className="min-h-0 flex-1">{viewer}</div></div>
          <div className="flex min-h-0 flex-col border-l border-white/[0.06]">
            {selectedLine && bom && (
              <div className="max-h-[55%] shrink-0 overflow-y-auto border-b border-white/[0.06] p-3">
                <PartCard line={selectedLine} subs={subs} onIsolate={(s) => set({ isolate: s, selected: null })} onClose={() => set({ selected: null })} />
              </div>
            )}
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-3 p-3">{partsList}</div>
            </ScrollArea>
          </div>
        </div>
      </div>
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1" data-testid="robotics-tab" data-layout="narrow">
      <div className="space-y-3 p-3">
        <Banner />
        {picker}
        {/* the desktop widens its side panel; the phone cockpit takes its sheet full screen (its own toggle) */}
        <button type="button" onClick={() => { setPanelExpanded(true); usePhoneSheet.getState().setFullscreen(true); }} data-testid="open-full"
          className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-ink hover:bg-white/[0.06]">
          <Maximize2 size={11} aria-hidden /> Open the full CAD view</button>
        <div className="overflow-hidden rounded border border-white/[0.06]">{toolbar}{cycleBar}<div className="h-[300px]">{viewer}</div></div>
        {functions}
        {subsystemList}
        {jointPanel}
        {subsystemDetail || overview}
        {selectedLine && bom && <PartCard line={selectedLine} subs={subs} onIsolate={(s) => set({ isolate: s, selected: null })} onClose={() => set({ selected: null })} />}
        {partsList}
      </div>
    </ScrollArea>
  );
}

export default TwinRoboticsTab;
