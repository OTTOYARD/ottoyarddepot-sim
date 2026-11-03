// ============================================================================
// TwinResearchTab — what the research wing measured, built and recommends, read from otto-q-core 0793's feed
// (public.ottoq_research_feed).
//
// Chase, 2026-11-03: the research lab's results go "into a 'Research' tab in the twin". It is RESEARCH, NOT LIVE: the
// research wing writes these findings beside the engine, nothing in the engine reads them, and a recommendation changes
// nothing at the depot until a person ships it as a certified change. So the banner stands above the list at every
// scroll position, and this tab reads no run, no snapshot and nothing else of the live depot.
//
// Findings by phase, Phase 0 first, newest first in each phase (the feed's own order, sorted again here). Each card: the
// title, a status badge and the kind, the plain-language summary, the metrics as indented "key: value" lines, the
// evidence as text, the measured time in CT, and run ids shortened to 8 characters.
//
// Data: src/hooks/useResearchFeed.ts (reads when the tab opens, then every minute). Words and numbers: src/lib/research.ts.
// This file only draws.
// ============================================================================
import { Component, type ReactNode } from 'react';
import { FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useResearchFeed } from '@/hooks/useResearchFeed';
import type { ResearchFinding } from '@/lib/ottoTwin';
import { publicText } from '@/lib/publicNames';
import { ctTime, groupByPhase, kindLabel, metricLines, shortRunId, statusLabel, type MetricLine } from '@/lib/research';

/** Not one of the depot's live colours: a shipped finding is the only one that reads green. */
const STATUS_TONE: Record<string, string> = {
  in_progress: 'border-white/20 bg-white/[0.05] text-ink',
  measured: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  built: 'border-indigo-400/35 bg-indigo-400/10 text-indigo-200',
  recommended: 'border-amber-400/35 bg-amber-400/10 text-amber-200',
  shipped: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  not_verified: 'border-brand-red/40 bg-brand-red/10 text-red-200',
};
const statusTone = (status: string): string => STATUS_TONE[status] ?? STATUS_TONE.in_progress;

const countText = (n: number): string => `${n} finding${n === 1 ? '' : 's'}`;

// ── pieces ──────────────────────────────────────────────────────────────────

function Banner() {
  return (
    <div
      role="note"
      data-testid="research-banner"
      className="flex items-start gap-2 rounded border border-dashed border-amber-300/50 bg-amber-300/[0.08] px-2.5 py-2"
    >
      <FlaskConical size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
      <p className="min-w-0 text-[11.5px] leading-5 text-ink">
        <span className="font-semibold text-amber-200">Research. Not live.</span>{' '}
        These findings come from the research lab. Nothing here changes the depot until a person ships it.
      </p>
    </div>
  );
}

