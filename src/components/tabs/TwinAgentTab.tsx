// ============================================================================
// TwinAgentTab — the agent layer in plain English: what it read, what it proposed, what happened to it, and what
// OTTO-Q learns from it afterwards.
//
// Chase, 2026-09-29: "the agent tab or the intelligence tab could just be more of that detailed plain English feed and
// live stream of agent decision-making and reading of all variables in real time and proposing and learning and looping."
//
// Sentences: src/lib/agentStream.ts. Reads: the shared decision stream (ottoq_activity_feed_v2, its agent rows), the
// proposal disposition ledger (useDispositions), the stack's agent layer, and the second loop's two boards.
// Design note: docs/OTTO-Q-FUNNEL-AND-AGENT-TABS.md.
// ============================================================================
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RotateCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTwinStore } from "@/store/twinStore";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { useActivityFeedStore } from "@/store/activityFeedStore";
import { useIntelligenceStack } from "@/hooks/useIntelligenceStack";
import { useDispositions } from "@/hooks/useDispositions";
import { useSecondLoop } from "@/hooks/useSecondLoop";
import { EndedState, StreamState } from "@/components/tabs/TwinDecisionLogTab";
import SecondLoopPanel from "@/components/tabs/SecondLoopPanel";
import { TONE_COLOR } from "@/components/tabs/ottoq/funnelGeometry";
import {
  agentPass, frameSentences, isLiveStatus, namesFromRows, offerBatches, tickClocks, type AgentPass, type OfferBatch, type StreamItem, type StreamTone,
} from "@/lib/agentStream";
import { tallyDispositions } from "@/lib/ottoqFunnel";
import { formatClockCT, num } from "@/lib/decisionText";

const Dot = ({ tone }: { tone: StreamTone }) => (
  <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] }} />
);

const fmt = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("en-US"));

