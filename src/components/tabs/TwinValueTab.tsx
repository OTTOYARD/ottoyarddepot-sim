// ============================================================================
// TwinValueTab — what OTTO-Q is worth at this depot, in words anyone can read.
//
// Chase, 2026-09-29: "Try to focus and hone in on a few industry standard
// metrics that are palpable and understandable by customers, and investors.
// Make the savings easy to understand and not just technical slop/jargon. If an
// explainer is needed or overviews as to what's happening and why we are
// effective, then streamline that in a concise way that any audience can view.
// And I guess this will only need to be visible in the twin."
//
// The three cards are his three priorities, in his order: the power bill
// (battery, solar and forward planning), chargers (fewer of them, every car
// fully serviced), and revenue time. Capital is a separate lens: collapsed, and
// never added to the savings.
//
// Chase, 2026-10-02: no heading addresses a reader by type ("For investors"); the
// page explains its numbers to whoever reads it.
//
// Data contract: otto-q-core 0576, ottoq_value_summary, over night 2's sweep
// (0575): OTTO-Q against a plain depot (first come, first served, no energy
// planning), seed by seed. Formatters in src/lib/valueSummary.ts; reads in
// src/hooks/useValueSummary.ts. This file only draws.
//
// WHAT IT WILL NOT DO. It invents no number: until a test day pairs OTTO-Q with
// a plain depot, or while the engine cannot answer, it says what will be
// measured and shows nothing else. Where OTTO-Q is worse, the card says so in
// words, in a neutral colour, never green.
// ============================================================================
import { Component, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BatteryCharging,
  CalendarClock,
  Clock,
  ExternalLink,
  Hourglass,
  Loader2,
  PlugZap,
  Route,
  ShieldCheck,
  Wrench,
  Zap,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useValueSummary } from '@/hooks/useValueSummary';
import {
  DASH,
  DEFAULT_FAST_CHARGERS,
  cellLabel,
  chargerOptions,
  chargersHeadline,
  comparable,
  dayClockCT,
  depotLine,
  footnoteText,
  guaranteeText,
  hasResults,
  investorLines,
  kpiRows,
  notMeasuredText,
  num,
  pairedSeeds,
  powerHeadline,
  progressText,
  revenueHeadline,
  safeHref,
  stillMeasuring,
  viewFor,
  type ChargerView,
  type Headline,
  type ValueSummary,
  type Verdict,
} from '@/lib/valueSummary';

const PANEL = 'rounded border border-white/[0.06] bg-canvas-panel/60';
const HEAD = 'font-display text-[10px] uppercase tracking-[0.08em] text-ink-dim';

/** Better is green. Worse and same are neutral ink, never green. */
const BIG_TONE: Record<Verdict, string> = { better: 'text-emerald-300', worse: 'text-ink', same: 'text-ink' };
const CHANGE_TONE: Record<Verdict, string> = { better: 'text-emerald-300', worse: 'text-ink-dim', same: 'text-ink-faint' };

// The charger choice is a per-viewer convenience: remembered where storage works, 10 (the depot as built) where not.
const CHOICE_KEY = 'ottoq_value_fast_chargers';

function readChoice(): number {
  try {
    const v = Number(window.localStorage.getItem(CHOICE_KEY));
    return Number.isInteger(v) && v > 0 ? v : DEFAULT_FAST_CHARGERS;
  } catch {
    return DEFAULT_FAST_CHARGERS;
  }
}

function saveChoice(n: number) {
  try {
    window.localStorage.setItem(CHOICE_KEY, String(n));
  } catch {
    /* per-viewer convenience only */
  }
}

// ── pieces ──────────────────────────────────────────────────────────────────

