// ============================================================================
// WorldContractTab — the seam, made visible.
//
// Everything in src/lib/ottoq/ was measurable but invisible: the boot report,
// the channel integrity records, the coverage audit and the decision trace all
// existed only in stores. This tab renders them.
//
// It is deliberately unflattering. It shows how much of the world OTTO-Q can
// actually see, which channels are degraded and why, and every command the
// shield REFUSED alongside the ones it let through. A panel that only showed
// successes would be a worse demo artifact, not a better one — "we measure our
// own twin's completeness" is the claim worth making to an OEM.
// ============================================================================
import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Battery, ChevronDown, ChevronRight, CircleSlash,
  Eye, EyeOff, Radio, ShieldCheck, Zap,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorldStore } from "@/store/worldStore";
import { useOrchestrationStore } from "@/store/orchestrationStore";
import { CHANNEL_LABELS, type ChannelStatus } from "@/lib/ottoq/contracts";
import { coverageHeadline } from "@/lib/ottoq/coverage";

// ── shared bits ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<ChannelStatus, string> = {
  ok: "#C9E0D4",
  degraded: "#FFEBC9",
  missing: "#FF8A80",
};

const Dot = ({ color }: { color: string }) => (
  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
);

const Section = ({ icon: Icon, title, right, children, defaultOpen = true }: {
  icon: React.ElementType; title: string; right?: React.ReactNode;
  children: React.ReactNode; defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.06]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-canvas-elev/40 border-l-2 border-l-brand-red hover:bg-canvas-elev/70 transition-colors"
      >
        {open ? <ChevronDown size={12} className="text-ink-dim" /> : <ChevronRight size={12} className="text-ink-dim" />}
        <Icon size={13} className="text-brand-red" />
        <span className="font-display text-[11px] uppercase tracking-[0.08em] text-ink">{title}</span>
        {right}
      </button>
      {open && <div className="px-3 py-2.5 flex flex-col gap-2">{children}</div>}
    </div>
  );
};

/** A 0..1 bar. Deliberately shows the EMPTY portion clearly. */
const Bar = ({ value, color }: { value: number; color: string }) => (
  <div className="h-1 w-full rounded-sm bg-white/[0.06] overflow-hidden">
    <div className="h-full rounded-sm" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
  </div>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="px-3 py-6 text-[11px] text-ink-faint text-center">{children}</div>
);

// ── main ────────────────────────────────────────────────────────────────────

