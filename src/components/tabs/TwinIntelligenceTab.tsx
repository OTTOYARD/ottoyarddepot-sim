// ============================================================================
// TwinIntelligenceTab — OTTO-Q's intelligence path, live, in signal order.
//
// This is the panel that answers "what is your AI actually doing" without a
// slide. Five layers, drawn top to bottom in the order a signal travels them:
// the assets push telemetry, the deterministic shield decides what is even
// feasible, the agent reads the frame and picks an objective, the proposers
// propose, and the kernel disposes. Each card carries the layer's job, its live
// numbers, and — the part an auditor cares about — the table those numbers were
// measured from.
//
// Data contract: otto-q-core migration 0351
//   public.ottoq_intelligence_stack(p_sim_run_id uuid, p_include_frame boolean)
// whose assertion A3 re-derives eight of these headline figures by direct query
// and raises if the function and the tables disagree. This panel therefore
// renders a checked number or nothing at all; see src/lib/intelligenceStack.ts
// for the formatters and the one rule they all obey.
//
// WHAT THIS PANEL WILL NOT DO. It does not average, infer, or colour-in. A
// missing metric renders as missing, a warning state renders amber even when
// the run is otherwise healthy, and the two findings that flatter us least —
// the agent being on average a tick late, and a rank-0 proposer that has never
// fired — are printed on the card rather than under it.
// ============================================================================
import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronRight,
  Cpu,
  Loader2,
  RadioTower,
  ShieldCheck,
  Sigma,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import TwinDecisionLogTab from '@/components/tabs/TwinDecisionLogTab';
import { useIntelligenceStack } from '@/hooks/useIntelligenceStack';
import {
  armingTone,
  formatClockCT,
  formatCount,
  formatMs,
  formatPct,
  hasRun,
  humanize,
  layerCaveats,
  layerHeadline,
  num,
  providerLabel,
  statusTone,
  topEntries,
  type StackLayer,
  type Tone,
} from '@/lib/intelligenceStack';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  bad: 'border-brand-red/40 bg-brand-red/10 text-red-300',
  idle: 'border-white/10 bg-white/[0.04] text-ink-faint',
};

const LAYER_ICON: Record<string, typeof Brain> = {
  L0_INGRESS: RadioTower,
  L1_SHIELD: ShieldCheck,
  L2_AGENT: Brain,
  L3_SOLVER: Cpu,
  L4_KERNEL: Sigma,
};

