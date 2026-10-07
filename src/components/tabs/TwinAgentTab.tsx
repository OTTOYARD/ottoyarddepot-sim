// ============================================================================
// TwinAgentTab — the agent layer in plain English: what it read, what it proposed, what happened to it, and what
// OTTO-Q learns from it afterwards.
//
// Chase, 2026-09-29: "the agent tab or the intelligence tab could just be more of that detailed plain English feed and
// live stream of agent decision-making and reading of all variables in real time and proposing and learning and looping."
//
// Sentences: src/lib/agentStream.ts. Reads: the shared decision stream (ottoq_activity_feed_v2, its agent rows), the
// proposal disposition ledger (useDispositions), the stack's agent layer, and the second loop's two boards. The live
// stream also carries what owners' agents asked of their cars (otto-q-core 0608, ownerBoardStore).
// Design note: docs/OTTO-Q-FUNNEL-AND-AGENT-TABS.md.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronRight, RotateCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTwinStore } from "@/store/twinStore";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { useActivityFeedStore } from "@/store/activityFeedStore";
import { useOwnerBoardStore } from "@/store/ownerBoardStore";
import { boardStateText, ownerFeedLines } from "@/lib/ownerBoard";
import { useIntelligenceStack } from "@/hooks/useIntelligenceStack";
import { useDispositions } from "@/hooks/useDispositions";
import { useAgentOrders } from "@/hooks/useAgentOrders";
import { useSecondLoop } from "@/hooks/useSecondLoop";
import { EndedState, StreamState } from "@/components/tabs/TwinDecisionLogTab";
import SecondLoopPanel from "@/components/tabs/SecondLoopPanel";
import { TONE_COLOR } from "@/components/tabs/ottoq/funnelGeometry";
import {
  agentPass, frameSentences, isLiveStatus, namesFromRows, offerBatches, tickClocks, type AgentPass, type OfferBatch, type StreamItem, type StreamTone,
} from "@/lib/agentStream";
import { tallyDispositions } from "@/lib/ottoqFunnel";
import { formatClockCT, num } from "@/lib/decisionText";
import { liveFeed, type FeedItem, type FeedKind, type FeedLine } from "@/lib/liveFeed";

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

// ── the live stream: one line per decision, arriving one at a time ───────────────────────────────────────────────
const KIND_LABEL: Record<FeedKind, string> = { car: "Cars", agent: "Agent", offers: "Planners", energy: "Energy", owner: "Owners" };
const clock = (l: { at: string | null; tick: number | null }) => (l.at ? formatClockCT(l.at) : l.tick != null ? `tick ${l.tick}` : "—");
const IN = "animate-in fade-in slide-in-from-top-1 duration-300";

/** A command an owner's agent sent: its own kind of line, in the agent's violet (as OrchestrAV draws it), with OTTO-Q's
 *  confirmation code. Taps open to the rest of OTTO-Q's receipt. Its clock is the sim clock it was sent at, like every
 *  other line's; the real time it was sent is on hover. */
function OwnerRow({ l, fresh }: { l: FeedLine; fresh: boolean }) {
  const [open, setOpen] = useState(false);
  const o = l.owner;
  const more = !!o && o.more.length > 0;
  const sent = [o?.sent ? `sent ${o.sent}` : null, o?.sim ?? null].filter(Boolean).join(" · ");
  return (
    <li className={`rounded border border-violet-500/40 bg-violet-500/10 ${fresh ? IN : ""}`} data-testid="owner-line">
      <button type="button" disabled={!more} onClick={() => setOpen((v) => !v)} aria-expanded={more ? open : undefined}
        className="flex w-full items-start gap-2 px-1.5 py-[3px] text-left disabled:cursor-default">
        <Bot size={11} aria-hidden className="mt-[2px] shrink-0 text-violet-300" />
        <span className="min-w-0 flex-1 break-words text-[11.5px] leading-4 text-violet-100">
          <span className="mr-1 font-display text-[9px] uppercase tracking-[0.08em] text-violet-300">Owner</span>
          {l.text}
          {o?.code && (
            <> · <code className="rounded border border-violet-400/40 bg-violet-500/15 px-1 font-mono text-[10px] text-violet-50">{o.code}</code></>
          )}
          {o?.note && <span className="ml-1 text-[10px] text-ink-faint">({o.note})</span>}
        </span>
        <span className="mt-[1px] shrink-0 font-mono text-[9px] text-ink-faint" title={sent || undefined}>{clock(l)}</span>
      </button>
      {open && o && (
        <ul className="space-y-0.5 border-t border-violet-500/20 px-2 py-1">
          {o.more.map((m, i) => <li key={i} className="break-words text-[10.5px] leading-4 text-ink-dim">{m}</li>)}
        </ul>
      )}
    </li>
  );
}

