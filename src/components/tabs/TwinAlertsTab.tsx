// ============================================================================
// TwinAlertsTab — live event feed from the backend snapshot's recent_events
// (replaces the legacy client-engine AlertsTab). Severity-colored, newest first.
// ============================================================================
import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Zap, BatteryWarning, Activity, Info } from "lucide-react";
import { useTwinStore } from "@/store/twinStore";

const SEV: Record<string, { color: string; ring: string }> = {
  critical: { color: "text-brand-hot", ring: "border-brand-hot/30 bg-brand-hot/5" },
  warning:  { color: "text-state-warn", ring: "border-state-warn/25 bg-state-warn/5" },
  info:     { color: "text-ink-dim", ring: "border-white/[0.06] bg-white/[0.02]" },
  debug:    { color: "text-ink-faint", ring: "border-white/[0.04]" },
};

function iconFor(type: string) {
  if (type.includes("brownout") || type.includes("voltage") || type.includes("grid")) return Zap;
  if (type.includes("dr_call") || type.includes("bess")) return BatteryWarning;
  if (type.includes("incident") || type.includes("fault") || type.includes("anomaly")) return AlertTriangle;
  if (type.includes("dispatch") || type.includes("service") || type.includes("charge")) return Activity;
  return Info;
}

// pull the most telling fields out of an event payload for a one-line summary
function summarize(type: string, payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const p = payload;
  if (p.reason) return String(p.reason).replace(/^fault\./, "fault: ");
  if (p.vehicle) return `${p.vehicle}${p.soc_end != null ? ` · SoC ${p.soc_end}%` : ""}`;
  if (p.count != null) return `${p.count} vehicle(s)${p.scenario ? ` · ${p.scenario}` : ""}`;
  if (p.overflow != null) return `${p.overflow} waiting · caps W${p.wash_cap}/S${p.svc_cap}`;
  if (p.required_cap_kw != null) return `cap ${p.required_cap_kw}kW · ${p.duration_min ?? "?"}min`;
  if (p.label) return String(p.label);
  return "";
}

const friendly = (type: string) =>
  type.replace(/^twin\./, "").replace(/^charge\./, "charge ").replace(/^anomaly\./, "anomaly ").replace(/_/g, " ");

export const TwinAlertsTab = () => {
  const snapshot = useTwinStore((s) => s.snapshot);
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);

  const events = useMemo(
    () => (snapshot?.recent_events ?? []).filter((e) => e.severity !== "debug"),
    [snapshot?.recent_events]
  );

  if (!activeSimRunId) {
    return <div className="flex-1 flex items-center justify-center p-6 text-center"><span className="text-ink-faint text-xs">Start a scenario to see the live event feed.</span></div>;
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-1.5">
        {events.length === 0 && (
          <div className="text-ink-faint text-xs text-center py-8">No alerts yet — nominal operations.</div>
        )}
        {events.map((e, i) => {
          const sev = SEV[e.severity] ?? SEV.info;
          const Icon = iconFor(e.type);
          const when = (() => { try { return new Date(e.at).toLocaleTimeString("en-US", { hour12: false, timeZone: "America/Chicago" }); } catch { return ""; } })();
          const sub = summarize(e.type, (e.payload ?? null) as Record<string, unknown> | null);
          return (
            <div key={i} className={`flex items-start gap-2 rounded-md border px-2.5 py-2 ${sev.ring}`}>
              <Icon size={13} className={`${sev.color} mt-0.5 shrink-0`} />
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-ink capitalize truncate">{friendly(e.type)}</span>
                  <span className="font-mono text-[9px] text-ink-faint shrink-0">{when}</span>
                </div>
                {sub && <span className="text-[10px] text-ink-dim truncate">{sub}</span>}
                <span className="text-[9px] text-ink-faint">{e.entity}</span>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
};