const Chip = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <span
    className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.06em] ${TONE_CLASS[tone]}`}
  >
    {children}
  </span>
);

/** key: value, rendered only when the value exists. */
const Metric = ({ label, value }: { label: string; value: string | null }) =>
  value === null ? null : (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[9px] text-ink-faint">{label}</span>
      <span className="font-mono text-[10px] text-ink">{value}</span>
    </div>
  );

/** A counter object as a short ranked list. Renders nothing when empty. */
const Breakdown = ({
  label,
  value,
  limit = 3,
  humanizeKeys = true,
}: {
  label: string;
  value: unknown;
  limit?: number;
  humanizeKeys?: boolean;
}) => {
  const rows = topEntries(value, limit);
  if (!rows.length) return null;
  return (
    <div className="mt-1.5">
      <div className="text-[9px] text-ink-faint">{label}</div>
      <div className="mt-0.5 space-y-0.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-2">
            <span className="truncate font-mono text-[9px] text-ink-dim">
              {humanizeKeys ? humanize(r.key) ?? r.key : r.key}
            </span>
            <span className="shrink-0 font-mono text-[9px] text-ink">
              {formatCount(r.count)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Per-layer metric bodies. Deliberately five explicit renderers rather than one
// generic key/value dump: each layer's numbers mean a different thing, and a
// generic renderer would print `refusal_rate_pct` next to `packets` as though
// they were comparable.
// ---------------------------------------------------------------------------
const LayerBody = ({ layer }: { layer: StackLayer }) => {
  const live = layer.live;
  if (!live) return null;

  switch (layer.layer) {
    case 'L0_INGRESS': {
      const integrity = live.integrity as Record<string, unknown> | null;
      return (
        <>
          <Metric label="packets" value={formatCount(live.packets)} />
          <Metric label="assets reporting" value={formatCount(live.vehicles_reporting)} />
          <Metric label="full frames" value={formatCount(integrity?.full)} />
          <Metric label="partial" value={formatCount(integrity?.partial)} />
          <Metric label="dropped" value={formatCount(live.dropped)} />
        </>
      );
    }
    case 'L1_SHIELD':
      return (
        <>
          <Metric label="evaluations" value={formatCount(live.evaluations)} />
          <Metric label="blocked" value={formatCount(live.blocked)} />
          <Metric label="distinct rules" value={formatCount(live.distinct_rules)} />
          <Metric label="overridden" value={formatCount(live.overridden)} />
          <Breakdown label="probe points" value={live.by_probe_point} />
          <Breakdown label="top blocking rules" value={live.top_blocking_rules} humanizeKeys={false} />
        </>
      );
    case 'L2_AGENT':
      return (
        <>
          <Metric label="model" value={(live.model as string) ?? null} />
          <Metric label="chains" value={formatCount(live.chains)} />
          <Metric label="avg latency" value={formatMs(live.avg_latency_ms)} />
          <Metric label="max latency" value={formatMs(live.max_latency_ms)} />
          <Metric label="objective" value={humanize(live.objective as string)} />
          <Breakdown label="by source" value={live.by_source} />
          <Breakdown label="handoff" value={live.handoff} humanizeKeys={false} />
          {typeof live.objective_why === 'string' && live.objective_why && (
            <p className="mt-1.5 border-l border-violet-400/30 pl-2 text-[9px] italic leading-4 text-ink-dim">
              “{live.objective_why}”
            </p>
          )}
        </>
      );
    case 'L3_SOLVER': {
      const providers = (live.providers as Record<string, Record<string, unknown>> | null) ?? {};
      const keys = Object.keys(providers).sort();
      return (
        <>
          <Metric label="declared primary" value={humanize(live.declared_primary as string)} />
          <Metric label="primary fires this run" value={formatCount(live.primary_fires)} />
          {keys.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              <div className="text-[9px] text-ink-faint">providers (evidence ledger)</div>
              {keys.map((k) => {
                const p = providers[k] ?? {};
                return (
                  <div key={k} className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[9px] text-ink-dim">{providerLabel(k)}</span>
                    <span className="shrink-0 font-mono text-[9px] text-ink">
                      {[
                        formatCount(p.calls) && `${formatCount(p.calls)} calls`,
                        num(p.proposals) ? `${formatCount(p.proposals)} proposals` : null,
                        formatClockCT(p.last_call as string) && `last ${formatClockCT(p.last_call as string)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      );
    }
    case 'L4_KERNEL':
      return (
        <>
          <Metric label="proposals" value={formatCount(live.proposals)} />
          <Metric label="enacted" value={formatCount(live.enacted)} />
          <Metric label="refused" value={formatCount(live.refused)} />
          <Metric label="superseded" value={formatCount(live.superseded)} />
          <Metric label="expired" value={formatCount(live.expired)} />
          <Metric label="refusal rate" value={formatPct(live.refusal_rate_pct)} />
          <Breakdown label="top refusal reasons" value={live.top_refusal_reasons} limit={4} />
          <Breakdown label="by source / status" value={live.by_source_status} limit={4} humanizeKeys={false} />
        </>
      );
    default:
      return null;
  }
};

const LayerCard = ({ layer, last }: { layer: StackLayer; last: boolean }) => {
  const Icon = LAYER_ICON[layer.layer] ?? Activity;
  const caveats = layerCaveats(layer);

  return (
    <div className="relative pl-6">
      {/* the rail: this is a signal path, not a list of cards */}
      <span className="absolute left-[7px] top-4 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-white/20 bg-canvas-panel" />
      {!last && (
        <span className="absolute left-[7px] top-7 bottom-[-10px] w-px -translate-x-1/2 bg-white/10" />
      )}

      <div className="rounded border border-white/[0.06] bg-canvas-panel/60 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon size={12} className="shrink-0 text-ink-dim" />
            <span className="truncate text-[11px] font-display uppercase tracking-[0.06em] text-ink">
              {layer.name}
            </span>
            <span className="shrink-0 font-mono text-[8px] text-ink-faint">{layer.layer}</span>
          </div>
          <Chip tone={statusTone(layer.status)}>{humanize(layer.status) ?? 'unknown'}</Chip>
        </div>

        <p className="mt-1 text-[9px] leading-4 text-ink-dim">{layer.does}</p>
        <p className="mt-1 font-mono text-[10px] text-ink">{layerHeadline(layer)}</p>

        <div className="mt-2 space-y-0.5 border-t border-white/[0.04] pt-2">
          <LayerBody layer={layer} />
        </div>

        {caveats.map((c) => (
          <div
            key={c}
            className="mt-1.5 flex items-start gap-1.5 rounded border border-amber-400/20 bg-amber-400/[0.06] p-1.5"
          >
            <AlertTriangle size={10} className="mt-px shrink-0 text-amber-300" />
            <span className="text-[9px] leading-4 text-amber-200/90">{c}</span>
          </div>
        ))}

        {/* provenance. The reason a number on this card can be checked. */}
        <p className="mt-2 truncate font-mono text-[8px] text-ink-faint" title={layer.measured_from}>
          measured from {layer.measured_from}
        </p>
      </div>
    </div>
  );
};