function Header({ depot }: { depot: string | null }) {
  return (
    <header className="px-0.5">
      <h2 className="font-display text-[15px] leading-tight text-ink">What OTTO-Q is worth at this depot</h2>
      <p className="mt-1 text-[11px] leading-4 text-ink-dim">
        Same cars, same ride demand, same day. OTTO-Q against a plain depot: first come, first served, no energy
        planning.
      </p>
      {depot && <p className="mt-1 break-words text-[10px] leading-4 text-ink-faint">{depot}</p>}
    </header>
  );
}

function ChargerToggle({ options, value, onChange }: { options: number[]; value: number; onChange: (n: number) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Fast chargers at the depot"
      className="inline-flex max-w-full flex-wrap rounded border border-white/10 bg-white/[0.03] p-0.5"
    >
      {options.map((n) => (
        <button
          key={n}
          type="button"
          role="tab"
          aria-selected={value === n}
          onClick={() => onChange(n)}
          className={`rounded px-2.5 py-1 font-display text-[10px] uppercase tracking-[0.06em] transition-colors ${
            value === n ? 'bg-brand-red text-white' : 'text-ink-faint hover:text-ink-dim'
          }`}
        >
          {n} fast chargers
        </button>
      ))}
    </div>
  );
}

function HeadlineCard({ id, icon: Icon, label, h }: { id: string; icon: typeof Zap; label: string; h: Headline }) {
  const tone = h.verdict ? BIG_TONE[h.verdict] : 'text-ink-faint';
  return (
    <section data-testid={`value-card-${id}`} aria-label={label} className={`${PANEL} p-3`}>
      <div className="flex items-center gap-1.5">
        <Icon size={12} aria-hidden className="shrink-0 text-ink-dim" />
        <span className={HEAD}>{label}</span>
      </div>
      <p className={`mt-1.5 flex flex-wrap items-baseline gap-x-1.5 ${tone}`}>
        <span className="font-mono text-[28px] font-semibold leading-none tabular-nums">{h.big}</span>{' '}
        <span className="text-[13px] leading-tight">{h.words}</span>
      </p>
      <div className="mt-2 space-y-0.5">
        {h.lines.map((line, i) => (
          <p key={i} className="break-words text-[11px] leading-4 text-ink-dim">
            {line}
          </p>
        ))}
      </div>
      {h.detail && <p className="mt-1.5 break-words text-[10px] leading-4 text-ink-faint">{h.detail}</p>}
      {h.range && <p className="mt-0.5 break-words text-[10px] leading-4 text-ink-faint">{h.range}</p>}
    </section>
  );
}

function GuaranteeStrip({ g }: { g: ValueSummary['guarantee'] }) {
  const t = guaranteeText(g);
  if (!t) return null;
  const Icon = t.short ? AlertTriangle : ShieldCheck;
  return (
    <div
      data-testid="value-guarantee"
      className={`flex items-start gap-2 rounded border p-2.5 ${
        t.short
          ? 'border-amber-400/30 bg-amber-400/[0.08] text-amber-200'
          : 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200'
      }`}
    >
      <Icon size={13} aria-hidden className="mt-px shrink-0" />
      <p className="min-w-0 break-words text-[11px] leading-4">{t.text}</p>
    </div>
  );
}

const HOW: { icon: typeof Zap; text: string }[] = [
  {
    icon: CalendarClock,
    text: "Plans every charge ahead against Nashville's time-of-use prices, so cars staying overnight charge when power is cheapest.",
  },
  {
    icon: BatteryCharging,
    text: "Uses the depot's battery and solar to flatten peaks: the monthly demand charge is set by the single busiest half hour.",
  },
  { icon: Route, text: 'Sends each car to the right charger at the right time, cars due out soonest first.' },
  { icon: Wrench, text: 'Runs cleaning, checks and software updates while the car charges, so one stop does everything.' },
];

