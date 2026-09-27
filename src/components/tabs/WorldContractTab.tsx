// ============================================================================
// WorldContractTab (the "Diagnostics" tab) — the feed seam, made visible.
//
// The boot report, the channel integrity records and the coverage audit: how
// much of the engine's world this cockpit can actually see, which channels are
// degraded and why, and which variability knobs have an effect on any channel.
// Engineering-facing. It is deliberately unflattering — a panel that only
// showed successes would be a worse diagnostic, not a better one.
//
// It used to also render a "Decision Trace", "Energy Controller" and "Command
// Ledger". Those were a SECOND orchestrator running in the browser
// (src/lib/ottoq/pipeline.ts and friends): client-side advisors, a client-side
// shield and a client-side battery model, deciding every tick in parallel with
// the engine and — through the motion driver's command inbox — able to choose
// which stall a car was drawn driving to. None of it was OTTO-Q. The engine's
// real decisions are on the Intelligence tab; the browser pipeline is gone.
// ============================================================================
import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ChevronDown, ChevronRight,
  Eye, EyeOff, Radio,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorldStore } from "@/store/worldStore";
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

            {/* REGISTRY DRIFT. Computed since the first version and rendered
                nowhere — so the one signal that our bindings and the backend
                catalog have diverged was invisible. Either direction is a
                defect the operator needs to see: an unbound key means the
                backend gained a variable we do not measure, a stale binding
                means we are measuring one that no longer exists. */}
            {coverage.unbound_catalog_keys === null ? (
              <div className="text-[9px] text-state-warn leading-snug">
                registry drift unknown — the variability catalog could not be read this run
              </div>
            ) : (coverage.unbound_catalog_keys.length > 0 || (coverage.stale_bindings?.length ?? 0) > 0) ? (
              <div className="rounded border border-state-warn/20 bg-state-warn/[0.04] px-2 py-1.5">
                <div className="flex items-center gap-1.5 pb-0.5">
                  <AlertTriangle size={10} className="text-state-warn" />
                  <span className="text-[9px] font-display uppercase tracking-wide text-state-warn">registry drift</span>
                </div>
                {coverage.unbound_catalog_keys.length > 0 && (
                  <div className="text-[9px] text-ink-dim leading-snug">
                    backend has {coverage.unbound_catalog_keys.length} variable(s) we do not measure:{" "}
                    {coverage.unbound_catalog_keys.slice(0, 6).join(", ")}
                    {coverage.unbound_catalog_keys.length > 6 ? "…" : ""}
                  </div>
                )}
                {(coverage.stale_bindings?.length ?? 0) > 0 && (
                  <div className="text-[9px] text-ink-dim leading-snug">
                    we measure {coverage.stale_bindings!.length} variable(s) the backend no longer lists:{" "}
                    {coverage.stale_bindings!.slice(0, 6).join(", ")}
                    {coverage.stale_bindings!.length > 6 ? "…" : ""}
                  </div>
                )}
              </div>
            ) : null}
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

    </ScrollArea>
  );
};