const FrameSection = ({
  frame,
  frameLoading,
  loadFrame,
}: {
  frame: Record<string, unknown> | null;
  frameLoading: boolean;
  loadFrame: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const assets = (frame?.assets as Record<string, unknown> | null) ?? null;
  const telemetry = (frame?.telemetry as Record<string, unknown> | null) ?? null;
  const soc = (assets?.soc as Record<string, unknown> | null) ?? null;
  const health = (assets?.health as Record<string, unknown> | null) ?? null;
  const deadlines = (assets?.deadlines as Record<string, unknown> | null) ?? null;
  const constraints = (assets?.hard_constraints as Record<string, unknown> | null) ?? null;
  const attention = Array.isArray(assets?.attention)
    ? (assets?.attention as Array<Record<string, unknown>>)
    : [];

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !frame && !frameLoading) loadFrame();
  };

  return (
    <div className="rounded border border-white/[0.06] bg-canvas-panel/60">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-1.5 p-2.5 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} className="text-ink-dim" /> : <ChevronRight size={12} className="text-ink-dim" />}
        <span className="text-[11px] font-display uppercase tracking-[0.06em] text-ink">
          What the agent saw
        </span>
        {frameLoading && <Loader2 size={11} className="ml-auto animate-spin text-ink-faint" />}
      </button>

      {open && (
        <div className="space-y-2 border-t border-white/[0.04] p-2.5 pt-2">
          <p className="text-[9px] leading-4 text-ink-dim">
            The per-asset board the orchestrator reads before it picks an objective — the same
            payload, not a summary of it. Fetched on demand: it runs over every asset in the depot.
          </p>

          {!frame && !frameLoading && (
            <p className="text-[9px] text-ink-faint">No frame returned for this run.</p>
          )}

          {soc && (
            <div className="space-y-0.5">
              <div className="text-[9px] text-ink-faint">state of charge</div>
              <Metric label="assets" value={formatCount(assets?.n)} />
              <Metric
                label="p10 / p50 / p90"
                value={
                  [soc.p10, soc.p50, soc.p90].every((v) => num(v) !== null)
                    ? `${num(soc.p10)}% / ${num(soc.p50)}% / ${num(soc.p90)}%`
                    : null
                }
              />
              <Metric label="below ready floor" value={formatCount(soc.below_min_ready)} />
            </div>
          )}

          {constraints && (
            <div className="space-y-0.5">
              <div className="text-[9px] text-ink-faint">hard constraints</div>
              <Metric label="DCFC blocked" value={formatCount(constraints.dcfc_blocked)} />
              <Metric label="charge derated" value={formatCount(constraints.charge_derated)} />
              <Breakdown label="block reasons" value={constraints.dcfc_block_reasons} />
            </div>
          )}

          {health && (
            <div className="space-y-0.5">
              <div className="text-[9px] text-ink-faint">health</div>
              <Metric label="open faults" value={formatCount(health.open_faults)} />
              <Metric label="severe faults" value={formatCount(health.severe_faults)} />
              <Metric label="PM overdue" value={formatCount(health.pm_overdue)} />
              <Metric label="software behind" value={formatCount(health.sw_behind)} />
              <Breakdown label="priority class" value={health.by_priority_class} />
            </div>
          )}

          {deadlines && (
            <div className="space-y-0.5">
              <div className="text-[9px] text-ink-faint">deadline pressure</div>
              <Metric label="overdue" value={formatCount(deadlines.overdue)} />
              <Metric label="due in 60m" value={formatCount(deadlines.due_60m)} />
              <Metric label="tightest" value={num(deadlines.tightest_min) === null ? null : `${num(deadlines.tightest_min)}m`} />
            </div>
          )}

          {telemetry && (
            <div className="space-y-0.5">
              <div className="text-[9px] text-ink-faint">
                telemetry trust · last {formatCount(telemetry.window_min) ?? '?'}m
              </div>
              <Metric label="packets" value={formatCount(telemetry.packets)} />
              <Metric label="reporting" value={formatCount(telemetry.vehicles_reporting)} />
              <Metric label="silent" value={formatCount(telemetry.silent_vehicles)} />
              <Metric
                label="max battery temp"
                value={num(telemetry.max_battery_temp_c) === null ? null : `${num(telemetry.max_battery_temp_c)}°C`}
              />
            </div>
          )}

          {attention.length > 0 && (
            <div>
              <div className="text-[9px] text-ink-faint">
                needs attention · {attention.length} of {formatCount(assets?.n) ?? '?'}
              </div>
              <div className="mt-1 space-y-1">
                {attention.map((a, i) => (
                  <div
                    key={typeof a.asset === 'string' ? a.asset : i}
                    className="rounded border border-white/[0.06] bg-canvas-raised/60 p-1.5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-mono text-[9px] text-ink">
                        {String(a.asset ?? 'unnamed')}
                      </span>
                      <span className="shrink-0 font-mono text-[8px] text-ink-faint">
                        {[
                          num(a.soc) === null ? null : `${num(a.soc)}%`,
                          humanize(a.state as string),
                          humanize(a.priority as string),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    {Array.isArray(a.why) && (
                      <ul className="mt-0.5 space-y-px">
                        {(a.why as unknown[]).map((w, j) => (
                          <li key={j} className="text-[8px] leading-3.5 text-ink-dim">
                            · {String(w)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

type IntelView = 'stream' | 'layers';

/** Two ways to read the same intelligence path: what it is doing right now
 *  (stream) and how it is built (layers). Stream is the default because it is
 *  the question a viewer watching a running depot is actually asking. */
const ViewToggle = ({
  view,
  setView,
}: {
  view: IntelView;
  setView: (v: IntelView) => void;
}) => (
  <div className="inline-flex shrink-0 rounded border border-white/10 bg-white/[0.03] p-0.5">
    {(
      [
        ['stream', 'Live stream'],
        ['layers', 'Layers'],
      ] as const
    ).map(([key, label]) => (
      <button
        key={key}
        type="button"
        onClick={() => setView(key)}
        className={`rounded px-2 py-0.5 text-[9px] font-display uppercase tracking-[0.06em] transition-colors ${
          view === key ? 'bg-white/[0.10] text-ink' : 'text-ink-faint hover:text-ink-dim'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

export function TwinIntelligenceTab() {
  const { stack, frame, error, loading, frameLoading, loadFrame, simRunId } =
    useIntelligenceStack(true);
  const [view, setView] = useState<IntelView>('stream');

  const layers = useMemo<StackLayer[]>(
    () => (Array.isArray(stack?.layers) ? (stack?.layers as StackLayer[]) : []),
    [stack],
  );
  const run = stack?.run ?? null;
  const arming = stack?.arming ?? null;
  const primary = arming?.primary_proposer ?? null;

  if (!simRunId) {
    return (
      <div className="flex-1 p-4">
        <p className="text-[11px] text-ink-dim">
          No simulation is active. Start a run from the Black Box tab and the intelligence path
          appears here as it runs.
        </p>
      </div>
    );
  }

  if (!stack && loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-ink-faint">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-[11px]">Reading the intelligence stack…</span>
      </div>
    );
  }

  // STREAM FIRST, LAYERS BEHIND A TOGGLE. Chase, 2026-09-21: "with the
  // intelligence layer in the control panel, I noticed that everything is
  // grouped into sections. I want more of a real time feed of OTTO-Q solvers
  // almost like a live stream of comments and decisions that are coming through
  // and being proposed or enacted."
  //
  // The layered view is NOT deleted, and that is deliberate: it is the only
  // surface that carries the arming verdict, the rank-0-proposer warning and
  // the per-layer caveats, and those are measured findings rather than
  // decoration. What changes is which one a viewer lands on. The stream answers
  // "what is it doing right now", the layers answer "how does it work", and
  // only the first was missing.
  if (view === 'stream') {
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
          <ViewToggle view={view} setView={setView} />
          <span className="truncate font-mono text-[9px] text-ink-faint">
            {formatClockCT(run?.sim_clock ?? null) ?? humanize(run?.status ?? null) ?? ''}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <TwinDecisionLogTab />
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-2 p-3">
        <ViewToggle view={view} setView={setView} />

        {/* ---- run header ---------------------------------------------- */}
        <div className="rounded border border-white/[0.06] bg-canvas-panel/60 p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-display uppercase tracking-[0.06em] text-ink">
                Intelligence path
              </div>
              <div className="mt-0.5 truncate font-mono text-[9px] text-ink-faint">
                {[
                  humanize(run?.scenario ?? null),
                  num(run?.tick) === null ? null : `tick ${formatCount(run?.tick)}`,
                  humanize(run?.status ?? null),
                  num(run?.speed_x) === null ? null : `${num(run?.speed_x)}×`,
                  formatClockCT(run?.sim_clock ?? null),
                ]
                  .filter(Boolean)
                  .join(' · ') || (run?.sim_run_id ? 'run present' : 'no run')}
              </div>
            </div>
            <Chip tone={armingTone(arming?.verdict)}>{humanize(arming?.verdict) ?? 'unknown'}</Chip>
          </div>

          {num(arming?.satisfied) !== null && num(arming?.required) !== null && (
            <p className="mt-1.5 font-mono text-[9px] text-ink-dim">
              arming {formatCount(arming?.satisfied)}/{formatCount(arming?.required)} dials set
              {Array.isArray(arming?.missing) && arming.missing.length > 0
                ? ` · missing ${arming.missing.join(', ')}`
                : ''}
            </p>
          )}

          {/* The honest line. 0349 exists because "armed 7 of 7" was printed
              beside a rank-0 proposer that had never fired. */}
          {primary?.reachable === false && (
            <div className="mt-1.5 flex items-start gap-1.5 rounded border border-amber-400/20 bg-amber-400/[0.06] p-1.5">
              <AlertTriangle size={10} className="mt-px shrink-0 text-amber-300" />
              <span className="text-[9px] leading-4 text-amber-200/90">
                Armed, and the declared primary proposer{' '}
                <span className="font-mono">{humanize(primary.declared ?? null) ?? 'rank 0'}</span>{' '}
                is unreachable: {formatCount(primary.fires) ?? '0'} fires against{' '}
                {formatCount(primary.fell_back) ?? '0'} fall-backs over{' '}
                {formatCount(primary.agent_chains) ?? '0'} chains
                {primary.last_reason ? ` — “${primary.last_reason}”` : ''}
              </span>
            </div>
          )}

          {error && (
            <p className="mt-1.5 font-mono text-[9px] text-red-300">stack read failed: {error}</p>
          )}
        </div>

        {/* ---- the five layers, in signal order ------------------------ */}
        {layers.length === 0 ? (
          <p className="p-1 text-[10px] text-ink-faint">
            {hasRun(stack)
              ? 'The stack returned no layers for this run.'
              : 'No run in the stack response.'}
          </p>
        ) : (
          <div className="space-y-2.5">
            {layers.map((l, i) => (
              <LayerCard key={l.layer} layer={l} last={i === layers.length - 1} />
            ))}
          </div>
        )}

        {/* ---- the frame, on demand ----------------------------------- */}
        <FrameSection frame={frame} frameLoading={frameLoading} loadFrame={loadFrame} />

        {/* ---- review verdict ----------------------------------------- */}
        {stack?.review && (
          <div className="rounded border border-white/[0.06] bg-canvas-panel/60 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-display uppercase tracking-[0.06em] text-ink">
                Loop review
              </span>
              <Chip tone={statusTone(stack.review.verdict === 'ok' ? 'ok' : '')}>
                {humanize(stack.review.verdict ?? null) ?? 'unknown'}
              </Chip>
            </div>
            <p className="mt-1 text-[9px] leading-4 text-ink-dim">
              The last few agent chains traced end to end: agent → shield → solver → kernel. The
              verdict names where the loop stopped, not whether it ran.
            </p>
            <div className="mt-1.5 space-y-0.5">
              <Metric label="chains examined" value={formatCount(stack.review.chains_examined)} />
              <Metric
                label="tick window"
                value={
                  num(stack.review.since_tick) === null || num(stack.review.now_tick) === null
                    ? null
                    : `${formatCount(stack.review.since_tick)} → ${formatCount(stack.review.now_tick)}`
                }
              />
              <Breakdown label="totals" value={stack.review.totals} limit={5} />
            </div>
          </div>
        )}

        <p className="px-1 pb-1 text-[8px] leading-4 text-ink-faint">
          Every figure above is returned by <span className="font-mono">ottoq_intelligence_stack</span>,
          whose assertion A3 re-derives eight of them by direct query against the source tables and
          fails the migration if they disagree. This panel renders what that function measured and
          nothing it did not.
        </p>
      </div>
    </ScrollArea>
  );
}

export default TwinIntelligenceTab;