function HowItWorks() {
  return (
    <section className={`${PANEL} p-3`}>
      <h3 className={HEAD}>How OTTO-Q does it</h3>
      <ul className="mt-2 space-y-1.5">
        {HOW.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2 text-[11px] leading-4 text-ink-dim">
            <Icon size={12} aria-hidden className="mt-0.5 shrink-0 text-ink-faint" />
            <span className="min-w-0">{text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-start gap-2 border-t border-white/[0.06] pt-2 text-[11px] leading-4 text-ink">
        <ShieldCheck size={12} aria-hidden className="mt-0.5 shrink-0 text-ink-dim" />
        <span className="min-w-0">
          Never by cutting corners: no charge is stopped early and no car leaves with a needed service open.
        </span>
      </p>
    </section>
  );
}

const KPI_COLS = ['w-[37%]', 'w-[21%]', 'w-[21%]', 'w-[21%]'];

function KpiTable({ view }: { view: ChargerView }) {
  const rows = kpiRows(view);
  return (
    <section className={`${PANEL} p-3`}>
      <h3 className={HEAD}>The standard measures</h3>
      <table className="mt-2 w-full table-fixed border-collapse">
        <colgroup>
          {KPI_COLS.map((w, i) => (
            <col key={i} className={w} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-[9px] uppercase tracking-[0.06em] text-ink-faint">
            <th scope="col" className="pb-1 text-left font-normal">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col" className="pb-1 pl-1 text-right font-normal">Plain depot</th>
            <th scope="col" className="pb-1 pl-1 text-right font-normal">OTTO-Q</th>
            <th scope="col" className="pb-1 pl-1 text-right font-normal">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tone = r.verdict ? CHANGE_TONE[r.verdict] : 'text-ink-faint';
            return (
              <tr key={r.key} data-testid={`value-kpi-${r.key}`} className="border-t border-white/[0.04] align-top">
                <th scope="row" className="py-1.5 pr-1 text-left text-[10px] font-normal leading-4 text-ink-dim">
                  {r.name}
                </th>
                <td className="break-words py-1.5 pl-1 text-right font-mono text-[10px] leading-4 tabular-nums sm:text-[11px] text-ink-dim">
                  {r.plain}
                  {r.plainNote && <div className="font-ui text-[9px] text-ink-faint">{r.plainNote}</div>}
                </td>
                <td className="break-words py-1.5 pl-1 text-right font-mono text-[10px] leading-4 tabular-nums sm:text-[11px] text-ink">
                  {r.ottoQ}
                  {r.ottoQNote && <div className="font-ui text-[9px] text-ink-faint">{r.ottoQNote}</div>}
                </td>
                <td className={`break-words py-1.5 pl-1 text-right font-mono text-[10px] leading-4 tabular-nums sm:text-[11px] ${tone}`}>
                  {r.change}
                  {r.verdict && r.verdict !== 'same' && <div className="font-ui text-[9px]">{r.verdict}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const TRIGGER = 'py-2.5 text-left text-ink-dim hover:no-underline';

function MoreSections({ summary }: { summary: ValueSummary }) {
  const inv = investorLines(summary.investor);
  const sweep = summary.sweep;
  const lastDay = dayClockCT(sweep?.last_arm_at);
  const sweepLine = sweep
    ? [sweep.code, progressText(sweep), lastDay ? `last test day ${lastDay}` : null].filter(Boolean).join(' · ')
    : null;
  return (
    <Accordion type="multiple" className={`${PANEL} px-3`}>
      {inv && (
        <AccordionItem value="capital" className="border-white/[0.06]">
          <AccordionTrigger className={TRIGGER}>
            <span className="min-w-0">
              <span className={`block ${HEAD}`}>Capital</span>
              <span className="mt-0.5 block text-[10px] font-normal leading-4 text-ink-faint">
                The capital lens, never added to the savings above
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-1.5 pb-3 text-[11px] leading-4 text-ink-dim">
            {inv.statement && <p className="break-words">{inv.statement}</p>}
            {inv.avoided && <p>{inv.avoided}</p>}
            {inv.chargerCapital && <p>{inv.chargerCapital}</p>}
            {inv.fleet && <p>{inv.fleet}</p>}
          </AccordionContent>
        </AccordionItem>
      )}
      <AccordionItem value="sources" className="border-b-0">
        <AccordionTrigger className={TRIGGER}>
          <span className={HEAD}>Sources and test runs</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-3 pb-3">
          {sweep && (
            <div className="space-y-0.5">
              {sweep.title && <p className="break-words text-[11px] leading-4 text-ink-dim">{sweep.title}</p>}
              {sweepLine && <p className="break-words font-mono text-[9px] leading-4 text-ink-faint">{sweepLine}</p>}
            </div>
          )}
          {summary.depot?.tariff && (
            <p className="break-words text-[10px] leading-4 text-ink-dim">Tariff: {summary.depot.tariff}</p>
          )}
          {summary.sources.length > 0 && (
            <ul className="space-y-1">
              {summary.sources.map((s, i) => {
                const href = safeHref(s.url);
                return (
                  <li key={i} className="break-words text-[10px] leading-4 text-ink-dim">
                    <span className="text-ink">{s.what}</span>
                    {s.value && (
                      <>
                        : <span className="font-mono">{s.value}</span>
                      </>
                    )}
                    {href ? (
                      <>
                        {' · '}
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-sky-300 hover:underline"
                        >
                          source
                          <ExternalLink size={9} aria-hidden />
                        </a>
                      </>
                    ) : (
                      typeof s.url === 'string' && s.url && <span className="font-mono text-ink-faint"> · {s.url}</span>
                    )}
                    {s.as_of && <span className="text-ink-faint"> · as of {s.as_of}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {summary.notes.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[10px] leading-4 text-ink-faint">
              {summary.notes.map((note, i) => (
                <li key={i} className="break-words">
                  {note}
                </li>
              ))}
            </ul>
          )}
          {summary.runs.length > 0 && (
            <table className="w-full table-fixed border-collapse text-[9px]">
              <colgroup>
                <col className="w-[58%]" />
                <col className="w-[20%]" />
                <col className="w-[22%]" />
              </colgroup>
              <thead>
                <tr className="uppercase tracking-[0.06em] text-ink-faint">
                  <th scope="col" className="pb-1 text-left font-normal">Test</th>
                  <th scope="col" className="pb-1 text-left font-normal">Seed</th>
                  <th scope="col" className="pb-1 text-left font-normal">Run</th>
                </tr>
              </thead>
              <tbody>
                {summary.runs.map((r, i) => (
                  <tr key={num(r.arm_id) ?? `i${i}`} className="border-t border-white/[0.04] align-top">
                    <td className="break-words py-0.5 pr-1 leading-4 text-ink-dim" title={typeof r.cell === 'string' ? r.cell : undefined}>
                      {typeof r.cell === 'string' ? cellLabel(r.cell, summary.views) : DASH}
                    </td>
                    <td className="break-words py-0.5 pr-1 font-mono leading-4 text-ink-dim">
                      {r.seed === null || r.seed === undefined ? DASH : String(r.seed)}
                    </td>
                    <td
                      className="py-0.5 font-mono leading-4 text-ink-faint"
                      title={typeof r.sim_run_id === 'string' ? r.sim_run_id : undefined}
                    >
                      {typeof r.sim_run_id === 'string' ? r.sim_run_id.slice(0, 8) : DASH}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function NotMeasured({ sweep, error }: { sweep: ValueSummary['sweep']; error: string | null }) {
  const t = notMeasuredText(sweep);
  const done = num(sweep?.arms_done), planned = num(sweep?.arms_planned);
  const pct = t.progress && done !== null && planned ? Math.min(100, Math.max(0, (100 * done) / planned)) : null;
  return (
    <section data-testid="value-not-measured" className={`${PANEL} p-4`}>
      <div className="flex items-start gap-2.5">
        <Hourglass size={14} aria-hidden className="mt-0.5 shrink-0 text-ink-dim" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[12px] leading-5 text-ink">{t.lead}</p>
          {t.progress && (
            <div>
              {pct !== null && (
                <div className="h-1 w-full overflow-hidden rounded bg-white/[0.06]">
                  <div className="h-full rounded bg-sky-400/70" style={{ width: `${pct}%` }} />
                </div>
              )}
              <p className="mt-1 text-[10px] leading-4 text-ink-dim">{t.progress}</p>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-3 text-[10px] leading-4 text-ink-faint" title={error}>
          The results could not be read yet. This page checks again every minute.
        </p>
      )}
    </section>
  );
}

function Results({ summary, error }: { summary: ValueSummary; error: string | null }) {
  const options = chargerOptions(summary);
  const [stored, setStored] = useState<number>(readChoice);
  const chargers = options.includes(stored) ? stored : DEFAULT_FAST_CHARGERS;
  const view = viewFor(summary, chargers);
  const drawable = comparable(view);
  const n = pairedSeeds(view, summary.runs);
  const choose = (c: number) => {
    setStored(c);
    saveChoice(c);
  };

  return (
    <>
      <ChargerToggle options={options} value={chargers} onChange={choose} />

      {stillMeasuring(summary.sweep) && (
        <p className="rounded border border-sky-400/20 bg-sky-400/[0.06] p-2 text-[10px] leading-4 text-sky-200">
          Still measuring: {progressText(summary.sweep)}. These numbers will move until it finishes.
        </p>
      )}

      {drawable ? (
        <div className="space-y-2">
          <HeadlineCard id="power" icon={Zap} label="Power bill" h={powerHeadline(view, n)} />
          <HeadlineCard id="chargers" icon={PlugZap} label="Chargers" h={chargersHeadline(view, n)} />
          <HeadlineCard id="revenue" icon={Clock} label="Revenue time" h={revenueHeadline(view, n)} />
        </div>
      ) : (
        <p className={`${PANEL} p-3 text-[11px] leading-4 text-ink-dim`}>
          Not measured yet with {chargers} fast chargers.
        </p>
      )}

      <GuaranteeStrip g={summary.guarantee} />
      <HowItWorks />
      {drawable && <KpiTable view={view} />}
      <MoreSections summary={summary} />

      <p className="px-0.5 text-[9px] leading-4 text-ink-faint">{footnoteText(summary.sweep)}</p>
      {error && (
        <p className="px-0.5 text-[9px] leading-4 text-ink-faint" title={error}>
          The last refresh did not answer; these are the last numbers read.
        </p>
      )}
    </>
  );
}

/**
 * A payload this page cannot draw falls back to the calm panel instead of blanking the cockpit: nothing above the side
 * panel catches a render error, and the contract is being written alongside this tab.
 */
class ValueBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ── the tab ─────────────────────────────────────────────────────────────────

export function TwinValueTab() {
  const { summary, error, loading } = useValueSummary(true);
  const results = hasResults(summary);

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-3 p-3">
        <Header depot={results ? depotLine(summary.depot) : null} />
        <ValueBoundary fallback={<NotMeasured sweep={null} error="the summary could not be drawn" />}>
          {!summary && loading && !error ? (
            <div className="flex items-center gap-2 px-0.5 text-ink-faint">
              <Loader2 size={14} aria-hidden className="animate-spin" />
              <span className="text-[11px]">Reading what the test days measured…</span>
            </div>
          ) : results ? (
            <Results summary={summary} error={error} />
          ) : (
            <>
              <NotMeasured sweep={summary?.sweep ?? null} error={error} />
              {/* the promise is shown whenever the engine has counted it, even before a pair completes */}
              <GuaranteeStrip g={summary?.guarantee ?? null} />
            </>
          )}
        </ValueBoundary>
      </div>
    </ScrollArea>
  );
}

export default TwinValueTab;