export const WorldContractTab = () => {
  const phase = useWorldStore((s) => s.phase);
  const boot = useWorldStore((s) => s.boot);
  const bundle = useWorldStore((s) => s.bundle);
  const coverage = useWorldStore((s) => s.coverage);
  const framesPacked = useWorldStore((s) => s.framesPacked);
  const bootError = useWorldStore((s) => s.error);

  const latest = useOrchestrationStore((s) => s.latest);
  const totals = useOrchestrationStore((s) => s.totals);

  const [showDark, setShowDark] = useState(false);

  const darkVars = useMemo(
    () => (coverage?.variables ?? []).filter((v) => v.verdict !== "observed"),
    [coverage],
  );

  if (phase === "idle") {
    return <Empty>No run adopted. Start a scenario to load the world.</Empty>;
  }
  if (phase === "loading") {
    return <Empty>Loading the world…</Empty>;
  }
  if (phase === "failed") {
    return <Empty><span className="text-state-crit">World load failed:</span> {bootError}</Empty>;
  }

  const phaseColor = phase === "ready" ? STATUS_COLOR.ok : STATUS_COLOR.degraded;

  return (
    <ScrollArea className="flex-1">
      {/* ── WORLD LOAD ───────────────────────────────────────────────────── */}
      <Section
        icon={Radio}
        title="World Load"
        right={
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[9px]" style={{ color: phaseColor }}>
            <Dot color={phaseColor} />
            {phase.toUpperCase()}
          </span>
        }
      >
        {boot && (
          <>
            <div className="flex items-center justify-between text-[10px] text-ink-faint font-mono">
              <span>{boot.scenario ?? "—"} · seed {boot.seed ?? "—"}</span>
              <span>{boot.duration_ms}ms · tick {boot.tick ?? 0}</span>
            </div>

            {/* boot stages */}
            <div className="flex flex-col gap-1 pt-1">
              {boot.stages.map((s) => {
                const color = s.status === "ok" ? STATUS_COLOR.ok
                  : s.status === "empty" ? STATUS_COLOR.degraded : STATUS_COLOR.missing;
                return (
                  <div key={s.id} className="flex items-start gap-1.5">
                    <span className="mt-1"><Dot color={color} /></span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] text-ink truncate">{s.label}</span>
                        <span className="font-mono text-[9px] text-ink-faint shrink-0">{s.duration_ms}ms</span>
                      </div>
                      <div className="text-[9px] text-ink-faint leading-tight">{s.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* blockers — the reason `ready` is false, stated plainly */}
            {boot.blocked_by.length > 0 && (
              <div className="mt-1 rounded border border-state-warn/20 bg-state-warn/[0.04] px-2 py-1.5">
                <div className="flex items-center gap-1.5 pb-1">
                  <AlertTriangle size={11} className="text-state-warn" />
                  <span className="text-[10px] font-display uppercase tracking-wide text-state-warn">
                    {boot.blocked_by.length} blocker{boot.blocked_by.length === 1 ? "" : "s"}
                  </span>
                </div>
                {boot.blocked_by.map((b, i) => (
                  <div key={i} className="text-[9px] text-ink-dim leading-snug">· {b}</div>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── CHANNELS ─────────────────────────────────────────────────────── */}
      <Section
        icon={Activity}
        title="Channels"
        right={
          <span className="ml-auto font-mono text-[9px] text-ink-faint">
            {bundle?.status ?? "—"} · {framesPacked} frame{framesPacked === 1 ? "" : "s"}
          </span>
        }
      >
        {!bundle && <span className="text-[10px] text-ink-faint">No frame packed yet.</span>}
        {bundle && Object.entries(bundle.channels).map(([id, env]) => {
          const color = STATUS_COLOR[env.integrity.status];
          const required = boot?.channels.find((c) => c.channel === id)?.required;
          return (
            <div key={id} className="flex flex-col gap-1 py-0.5">
              <div className="flex items-center gap-1.5">
                <Dot color={color} />
                <span className="text-[11px] text-ink">{CHANNEL_LABELS[id as keyof typeof CHANNEL_LABELS]}</span>
                {required && (
                  <span className="text-[8px] text-ink-faint border border-white/10 rounded px-1 leading-tight">required</span>
                )}
                <span className="ml-auto font-mono text-[9px]" style={{ color }}>
                  {Math.round(env.integrity.completeness * 100)}%
                </span>
              </div>
              <Bar value={env.integrity.completeness} color={color} />
              {env.staleness_s !== null && env.staleness_s > 0 && (
                <div className="text-[9px] text-ink-faint font-mono">{env.staleness_s}s behind the world clock</div>
              )}
              {env.integrity.missing.length > 0 && (
                <div className="text-[9px] text-ink-faint leading-snug">
                  missing: {env.integrity.missing.join(", ")}
                </div>
              )}
              {env.integrity.notes.map((n, i) => (
                <div key={i} className="text-[9px] text-ink-faint/80 leading-snug italic">{n}</div>
              ))}
            </div>
          );
        })}
      </Section>

      {/* ── COVERAGE ─────────────────────────────────────────────────────── */}
      <Section
        icon={Eye}
        title="Variable Coverage"
        right={
          coverage && (
            <span className="ml-auto font-mono text-[9px] text-ink-faint">
              {coverage.observed}/{coverage.total}
            </span>
          )
        }
      >
        {!coverage && <span className="text-[10px] text-ink-faint">Not computed yet.</span>}
        {coverage && (
          <>
            <div className="text-[10px] text-ink-dim leading-snug">{coverageHeadline(coverage)}</div>
            {coverage.by_domain.map((d) => (
              <div key={d.domain} className="flex flex-col gap-1 py-0.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-ink-dim capitalize">{d.domain.replace(/_/g, " ")}</span>
                  <span className="font-mono text-[9px] text-ink-faint">{d.observed}/{d.total}</span>
                </div>
                <Bar value={d.ratio} color={d.ratio > 0.5 ? STATUS_COLOR.ok : d.ratio > 0 ? STATUS_COLOR.degraded : STATUS_COLOR.missing} />
              </div>
            ))}

            <button
              onClick={() => setShowDark((s) => !s)}
              className="flex items-center gap-1.5 text-[10px] text-ink-dim hover:text-ink pt-1"
            >
              {showDark ? <EyeOff size={11} /> : <Eye size={11} />}
              {showDark ? "Hide" : "Show"} the {darkVars.length} variables OTTO-Q cannot see
            </button>
            {showDark && (
              <div className="flex flex-col gap-0.5 pl-2 border-l border-white/[0.06]">
                {darkVars.map((v) => (
                  <div key={v.var_key} className="flex items-baseline gap-1.5">
                    <span
                      className="font-mono text-[8px] shrink-0 w-[62px]"
                      style={{ color: v.verdict === "dark" ? STATUS_COLOR.degraded : STATUS_COLOR.missing }}
                    >
                      {v.verdict}
                    </span>
                    <span className="text-[10px] text-ink-dim truncate">{v.label}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── DECISION TRACE ───────────────────────────────────────────────── */}
      <Section
        icon={ShieldCheck}
        title="Decision Trace"
        right={
          <span className="ml-auto font-mono text-[9px] text-ink-faint">
            tick {latest?.tick ?? "—"}
          </span>
        }
      >
        {!latest && <span className="text-[10px] text-ink-faint">No decision pass yet.</span>}
        {latest && (
          <>
            {/* the funnel, layer by layer */}
            {latest.trace.map((line, i) => (
              <div key={i} className="font-mono text-[9px] text-ink-dim leading-snug">{line}</div>
            ))}

            {/* what went out */}
            {latest.batch.commands.length > 0 && (
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-[10px] font-display uppercase tracking-wide text-ink-faint">
                  Sent ({latest.batch.commands.length})
                </span>
                {latest.batch.commands.map((c) => (
                  <div key={c.command_id} className="rounded border border-white/[0.06] bg-canvas-elev/40 px-2 py-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-[9px] text-brand-red">{c.intent}</span>
                      <span className="text-[10px] text-ink truncate">{c.target.label ?? c.target.id}</span>
                      <span className="ml-auto font-mono text-[8px] text-ink-faint">{c.provenance.advisor}</span>
                    </div>
                    <div className="text-[9px] text-ink-dim leading-snug pt-0.5">{c.provenance.rationale}</div>
                  </div>
                ))}
              </div>
            )}

            {/* what did NOT — the part that makes this trustworthy */}
            {latest.batch.suppressed.length > 0 && (
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-[10px] font-display uppercase tracking-wide text-ink-faint">
                  Suppressed ({latest.batch.suppressed.length})
                </span>
                {latest.batch.suppressed.slice(0, 12).map((s, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <CircleSlash size={10} className="text-ink-faint mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-mono text-[9px] text-state-warn">{s.rule}</span>
                        <span className="text-[9px] text-ink-dim truncate">{s.intent} · {s.target.id}</span>
                      </div>
                      <div className="text-[9px] text-ink-faint leading-snug">{s.detail}</div>
                    </div>
                  </div>
                ))}
                {latest.batch.suppressed.length > 12 && (
                  <span className="text-[9px] text-ink-faint">
                    …and {latest.batch.suppressed.length - 12} more
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── ENERGY CONTROLLER ────────────────────────────────────────────── */}
      <Section icon={Battery} title="Energy Controller" defaultOpen={false}>
        {!latest && <span className="text-[10px] text-ink-faint">No pass yet.</span>}
        {latest && (
          <>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
              <span className="text-ink-faint">delivering</span>
              <span className="text-ink text-right">{latest.energy.actualKw} kW</span>
              <span className="text-ink-faint">commanded</span>
              <span className="text-ink text-right">{latest.energy.targetKw} kW</span>
              <span className="text-ink-faint">state of charge</span>
              <span className="text-ink text-right">{latest.energy.socPct}%</span>
              <span className="text-ink-faint">site cap</span>
              <span className="text-ink text-right">{latest.energy.siteCapKw ?? "—"}</span>
            </div>
            {latest.energy.derateReason && (
              <div className="text-[9px] text-state-warn leading-snug">{latest.energy.derateReason}</div>
            )}
            <div className="text-[9px] text-ink-faint leading-snug">
              OTTO-Q states an average power and a window. Ramp, derate and state-of-charge
              bounds are the controller's own — the orchestrator never sets a converter.
            </div>
          </>
        )}
      </Section>

      {/* ── LEDGER ───────────────────────────────────────────────────────── */}
      <Section icon={Zap} title="Command Ledger" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
          <span className="text-ink-faint">issued</span>
          <span className="text-ink text-right">{totals.issued}</span>
          <span className="text-ink-faint">accepted</span>
          <span className="text-ink text-right">{totals.accepted}</span>
          <span className="text-ink-faint">rejected</span>
          <span className="text-ink text-right">{totals.rejected}</span>
          <span className="text-ink-faint">suppressed</span>
          <span className="text-ink text-right">{totals.suppressed}</span>
          <span className="text-ink-faint">expired</span>
          <span className="text-ink text-right">{totals.expired}</span>
        </div>
        {latest && latest.ledger.sequenceGaps.length > 0 && (
          <div className="text-[9px] text-state-crit leading-snug">
            {latest.ledger.sequenceGaps.length} sequence gap(s) — commands were lost in transit,
            not simply not issued.
          </div>
        )}
        {latest && latest.transmit.transportError && (
          <div className="text-[9px] text-state-crit leading-snug">
            transport: {latest.transmit.transportError}
          </div>
        )}
      </Section>
    </ScrollArea>
  );
};
