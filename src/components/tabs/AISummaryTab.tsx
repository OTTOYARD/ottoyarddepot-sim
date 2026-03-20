import React, { useCallback } from 'react';
import { useAIStore, type Observation } from '@/store/aiStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Copy, Loader2, Brain, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

// Simple markdown-ish renderer: bold, headers, bullets
function renderMarkdown(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // Headers
    if (line.startsWith('### '))
      return <h4 key={i} className="text-xs font-semibold text-otto-teal mt-3 mb-1">{line.slice(4)}</h4>;
    if (line.startsWith('## '))
      return <h3 key={i} className="text-sm font-bold text-otto-white mt-3 mb-1">{line.slice(3)}</h3>;
    if (line.startsWith('# '))
      return <h2 key={i} className="text-sm font-bold text-otto-white mt-2 mb-1">{line.slice(2)}</h2>;

    // Bullets
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <p key={i} className="text-xs text-otto-white/80 pl-3 py-0.5">
          • {renderInline(line.slice(2))}
        </p>
      );
    }

    // Empty line
    if (!line.trim()) return <div key={i} className="h-1" />;

    // Regular paragraph
    return <p key={i} className="text-xs text-otto-white/80 py-0.5">{renderInline(line)}</p>;
  });
}

function renderInline(text: string) {
  // Bold **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-otto-white font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

const ObservationBubble = React.memo(({ obs }: { obs: Observation }) => (
  <div className="flex gap-2 mb-2">
    <div className="shrink-0 mt-0.5">
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-otto-teal/20 text-otto-teal">
        {obs.simTime}
      </span>
    </div>
    <div className="flex-1 bg-otto-dark rounded-lg p-2.5 border border-white/5">
      {renderMarkdown(obs.text)}
    </div>
  </div>
));
ObservationBubble.displayName = 'ObservationBubble';

export const AISummaryTab = () => {
  const {
    observations,
    runSummary,
    isLoadingObservation,
    isLoadingSummary,
    apiCallCount,
    error,
  } = useAIStore();

  const handleCopy = useCallback(() => {
    if (runSummary) {
      navigator.clipboard.writeText(runSummary);
      toast.success('Summary copied to clipboard');
    }
  }, [runSummary]);

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 p-3">
        {/* Run Summary */}
        {(runSummary || isLoadingSummary) && (
          <div className="mb-4 rounded-lg bg-otto-dark border-l-4 border-otto-red p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-otto-red" />
                <span className="text-xs font-semibold text-otto-white">Run Summary</span>
              </div>
              {runSummary && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCopy}>
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
              )}
            </div>
            {isLoadingSummary ? (
              <div className="flex items-center gap-2 py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-otto-teal" />
                <span className="text-xs text-otto-gray">Analyzing run data…</span>
              </div>
            ) : (
              runSummary && <div>{renderMarkdown(runSummary)}</div>
            )}
          </div>
        )}

        {/* Loading indicator for live observation */}
        {isLoadingObservation && (
          <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded bg-otto-dark/50 border border-white/5">
            <Loader2 className="w-3 h-3 animate-spin text-otto-teal" />
            <span className="text-[10px] text-otto-gray">Generating observation…</span>
          </div>
        )}

        {/* Observations */}
        {observations.length > 0 ? (
          observations.map((obs, i) => <ObservationBubble key={obs.timestamp + '-' + i} obs={obs} />)
        ) : (
          !runSummary &&
          !isLoadingSummary && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Brain className="w-8 h-8 text-otto-gray/40 mb-3" />
              <p className="text-xs text-otto-gray mb-1">OTTO-AI Analysis</p>
              <p className="text-[10px] text-otto-gray/60 max-w-[200px]">
                Start the simulation to receive live AI observations every 60 sim-seconds.
              </p>
            </div>
          )
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
