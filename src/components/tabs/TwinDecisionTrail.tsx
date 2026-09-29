// ============================================================================
// TwinDecisionTrail — OTTO-Q's reasoning, one car at a time, in plain words.
//
// Chase, 2026-09-28: "needs to be even a little more simple to understand. I dont want it to look like a lot of
// technical jargon or slop. Just easy to understand reasoning and decision logic trail. Like scenario requested by
// vehicle, scanned, found best solution, proposed, passed, dispatched."
//
// Top: the depot funnel (asked -> planned -> passed safety -> sent -> done), last hour or whole run, with "vehicles
// serviced" as the headline because throughput is OTTO-Q's main objective. Below: one card per car. At rest a card shows
// the car, the step it is on, progress and the next step; a tap opens its full trail, like a package-tracking timeline.
//
// Words: src/lib/plainWords.ts (the glossary the other cockpits carry verbatim). Composition: src/lib/decisionTrail.ts.
// Reads: src/hooks/useDecisionTrail.ts. This file only draws.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Crosshair, Loader2, Search } from 'lucide-react';
import { useDecisionTrail } from '@/hooks/useDecisionTrail';
import { useVehicleStore } from '@/store/vehicleStore';
import {
  BRANCH_LABEL, FUNNEL_LABEL, buildTrail, depotFunnel, isCarRow, windowLabel,
  type FunnelCounts, type Trail, type TrailCard, type TrailStep,
} from '@/lib/decisionTrail';
import { MISSING, clockCT } from '@/lib/plainWords';
import type { ActivityFeedRow } from '@/store/activityFeedStore';

type Window = 'hour' | 'run';
const STAGES = ['asked', 'planned', 'passed', 'sent', 'done'] as const;
const LIST_STEP = 24;

// ── funnel ──────────────────────────────────────────────────────────────────
function Funnel({ counts, window, setWindow, since, capped }: {
  counts: FunnelCounts; window: Window; setWindow: (w: Window) => void; since: string | null; capped: boolean;
}) {
  const chips = (Object.keys(counts.branches) as (keyof FunnelCounts['branches'])[]).filter((k) => counts.branches[k] > 0);
  return (
    <section aria-label="Depot funnel" className="rounded border border-white/[0.08] bg-canvas-panel/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-[10px] uppercase tracking-[0.08em] text-ink-dim">Vehicles serviced</div>
          <div className="flex items-baseline gap-2">
            <span data-testid="serviced-count" className="font-mono text-[34px] font-semibold leading-none text-ink">
              {counts.done}
            </span>
            <span className="truncate text-[11px] text-ink-faint">left ready, {windowLabel(since)}</span>
          </div>
        </div>
        <div role="tablist" className="inline-flex shrink-0 rounded border border-white/10 bg-white/[0.03] p-0.5">
          {(['hour', 'run'] as const).map((w) => (
            <button
              key={w} type="button" role="tab" aria-selected={window === w} onClick={() => setWindow(w)}
              className={`rounded px-2 py-1 font-display text-[10px] uppercase tracking-[0.06em] ${
                window === w ? 'bg-brand-red text-white' : 'text-ink-faint hover:text-ink-dim'}`}
            >
              {w === 'hour' ? 'Last hour' : 'Whole run'}
            </button>
          ))}
        </div>
      </div>

      <ol className="mt-3 grid grid-cols-5 gap-1">
        {STAGES.map((k, i) => (
          <li key={k} className="relative min-w-0 rounded bg-white/[0.04] px-1.5 py-1.5 text-center">
            <div className={`font-mono text-[15px] leading-none ${k === 'done' ? 'text-brand-hot' : 'text-ink'}`}>{counts[k]}</div>
            <div className="mt-1 break-words text-[10px] leading-tight text-ink-dim">{FUNNEL_LABEL[k]}</div>
            {i < STAGES.length - 1 && (
              <ChevronRight aria-hidden size={10} className="absolute -right-[7px] top-1/2 z-10 -translate-y-1/2 text-ink-faint" />
            )}
          </li>
        ))}
      </ol>

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map((k) => (
            <span key={k} className={`rounded-full border px-2 py-0.5 text-[10px] ${
              k === 'blocked' ? 'border-amber-400/30 text-amber-200' : 'border-white/10 text-ink-dim'}`}>
              {BRANCH_LABEL[k]} <span className="font-mono text-ink">{counts.branches[k]}</span>
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] leading-4 text-ink-faint">
        Counted in cars. Every car that asked for a place, then how many OTTO-Q planned for, cleared the safety checks,
        sent to a stall, and saw leave ready.
        {capped ? ' A long run: the whole-run count starts at the oldest decision this view could read.' : ''}
      </p>
    </section>
  );
}

// ── one trail line ──────────────────────────────────────────────────────────
const DOT: Record<TrailStep['tone'], string> = {
  ok: 'bg-emerald-400',
  branch: 'bg-sky-300',
  warn: 'bg-amber-400',
  missing: 'bg-white/25',
};

function Step({ s, last }: { s: TrailStep; last: boolean }) {
  return (
    <li className={`relative flex gap-2.5 ${s.branch ? 'pl-4' : ''}`}>
      <div className="flex w-3 shrink-0 flex-col items-center">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[s.tone]}`} />
        {!last && <span className="w-px flex-1 bg-white/10" />}
      </div>
      <div className="min-w-0 flex-1 pb-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-[12px] font-medium ${s.tone === 'warn' ? 'text-amber-200' : 'text-ink'}`}>{s.title}</span>
          <span className="shrink-0 font-mono text-[10px] text-ink-faint">{s.at ? clockCT(s.at) : MISSING}</span>
        </div>
        {s.detail && <p className="mt-0.5 break-words text-[11px] leading-4 text-ink-dim">{s.detail}</p>}
      </div>
    </li>
  );
}