function Metrics({ lines }: { lines: MetricLine[] }) {
  return (
    <ul data-testid="research-metrics" className="space-y-0.5 rounded bg-white/[0.03] px-2 py-1.5">
      {lines.map((l, i) => (
        <li
          key={i}
          className={`flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-4 ${l.depth > 0 ? 'border-l border-white/10' : ''}`}
          style={l.depth > 0 ? { marginLeft: (l.depth - 1) * 12, paddingLeft: 8 } : undefined}
        >
          <span className="text-ink-dim">{l.label}:</span>
          {l.value !== null && (
            <>
              {' '}
              <span className="min-w-0 break-words font-mono tabular-nums text-ink">{l.value}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function FootLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
      <span className="font-display text-[9px] uppercase tracking-[0.08em] text-ink-dim">{label}:</span>{' '}
      <span className="min-w-0 break-words text-ink">{children}</span>
    </div>
  );
}

function FindingCard({ finding: f }: { finding: ResearchFinding }) {
  const lines = metricLines(f.metrics);
  const measured = ctTime(f.measured_at);
  return (
    <article
      data-testid="research-finding"
      data-slug={f.slug}
      className="space-y-2 rounded-lg border border-white/[0.06] bg-canvas-panel p-3"
    >
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="min-w-0 break-words text-[13px] font-semibold leading-snug text-ink">{publicText(f.title)}</h4>
          <span
            data-testid="research-status"
            className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] ${statusTone(f.status)}`}
          >
            {statusLabel(f.status)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-display text-[9px] uppercase tracking-[0.08em] text-ink-dim">
          <span data-testid="research-kind">{kindLabel(f.kind)}</span>
          {f.item && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono normal-case tracking-normal">{f.item}</span>
            </>
          )}
        </div>
      </header>

      <p className="break-words text-[11.5px] leading-5 text-ink-dim">{publicText(f.summary)}</p>

      {lines.length > 0 && <Metrics lines={lines} />}

      <div className="space-y-1 text-[10.5px] leading-4">
        {f.evidence && <FootLine label="Evidence">{publicText(f.evidence)}</FootLine>}
        <FootLine label="Measured">{measured ?? 'not yet'}</FootLine>
        {f.run_ids.length > 0 && (
          <FootLine label={f.run_ids.length === 1 ? 'Run' : 'Runs'}>
            <span className="inline-flex flex-wrap gap-1">
              {f.run_ids.map((id) => (
                <span
                  key={id}
                  title={id}
                  data-testid="research-run"
                  className="rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-[10px] text-ink"
                >
                  {shortRunId(id)}
                </span>
              ))}
            </span>
          </FootLine>
        )}
      </div>
    </article>
  );
}

function Findings({ findings }: { findings: ResearchFinding[] }) {
  return (
    <div className="space-y-4">
      {groupByPhase(findings).map((g) => (
        <section key={g.phase || 'none'} data-testid="research-phase" data-phase={g.phase} className="space-y-2">
          <h3 className="px-0.5 font-display text-[10px] uppercase tracking-[0.08em] text-ink-dim">
            {g.label} <span className="normal-case tracking-normal">· {countText(g.findings.length)}</span>
          </h3>
          {g.findings.map((f) => (
            <FindingCard key={f.slug} finding={f} />
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * The findings carry whatever JSON the research wing wrote. A payload this tab cannot draw shows a calm line instead of
 * blanking the cockpit (nothing above the side panel catches a render error), and the next reading tries again.
 */
export class ResearchBoundary extends Component<
  { resetKey: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ── the tab ─────────────────────────────────────────────────────────────────

export function TwinResearchTab() {
  const { feed, error, refreshing, refresh } = useResearchFeed();
  const readAt = ctTime(feed?.read_at);
  const n = feed?.findings.length ?? 0;

  let body: ReactNode;
  if (!feed && error) {
    body = (
      <div data-testid="research-error" className="flex flex-col items-center gap-1 p-4 text-center">
        <p className="text-xs text-ink">Could not read the research findings.</p>
        <p className="break-words text-[10px] text-brand-hot">{publicText(error)}</p>
        <p className="text-[10px] text-ink-dim">This tab tries again every minute.</p>
        <Button size="sm" variant="ghost" className="mt-1 text-[10px] text-ink-dim" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  } else if (!feed) {
    body = (
      <div data-testid="research-loading" className="flex items-center justify-center gap-2 p-4 text-ink-dim">
        <Loader2 size={14} aria-hidden className="animate-spin" />
        <span className="text-xs">Reading the findings…</span>
      </div>
    );
  } else if (n === 0) {
    body = (
      <div data-testid="research-empty" className="p-4 text-center">
        <p className="text-xs text-ink">No findings yet.</p>
        <p className="mt-1 text-[10px] text-ink-dim">The research lab puts its findings here.</p>
      </div>
    );
  } else {
    body = (
      <ResearchBoundary
        resetKey={feed.read_at}
        fallback={<p className="p-4 text-center text-xs text-ink">The findings could not be drawn. This tab tries again every minute.</p>}
      >
        <Findings findings={feed.findings} />
      </ResearchBoundary>
    );
  }

  return (
    <div data-testid="research-tab" className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl space-y-2 px-2 pt-2">
        <Banner />
        <div className="flex items-center justify-between gap-2 px-0.5 pb-1">
          <span data-testid="research-read" className="text-[11px] text-ink-dim">
            {feed ? `${countText(n)}${readAt ? ` · read ${readAt}` : ''}` : null}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px] text-ink-dim hover:text-ink"
            onClick={refresh}
            aria-label="Read the findings again"
            title="Read the findings again"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          </Button>
        </div>
        {feed && error && (
          <p data-testid="research-stale" className="px-0.5 text-[10px] leading-4 text-ink-dim" title={publicText(error)}>
            The last refresh did not answer. These findings are from {readAt ?? 'the last reading'}.
          </p>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl p-2">{body}</div>
      </ScrollArea>
    </div>
  );
}

export default TwinResearchTab;
