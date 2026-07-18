// ============================================================================
// BlackBoxPanel — the OTTO-Q flight recorder (founder-side run-audit control).
// Press Play to start recording a run; the sim runs and the backend records
// every decision + raw datum; Stop freezes the run and resets the depot to
// empty; then a forensic .json bundle (exact code + all raw data) is
// downloadable. Only the latest run is kept. No in-product analysis — just
// Play / Stop / Download + a recording indicator.
//
// Shares the single authoritative start/stop path (src/lib/blackbox.ts) with
// the Operator Console, so the two never fight over the one-run-per-depot lock.
// ============================================================================
import { Play, Square, Download, RotateCcw, Loader2, HardDrive, ShieldCheck } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useBlackbox } from "@/hooks/use-blackbox";
import { deckLabel } from "@/lib/blackbox";

// ── section header, matching the Operator Console's Group chrome ──
const SectionHead = ({ title, right }: { title: string; right?: React.ReactNode }) => (
  <div className="flex items-center gap-2 px-3 py-2 bg-canvas-elev/40 border-l-2 border-l-brand-red border-b border-white/[0.06]">
    <HardDrive size={13} className="text-brand-red" />
    <span className="font-display text-[11px] uppercase tracking-[0.08em] text-ink">{title}</span>
    {right}
  </div>
);

export const BlackBoxPanel = () => {
  const bb = useBlackbox();

  const onStart = async () => {
    try {
      await bb.start();
      toast.success(`Recording ${deckLabel(bb.scenario)}`, { description: "Depot is live — press Stop to freeze the run." });
    } catch (e: any) {
      toast.error("Couldn’t start recording", { description: e?.message });
    }
  };
  const onStop = async () => {
    try {
      await bb.stop();
      toast.success("Run recorded", { description: "Depot reset — Black Box is ready to download." });
    } catch (e: any) {
      toast.error("Stop failed", { description: e?.message });
    }
  };
  const onDownload = async () => {
    try {
      await bb.download();
      toast.success("Black Box downloaded");
    } catch (e: any) {
      toast.error("Download failed", { description: e?.message });
    }
  };

  return (
    <ScrollArea className="flex-1">
      {/* Intro */}
      <SectionHead title="OTTO-Q Black Box" />
      <div className="px-3 py-3 border-b border-white/[0.06]">
        <p className="text-[12px] leading-relaxed text-ink-dim">
          Flight recorder. Press Play to record a full run — every decision and
          raw datum is captured on the backend. Stop freezes the run and empties
          the depot, then the forensic bundle (exact code + all run data) is
          downloadable for a code audit. Only the latest run is kept.
        </p>
      </div>

      {/* IDLE — pick a deck, set speed, start recording */}
      {bb.phase === "idle" && (
        <div className="px-3 py-3 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] text-ink-faint uppercase tracking-wide">Scenario</span>
            <Select value={bb.scenario} onValueChange={bb.setScenario} disabled={bb.busy === "start"}>
              <SelectTrigger className="h-8 text-xs bg-canvas-elev border-white/[0.06]"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-canvas-panel border-white/10 text-ink">
                {bb.decks.map((d) => (
                  <SelectItem key={d.code} value={d.code} className="text-xs text-ink focus:bg-white/10 focus:text-white">{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-ink-faint uppercase tracking-wide">Speed</span>
              <span className="font-mono text-[11px] text-ink cc-num">{bb.speed}×</span>
            </div>
            <Slider min={0.25} max={5} step={0.25} value={[bb.speed]} onValueChange={([v]) => bb.setSpeed(v)} disabled={bb.busy === "start"} />
          </div>

          <Button onClick={onStart} disabled={bb.busy === "start"}
            className="h-11 w-full bg-brand-red hover:bg-brand-deep text-white font-display uppercase tracking-[0.06em] text-xs">
            {bb.busy === "start" ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {bb.busy === "start" ? "Starting…" : "Play — Start Recording"}
          </Button>
          <p className="text-[11px] text-ink-faint text-center -mt-1">Press Play to start recording a run.</p>
        </div>
      )}

      {/* RECORDING — live indicator + stop */}
      {bb.phase === "recording" && bb.run && (
        <div className="px-3 py-3 flex flex-col gap-4">
          <div className="rounded-lg border border-brand-red/40 bg-brand-red/[0.07] px-3 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-brand-red opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-red" />
              </span>
              <span className="font-display text-[12px] uppercase tracking-[0.1em] text-ink">Recording</span>
              {bb.run.status === "paused" && <span className="ml-auto text-[10px] text-ink-faint uppercase">paused</span>}
            </div>
            <div className="text-[13px] text-ink">{deckLabel(bb.run.scenario_code)}</div>
            <div className="flex items-center gap-4 pt-0.5 font-mono text-[11px] text-ink-dim cc-num">
              <span>tick <span className="text-ink">{bb.run.tick_count}</span></span>
              <span>speed <span className="text-ink">{bb.run.demo_speed_x}×</span></span>
              <span className="text-ink-faint">run {bb.run.sim_run_id.slice(0, 8)}</span>
            </div>
          </div>

          <Button onClick={onStop} disabled={bb.busy === "stop"} variant="outline"
            className="h-11 w-full border-white/[0.1] text-ink hover:bg-white/[0.06] font-display uppercase tracking-[0.06em] text-xs">
            {bb.busy === "stop" ? <Loader2 size={16} className="animate-spin" /> : <Square size={15} />}
            {bb.busy === "stop" ? "Stopping…" : "Stop"}
          </Button>
          <p className="text-[11px] text-ink-faint text-center -mt-1">Stop freezes the run and resets the depot to empty.</p>
        </div>
      )}

      {/* STOPPED — run frozen, bundle ready */}
      {bb.phase === "stopped" && bb.run && (
        <div className="px-3 py-3 flex flex-col gap-4">
          <div className="rounded-lg border border-white/[0.08] bg-canvas-elev/60 px-3 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-state-go" />
              <span className="font-display text-[12px] uppercase tracking-[0.08em] text-ink">Run recorded — depot reset</span>
            </div>
            <div className="text-[13px] text-ink">{deckLabel(bb.run.scenario_code)}</div>
            <div className="flex items-center gap-4 pt-0.5 font-mono text-[11px] text-ink-dim cc-num">
              <span>{bb.run.tick_count} ticks</span>
              <span className="text-ink-faint">run {bb.run.sim_run_id.slice(0, 8)}</span>
            </div>
          </div>

          <Button onClick={onDownload} disabled={bb.downloading}
            className="h-11 w-full bg-brand-red hover:bg-brand-deep text-white font-display uppercase tracking-[0.06em] text-xs">
            {bb.downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {bb.downloading ? "Preparing bundle…" : "Download Black Box"}
          </Button>
          {bb.downloading && <p className="text-[11px] text-ink-faint text-center -mt-2">Building the forensic .json (~20MB, ~12s)…</p>}

          <Button onClick={bb.startNew} disabled={bb.downloading} variant="outline"
            className="h-9 w-full border-white/[0.06] text-ink-dim hover:text-ink text-[11px]">
            <RotateCcw size={13} /> Start New Run
          </Button>
        </div>
      )}
    </ScrollArea>
  );
};
