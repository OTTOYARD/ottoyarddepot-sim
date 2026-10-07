// ============================================================================
// LearnedThisRun — the strip on the OTTO-Q tab that shows what the planners learned inside the run being watched: free
// chargers, cars waiting, how many cars the planners plan next, what happened to their offers, and where each refused
// charger went. The words are src/lib/runLearning.ts (tested there); this file only draws them.
//
// It is the same read the planners and the agent make on each pass (otto-q-core 0613), so a viewer sees what OTTO-Q
// was told, not a story about it. On a run that takes the agent's charge-line order (0614), the same read carries the
// order standing now and what the orders did; the strip shows both under "The agent's charge-line order".
// ============================================================================
import { GraduationCap } from "lucide-react";
import { TONE_COLOR } from "./funnelGeometry";
import { agentOrderView, learningError, learningView, type LearningTone, type RunLearning } from "@/lib/runLearning";

const TONE_DOT: Record<LearningTone, string> = { ok: TONE_COLOR.ok, held: TONE_COLOR.held, idle: TONE_COLOR.idle };

export function LearnedThisRun({ data, error }: { data: RunLearning | null; error: string | null }) {
  const view = learningView(data);
  const order = agentOrderView(data);
  const failed = learningError(data, error);
  return (
    <section aria-label="Learned this run" className="rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <GraduationCap aria-hidden size={12} className="shrink-0 text-ink-faint" />
        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Learned this run</div>
      </div>
      {!view ? (
        <p className="mt-1 text-[10.5px] leading-[14px] text-ink-faint">
          {failed ? `The learning read did not answer: ${failed}. —` : "Reading what the planners learned…"}
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
          {view.moved.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[10.5px] leading-[14px] text-ink-dim" aria-label="Offers moved to an equal charger">
              {view.moved.map((m) => <li key={m.key}>{m.text}</li>)}
            </ul>
          )}
          {view.refusals.length > 0 && (
            <details className="mt-1 text-[10.5px] leading-[14px] text-ink-dim">
              <summary className="cursor-pointer select-none text-ink-faint hover:text-ink-dim">
                Where the refused chargers went ({view.refusals.length})
              </summary>
              <ul className="mt-1 space-y-0.5">
                {view.refusals.map((r) => <li key={r.key}>{r.text}</li>)}
              </ul>
            </details>
          )}
          {order && (
            <div className="mt-2 border-t border-white/[0.06] pt-1.5" aria-label="The agent's charge-line order">
              <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-faint">The agent's charge-line order</div>
              <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-[15px] text-ink">
                <span aria-hidden className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE_DOT[order.tone] }} />
                <span>{order.headline}</span>
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-[10px] leading-[14px] text-ink-dim">
                {order.facts.map((f) => <li key={f}>{f}</li>)}
              </ul>
              {order.head.length > 0 && (
                <details className="mt-1 text-[10.5px] leading-[14px] text-ink-dim">
                  <summary className="cursor-pointer select-none text-ink-faint hover:text-ink-dim">
                    The cars it ranked first ({order.head.length})
                  </summary>
                  <ol className="mt-1 space-y-0.5">
                    {order.head.map((h) => <li key={h.key}>{h.text}</li>)}
                  </ol>
                </details>
              )}
            </div>
          )}
          <p className="mt-1 text-[9.5px] text-ink-faint">{view.basis}</p>
        </>
      )}
    </section>
  );
}
