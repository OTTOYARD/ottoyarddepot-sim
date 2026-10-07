// ============================================================================
// TwinKpisTab — the run's numbers, led by what a depot owner, an OEM or an investor asks first.
//
// Chase, 2026-10-06: "the KPI tab is super weak and unclear and not reader friendly ... the first half is just random
// super technical information ... It should hang very heavily on Vehicle up time and any other autonomous vehicle or
// depot KPI's that are extremely relevant for revenue energy turnaround time service is completed, etc."
//
//   1. THE BOARD (otto-q-core 0609/0610, public.ottoq_twin_kpi_board). Fleet uptime as the one hero figure; turnaround,
//      charge at departure, on time and cars out as tiles; where fleet time went; then turnaround, service, energy and
//      chargers. Every figure is computed by the engine from the run's own rows inside its window, so each regenerates
//      from the run id printed under it. Shaping and words: src/lib/kpiBoard.ts.
//   2. LIVE DEPOT. What the latest snapshot shows right now. Useful for watching, not for quoting: it is one frame.
//   3. THE FIVE (CLAUDE.md 2.9, ottoq_kpi_five), unchanged, in a closed section for diligence.
//
// 2026-09-23: this tab used to show only the live half, with an L2 denominator of 35 stalls (the twin depot has 30) and
// a "Fleet Ready" ring that counted cars WAITING for service as ready. Denominators come from the depot layout, and
// ready means staged to depart.
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StatCard } from "./StatCard";
import { useTwinStore } from "@/store/twinStore";
import { twin, type TwinKpiBoard, type TwinKpiFive } from "@/lib/ottoTwin";
import { chargeWaitDetail } from "@/lib/chargeWait";
import { liveFleetMetrics } from "@/lib/liveFleetMetrics";
import {
  boardCaption, chargerRows, energyNote, energyRows, fmtHours, fmtPct, headlineTiles, serviceRows, timeSplit, topServices, turnaroundRows,
  waitingShare, type Row, type Tile, type TimeSegment,
} from "@/lib/kpiBoard";
import { CheckCircle2 } from "lucide-react";

const num = (v: unknown, d = 0): number => (typeof v === "number" && isFinite(v) ? v : Number(v) || d);
/** A reading the snapshot actually carries, or null. An absent reading renders as unavailable, never as 0 (PR #109). */
const measured = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;