function PassCard({ p }: { p: AgentPass }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded border border-violet-400/20 bg-violet-400/[0.04] p-2.5">
      <div className="flex items-start gap-2">
        <Dot tone={p.tone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-medium leading-4 text-ink">{p.headline}</span>
            <span className="shrink-0 font-mono text-[9px] text-ink-faint">{formatClockCT(p.at)}</span>
          </div>
          {p.read && (
            <p className={`mt-1 break-words text-[11px] leading-4 text-ink-dim ${open ? "" : "line-clamp-4"}`}>
              <span className="text-ink-faint">What it read: </span>{p.read}
            </p>
          )}
          {p.directives.length > 0 && open && (
            <div className="mt-1.5">
              <div className="text-[10px] text-ink-faint">What it asked for</div>
              <ul className="mt-0.5 space-y-1">
                {p.directives.map((d, i) => (
                  <li key={i} className="break-words border-l border-violet-400/30 pl-2 text-[11px] leading-4 text-ink-dim">{d}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-1 break-words text-[11px] leading-4 text-ink">{p.chose}</p>
          {p.outcome.length > 0 && <p className="mt-0.5 break-words text-[11px] leading-4 text-ink-dim">{p.outcome.join(" ")}</p>}
          {(p.read || p.directives.length > 0) && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-[10px] text-ink-faint hover:text-ink-dim">
              {open ? "Show less" : p.directives.length ? `Read all, and the ${p.directives.length} directive${p.directives.length === 1 ? "" : "s"}` : "Read all"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function OfferCard({ b }: { b: OfferBatch }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded border border-white/[0.06]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-2 px-2.5 py-2 text-left">
        <Dot tone={b.tone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 break-words text-[11px] leading-4 text-ink">{b.headline}</span>
            <span className="shrink-0 font-mono text-[9px] text-ink-faint">{b.at ? formatClockCT(b.at) : b.tick != null ? `tick ${b.tick}` : "—"}</span>
          </div>
        </div>
        {open ? <ChevronDown size={12} className="mt-0.5 shrink-0 text-ink-dim" /> : <ChevronRight size={12} className="mt-0.5 shrink-0 text-ink-faint" />}
      </button>
      {open && (
        <ul className="space-y-0.5 border-t border-white/[0.06] px-2.5 py-1.5">
          {b.lines.slice(0, 30).map((l) => (
            <li key={l.key} className="flex items-start gap-2 text-[10px] leading-4 text-ink-dim">
              <Dot tone={l.tone} /> <span className="min-w-0 break-words">{l.text}</span>
            </li>
          ))}
          {b.lines.length > 30 && <li className="text-[10px] text-ink-faint">and {b.lines.length - 30} more</li>}
        </ul>
      )}
    </li>
  );
}

/** Read → propose → dispose → learn, each step counted from its own record. */
function Loop({ reads, offers, enacted, refused, graded }: { reads: number | null; offers: number | null; enacted: number | null; refused: number | null; graded: number | null }) {
  const steps = [
    { k: "Read", v: fmt(reads), sub: "agent passes" },
    { k: "Proposed", v: fmt(offers), sub: "offers" },
    { k: "Disposed", v: enacted == null ? "—" : `${fmt(enacted)} / ${fmt(refused)}`, sub: "enacted / refused" },
    { k: "Learned", v: fmt(graded), sub: "questions graded" },
  ];
  return (
    <section aria-label="The loop" className="rounded border border-white/[0.08] bg-canvas-panel/70 p-2.5">
      <ol className="flex items-stretch gap-0.5">
        {steps.map((s, i) => (
          <li key={s.k} className="flex min-w-0 flex-1 items-stretch gap-0.5">
            <div className="min-w-0 flex-1 overflow-hidden rounded bg-white/[0.04] px-1 py-1.5 text-center">
              <div className="truncate font-display text-[9px] uppercase tracking-[0.02em] text-violet-300">{s.k}</div>
              <div className="mt-0.5 truncate font-mono text-[13px] leading-none text-ink">{s.v}</div>
              <div className="mt-0.5 break-words text-[9px] leading-3 text-ink-faint">{s.sub}</div>
            </div>
            {i < steps.length - 1 && <ChevronRight aria-hidden size={9} className="shrink-0 self-center text-ink-faint" />}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-4 text-ink-faint">
        <RotateCw size={10} className="mt-0.5 shrink-0" />
        This run so far. What is learned feeds the next day's decisions only after a person ships it.
      </p>
    </section>
  );
}

/** The board the agent reads, in words, fetched on demand (it runs over every car in the depot). */
function ReadsCard({ status, frame, loading, onRead }: { status: string | null; frame: Record<string, unknown> | null; loading: boolean; onRead: () => void }) {
  const [all, setAll] = useState(false);
  const live = isLiveStatus(status);
  const r = useMemo(() => frameSentences(frame), [frame]);
  return (
    <section aria-label="What the agent reads" className="rounded border border-violet-400/20 bg-violet-400/[0.03] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-[11px] uppercase tracking-[0.08em] text-ink">What the agent reads</div>
          <p className="mt-0.5 text-[10px] leading-4 text-ink-faint">
            The board the agent reads before it chooses: every car's battery, faults, deadlines and blocks, straight from
            the engine. Read on demand, because it looks at every car.
          </p>
        </div>
        {live && (
          <button type="button" onClick={onRead} disabled={loading}
            className="shrink-0 rounded border border-white/15 px-2 py-1 text-[10px] text-ink-dim hover:text-ink disabled:opacity-50">
            {loading ? "Reading…" : frame ? "Read again" : "Read it now"}
          </button>
        )}
      </div>
      {!live ? (
        <p className="mt-1.5 text-[11px] leading-4 text-ink-dim">
          The agent reads the depot live, and this run is not running, so there is nothing current to read.
        </p>
      ) : frame && r.lines.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-ink-faint">The engine returned no board for this run.</p>
      ) : (
        <>
          <ul className="mt-1.5 space-y-1">
            {r.lines.map((l) => <li key={l.key} className="text-[11px] leading-4 text-ink">{l.text}</li>)}
          </ul>
          {r.attention.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-ink-faint">Cars it flags for attention ({r.attention.length})</div>
              <ul className="mt-1 space-y-1">
                {(all ? r.attention : r.attention.slice(0, 4)).map((x) => (
                  <li key={x.name} className="text-[10px] leading-4 text-ink-dim"><span className="font-mono text-ink">{x.name}</span> {x.line}</li>
                ))}
              </ul>
              {r.attention.length > 4 && (
                <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-[10px] text-ink-faint hover:text-ink-dim">
                  {all ? "Show fewer" : `Show all ${r.attention.length}`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

type View = "thinking" | "learning";

export function TwinAgentTab() {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  useActivityFeed();
  const { rows, frozen, error } = useActivityFeedStore();
  const { stack, frame, frameLoading, loadFrame } = useIntelligenceStack(!!simRunId);
  const disp = useDispositions();
  const loop = useSecondLoop(true);
  const [view, setView] = useState<View>("thinking");
  const [limit, setLimit] = useState(30);
  const [showQuiet, setShowQuiet] = useState(false);

  const names = useMemo(() => namesFromRows(rows), [rows]);
  const items = useMemo<StreamItem[]>(() => {
    const passes = rows.filter((r) => r.action === "orchestrator_agent").map(agentPass);
    const batches = offerBatches(disp.rows ?? [], names, tickClocks(rows)).filter((b) => showQuiet || !b.quiet);
    // Both carry the tick they belong to; merged on it, a pass before the offers of its own tick.
    return [...passes, ...batches].sort((a, b) => (b.tick ?? -1) - (a.tick ?? -1) || (a.kind === "pass" ? -1 : 1));
  }, [rows, disp.rows, names, showQuiet]);
  const quietCount = useMemo(() => offerBatches(disp.rows ?? [], names).filter((b) => b.quiet).length, [disp.rows, names]);

  const agentLive = (Array.isArray(stack?.layers) ? stack!.layers! : []).find((l) => l.layer === "L2_AGENT")?.live ?? null;
  const chains = num(agentLive?.chains);
  const fell = num(agentLive?.model_fallbacks);
  const late = num(agentLive?.advice_mean_ticks_late);
  const t = disp.rows ? tallyDispositions(disp.rows) : null;
  const graded = loop.challenger?.questions
    ? loop.challenger.questions.reduce((s, q) => s + (num(q.run?.confirmed) ?? 0) + (num(q.run?.refuted) ?? 0) + (num(q.run?.inconclusive) ?? 0), 0)
    : null;

  const Toggle = (
    <div role="tablist" className="inline-flex shrink-0 rounded border border-white/10 bg-white/[0.03] p-0.5">
      {(["thinking", "learning"] as const).map((v) => (
        <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
          className={`rounded px-2 py-1 font-display text-[10px] uppercase tracking-[0.06em] ${view === v ? "bg-brand-red text-white" : "text-ink-faint hover:text-ink-dim"}`}>
          {v === "thinking" ? "Thinking" : "Learning"}
        </button>
      ))}
    </div>
  );

  const learning = (
    <div className="space-y-2">
      <p className="text-[11px] leading-4 text-ink-dim">
        After the fact, OTTO-Q grades its own decisions: the challenger asks whether the depot could have done better and
        checks the answer later. It never changes the engine. New settings are tested by the research wing in the twin,
        never by OTTO-Q in production, and every result is a recommendation a person decides to ship.
      </p>
      <p className="rounded border border-white/[0.06] p-2 text-[10px] leading-4 text-ink-faint">
        Overnight estimates (how long charges take, when cars return, which chargers fault) are not built yet: no engine
        job produces them, so there is nothing to show here.
      </p>
      <SecondLoopPanel state={loop} />
    </div>
  );

  if (!simRunId) {
    return (
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {Toggle}
          {view === "learning" ? learning : (
            <p className="text-[12px] leading-5 text-ink-dim">
              No simulation is active. When a run is going, each pass of the agent appears here in plain words: what it
              read, what it chose, and what the solver and the decide path did with it. What OTTO-Q learns is under Learning.
            </p>
          )}
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-2.5 p-3 font-ui">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-display text-[12px] uppercase tracking-[0.08em] text-ink">The agent</div>
            <p className="mt-0.5 text-[10px] leading-4 text-ink-faint">
              {chains == null
                ? "Passes this run: —"
                : chains === 0
                  ? "The agent has not run a pass in this run."
                  : `${fmt(chains)} ${chains === 1 ? "pass" : "passes"} this run${fell ? `, ${fmt(fell)} fell back to the deterministic path` : ""}${late != null ? `. Advice lands a mean of ${late} ticks after the tick it read; the tick never waits for it.` : "."}`}
            </p>
          </div>
          {stack?.run?.status && !isLiveStatus(stack.run.status) ? <EndedState /> : <StreamState frozen={frozen} />}
        </div>

        <Loop reads={chains} offers={t ? t.total - t.abstained : null} enacted={t?.enacted ?? null} refused={t?.refused ?? null} graded={graded} />

        {Toggle}

        {view === "learning" ? learning : (
          <>
            <ReadsCard status={stack?.run?.status ?? null} frame={frame} loading={frameLoading} onRead={loadFrame} />
            {quietCount > 0 && (
              <label className="flex items-center gap-2 text-[10px] text-ink-faint">
                <input type="checkbox" checked={showQuiet} onChange={(e) => setShowQuiet(e.target.checked)} className="accent-brand-red" />
                Also show the {quietCount} ticks where every offer was replaced, expired or declined
              </label>
            )}
            {(error || disp.error) && <p className="text-[11px] text-amber-200">Could not read the latest records. Showing what was read last.</p>}
            {items.length === 0 ? (
              <p className="text-[12px] text-ink-dim">
                {frozen ? "Paused before any agent pass arrived." : "No agent pass or offer in the last two sim-hours yet."}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {items.slice(0, limit).map((it) => (it.kind === "pass" ? <PassCard key={it.key} p={it} /> : <OfferCard key={it.key} b={it} />))}
              </ul>
            )}
            {items.length > limit && (
              <button type="button" onClick={() => setLimit((n) => n + 30)} className="w-full rounded border border-white/10 py-1.5 text-[11px] text-ink-dim hover:text-ink">
                Show more ({items.length - limit} more)
              </button>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

export default TwinAgentTab;
