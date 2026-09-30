import { useEffect, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { twin, type Scenario } from '@/lib/ottoTwin';
import { FEATURED, DEFAULT_SCENARIO } from '@/components/cockpit/featuredScenarios';
import { useStartRun, type StartRunControl } from '@/hooks/useStartRun';

/**
 * The phone's Start: pick a featured scenario, then start it for real — through
 * useStartRun, the very start path the desktop Control tab uses. It is a confirm,
 * not a one-tap button, because starting a run ends and resets the one before it.
 * "More options in Control" opens the full console (every scenario, variability).
 */
export function PhoneStartDialog({ open, onOpenChange, ctrl, onOpenControl }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctrl: StartRunControl;
  onOpenControl: () => void;
}) {
  const { start, starting } = useStartRun(ctrl);
  const [selected, setSelected] = useState(DEFAULT_SCENARIO);
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);

  // The backend's scenario list: hides a chip whose deck it does not offer, and names the toast.
  // Until (or unless) it answers, every featured chip is offered.
  useEffect(() => {
    if (!open || scenarios) return;
    let cancelled = false;
    twin.scenarios().then((d) => { if (!cancelled) setScenarios(d.scenarios); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, scenarios]);

  const chips = scenarios?.length ? FEATURED.filter((f) => scenarios.some((s) => s.scenario_code === f.code)) : FEATURED;
  const pick = chips.some((c) => c.code === selected) ? selected : chips[0]?.code ?? DEFAULT_SCENARIO;
  const title = scenarios?.find((s) => s.scenario_code === pick)?.title ?? FEATURED.find((f) => f.code === pick)?.label ?? pick;

  const go = async () => {
    if (await start(pick, title)) onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!starting) onOpenChange(o); }}>
      <AlertDialogContent className="bg-canvas-panel border-white/10 text-ink max-w-sm" data-testid="phone-start-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Start a simulation run</AlertDialogTitle>
          <AlertDialogDescription className="text-ink-dim">
            Starting a new run ends and resets the current one.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Scenario">
          {chips.map((f) => {
            const active = pick === f.code;
            return (
              <button key={f.code} type="button" role="radio" aria-checked={active} disabled={starting}
                onClick={() => setSelected(f.code)}
                className={`flex items-center gap-1.5 h-11 px-2.5 rounded-md border text-[12px] text-left disabled:opacity-50 ${
                  active ? 'border-brand-red bg-brand-red/10 text-ink' : 'border-white/[0.08] bg-canvas-elev text-ink-dim active:bg-white/10'}`}>
                <f.icon size={14} className={f.tint} />
                <span className="truncate">{f.label}</span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => { onOpenChange(false); onOpenControl(); }} disabled={starting}
          className="self-start text-[12px] text-ink-dim underline underline-offset-2 active:text-ink disabled:opacity-50">
          More options in Control
        </button>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-canvas-elev border-white/10 text-ink" disabled={starting}>Cancel</AlertDialogCancel>
          {/* Not an AlertDialogAction: that closes the dialog on click, before the start has answered. */}
          <button type="button" onClick={go} disabled={starting}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 bg-brand-red hover:bg-brand-deep text-white text-sm font-medium disabled:opacity-60">
            {starting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {starting ? 'Starting…' : 'Start run'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
