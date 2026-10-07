import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTwinStore } from '@/store/twinStore';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { backText, chargersDown, chargersDownLabel, downLabel, downSentence } from '@/lib/chargerFaults';

/**
 * "N chargers down" — the red chip on the live depot status (the desktop top bar and the
 * phone's status strip) while the twin reports any charger out of use. A tap or click
 * lists each charger by the name the plan draws, why it is down and when it comes back;
 * the desktop's hover title carries the same list. Nothing at all while none is down.
 *
 * Read straight from the snapshot (`stalls_status`, otto-q-core 0612), not from the
 * drawn stalls, so a faulted charger the renderer does not draw is still counted.
 */
export function ChargersDownChip({ variant, side = 'bottom' }: {
  variant: 'desktop' | 'phone';
  /** where the list opens: 'top' from a bar at the foot of the screen */
  side?: 'top' | 'bottom';
}) {
  const snapshot = useTwinStore((s) => s.snapshot);
  const layout = useTwinStore((s) => s.layout);
  const [open, setOpen] = useState(false);
  const down = useMemo(
    () => chargersDown(snapshot, layout, (id) => twinMotionDriver.rendererStallFor(id)),
    [snapshot, layout],
  );
  if (!down.length) return null;

  const simClock = snapshot?.run?.sim_clock ?? null;
  const label = chargersDownLabel(down.length);
  const rows = down.map((c) => ({ ...c, label: downLabel(c.down), back: backText(c.down.until, simClock) }));
  const title = [`${label}. OTTO-Q sends no car to them.`, ...down.map((c) => downSentence(c.name, c.down, simClock))].join('\n');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="chargers-down"
          title={variant === 'desktop' ? title : undefined}
          aria-label={`${label}. Show which.`}
          className={`inline-flex shrink-0 items-center gap-1 rounded border border-red-400/70 bg-red-600/90 font-mono text-white shadow-[0_0_10px_rgba(220,38,38,0.45)] hover:bg-red-600 ${
            variant === 'phone' ? 'h-8 px-2 text-[11px]' : 'h-6 px-1.5 text-[10px]'}`}
        >
          <AlertTriangle size={variant === 'phone' ? 13 : 11} aria-hidden />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align="start" className="w-72 p-2.5 bg-canvas-panel border-red-500/40 text-ink" data-testid="chargers-down-list">
        <div className="font-display text-[10px] uppercase tracking-[0.1em] text-red-300">Chargers down</div>
        <p className="mt-0.5 text-[11px] text-ink-dim">OTTO-Q sends no car to these chargers.</p>
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] leading-snug">
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-semibold text-white">{r.name}</span>
                <span className="text-red-300">{r.label}</span>
              </div>
              <div className="text-ink-dim">{r.back ?? 'The twin gives no repair time.'}</div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
