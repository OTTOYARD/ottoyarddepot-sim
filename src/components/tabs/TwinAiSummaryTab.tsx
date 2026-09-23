// ============================================================================
// TwinAiSummaryTab — OTTO-Q's self-analysis of the live run, from the backend
// snapshot (replaces the legacy client-engine AISummaryTab).
//
//   • "Generate Analysis" → instant, free deterministic OTTO-Q narrative.
//   • "✨ Richer AI narrative" → opt-in Gemini pass (no surprise spend), with
//     automatic fallback to the deterministic engine.
// ============================================================================
import { useCallback, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Copy, Download, Brain, Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTwinStore } from "@/store/twinStore";
import { buildTwinContext, deterministicAnalysis, requestLlmAnalysis, type AnalysisResult } from "@/lib/twinAnalysis";

// ── tiny markdown renderer (## h3, ### h4, - bullets, **bold**) ──
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="text-ink font-semibold">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}
function renderMarkdown(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("### ")) return <h4 key={i} className="font-display text-[10px] uppercase tracking-wider text-ink-dim mt-3 mb-1">{line.slice(4)}</h4>;
    if (line.startsWith("## ")) return <h3 key={i} className="text-[13px] font-semibold text-brand-red mt-3 mb-1">{line.slice(3)}</h3>;
    if (line.startsWith("# ")) return <h2 key={i} className="text-sm font-bold text-ink mt-2 mb-1">{line.slice(2)}</h2>;
    if (line.startsWith("- ")) return <p key={i} className="text-[11px] text-ink-dim pl-3 py-0.5 leading-relaxed">• {renderInline(line.slice(2))}</p>;
    if (!line.trim()) return <div key={i} className="h-1.5" />;
    return <p key={i} className="text-[11px] text-ink-dim py-0.5 leading-relaxed">{renderInline(line)}</p>;
  });
}

export const TwinAiSummaryTab = () => {
  const snapshot = useTwinStore((s) => s.snapshot);
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState<null | "rules" | "ai">(null);

  const generate = useCallback((mode: "rules" | "ai") => {
    const snap = useTwinStore.getState().snapshot;
    const hist = useTwinStore.getState().energyHistory;
    if (!snap) { toast.error("No live snapshot yet — start a scenario first."); return; }
    const ctx = buildTwinContext(snap, hist, useTwinStore.getState().layout);
    if (mode === "rules") {
      setResult({ text: deterministicAnalysis(ctx), source: "OTTO-Q engine" });
      return;
    }
    setLoading("ai");
    requestLlmAnalysis(ctx)
      .then((res) => {
        setResult(res);
        if (res.source === "OTTO-Q engine") toast.info("AI narrative unavailable — showing OTTO-Q engine analysis.");
      })
      .finally(() => setLoading(null));
  }, []);

  const copy = useCallback(() => {
    if (result) { navigator.clipboard.writeText(result.text); toast.success("Analysis copied"); }
  }, [result]);

  const download = useCallback(() => {
    if (!result) return;
    const scn = useTwinStore.getState().snapshot?.run?.scenario ?? "run";
    const header = `# OTTOYARD · OTTO-Q Depot Analysis\n\nScenario: ${scn}\nSource: ${result.source}\n\n---\n\n`;
    const blob = new Blob([header + result.text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `OTTOQ-Analysis-${scn}.md`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Analysis downloaded");
  }, [result]);

  if (!activeSimRunId || !snapshot) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <Brain className="w-8 h-8 text-ink-faint/40 mb-3" />
        <p className="text-xs text-ink-dim mb-1">OTTO-Q Analysis</p>
        <p className="text-[10px] text-ink-faint max-w-[220px]">Start a scenario in Run Control, then generate a live analysis of what OTTO-Q is doing.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-3">
          {result ? (
            <div className="rounded-lg bg-canvas-panel border-l-2 border-brand-red p-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5 text-brand-red" />
                  <span className="text-xs font-semibold text-ink">OTTO-Q Analysis</span>
                  <span className="font-mono text-[9px] text-ink-faint border border-white/[0.08] rounded px-1 py-0.5">{result.source}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-ink-dim hover:text-ink" onClick={copy}><Copy className="w-3 h-3 mr-1" /> Copy</Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-ink-dim hover:text-ink" onClick={download}><Download className="w-3 h-3 mr-1" /> Save</Button>
                </div>
              </div>
              <div>{renderMarkdown(result.text)}</div>
              <div className="mt-3 pt-2 border-t border-white/[0.06] flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-ink-dim hover:text-ink" onClick={() => generate("rules")}>
                  <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-ink-dim hover:text-ink" disabled={loading === "ai"} onClick={() => generate("ai")}>
                  {loading === "ai" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />} Richer AI narrative
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Brain className="w-9 h-9 text-brand-red/60 mb-3" />
              <p className="text-sm font-medium text-ink mb-1">Analyze this run</p>
              <p className="text-[11px] text-ink-faint mb-4 max-w-[230px]">
                OTTO-Q will assess fleet readiness, energy posture, stressors, and its own actions from the live snapshot.
              </p>
              <div className="flex flex-col gap-2 items-center">
                <Button size="sm" className="bg-brand-red hover:bg-brand-red/90 text-white font-semibold" onClick={() => generate("rules")}>
                  <Brain className="w-4 h-4 mr-1.5" /> Generate Analysis
                </Button>
                <Button size="sm" variant="ghost" className="text-[10px] text-ink-dim hover:text-ink" disabled={loading === "ai"} onClick={() => generate("ai")}>
                  {loading === "ai" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />} or richer AI narrative (Gemini)
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="px-3 py-2 border-t border-white/[0.06]">
        <span className="text-[9px] text-ink-faint">Analysis reflects the live snapshot · deterministic engine is free + instant · AI narrative is opt-in</span>
      </div>
    </div>
  );
};