function FeedRow({ l, fresh }: { l: FeedLine; fresh: boolean }) {
  const [open, setOpen] = useState(false);
  const expandable = !!l.pass || !!l.batch;
  const accent = l.kind === "agent" ? "border-violet-400/25 bg-violet-400/[0.05]" : "border-transparent";
  return (
    <li className={`rounded border ${accent} ${fresh ? IN : ""}`}>
      <button type="button" disabled={!expandable} onClick={() => setOpen((o) => !o)} aria-expanded={expandable ? open : undefined}
        className="flex w-full items-start gap-2 px-1.5 py-[3px] text-left disabled:cursor-default">
        <Dot tone={l.tone} />
        <span className={`min-w-0 flex-1 text-[11.5px] leading-4 ${l.kind === "agent" ? "text-violet-100" : "text-ink"} ${open ? "" : "line-clamp-2"}`}>
          {l.kind === "agent" && <span className="mr-1 font-display text-[9px] uppercase tracking-[0.08em] text-violet-300">Agent</span>}
          {l.kind === "offers" && <span className="mr-1 font-display text-[9px] uppercase tracking-[0.08em] text-ink-faint">Planners</span>}
          {l.text}
        </span>
        <span className="mt-[1px] shrink-0 font-mono text-[9px] text-ink-faint">{clock(l)}</span>
      </button>
      {open && l.pass && <ul className="px-1 pb-1"><PassCard p={l.pass} /></ul>}
      {open && l.batch && <ul className="px-1 pb-1"><OfferCard b={l.batch} /></ul>}
    </li>
  );
}

