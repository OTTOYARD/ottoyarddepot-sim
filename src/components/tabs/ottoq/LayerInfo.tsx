// ============================================================================
// LayerInfo — the "i" beside each OTTO-Q layer, and the card it opens: what the layer is, why it is there, what it
// does, what it technically is, and why it was built that way.
//
// Chase, 2026-10-02: "beside agent there would be a little button you can tap ... and opens up a small tab or bubble
// that shares what it is why it's there it's function what it technically is and why it's technically selected or
// integrated, etc.. In the same for the other layers, such as safety planner, etc."
//
// The words are src/lib/layerInfo.ts (tested there). This file only draws them. The one number a card may show is the
// plate's own live line for the run being watched, named as that run's, so nothing here is a figure written on a day.
// ============================================================================
import { useState, type ReactNode } from "react";
import { ArrowRight, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LAYER_INFO } from "@/lib/layerInfo";
import type { PlateId } from "./stack/stackModel";

export type InfoTab = "agent" | "background";

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{label}</div>
      <div className="mt-0.5 text-[11px] leading-[15px] text-ink-dim">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((t) => (
        <li key={t} className="flex gap-1.5">
          <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** One layer's card. `live` is the plate's line for the run being watched; `run` names that run. */
export function LayerInfoCard({ plate, live, run, onOpenTab }: {
  plate: PlateId;
  live?: string | null;
  run?: string | null;
  onOpenTab?: (tab: InfoTab) => void;
}) {
  const info = LAYER_INFO[plate];
  return (
    <article aria-label={`About the ${info.title} layer`} className="text-left">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-[12px] font-semibold uppercase tracking-[0.08em] text-ink">{info.title}</h3>
        <span className="text-[10px] text-ink-faint">{info.tagline}</span>
      </header>
      <p className="mt-1 text-[11.5px] leading-4 text-ink">{info.what}</p>
      <Section label="Why it is there">{info.why}</Section>
      <Section label="What it does">{info.does}</Section>
      <Section label="What it technically is"><Bullets items={info.technically} /></Section>
      <Section label="Why it was built this way"><Bullets items={info.chosen} /></Section>
      <p className="mt-2 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] leading-[15px] text-ink">
        {info.never}
      </p>
      {live ? (
        <Section label={run ? `On this run (${run.slice(0, 8)})` : "On this run"}>
          <span className="font-mono text-[10.5px] text-ink">{live}</span>
        </Section>
      ) : null}
      <details className="mt-2 text-[10px] text-ink-faint">
        <summary className="cursor-pointer select-none hover:text-ink-dim">Where to check it</summary>
        <ul className="mt-1 space-y-0.5 font-mono text-[9.5px] leading-[13px]">
          {info.refs.map((r) => <li key={r} className="break-words">{r}</li>)}
        </ul>
      </details>
      {onOpenTab ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {plate === "agent" ? (
            <button type="button" onClick={() => onOpenTab("agent")} className="inline-flex items-center gap-1 text-[10.5px] text-brand-hot hover:underline">
              Every pass, on the Agent tab <ArrowRight size={10} />
            </button>
          ) : null}
          <button type="button" onClick={() => onOpenTab("background")} className="inline-flex items-center gap-1 text-[10.5px] text-brand-hot hover:underline">
            The whole system, on the Background tab <ArrowRight size={10} />
          </button>
        </div>
      ) : null}
    </article>
  );
}

/**
 * The "i". Opens the card for one plate, or for several (the flat funnel's Proposers row is the Agent and the
 * Planners together). Its clicks and presses stop here, so tapping it never also opens the plate or starts a turn
 * of the stack underneath.
 */
export function LayerInfoButton({ plates, label, live, run, onOpenTab, side = "left", className = "" }: {
  plates: readonly PlateId[];
  /** The layer's name, for the button's accessible label. */
  label: string;
  live?: Partial<Record<PlateId, string | null>>;
  run?: string | null;
  onOpenTab?: (tab: InfoTab) => void;
  side?: "left" | "right" | "top" | "bottom";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          onClick={stop}
          onPointerDown={stop}
          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/25 text-ink-dim transition-colors hover:border-brand-hot/70 hover:text-brand-hot focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-hot [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6 ${open ? "border-brand-hot/70 text-brand-hot" : ""} ${className}`}
        >
          <Info aria-hidden size={10} strokeWidth={2.4} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        collisionPadding={8}
        onPointerDown={stop}
        onClick={stop}
        className="max-h-[min(72vh,600px)] w-[min(360px,calc(100vw-24px))] overflow-y-auto border-white/15 bg-canvas-panel p-3 font-ui text-ink shadow-xl"
      >
        {plates.map((p, i) => (
          <div key={p} className={i ? "mt-3 border-t border-white/10 pt-3" : ""}>
            <LayerInfoCard plate={p} live={live?.[p] ?? null} run={run}
              onOpenTab={onOpenTab ? (t) => { setOpen(false); onOpenTab(t); } : undefined} />
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
