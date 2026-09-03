// TwinDecisionLogTab — live "why" feed from OTTO-Q's decision ledger.
// Polls ottoq_activity_feed every 4s while a run is active.
import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { useActivityFeedStore, type ActivityFeedRow } from "@/store/activityFeedStore";
import {
  Brain, ShieldCheck, Zap, Droplets, Wrench, Truck,
  ArrowRight, Clock, AlertTriangle, CheckCircle2, XCircle,
} from "lucide-react";

const ACTION_BADGE: Record<string, { label: string; color: string; icon: typeof Brain }> = {
  task_start: { label: "Promote", color: "#00B4A6", icon: Truck },
  stall_assignment: { label: "Assign", color: "#C8102E", icon: Zap },
  shield_override: { label: "Shield", color: "#F59E0B", icon: ShieldCheck },
  wash_dispatch: { label: "Wash", color: "#3B82F6", icon: Droplets },
  service_dispatch: { label: "Service", color: "#E8893F", icon: Wrench },
};

const OUTCOME_ICON: Record<string, typeof CheckCircle2> = {
  enacted: CheckCircle2,
  refused: XCircle,
  shielded: ShieldCheck,
  deferred: Clock,
  error: AlertTriangle,
};

const Row = ({ r }: { r: ActivityFeedRow }) => {
  const badge = ACTION_BADGE[r.action] ?? { label: r.action, color: "#8A8F99", icon: Brain };
  const Icon = badge.icon;
  const OIcon = OUTCOME_ICON[r.outcome] ?? CheckCircle2;
  const outcomeColor = r.outcome === "enacted" ? "#00B4A6" : r.outcome === "refused" ? "#C8102E" : "#8A8F99";

  const reasonText = useMemo(() => {
    const src = r.rationale ?? r.reason;
    if (!src) return null;
    const entries = Object.entries(src);
    if (!entries.length) return null;
    return entries.map(([k, v]) => `${k}: ${v}`).join(" · ");
  }, [r.rationale, r.reason]);

  return (
    <div className="flex items-start gap-2 rounded-md px-2.5 py-2 border border-white/[0.06] hover:bg-white/[0.03] transition-colors">
      <span
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-display uppercase tracking-wide leading-none shrink-0"
        style={{ color: badge.color, background: `${badge.color}1A`, border: `1px solid ${badge.color}40` }}
      >
        <Icon size={10} />
        {badge.label}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-ink truncate font-medium">{r.display_name || r.vehicle_id?.slice(0, 8)}</span>
          <ArrowRight size={10} className="text-ink-faint shrink-0" />
          <span className="font-mono text-[10px] text-ink-dim truncate">{r.target || "—"}</span>
        </div>
        {reasonText && (
          <div className="text-[9px] text-ink-faint mt-0.5 truncate">{reasonText}</div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <OIcon size={12} style={{ color: outcomeColor }} />
        <span className="font-mono text-[9px] tabular-nums text-ink-faint" style={{ color: outcomeColor }}>
          {r.occurred_at ? new Date(r.occurred_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—"}
        </span>
      </div>
    </div>
  );
};

export default function TwinDecisionLogTab() {
  useActivityFeed();
  const { rows, error } = useActivityFeedStore();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-brand-cool" />
          <span className="text-[11px] font-display uppercase tracking-wide text-ink-dim">Decision Log</span>
          <span className="font-mono text-[10px] tabular-nums text-ink-faint bg-white/[0.04] rounded px-1.5 py-0.5">
            {rows.length}
          </span>
        </div>
        {error && (
          <span className="text-[9px] text-brand-hot truncate max-w-[200px]">{error}</span>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {rows.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-ink-faint">
              <Brain size={24} className="opacity-30" />
              <span className="text-[11px]">No decisions yet — start a run to see OTTO-Q's reasoning live.</span>
            </div>
          )}
          {rows.map((r, i) => (
            <Row key={`${r.vehicle_id}-${r.occurred_at}-${i}`} r={r} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}