// ============================================================================
// TwinCopilotTab — OTTO-Q's agentic copilot in the cockpit. Invokes the
// ottoq-nemotron-copilot edge function in the engine project. This is an
// on-demand interpretation of a bounded sample, not a live solver verdict.
// ============================================================================
import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ottoQ } from "@/lib/ottoQClient";
import { readCopilotFailure, type CopilotResult } from "@/lib/copilotError";
import { useTwinStore } from "@/store/twinStore";
import { publicText } from "@/lib/publicNames";

// Minimal markdown: **bold**, headings (lines starting with **N.), and paragraph breaks. The text is the model's own;
// only product names and engine keys in it are put in their public names (publicNames.publicText, Chase 2026-10-07).
function renderAnalysis(text: string) {
  return publicText(text).split(/\n{2,}/).map((para, i) => {
    const parts = para.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
      seg.startsWith("**") && seg.endsWith("**")
        ? <strong key={j} className="text-ink">{seg.slice(2, -2)}</strong>
        : <span key={j}>{seg}</span>
    );
    return <p key={i} className="text-[12px] text-ink-dim leading-relaxed mb-2 whitespace-pre-wrap">{parts}</p>;
  });
}

const Chip = ({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "warn" | "muted" }) => (
  <div className="bg-canvas-panel border border-white/[0.06] rounded-lg px-2.5 py-2">
    <div className="text-[14px] font-display tabular-nums" style={{ color: tone === "good" ? "#00B4A6" : tone === "warn" ? "#F59E0B" : "#E7EAF0" }}>{value}</div>
    <div className="text-[9px] text-ink-faint uppercase tracking-wide mt-0.5">{label}</div>
  </div>
);

export const TwinCopilotTab = () => {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setResult(null); setError(null); setLoading(false); }, [activeSimRunId]);

  const runAudit = async () => {
    if (!activeSimRunId) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, error } = await ottoQ.functions.invoke("ottoq-nemotron-copilot", { body: { sim_run_id: activeSimRunId } });
      if (useTwinStore.getState().activeSimRunId !== activeSimRunId) return;
      if (error) {
        const failure = await readCopilotFailure(error);
        if (useTwinStore.getState().activeSimRunId !== activeSimRunId) return;
        if (failure.summary) setResult({ summary: failure.summary });
        setError(failure.error ?? error.message);
      }
      else if ((data as CopilotResult)?.error) setError((data as CopilotResult).error!);
      else setResult(data as CopilotResult);
    } catch (e) {
      if (useTwinStore.getState().activeSimRunId === activeSimRunId)
        setError(e instanceof Error ? e.message : "unknown error");
    }
    if (useTwinStore.getState().activeSimRunId === activeSimRunId) setLoading(false);
  };

  if (!activeSimRunId) {
    return <div className="flex-1 flex items-center justify-center p-6 text-center text-ink-faint text-xs">Start a run in Run Control. Then audit the OTTO-Q decisions here.</div>;
  }

  const s = result?.summary;
  const sources = s?.by_proposal_source ?? {};

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        <div>
          <div className="font-display text-[10px] text-ink-dim uppercase tracking-[0.08em]">OTTO-Q Copilot · NVIDIA open model</div>
          <p className="text-[11px] text-ink-faint mt-1 leading-snug">On request, a reasoning model reviews up to 80 recent decisions. The live decisions in the OTTO-Q tab are the evidence.</p>
        </div>

        <button
          onClick={runAudit} disabled={loading}
          className="w-full py-2.5 rounded-lg font-display text-[12px] uppercase tracking-wide transition-colors disabled:opacity-50"
          style={{ background: loading ? "#1a2330" : "#00B4A6", color: loading ? "#7e8ea3" : "#04140d" }}
        >
          {loading ? "Audit in progress…" : "Run OTTO-Q audit"}
        </button>

        {error && <div role="alert" className="text-[11px] text-brand-red bg-brand-red/10 border border-brand-red/30 rounded-lg p-2.5">Audit error: {publicText(error)}{s && <p className="mt-1 text-ink-dim">OTTO-Q returned the decision counts below. The model review is not available.</p>}</div>}

        {s && (
          <>
            <div className="grid grid-cols-4 gap-2">
              <Chip label="Decisions" value={s.total} />
              <Chip label="Carried out" value={s.enacted} tone="good" />
              <Chip label="Shield overrides" value={s.overridden} tone="warn" />
              <Chip label="Sources seen" value={Object.keys(sources).length} />
            </div>

            {s.top_override_rules && Object.keys(s.top_override_rules).length > 0 && (
              <div className="bg-canvas-panel border border-white/[0.06] rounded-lg p-2.5">
                <div className="text-[9px] text-ink-faint uppercase tracking-wide mb-1.5">Shield overrides by rule</div>
                {Object.entries(s.top_override_rules).sort((a, b) => b[1] - a[1]).map(([rule, n]) => (
                  <div key={rule} className="flex justify-between text-[11px] py-0.5">
                    <span className="text-ink-dim font-mono text-[10px]">{rule}</span><span className="text-ink tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {result?.analysis && (
          <div className="bg-canvas-panel border border-white/[0.06] rounded-lg p-3">
            <div className="text-[9px] text-ink-faint uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00B4A6]" /> Model review
            </div>
            {renderAnalysis(result.analysis)}
            {result.model && <div className="text-[9px] text-ink-faint mt-2">NVIDIA open model</div>}
          </div>
        )}
      </div>
    </ScrollArea>
  );
};
