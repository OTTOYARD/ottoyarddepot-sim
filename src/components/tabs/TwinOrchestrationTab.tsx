// ============================================================================
// TwinOrchestrationTab — makes OTTO-Q's appointment / reservation / servicing
// ecosystem VISIBLE. Investor-grade view of the whole seam: vehicles book a
// stall + full servicing workflow BEFORE they arrive, OTTO-Q holds the stall,
// and the shield guarantees zero unsafe deploys. Renders ONLY what the RPC
// `ottoq_twin_appointments` returns (see useAppointments / appointmentStore).
// ============================================================================
import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Navigation, LogIn, DoorOpen, BatteryCharging, Droplets, Wrench,
  CheckCircle2, ShieldCheck, ChevronRight, Moon, Circle, Clock, ArrowRight,
} from "lucide-react";
import { useTwinStore } from "@/store/twinStore";
import { useAppointmentStore } from "@/store/appointmentStore";
import { useAppointments } from "@/hooks/useAppointments";
import type { ApptReservation, ApptInbound } from "@/store/appointmentStore";

const num = (v: unknown, d = 0): number => (typeof v === "number" && isFinite(v) ? v : Number(v) || d);
const humanize = (s: string): string => (s || "").replace(/_/g, " ").trim();

// ── stall-type badge ──────────────────────────────────────────────────────
const STALL_META: Record<string, { label: string; color: string }> = {
  dcfc: { label: "DCFC", color: "#C8102E" },
  l2: { label: "L2", color: "#00B4A6" },
  staging: { label: "STAGE", color: "#A8AEBB" },
};
const StallBadge = ({ type }: { type: string }) => {
  const m = STALL_META[String(type).toLowerCase()] ?? { label: String(type || "—").toUpperCase(), color: "#A8AEBB" };
  return (
    <span
      className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-display uppercase tracking-wide leading-none"
      style={{ color: m.color, background: `${m.color}1A`, border: `1px solid ${m.color}40` }}
    >
      {m.label}
    </span>
  );
};

// ── lifecycle pipeline stages (ordered ecosystem flow) ─────────────────────
const STAGES: { key: string; label: string; icon: typeof Navigation; color: string }[] = [
  { key: "deployed", label: "Deployed", icon: Navigation, color: "#00B4A6" },
  { key: "inbound", label: "Inbound", icon: LogIn, color: "#D8DDFF" },
  { key: "at_gate", label: "At gate", icon: DoorOpen, color: "#C8102E" },
  { key: "charging", label: "Charging", icon: BatteryCharging, color: "#3B82F6" },
  { key: "washing", label: "Washing", icon: Droplets, color: "#F59E0B" },
  { key: "servicing", label: "Service", icon: Wrench, color: "#E8893F" },
  { key: "staged_ready", label: "Ready", icon: CheckCircle2, color: "#C9E0D4" },
];

