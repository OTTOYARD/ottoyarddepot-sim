// ============================================================================
// SelfReview — the card on the OTTO-Q tab that shows the engine's own morning review of its check: the week's agent
// orders replayed with what actually happened, what made its forecasts wrong, the places it says it falls short, and
// the charge clock it learned from the depot's own charges. The words are src/lib/selfAssessment.ts (tested there);
// this file only draws them.
//
// The findings are for the research team. The production engine never changes its own rules or settings from them;
// a person decides what gets built (otto-q-core CLAUDE.md rule 10), and the card says so.
// ============================================================================
import { ChevronRight, ClipboardCheck } from "lucide-react";
import { TONE_COLOR } from "./funnelGeometry";
import { selfAssessmentView, type ClockFitRow, type ReviewArea, type SelfAssessmentRow } from "@/lib/selfAssessment";
import type { LearningTone } from "@/lib/runLearning";

const TONE_DOT: Record<LearningTone, string> = { ok: TONE_COLOR.ok, held: TONE_COLOR.held, idle: TONE_COLOR.idle };
/** The twin's one data hue for a bar list (TwinKpisTab's ServiceBars): a magnitude, not a state. */
const BAR = "#3987e5";

function Area({ a }: { a: ReviewArea }) {
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer select-none list-none items-baseline gap-1.5 text-[10.5px] leading-[14px] text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden size={10} className="shrink-0 translate-y-[1px] self-start text-ink-faint transition-transform group-open:rotate-90" />
          <span className="shrink-0 rounded-sm border border-white/[0.12] px-1 py-px text-[8.5px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
            {a.kindLabel}
          </span>
          <span>{a.title}</span>
        </summary>
        <p className="mt-0.5 pl-4 text-[10px] leading-[14px] text-ink-dim">{a.finding}</p>
      </details>
    </li>
  );
}

export function SelfReview({ review, clock, error, loaded }: {
  review: SelfAssessmentRow | null; clock: ClockFitRow | null; error: string | null; loaded: boolean;
}) {
  const view = selfAssessmentView(review, clock);
  return (
    <section aria-label="Morning self-review" className="rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <ClipboardCheck aria-hidden size={12} className="shrink-0 text-ink-faint" />
        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Morning self-review</div>
      </div>
      {!view ? (
        <p className="mt-1 text-[10.5px] leading-[14px] text-ink-faint">
          {error ? `The review read did not answer: ${error}. —` : loaded ? "No review has been written for this depot yet." : "Reading the engine's last review…"}
        </p>
      ) : (
        <>
          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-[15px] text-ink">
            <span aria-hidden className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE_DOT[view.tone] }} />
            <span>{view.headline}</span>
          </p>
          {view.facts.length > 0 && (
            <ul className="mt-1 space-y-0.5 font-mono text-[10px] leading-[14px] text-ink-dim">
              {view.facts.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}

          {view.causes.length > 0 && (
            <div className="mt-2" aria-label={view.causesLabel}>
              <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{view.causesLabel}</div>
              <ul className="mt-1 space-y-1">
                {view.causes.map((c) => (
                  <li key={c.key} title={c.detail}>
                    <div className="flex items-baseline justify-between gap-2 text-[10.5px] leading-[14px]">
                      <span className="min-w-0 truncate text-ink-dim">{c.label}</span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink">{c.text}</span>
                    </div>
                    <div className="mt-0.5 h-1 w-full rounded-full bg-white/[0.08]">
                      <div className="h-1 rounded-full" style={{ width: `${Math.max(2, c.pct)}%`, background: BAR }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.areas.length > 0 && (
            <div className="mt-2" aria-label="Where the check falls short">
              <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Where it says the check falls short</div>
              <ol className="mt-1 space-y-1">
                {view.areas.map((a) => <Area key={a.key} a={a} />)}
              </ol>
              {view.more.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer select-none text-[10.5px] leading-[14px] text-ink-faint hover:text-ink-dim">
                    The other {view.more.length}
                  </summary>
                  <ol className="mt-1 space-y-1">
                    {view.more.map((a) => <Area key={a.key} a={a} />)}
                  </ol>
                </details>
              )}
              <p className="mt-1 text-[9.5px] leading-[13px] text-ink-faint">
                Findings for the research team. OTTO-Q does not change its own rules or settings from them; a person decides what to build.
              </p>
            </div>
          )}

          {view.clock && (
            <div className="mt-2 border-t border-white/[0.06] pt-1.5" aria-label="The charge clock it learned">
              <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-faint">The charge clock it learned</div>
              <p className="mt-1 text-[10.5px] leading-[14px] text-ink">{view.clock.headline}</p>
              {view.clock.facts.length > 0 && (
                <ul className="mt-1 space-y-0.5 font-mono text-[10px] leading-[14px] text-ink-dim">
                  {view.clock.facts.map((f) => <li key={f}>{f}</li>)}
                </ul>
              )}
              <p className="mt-1 text-[9.5px] leading-[13px] text-ink-faint">{view.clock.note}</p>
            </div>
          )}
          <p className="mt-1 text-[9.5px] text-ink-faint">{view.basis}</p>
        </>
      )}
    </section>
  );
}