const EnergyChart = React.memo(function EnergyChart() {
  const history = useTwinStore((s) => s.energyHistory);
  const data = useMemo(
    () => history.map((p) => ({
      t: `t${p.t}`, Solar: Math.round(p.solar), Charging: Math.round(p.ev),
      Building: Math.round(p.building), Import: Math.round(Math.max(0, p.grid)),
      Export: Math.round(Math.max(0, -p.grid)), LMP: Math.round(p.lmp),
    })),
    [history]
  );
  if (data.length < 2) {
    return (
      <div className="h-[160px] bg-canvas-panel rounded-lg border border-white/[0.06] flex items-center justify-center text-ink-faint text-xs">
        The energy curve grows with each tick…
      </div>
    );
  }
  return (
    <div className="bg-canvas-panel rounded-lg border border-white/[0.06] p-3">
      <span className="font-display text-[10px] text-ink-dim uppercase tracking-wider">Site energy (kW) · LMP ($/MWh)</span>
      <div className="h-[150px] mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -10 }}>
            <defs>
              <linearGradient id="gSolar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFEBC9" stopOpacity={0.5} /><stop offset="100%" stopColor="#FFEBC9" stopOpacity={0.05} /></linearGradient>
              <linearGradient id="gChg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C8102E" stopOpacity={0.5} /><stop offset="100%" stopColor="#C8102E" stopOpacity={0.05} /></linearGradient>
            </defs>
            <XAxis dataKey="t" tick={{ fill: "#FFFFFF", fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#FFFFFF", fontSize: 9 }} axisLine={false} tickLine={false} width={40} />
            <Tooltip contentStyle={{ background: "#14161A", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, color: "#E7EAF0" }} />
            <Area type="monotone" dataKey="Solar" stroke="#F59E0B" fill="url(#gSolar)" isAnimationActive={false} />
            <Area type="monotone" dataKey="Charging" stroke="#C8102E" fill="url(#gChg)" isAnimationActive={false} />
            <Line type="monotone" dataKey="Export" stroke="#C9E0D4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="LMP" stroke="#D8DDFF" strokeWidth={1} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

/** The KPI payload is a measurement over the whole run; a 20-second refresh is plenty. */
const KPI_POLL_MS = 20_000;

/**
 * The sim day a per-day KPI should be read on: the day the sim clock is on, or the latest day before it.
 *
 * NOT simply the latest key. ottoq_kpi_five keys days with date_trunc in the database session's zone (UTC),
 * and a booking that runs past midnight UTC creates the next day's key with 0 turns while the run is still
 * on the current day (run 736406cf at 14:40 CT read "0.00 turns per point" off a `2026-09-24: 0` entry).
 * `asOf` is the sim clock; its UTC date matches the engine's keys.
 */
export function latestDay(
  m: Record<string, number> | null | undefined,
  asOf?: string | null,
): { day: string; value: number } | null {
  if (!m || typeof m !== "object") return null;
  const cutoff = asOf && !Number.isNaN(Date.parse(asOf)) ? new Date(asOf).toISOString().slice(0, 10) : null;
  const days = Object.keys(m).sort().filter((d) => !cutoff || d <= cutoff);
  for (let i = days.length - 1; i >= 0; i--) {
    const v = Number(m[days[i]]);
    if (Number.isFinite(v)) return { day: days[i], value: v };
  }
  return null;
}

const fmt = (v: number | null | undefined, digits = 0): string =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";

function useKpiFive(simRunId: string | null) {
  const [kpis, setKpis] = useState<TwinKpiFive | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setKpis(null);
    setError(null);
    if (!simRunId) return;
    let cancelled = false;
    const load = () =>
      twin.kpis(simRunId)
        .then((k) => { if (!cancelled) { setKpis(k); setError(null); } })
        .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    load();
    const t = setInterval(load, KPI_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [simRunId]);
  return { kpis, error };
}

function KpiRow({ n, label, value, unit, detail }: { n?: number; label: string; value: string; unit?: string; detail?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
      <div className="min-w-0">
        <div className="text-[11px] text-ink-dim">{n != null && <span className="font-mono text-ink-faint mr-1.5">{n}</span>}{label}</div>
        {detail && <div className="text-[10px] text-ink-faint mt-0.5 leading-snug">{detail}</div>}
      </div>
      <div className="font-mono text-sm text-ink tabular-nums whitespace-nowrap">
        {value}{unit && value !== "—" && <span className="text-[10px] text-ink-faint ml-1">{unit}</span>}
      </div>
    </div>
  );
}

const KpiFivePanel = ({ simRunId, simClock }: { simRunId: string; simClock: string | null }) => {
  const { kpis, error } = useKpiFive(simRunId);
  const hours = latestDay(kpis?.asset_hours_available_per_day, simClock);
  const turns = latestDay(kpis?.service_point_turns_per_point_per_day, simClock);
  const a = kpis?.audit;
  const turnsDone = a?.touch_events_per_turn?.turns;
  const touches = a?.touch_events_per_turn?.touch_events;
  const shaved = kpis && typeof kpis.peak_site_kw === "number" && typeof kpis.peak_site_kw_demand === "number"
    ? kpis.peak_site_kw_demand - kpis.peak_site_kw : null;

  return (
    <div className="bg-canvas-panel rounded-lg border border-white/[0.06] p-3">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[10px] text-ink-dim uppercase tracking-wider">The five KPIs · this run</span>
        <span className="font-mono text-[9px] text-ink-faint" title={simRunId}>run {simRunId.slice(0, 8)}</span>
      </div>
      {error && !kpis && <div className="text-[11px] text-otto-red mt-2">KPI read failed: {error}</div>}
      {!error && !kpis && <div className="text-[11px] text-ink-faint mt-2">Computing from the run's rows…</div>}
      {kpis?.purged != null && <div className="text-[11px] text-ink-faint mt-2">This run's rows were purged; its KPIs live in the run archive.</div>}
      {kpis && kpis.purged == null && (
        <div className="mt-1">
          <KpiRow n={1} label="Asset-hours available"
            value={fmt(hours?.value, 1)} unit="h"
            detail={hours ? `vehicle-hours deployed on sim day ${hours.day}` : "no deployed hours measured yet"} />
          <KpiRow n={2} label="Turns per service point per day"
            value={fmt(turns?.value, 2)}
            detail={a?.service_point_turns_per_point_per_day?.turns_completed != null
              ? `${fmt(a.service_point_turns_per_point_per_day.turns_completed)} completed turns over ${fmt(a.service_point_turns_per_point_per_day.points_with_a_turn_max_day)} points`
              : undefined} />
          <KpiRow n={3} label="Peak grid import (15-min)"
            value={fmt(kpis.peak_site_kw, 0)} unit="kW"
            detail={kpis.peak_site_kw_demand != null
              ? `site load before the battery peaked at ${fmt(kpis.peak_site_kw_demand, 0)} kW${shaved != null && shaved > 0 ? ` — the battery took ${fmt(shaved, 0)} kW off the bill` : ""}`
              : undefined} />
          <KpiRow n={4} label="Human touches per turn"
            value={fmt(kpis.touch_events_per_turn, 3)}
            detail={turnsDone != null && touches != null ? `${fmt(touches)} operator touches over ${fmt(turnsDone)} turns` : undefined} />
          <KpiRow n={5} label="Time to service, p95"
            value={fmt(kpis.p95_time_to_service_min, 1)} unit="min"
            detail={`p50 ${fmt(kpis.p50_time_to_service_min, 1)} min · ${fmt(a?.p95_time_to_service_min?.returns_measured)} returns measured · ${fmt(kpis.returns_unserved)} unserved`} />
          {kpis.charge_wait && (
            <div className="mt-2 pt-1 border-t border-white/[0.06]">
              <div className="font-display text-[9px] text-ink-faint uppercase tracking-wider pt-1">Beside the five</div>
              <KpiRow label="Wait for a charger, p95"
                value={fmt(kpis.charge_wait.p95_wait_floor_min, 1)} unit="min"
                detail={chargeWaitDetail(kpis.charge_wait)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── the board ───────────────────────────────────────────────────────────────
/** The board runs the run's whole history through the engine (about 1 to 1.5 s on a full sim day): 30 s is plenty. */
const BOARD_POLL_MS = 30_000;

function useKpiBoard(simRunId: string | null) {
  const [board, setBoard] = useState<TwinKpiBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setBoard(null);
    setError(null);
    if (!simRunId) return;
    let cancelled = false;
    const load = () =>
      twin.kpiBoard(simRunId)
        .then((b) => { if (!cancelled) { setBoard(b); setError(null); } })
        .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    load();
    const t = setInterval(load, BOARD_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [simRunId]);
  return { board, error };
}

const card = "bg-canvas-panel rounded-lg border border-white/[0.06] p-3";
const sectionTitle = "font-display text-[10px] text-ink-dim uppercase tracking-wider";

/** The one hero figure: fleet uptime, with the meter split into on the road and ready. */
function UptimeHero({ board, seg }: { board: TwinKpiBoard; seg: TimeSegment[] }) {
  const road = seg.find((x) => x.key === "road"), ready = seg.find((x) => x.key === "ready");
  const u = board.uptime;
  return (
    <section aria-label="Fleet uptime" className={card} data-testid="kpi-uptime">
      <div className={sectionTitle}>Fleet uptime</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-ui text-[48px] font-semibold leading-none text-ink">{fmtPct(u?.pct ?? null)}</span>
        <span className="text-[11px] leading-4 text-ink-dim">of fleet time on the road or ready to go</span>
      </div>
      <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]" role="img"
        aria-label={`On the road ${fmtPct(road?.pct ?? null)}, ready ${fmtPct(ready?.pct ?? null)}`}>
        <div style={{ width: `${road?.pct ?? 0}%`, background: road?.color }} />
        {(ready?.pct ?? 0) > 0 && <div style={{ width: `${ready?.pct ?? 0}%`, background: ready?.color, marginLeft: 2 }} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-dim">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: road?.color }} />On the road {fmtPct(road?.pct ?? null)}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: ready?.color }} />Ready {fmtPct(ready?.pct ?? null)}</span>
        <span>{fmtHours(u?.revenue_hours ?? null)} on the road · {u?.revenue_hours_per_car_day != null ? `${u.revenue_hours_per_car_day.toFixed(1)} h` : "—"} a car a day</span>
      </div>
    </section>
  );
}

function HeadlineTile({ t }: { t: Tile }) {
  return (
    <div className={`${card} min-w-0`} data-testid={`kpi-tile-${t.key}`}>
      <div className="text-[11px] text-ink-dim">{t.label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="font-ui text-[22px] font-semibold leading-none text-ink">{t.value}</span>
        {t.tone === "good" && <CheckCircle2 aria-label="all" size={15} className="text-emerald-400" />}
      </div>
      <div className="mt-1.5 text-[10.5px] leading-[14px] text-ink-dim">{t.sub}</div>
    </div>
  );
}

/** Where fleet time went: one stacked bar (2 px gaps), a legend that is always shown, and the wait in one sentence. */
function TimeSplitCard({ seg }: { seg: TimeSegment[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = seg.filter((x) => x.hours > 0);
  const h = shown.find((x) => x.key === hover) ?? null;
  const wait = waitingShare(seg);
  const q = seg.find((x) => x.key === "queue"), btw = seg.find((x) => x.key === "between");
  return (
    <section aria-label="Where fleet time went" className={card} data-testid="kpi-split">
      <div className={sectionTitle}>Where fleet time went</div>
      <div className="mt-2 flex h-5 w-full gap-[2px]" role="img" aria-label={shown.map((x) => `${x.label} ${fmtPct(x.pct)}`).join(", ")}
        onMouseLeave={() => setHover(null)}>
        {shown.map((x, i) => (
          <div key={x.key} onMouseEnter={() => setHover(x.key)} onClick={() => setHover(hover === x.key ? null : x.key)}
            className="h-full cursor-default transition-opacity"
            style={{ width: `${x.pct}%`, minWidth: 2, background: x.color, opacity: hover && hover !== x.key ? 0.45 : 1,
              borderTopLeftRadius: i === 0 ? 4 : 0, borderBottomLeftRadius: i === 0 ? 4 : 0,
              borderTopRightRadius: i === shown.length - 1 ? 4 : 0, borderBottomRightRadius: i === shown.length - 1 ? 4 : 0 }} />
        ))}
      </div>
      <div className="mt-1 h-4 text-[10.5px] text-ink">
        {h ? `${h.label}: ${fmtPct(h.pct)} · ${fmtHours(h.hours)} · ${h.means}` : <span className="text-ink-dim">Point at or tap a part of the bar to see its hours.</span>}
      </div>
      <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1" aria-label="Legend">
        {seg.map((x) => (
          <li key={x.key} className="flex items-center gap-1.5 text-[11px]" onMouseEnter={() => setHover(x.key)} onMouseLeave={() => setHover(null)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: x.color }} />
            <span className="min-w-0 truncate text-ink">{x.label}</span>
            <span className="ml-auto font-mono text-[10.5px] tabular-nums text-ink">{fmtPct(x.pct)}</span>
          </li>
        ))}
      </ul>
      {wait != null && (
        <p className="mt-2 border-t border-white/[0.06] pt-2 text-[11px] leading-4 text-ink">
          Cars waited {fmtPct(wait)} of fleet time: {fmtPct(q?.pct ?? null)} after arrival, {fmtPct(btw?.pct ?? null)} between steps.
        </p>
      )}
    </section>
  );
}

function RowsCard({ title, rows, children, testid }: { title: string; rows: Row[]; children?: React.ReactNode; testid?: string }) {
  if (!rows.length && !children) return null;
  return (
    <section aria-label={title} className={card} data-testid={testid}>
      <div className={sectionTitle}>{title}</div>
      <div className="mt-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] py-1.5 last:border-0">
            <div className="min-w-0">
              <div className="text-[11.5px] text-ink">{r.label}</div>
              {r.detail && <div className="mt-0.5 text-[10.5px] leading-snug text-ink-dim">{r.detail}</div>}
            </div>
            <div className="whitespace-nowrap font-ui text-[15px] font-semibold text-ink">{r.value}</div>
          </div>
        ))}
      </div>
      {children}
    </section>
  );
}

function ServiceBars({ board }: { board: TwinKpiBoard }) {
  const top = topServices(board, 5);
  if (!top.length) return null;
  return (
    <ul className="mt-2 space-y-1.5" aria-label="Most steps done, by service">
      {top.map((x) => (
        <li key={x.svc}>
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate text-ink">{x.name}</span>
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink">{x.done} of {x.total}</span>
          </div>
          <div className="mt-0.5 h-1.5 w-full rounded-full bg-white/[0.08]">
            <div className="h-1.5 rounded-full" style={{ width: `${x.pct}%`, background: "#3987e5" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The board: what the run did for the fleet, from the engine's own reading of the run. */
const KpiBoardPanel = ({ simRunId }: { simRunId: string }) => {
  const { board, error } = useKpiBoard(simRunId);
  const seg = useMemo(() => timeSplit(board), [board]);
  if (error && !board) return <div className={`${card} text-[11px] text-otto-red`}>KPI board read failed: {error}</div>;
  if (!board) return <div className={`${card} text-[11px] text-ink-dim`}>Computing from this run's records…</div>;
  if (!board.ok) {
    return (
      <div className={`${card} text-[11px] leading-4 text-ink-dim`}>
        {board.error === "no_state_history"
          ? "This run has no car state history left, so the board has nothing to read. The five KPIs below come from its archive."
          : `The KPI board did not answer (${board.error ?? "unknown"}).`}
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="kpi-board">
      <UptimeHero board={board} seg={seg} />
      <div className="grid grid-cols-2 gap-2">
        {headlineTiles(board).map((t) => <HeadlineTile key={t.key} t={t} />)}
      </div>
      {seg.length > 0 && <TimeSplitCard seg={seg} />}
      <RowsCard title="Turnaround" rows={turnaroundRows(board)} testid="kpi-turnaround" />
      <RowsCard title="Service" rows={serviceRows(board)} testid="kpi-service"><ServiceBars board={board} /></RowsCard>
      <RowsCard title="Energy" rows={energyRows(board)} testid="kpi-energy">
        {energyNote(board) && <p className="mt-2 text-[10px] leading-4 text-ink-dim">{energyNote(board)}</p>}
      </RowsCard>
      <RowsCard title="Chargers" rows={chargerRows(board)} testid="kpi-chargers" />
      <p className="px-1 text-[10px] leading-4 text-ink-dim">
        {boardCaption(board)}. The engine computes each figure from this run's own records. It updates every 30 s.
      </p>
    </div>
  );
};

/** What the latest snapshot shows right now: one frame, for watching, never for quoting. */
function LiveDepot({ snapshot, layout }: { snapshot: NonNullable<ReturnType<typeof useTwinStore.getState>["snapshot"]>; layout: ReturnType<typeof useTwinStore.getState>["layout"] }) {
  const c = (snapshot.fleet?.counts ?? {}) as Record<string, number>;
  // Denominators from the run's own layout, never a constant (PR #108's shared definition).
  const fleet = liveFleetMetrics(snapshot, layout);
  const total = fleet.total;
  const energy = (snapshot.energy ?? {}) as Record<string, number | string>;
  const bess = (snapshot.bess ?? {}) as Record<string, number | string>;
  const grid = (snapshot.grid ?? {}) as Record<string, number | string | boolean | null>;
  const counters = (snapshot.counters ?? {}) as Record<string, number>;

  const deployed = num(c.deployed);
  const inDepot = Math.max(0, total - deployed);
  const inBays = num(c.in_wash_bay) + num(c.in_detail_bay) + num(c.in_service_bay);
  const waiting = num(c.staged_awaiting_service) + num(c.arrived_at_gate);
  const ready = fleet.ready;
  const dcfcStalls = fleet.dcfcStalls;
  const l2Stalls = fleet.l2Stalls;
  const dcfcUtil = fleet.dcfcUtil ?? 0;
  const l2Util = fleet.l2Util ?? 0;
  const gridImport = measured(energy.grid_import_kw);
  const netGrid = gridImport === null ? null : gridImport - (measured(energy.grid_export_kw) ?? 0);
  const solar = measured(energy.solar_kw);
  const lmp = measured(grid.lmp_usd_mwh);
  const bessSoc = measured(bess.soc_pct);

  return (
    <>
      <div className="font-display text-[10px] text-ink-dim uppercase tracking-wider pt-1">Live depot · this frame</div>
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="Deployed" value={deployed} />
        <StatCard label="In bays" value={inBays} />
        <StatCard label="Waiting" value={waiting} />
        <StatCard label="Ready" value={ready} />
      </div>
      <div className="text-[10px] text-ink-faint -mt-1">
        {fmt(inDepot)} of {fmt(total)} cars in the depot · ready = staged to leave · waiting = at the gate or between steps
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatCard label={`DCFC in use · ${num(c.charging_dcfc)} of ${dcfcStalls}`} value={dcfcUtil} variant="bar-gauge" barValue={dcfcUtil} barColor="#3987e5" />
        <StatCard label={`L2 in use · ${num(c.charging_l2)} of ${l2Stalls}`} value={l2Util} variant="bar-gauge" barValue={l2Util} barColor="#3987e5" />
      </div>

      {/* Energy */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label={netGrid !== null && netGrid < 0 ? "Grid Export" : "Grid Import"} value={netGrid === null ? "—" : `${Math.abs(Math.round(netGrid))}`} unit="kW" />
        <StatCard label="Solar Output" value={solar === null ? "—" : Math.round(solar)} unit="kW" />
        <StatCard label={`Battery · ${String(bess.state ?? "idle")}`} value={bessSoc === null ? "—" : Math.round(bessSoc)} unit="% SoC" />
        <StatCard label="LMP" value={lmp === null ? "—" : `$${Math.round(lmp)}`} unit="/MWh" />
      </div>

      <EnergyChart />

      {/* Throughput */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Dispatches (out now / total)" value={`${num(counters.dispatches_active)} / ${num(counters.dispatches_total)}`} />
        <StatCard label="Charge Sessions" value={num(counters.charge_sessions)} />
      </div>
    </>
  );
}

export const TwinKpisTab = () => {
  const snapshot = useTwinStore((s) => s.snapshot);
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const layout = useTwinStore((s) => s.layout);

  if (!activeSimRunId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <span className="text-ink-faint text-xs">Press Start at the top of the screen to see this run's KPIs.</span>
      </div>
    );
  }

  const energy = (snapshot?.energy ?? {}) as Record<string, number | string>;
  const grid = (snapshot?.grid ?? {}) as Record<string, number | string | boolean | null>;
  const weather = (snapshot?.weather ?? {}) as Record<string, number | string>;

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        <KpiBoardPanel simRunId={activeSimRunId} />

        {snapshot
          ? <LiveDepot snapshot={snapshot} layout={layout} />
          : <p className="px-1 text-[10.5px] text-ink-dim">Live readings show here while the run has a frame.</p>}

        {/* Engineering KPIs and Grid & Environment, closed: for diligence, not for the first read */}
        <Accordion type="single" collapsible>
          <AccordionItem value="five" className="border-white/[0.06]">
            <AccordionTrigger className="text-xs text-ink-dim hover:no-underline py-2 font-display uppercase tracking-wide">Engineering KPIs · the five</AccordionTrigger>
            <AccordionContent>
              <KpiFivePanel simRunId={activeSimRunId} simClock={typeof snapshot?.run?.sim_clock === "string" ? snapshot.run.sim_clock : null} />
            </AccordionContent>
          </AccordionItem>
          {snapshot && (
            <AccordionItem value="grid" className="border-white/[0.06]">
              <AccordionTrigger className="text-xs text-ink-dim hover:no-underline py-2 font-display uppercase tracking-wide">Grid & Environment</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-2 gap-2">
                  <StatCard label="Tariff" value={String(energy.tariff ?? "—")} className="text-xs" />
                  <StatCard label="Reserve Margin" value={Math.round(num(grid.reserve_margin_pct) * 100)} unit="%" />
                  <StatCard label="Grid Carbon" value={Math.round(num(grid.carbon_gco2_kwh))} unit="g/kWh" />
                  <StatCard label="Voltage" value={String(grid.voltage_status ?? "—")} className="text-xs" />
                  <StatCard label="DR Call" value={grid.dr_active ? `ACTIVE ${Math.round(num(grid.dr_cap_kw))}kW` : "none"} className="text-xs" />
                  <StatCard label="Energy Rate" value={`$${num(energy.rate_per_kwh).toFixed(3)}`} unit="/kWh" />
                  <StatCard label="Ambient" value={num(weather.temp_c)} unit="°C" />
                  <StatCard label="Conditions" value={String(weather.conditions ?? "—")} className="text-xs" />
                  <StatCard label="Cloud" value={Math.round(num(weather.cloud_pct))} unit="%" />
                  <StatCard label="GHI" value={Math.round(num(weather.ghi_wm2))} unit="W/m²" />
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </div>
    </ScrollArea>
  );
};