function FeedTile({ g, fresh }: { g: Extract<FeedItem, { kind: "group" }>; fresh: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? g.lines : g.lines.slice(0, 6);
  return (
    <li className={`rounded border border-white/[0.08] bg-white/[0.02] px-2 py-1.5 ${fresh ? IN : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-[11.5px] font-medium text-ink"><Dot tone={g.tone} />{g.title}</span>
        <span className="shrink-0 font-mono text-[9px] text-ink-faint">{clock(g)}</span>
      </div>
      <ul className="mt-1 space-y-0.5 border-l border-white/10 pl-2">
        {shown.map((l) => <li key={l.key} className="text-[10.5px] leading-4 text-ink-dim">{l.text}</li>)}
      </ul>
      {g.lines.length > 6 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-0.5 text-[10px] text-ink-faint hover:text-ink-dim">
          {all ? "Show fewer" : `and ${g.lines.length - 6} more`}
        </button>
      )}
    </li>
  );
}

/** Items already there when the tab opens show at once; each new one is let in on its own, every STEP_MS, so a tick's
 *  decisions stream in one at a time instead of landing as a block. Paused runs let nothing in. */
const STEP_MS = 450;
function useTrickle(items: FeedItem[], paused: boolean) {
  const shown = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [fresh, setFresh] = useState<string[]>([]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!items.length) return;
    if (!shown.current) { shown.current = new Set(items.map((i) => i.key)); bump((n) => n + 1); return; }
    const add = items.map((i) => i.key).filter((k) => !shown.current!.has(k)).reverse(); // oldest first
    if (add.length) setQueue((q) => [...q, ...add.filter((k) => !q.includes(k))]);
  }, [items]);
  useEffect(() => {
    if (!queue.length || paused) return;
    const t = window.setTimeout(() => {
      const [k, ...rest] = queue;
      shown.current!.add(k);
      setFresh((f) => [...f, k].slice(-12));
      setQueue(rest);
    }, queue.length > 12 ? 90 : STEP_MS); // a big batch streams faster, so the feed never falls far behind
    return () => window.clearTimeout(t);
  }, [queue, paused]);
  const visible = shown.current ? items.filter((i) => shown.current!.has(i.key)) : [];
  return { visible, incoming: queue.length, fresh: new Set(fresh) };
}

function LiveFeed({ items, frozen, ownerNote }: { items: FeedItem[]; frozen: boolean; ownerNote?: string | null }) {
  const [only, setOnly] = useState<FeedKind | null>(null);
  const [limit, setLimit] = useState(80);
  const { visible, incoming, fresh } = useTrickle(items, frozen);
  const kindOf = (i: FeedItem): FeedKind => (i.kind === "group" ? "car" : i.kind);
  const list = only ? visible.filter((i) => kindOf(i) === only) : visible;
  return (
    <section aria-label="Live decisions" className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {([null, "car", "agent", "offers", "energy", "owner"] as (FeedKind | null)[]).map((k) => (
          <button key={k ?? "all"} type="button" onClick={() => setOnly(k)} aria-pressed={only === k}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${only === k ? "border-brand-red/60 bg-brand-red/10 text-ink" : "border-white/10 text-ink-dim"}`}>
            {k ? KIND_LABEL[k] : "All"}
          </button>
        ))}
        {incoming > 0 && <span className="ml-auto font-mono text-[9px] text-ink-faint">+{incoming} incoming</span>}
      </div>
      {ownerNote && (
        <p className="flex items-start gap-1.5 rounded border border-violet-500/30 bg-violet-500/[0.06] px-2 py-1 text-[10.5px] leading-4 text-violet-200" data-testid="owner-board-state">
          <Bot size={11} aria-hidden className="mt-[2px] shrink-0" />{ownerNote}
        </p>
      )}
      {list.length === 0 ? (
        <p className="text-[11px] text-ink-dim">
          {only === "owner" ? "No owner's agent has sent anything on this run yet." : frozen ? "Paused." : "No decisions in the last two sim-hours yet."}
        </p>
      ) : (
        <ul className="space-y-[2px]">
          {list.slice(0, limit).map((i) => (i.kind === "group" ? <FeedTile key={i.key} g={i} fresh={fresh.has(i.key)} />
            : i.kind === "owner" ? <OwnerRow key={i.key} l={i} fresh={fresh.has(i.key)} />
            : <FeedRow key={i.key} l={i} fresh={fresh.has(i.key)} />))}
        </ul>
      )}
      {list.length > limit && (
        <button type="button" onClick={() => setLimit((n) => n + 80)} className="w-full rounded border border-white/10 py-1.5 text-[11px] text-ink-dim hover:text-ink">
          Show older ({list.length - limit} more)
        </button>
      )}
    </section>
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
          The agent reads the live depot. This run is not active, so there is nothing current to read.
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

type View = "live" | "thinking" | "learning";