// ── one car ─────────────────────────────────────────────────────────────────
function CarCard({ trail, open, onToggle, full, loading }: {
  trail: Trail; open: boolean; onToggle: () => void; full: Trail | null; loading: boolean;
}) {
  const shown = open && full ? full : trail;
  return (
    <li className={`rounded border ${open ? 'border-brand-red/50 bg-canvas-elev' : 'border-white/[0.06] bg-canvas-panel/60'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left">
        {open ? <ChevronDown size={13} className="mt-0.5 shrink-0 text-ink-dim" /> : <ChevronRight size={13} className="mt-0.5 shrink-0 text-ink-faint" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-mono text-[12px] text-ink">{trail.name}</span>
            <span className={`min-w-0 text-right text-[11px] ${trail.left ? 'text-emerald-300' : 'text-ink'}`}>{shown.now}</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-white/[0.06]" role="progressbar"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown.progress ?? undefined}>
            {shown.progress != null && <div className="h-full bg-brand-red" style={{ width: `${Math.min(100, Math.max(2, shown.progress))}%` }} />}
          </div>
          <div className="mt-1 text-[10px] text-ink-faint">
            {shown.left ? 'Visit complete' : shown.next ? <>Next: <span className="text-ink-dim">{shown.next}</span></> : 'Next step not planned yet'}
          </div>
        </div>
      </button>
      {open && (
        <div className="border-t border-white/[0.06] px-2.5 pt-2.5">
          {!full && loading ? (
            <div className="flex items-center gap-2 pb-2.5 text-[11px] text-ink-faint"><Loader2 size={12} className="animate-spin" /> Reading this car's decisions…</div>
          ) : (
            <ol aria-label={`${trail.name} decision trail`}>
              {shown.steps.map((s, i) => <Step key={`${s.kind}-${s.at}-${i}`} s={s} last={i === shown.steps.length - 1} />)}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

// ── the panel ───────────────────────────────────────────────────────────────
export function TwinDecisionTrail({ onTechnical }: { onTechnical?: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [window, setWindow] = useState<Window>('run');
  const [limit, setLimit] = useState(LIST_STEP);
  const data = useDecisionTrail(picked);

  // Point at a car in the 2D or 3D view and it is offered here. Reading the hovered car is all this does with the scene.
  const hovered = useVehicleStore((s) => s.hoveredVehicleId);
  const roster = useVehicleStore((s) => s.vehicles);
  const [pointed, setPointed] = useState<string | null>(null);
  useEffect(() => { if (hovered) setPointed(hovered); }, [hovered]);

  const rowsByCar = useMemo(() => {
    const m = new Map<string, ActivityFeedRow[]>();
    for (const r of data.runRows) if (isCarRow(r)) (m.get(r.vehicle_id) ?? m.set(r.vehicle_id, []).get(r.vehicle_id)!).push(r);
    return m;
  }, [data.runRows]);

  const cardFor = (id: string): TrailCard | null =>
    data.cards.find((c) => c.vehicle_id === id && c.card) ?? data.cardMemory.get(id) ?? data.cards.find((c) => c.vehicle_id === id) ?? null;

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data.cards) m.set(c.vehicle_id, c.display_name);
    for (const r of data.runRows) if (r.vehicle_id && r.display_name && !m.has(r.vehicle_id)) m.set(r.vehicle_id, r.display_name);
    return m;
  }, [data.cards, data.runRows]);

  // The pointed-at car in engine terms: the renderer keys cars by the twin's vehicle id, and labels them by fleet name.
  const pointedId = useMemo(() => {
    if (!pointed) return null;
    if (names.has(pointed)) return pointed;
    const label = roster.find((v) => v.id === pointed)?.label?.split(' · ')[0];
    return label ? [...names].find(([, n]) => n === label)?.[0] ?? null : null;
  }, [pointed, names, roster]);

  const trails = useMemo(() => {
    const ids = new Set<string>([...rowsByCar.keys(), ...data.cards.filter((c) => c.card).map((c) => c.vehicle_id)]);
    const list = [...ids].map((id) => {
      const rows = rowsByCar.get(id) ?? [];
      const t = buildTrail({ vehicleId: id, name: names.get(id) ?? MISSING, rows, card: cardFor(id) });
      const lastAt = rows.reduce((mx, r) => Math.max(mx, Date.parse(r.occurred_at)), 0);
      return { t, lastAt };
    });
    // Cars still in the depot first, newest activity first.
    list.sort((a, b) => Number(a.t.left) - Number(b.t.left) || b.lastAt - a.lastAt);
    return list.map((x) => x.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsByCar, data.cards, names]);

  const full = useMemo(() => {
    if (!picked || data.carRows.length === 0) return null;
    return buildTrail({
      vehicleId: picked, name: names.get(picked) ?? MISSING, rows: data.carRows,
      decisions: data.decisions, proposals: data.proposals, choices: data.choices, card: cardFor(picked),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, data.carRows, data.decisions, data.proposals, data.choices, names, data.cards]);

  const clock = data.simClock ?? data.runRows[0]?.occurred_at ?? null;
  const since = window === 'hour' && clock ? new Date(Date.parse(clock) - 3_600_000).toISOString() : null;
  const counts = useMemo(() => depotFunnel(data.runRows, since), [data.runRows, since]);

  const q = query.trim().toLowerCase();
  const shown = q ? trails.filter((t) => t.name.toLowerCase().includes(q)) : trails;
  // A picked car stays on the list even when the filter or the page would hide it.
  const page = shown.slice(0, limit);
  const pickedTrail = picked ? trails.find((t) => t.vehicleId === picked) : undefined;
  if (pickedTrail && !page.includes(pickedTrail)) page.unshift(pickedTrail);

  if (!data.simRunId) {
    return <p className="p-3 text-[12px] text-ink-dim">No simulation is running. Start one on the Control tab and each car's decisions appear here as OTTO-Q makes them.</p>;
  }

  return (
    <div className="space-y-2.5 font-ui">
      <Funnel counts={counts} window={window} setWindow={setWindow} since={since} capped={data.runRowsCapped && window === 'run'} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5">
          <Search size={12} className="shrink-0 text-ink-faint" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a car"
            aria-label="Find a car"
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
        {pointedId && pointedId !== picked && (
          <button type="button" onClick={() => setPicked(pointedId)}
            className="flex shrink-0 items-center gap-1 rounded border border-brand-red/40 px-2 py-1.5 text-[11px] text-ink hover:bg-brand-red/10">
            <Crosshair size={12} className="text-brand-hot" /> Show <span className="font-mono">{names.get(pointedId)}</span>
          </button>
        )}
      </div>

      {data.error && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-200">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Could not read the latest decisions. Showing what was read last.
        </p>
      )}

      {trails.length === 0 ? (
        <p className="p-1 text-[12px] text-ink-dim">
          {data.loading ? 'Reading the run…' : 'No car has asked for anything yet in this run.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {page.map((t) => (
            <CarCard key={t.vehicleId} trail={t} open={picked === t.vehicleId} full={picked === t.vehicleId ? full : null}
              loading={picked === t.vehicleId} onToggle={() => setPicked(picked === t.vehicleId ? null : t.vehicleId)} />
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit((n) => n + LIST_STEP)}
          className="w-full rounded border border-white/10 py-1.5 text-[11px] text-ink-dim hover:text-ink">
          Show more cars ({shown.length - limit} more)
        </button>
      )}

      {onTechnical && (
        <button type="button" onClick={onTechnical}
          className="flex w-full items-center justify-between rounded border border-white/[0.06] px-2.5 py-2 text-left text-[11px] text-ink-dim hover:text-ink">
          <span>How it works (technical)</span>
          <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}

export default TwinDecisionTrail;
