import { useCallback } from 'react';
import { useAIStore } from '@/store/aiStore';
import { useSimulationStore } from '@/store/simulationStore';
import { requestAnalysis } from '@/lib/aiAnalysis';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Copy, Download, Brain, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

function renderMarkdown(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('### '))
      return <h4 key={i} className="text-xs font-semibold text-otto-teal mt-3 mb-1">{line.slice(4)}</h4>;
    if (line.startsWith('## '))
      return <h3 key={i} className="text-sm font-bold text-foreground mt-3 mb-1">{line.slice(3)}</h3>;
    if (line.startsWith('# '))
      return <h2 key={i} className="text-sm font-bold text-foreground mt-2 mb-1">{line.slice(2)}</h2>;
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <p key={i} className="text-xs text-foreground/80 pl-3 py-0.5">
          • {renderInline(line.slice(2))}
        </p>
      );
    }
    if (!line.trim()) return <div key={i} className="h-1" />;
    return <p key={i} className="text-xs text-foreground/80 py-0.5">{renderInline(line)}</p>;
  });
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export const AISummaryTab = () => {
  const { runSummary, isLoadingSummary, apiCallCount, error } = useAIStore();
  const simStatus = useSimulationStore((s) => s.status);
  const vehiclesProcessed = useSimulationStore((s) => s.simTime);

  const hasRunData = simStatus === 'paused' || (simStatus === 'idle' && vehiclesProcessed > 50400);

  const handleGenerate = useCallback(() => {
    requestAnalysis();
  }, []);

  const handleCopy = useCallback(() => {
    if (runSummary) {
      navigator.clipboard.writeText(runSummary);
      toast.success('Summary copied to clipboard');
    }
  }, [runSummary]);

  const handleDownload = useCallback(() => {
    if (!runSummary) return;
    const config = useSimulationStore.getState().config;
    const date = new Date().toISOString().slice(0, 10);
    const header = `# OTTOYARD Depot Simulation Summary\n\nGenerated: ${new Date().toLocaleString()}\n\nConfig: ${config.activeFleetSize} fleet / ${config.dcfcCount} DCFC / ${config.l2Count} L2 / ${config.ottoQAlgorithm}\n\n---\n\n`;
    const content = header + runSummary;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OTTOYARD-Summary-${date}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Summary downloaded');
  }, [runSummary]);

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 p-3">
        {/* Summary content */}
        {runSummary && (
          <div className="mb-4 rounded-lg bg-otto-dark border-l-4 border-otto-red p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-otto-red" />
                <span className="text-xs font-semibold text-foreground">Run Summary</span>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCopy}>
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleDownload}>
                  <Download className="w-3 h-3 mr-1" /> Download
                </Button>
              </div>
            </div>
            <div>{renderMarkdown(runSummary)}</div>
            <div className="mt-3 pt-2 border-t border-white/5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 text-xs text-otto-gray hover:text-foreground"
                onClick={handleGenerate}
                disabled={isLoadingSummary}
              >
                <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
              </Button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoadingSummary && !runSummary && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex items-center gap-1 mb-3">
              <span className="w-2 h-2 rounded-full bg-otto-teal animate-[typing-dot_1.2s_ease-in-out_infinite]" />
              <span className="w-2 h-2 rounded-full bg-otto-teal animate-[typing-dot_1.2s_ease-in-out_0.2s_infinite]" />
              <span className="w-2 h-2 rounded-full bg-otto-teal animate-[typing-dot_1.2s_ease-in-out_0.4s_infinite]" />
            </div>
            <p className="text-xs text-otto-gray">Analyzing run data…</p>
          </div>
        )}

        {/* Post-run: generate button */}
        {!runSummary && !isLoadingSummary && hasRunData && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Brain className="w-10 h-10 text-otto-teal/60 mb-4" />
            <p className="text-sm font-medium text-foreground mb-1">Simulation Complete</p>
            <p className="text-xs text-otto-gray mb-4 max-w-[220px]">
              Analyze your last simulation run with AI
            </p>
            <Button
              onClick={handleGenerate}
              className="bg-otto-teal hover:bg-otto-teal/90 text-otto-dark font-semibold"
              size="sm"
            >
              <Brain className="w-4 h-4 mr-1.5" /> Generate Summary
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!runSummary && !isLoadingSummary && !hasRunData && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Brain className="w-8 h-8 text-otto-gray/40 mb-3" />
            <p className="text-xs text-otto-gray mb-1">OTTO-AI Analysis</p>
            <p className="text-[10px] text-otto-gray/60 max-w-[200px]">
              Run a simulation, then generate an AI summary here.
            </p>
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between">
        <span className="text-[10px] text-otto-gray">
          {apiCallCount} API call{apiCallCount !== 1 ? 's' : ''} this session
        </span>
        {error && (
          <div className="flex items-center gap-1">
            <AlertCircle className="w-3 h-3 text-otto-red" />
            <span className="text-[10px] text-otto-red truncate max-w-[150px]">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};
