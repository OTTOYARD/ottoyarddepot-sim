// CarTrail — one car's OTTO-Q decision trail (buildTrail over useDecisionTrail), in plain words.
//
// Shared by the OTTO-Q tab's layer drill-in and the vehicle Q card's "Full trail" (src/components/canvas/VehicleQCard).
// It reads; it decides nothing.
import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useDecisionTrail } from "@/hooks/useDecisionTrail";
import { TONE_COLOR } from "@/components/tabs/ottoq/funnelGeometry";
import { buildTrail, type Trail } from "@/lib/decisionTrail";
import { MISSING, clockCT } from "@/lib/plainWords";

export function CarTrail({ car }: { car: { id: string; name: string } }) {
  const d = useDecisionTrail(car.id);
  const trail: Trail | null = useMemo(() => {
    if (!d.carRows.length) return null;
    const card = d.cards.find((c) => c.vehicle_id === car.id) ?? d.cardMemory.get(car.id) ?? null;
    return buildTrail({ vehicleId: car.id, name: car.name, rows: d.carRows, decisions: d.decisions, proposals: d.proposals, choices: d.choices, card });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.carRows, d.decisions, d.proposals, d.choices, d.cards, car.id, car.name]);
  if (!trail) {
    return (
      <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-ink-faint">
        {d.error ? "Could not read this car's decisions." : <><Loader2 size={12} className="animate-spin" /> Reading this car's decisions…</>}
      </div>
    );
  }
  return (
    <ol className="px-2 pb-1 pt-1.5" aria-label={`${car.name} decision trail`}>
      {trail.steps.map((s, i) => (
        <li key={`${s.kind}-${s.at}-${i}`} className={`flex gap-2 ${s.branch ? "pl-3" : ""}`}>
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: s.tone === "ok" ? TONE_COLOR.ok : s.tone === "warn" ? TONE_COLOR.held : s.tone === "branch" ? "#7DD3FC" : "rgba(255,255,255,0.25)" }} />
          <div className="min-w-0 flex-1 pb-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-ink">{s.title}</span>
              <span className="shrink-0 font-mono text-[9px] text-ink-faint">{s.at ? clockCT(s.at) : MISSING}</span>
            </div>
            {s.detail && <p className="break-words text-[10px] leading-4 text-ink-dim">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