// ── small hero stat tile ───────────────────────────────────────────────────
const SeamStat = ({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) => (
  <div className="bg-canvas-panel rounded-lg border border-white/[0.06] p-2.5 flex flex-col gap-1 min-w-0">
    <span className="text-[9px] text-ink-faint uppercase tracking-wider leading-none truncate">{label}</span>
    <span className="text-xl font-display tabular-nums leading-none" style={{ color: accent ?? "#E7EAF0" }}>{value}</span>
    {sub && <span className="text-[9px] text-ink-faint leading-none truncate">{sub}</span>}
  </div>
);

// ── reservation row ─────────────────────────────────────────────────────────
const ReservationRow = ({ r }: { r: ApptReservation }) => {
  const held = r.inbound && !r.occupied; // stall held EMPTY for a car still on its way
  return (
    <div
      className="flex items-center gap-2 rounded-md px-2.5 py-2 border"
      style={{
        borderColor: held ? "rgba(200,16,46,0.35)" : "rgba(255,255,255,0.06)",
        background: held ? "rgba(200,16,46,0.06)" : "transparent",
      }}
    >
      <StallBadge type={r.stall_type} />
      <span className="font-mono text-[11px] text-ink-dim tabular-nums shrink-0">{r.stall_code}</span>
      <div className="flex-1 min-w-0 text-right">
        <div className="text-[11px] text-ink truncate">{r.av_id ?? "—"}</div>
        <div className="text-[9px] text-ink-faint truncate">{humanize(r.veh_state ?? "")}</div>
      </div>
      {r.soc != null && (
        <span className="font-mono text-[11px] tabular-nums shrink-0" style={{ color: num(r.soc) < 30 ? "#FF8A80" : "#A8AEBB" }}>
          {Math.round(num(r.soc))}%
        </span>
      )}
      <span
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-display uppercase tracking-wide leading-none shrink-0"
        style={
          held
            ? { color: "#E8293F", background: "rgba(232,41,63,0.12)", border: "1px solid rgba(232,41,63,0.4)" }
            : r.occupied
              ? { color: "#00B4A6", background: "rgba(0,180,166,0.12)", border: "1px solid rgba(0,180,166,0.3)" }
              : { color: "#A8AEBB", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
        }
      >
        {held ? "Inbound" : r.occupied ? "Occupied" : "Held"}
      </span>
    </div>
  );
};

// ── inbound vehicle card (with pre-booked servicing workflow) ───────────────
const InboundCard = ({ v }: { v: ApptInbound }) => (
  <div className="rounded-md border border-white/[0.06] bg-canvas-panel p-3 space-y-2">
    <div className="flex items-center gap-2">
      <span className="text-[12px] font-display text-ink truncate">{v.av_id}</span>
      {v.secured && (
        <span className="inline-flex items-center gap-1 text-[9px] text-otto-teal uppercase tracking-wide shrink-0">
          <CheckCircle2 size={11} /> secured
        </span>
      )}
      <span className="ml-auto flex items-center gap-1 text-[10px] text-ink-faint tabular-nums shrink-0">
        <Clock size={11} /> {v.eta_min != null ? `${Math.round(num(v.eta_min))} min` : "—"}
      </span>
    </div>
    <div className="flex items-center gap-2 text-[10px] text-ink-dim">
      {v.soc != null && (
        <span className="font-mono tabular-nums" style={{ color: num(v.soc) < 30 ? "#FF8A80" : "#A8AEBB" }}>
          {Math.round(num(v.soc))}% SoC
        </span>
      )}
      {v.return_trigger && <span className="text-ink-faint">· {humanize(v.return_trigger)}</span>}
      {v.booked_stall_type && (
        <span className="ml-auto flex items-center gap-1">
          <span className="text-ink-faint">booked</span>
          <StallBadge type={v.booked_stall_type} />
        </span>
      )}
    </div>
    {v.workflow?.length > 0 && (
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        {v.workflow.map((step, i) => (
          <span key={`${step}-${i}`} className="flex items-center gap-1">
            <span className="inline-flex items-center rounded-sm bg-white/[0.04] border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-ink-dim lowercase leading-none">
              {humanize(step)}
            </span>
            {i < v.workflow.length - 1 && <ArrowRight size={9} className="text-ink-faint shrink-0" />}
          </span>
        ))}
      </div>
    )}
  </div>
);

export const TwinOrchestrationTab = () => {
  useAppointments(); // poll the seam while a run is active

  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const data = useAppointmentStore((s) => s.data);
  const error = useAppointmentStore((s) => s.error);

  // reservations sorted so the "held for inbound" ones surface first
  const reservations = useMemo(() => {
    const list = data?.reservations ?? [];
    return [...list].sort((a, b) => Number(b.inbound && !b.occupied) - Number(a.inbound && !a.occupied));
  }, [data]);

  if (!activeSimRunId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <span className="text-ink-faint text-xs">Start a scenario in Run Control to see the orchestration seam.</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <span className="text-ink-faint text-xs">
          {error ? `Appointments feed error: ${error}` : "Connecting to the appointment seam…"}
        </span>
      </div>
    );
  }

  const h = data.headline;
  const phases = data.phases ?? {};
  const inboundHeldCount = reservations.filter((r) => r.inbound && !r.occupied).length;

  return (
    <ScrollArea className="flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
      <div className="p-3 space-y-3">
        {/* Header */}
        <div>
          <h2 className="text-sm font-display uppercase tracking-[0.08em] text-ink">Orchestration — the appointment ecosystem</h2>
          <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
            Every vehicle books a stall and its full servicing plan before it arrives. OTTO-Q holds the stall,
            sequences the workflow, and the safety shield guarantees no unsafe deploy — one continuous loop.
          </p>
          <p className="text-[10px] text-ink-faint mt-1 tabular-nums">
            Sim clock {new Date(data.sim_clock).toISOString().slice(11, 16)} UTC · hour {data.hour_cst} CST
          </p>
        </div>

        {/* Headline seam row */}
        <div className="grid grid-cols-3 gap-2">
          <SeamStat label="Fleet" value={num(h.fleet_total)} sub={`${num(h.charge_stalls)} charge stalls`} />
          <SeamStat label="Vehicles / charger" value={`${num(h.veh_per_charger).toFixed(1)}:1`} sub="fleet ÷ stalls" />
          <SeamStat label="Reservations held" value={num(h.reservations_held)} sub={`${inboundHeldCount} for inbound`} accent="#D8DDFF" />
          <SeamStat
            label="Booked before arrival"
            value={`${num(h.booked_before_arrival)} / ${num(h.inbound_count)}`}
            sub="inbound with a plan"
            accent="#00B4A6"
          />
          <div className="col-span-2 bg-canvas-panel rounded-lg border p-2.5 flex items-center gap-2.5" style={{ borderColor: num(h.unsafe_deploys_run) === 0 ? "rgba(0,180,166,0.3)" : "rgba(200,16,46,0.4)" }}>
            <ShieldCheck size={26} style={{ color: num(h.unsafe_deploys_run) === 0 ? "#00B4A6" : "#C8102E" }} className="shrink-0" />
            <div className="min-w-0">
              <div className="text-[9px] text-ink-faint uppercase tracking-wider leading-none">Unsafe deploys · this run</div>
              <div className="text-xl font-display tabular-nums leading-tight" style={{ color: num(h.unsafe_deploys_run) === 0 ? "#00B4A6" : "#C8102E" }}>
                {num(h.unsafe_deploys_run)}
                <span className="text-[10px] font-ui normal-case tracking-normal ml-1.5 text-ink-faint">
                  {num(h.unsafe_deploys_run) === 0 ? "shield-guaranteed" : "breaches"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Lifecycle pipeline */}
        <div className="space-y-1.5">
          <span className="text-[10px] text-ink-faint uppercase tracking-wide">Lifecycle pipeline · live counts</span>
          <div className="flex items-stretch gap-0.5 overflow-x-auto pb-1 w-full min-w-0">
            {STAGES.map((st, i) => {
              const count = num(phases[st.key]);
              const zero = count === 0;
              const Icon = st.icon;
              return (
                <div key={st.key} className="flex items-center shrink-0 flex-1">
                  <div
                    className="flex flex-col items-center justify-center gap-1 rounded-md border px-1 py-2 w-full min-w-0"
                    style={{
                      borderColor: zero ? "rgba(255,255,255,0.05)" : `${st.color}40`,
                      background: zero ? "transparent" : `${st.color}12`,
                      opacity: zero ? 0.4 : 1,
                    }}
                  >
                    <Icon size={13} style={{ color: st.color }} />
                    <span className="text-base font-display tabular-nums leading-none" style={{ color: zero ? "#7B818D" : "#E7EAF0" }}>{count}</span>
                    <span className="text-[8px] text-ink-faint uppercase tracking-wide text-center leading-tight">{st.label}</span>
                  </div>
                  {i < STAGES.length - 1 && <ChevronRight size={10} className="text-ink-faint shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Overnight */}
        {data.overnight?.window_active ? (
          <div className="rounded-md border border-[#D8DDFF]/30 bg-[#D8DDFF]/[0.06] p-3 flex items-center gap-3">
            <Moon size={20} className="text-[#D8DDFF] shrink-0" />
            <div className="text-[11px] text-ink-dim leading-relaxed">
              <span className="text-ink font-display">Overnight window active</span> · hour {num(data.overnight.hour_cst)} CST ·{" "}
              <span className="tabular-nums text-ink">{num(data.overnight.recalled_tonight)}</span> recalled tonight ·{" "}
              <span className="tabular-nums text-ink">{num(data.overnight.holdout_still_out)}</span> still deployed, returning by ~3am.
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-ink-faint flex items-center gap-1.5">
            <Moon size={11} /> Overnight recall window inactive ·{" "}
            <span className="tabular-nums text-ink-dim">{num(data.overnight?.holdout_still_out)}</span> vehicle(s) still deployed (~1%).
          </div>
        )}

        {/* Reservations held */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] text-ink-faint uppercase tracking-wide">Reservations held</span>
            <span className="text-[10px] text-ink-faint">
              {reservations.length} reserved · <span className="text-brand-hot">{inboundHeldCount} held for inbound</span>
            </span>
          </div>
          {reservations.length === 0 ? (
            <div className="rounded-md border border-white/[0.06] p-3 text-[11px] text-ink-faint text-center">No stalls reserved right now.</div>
          ) : (
            <div className="space-y-1">
              {reservations.map((r, i) => <ReservationRow key={r.stall_id ?? `${r.stall_code}-${i}`} r={r} />)}
            </div>
          )}
          <div className="flex items-center gap-1 text-[9px] text-ink-faint pt-0.5">
            <Circle size={7} className="fill-current text-brand-hot" /> = stall held empty for a vehicle still en route (booked ahead, not wasted)
          </div>
        </div>

        {/* Inbound & booked */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] text-ink-faint uppercase tracking-wide">Inbound &amp; pre-booked servicing</span>
            <span className="text-[10px] text-ink-faint">{num(h.booked_before_arrival)} / {num(h.inbound_count)} arrive with a full plan</span>
          </div>
          {(data.inbound?.length ?? 0) === 0 ? (
            <div className="rounded-md border border-white/[0.06] p-3 text-[11px] text-ink-faint text-center">Nothing inbound right now.</div>
          ) : (
            <div className="space-y-2">
              {data.inbound.map((v, i) => <InboundCard key={`${v.av_id}-${i}`} v={v} />)}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
};