export function TwinAgentTab() {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  useActivityFeed();
  const { rows, frozen, error } = useActivityFeedStore();
  const { stack, frame, frameLoading, loadFrame } = useIntelligenceStack(!!simRunId);
  const disp = useDispositions();
  const orders = useAgentOrders();
  const loop = useSecondLoop(true);
  const [view, setView] = useState<View>("live");
  const [limit, setLimit] = useState(30);
  const [showQuiet, setShowQuiet] = useState(false);

  const names = useMemo(() => namesFromRows(rows), [rows]);
  const items = useMemo<StreamItem[]>(() => {
    const passes = rows.filter((r) => r.action === "orchestrator_agent").map((r) => agentPass(r, orders.byChain));
    const batches = offerBatches(disp.rows ?? [], names, tickClocks(rows)).filter((b) => showQuiet || !b.quiet);
    // Both carry the tick they belong to; merged on it, a pass before the offers of its own tick.
    return [...passes, ...batches].sort((a, b) => (b.tick ?? -1) - (a.tick ?? -1) || (a.kind === "pass" ? -1 : 1));
  }, [rows, disp.rows, names, showQuiet, orders.byChain]);
  // What owners' agents asked of their cars on this run (otto-q-core 0608), polled for the whole cockpit by useOwnerBoard.
  // Its lines join the stream once the stream's first page is in: the stream shows what is already there when the tab
  // opens all at once, and only plays in what arrives after (useTrickle), so lines landing before that page would make
  // the whole page play in one at a time.
  const ownerCommands = useOwnerBoardStore((s) => s.commands);
  const ownerStatus = useOwnerBoardStore((s) => s.status);
  const ownerMessage = useOwnerBoardStore((s) => s.message);
  const ownerBoard = useOwnerBoardStore((s) => s.board);
  const streamIn = rows.length > 0;
  const owners = useMemo(() => (streamIn ? ownerFeedLines(ownerCommands, simRunId) : []), [streamIn, ownerCommands, simRunId]);
  const ownerNote = boardStateText(ownerStatus, ownerMessage, !!ownerBoard);
  const feed = useMemo(
    () => liveFeed(rows, offerBatches(disp.rows ?? [], names, tickClocks(rows)).filter((b) => !b.quiet), owners, orders.byChain),
    [rows, disp.rows, names, owners, orders.byChain],
  );
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
      {(["live", "thinking", "learning"] as const).map((v) => (
        <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
          className={`rounded px-2 py-1 font-display text-[10px] uppercase tracking-[0.06em] ${view === v ? "bg-brand-red text-white" : "text-ink-faint hover:text-ink-dim"}`}>
          {v === "live" ? "Live" : v === "thinking" ? "Agent passes" : "Learning"}
        </button>
      ))}
    </div>
  );

  const learning = (
    <div className="space-y-2">
      <p className="text-[11px] leading-4 text-ink-dim">
        OTTO-Q grades its own decisions after they occur. The challenger asks if the depot could have done better. It
        checks the answer later and never changes the engine. The research wing tests new settings in the twin, never
        OTTO-Q in production. Each result is a recommendation, and a person decides to ship it.
      </p>
      <p className="rounded border border-white/[0.06] p-2 text-[10px] leading-4 text-ink-faint">
        Overnight estimates (charge times, return times, charger faults) are not built yet. No engine job makes them, so
        there is nothing to show here.
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
            <div className="text-[12px] leading-5 text-ink-dim">
              <p>No run is active. During a run, this panel shows each agent pass:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>what the agent read</li>
                <li>what it chose</li>
                <li>what the solver and the decide path did</li>
              </ul>
              <p className="mt-1">Learning shows what OTTO-Q learns.</p>
            </div>
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
            {view !== "live" && <p className="mt-0.5 text-[10px] leading-4 text-ink-faint">
              {chains == null
                ? "Passes this run: —"
                : chains === 0
                  ? "The agent has not run a pass in this run."
                  : `${fmt(chains)} ${chains === 1 ? "pass" : "passes"} this run${fell ? `, ${fmt(fell)} fell back to the decide path` : ""}${late != null ? `. Advice arrives a mean of ${late} ticks after the tick it read. The tick never waits for it.` : "."}`}
            </p>}
            {view === "live" && <p className="mt-0.5 text-[10px] leading-4 text-ink-faint">One line for each OTTO-Q decision, when it occurs.</p>}
          </div>
          {stack?.run?.status && !isLiveStatus(stack.run.status) ? <EndedState /> : <StreamState frozen={frozen} />}
        </div>

        {view === "thinking" && <Loop reads={chains} offers={t ? t.total - t.abstained : null} enacted={t?.enacted ?? null} refused={t?.refused ?? null} graded={graded} />}

        {Toggle}

        {view === "live" ? <LiveFeed items={feed} frozen={frozen} ownerNote={ownerNote} /> : view === "learning" ? learning : (
          <>
            <ReadsCard status={stack?.run?.status ?? null} frame={frame} loading={frameLoading} onRead={loadFrame} />
            {quietCount > 0 && (
              <label className="flex items-center gap-2 text-[10px] text-ink-faint">
                <input type="checkbox" checked={showQuiet} onChange={(e) => setShowQuiet(e.target.checked)} className="accent-brand-red" />
                Also show the {quietCount} ticks where every offer was replaced, expired or declined
              </label>
            )}
            {(error || disp.error) && <p className="text-[11px] text-amber-200">Could not read the latest records. This shows the last records read.</p>}
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
