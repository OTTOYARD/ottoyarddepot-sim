// ============================================================================
// TwinKpisTab — the run's numbers, in two halves that answer different questions.
//
//   1. THE FIVE (CLAUDE.md 2.9). ottoq_kpi_five, recomputed server-side from the run's
//      own rows, so every figure here regenerates from the run ID printed under it.
//      These are the numbers that may be quoted.
//   2. LIVE DEPOT. What the latest snapshot shows right now. Useful for watching,
//      not for quoting: it is one frame, not a measurement over the run.
//
// 2026-09-23: this tab used to show only the second half, with an L2 denominator of
// 35 stalls (the twin depot has 30, so L2 read 83% full when 29 of 30 were in use)
// and a "Fleet Ready" ring that counted vehicles WAITING for service as ready.
// Denominators now come from the depot layout, and ready means staged to depart.
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StatCard } from "./StatCard";
import { useTwinStore } from "@/store/twinStore";
import { twin, type TwinKpiFive } from "@/lib/ottoTwin";
import { chargeWaitDetail } from "@/lib/chargeWait";
import { liveFleetMetrics } from "@/lib/liveFleetMetrics";

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
        The energy curve builds as the run ticks…
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
            <XAxis dataKey="t" tick={{ fill: "#7B818D", fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#7B818D", fontSize: 9 }} axisLine={false} tickLine={false} width={40} />
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

export const TwinKpisTab = () => {
  const snapshot = useTwinStore((s) => s.snapshot);
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const layout = useTwinStore((s) => s.layout);


  if (!activeSimRunId || !snapshot) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <span className="text-ink-faint text-xs">Start a scenario on the Control tab to see this run's KPIs.</span>
      </div>
    );
  }

  const c = (snapshot.fleet?.counts ?? {}) as Record<string, number>;
  // Denominators from the run's own layout, never a constant (PR #108's shared definition).
  const fleet = liveFleetMetrics(snapshot, layout);
  const total = fleet.total;
  const energy = (snapshot.energy ?? {}) as Record<string, number | string>;
  const bess = (snapshot.bess ?? {}) as Record<string, number | string>;
  const grid = (snapshot.grid ?? {}) as Record<string, number | string | boolean | null>;
  const weather = (snapshot.weather ?? {}) as Record<string, number | string>;
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
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        <KpiFivePanel simRunId={activeSimRunId} simClock={typeof snapshot.run?.sim_clock === "string" ? snapshot.run.sim_clock : null} />

        <div className="font-display text-[10px] text-ink-dim uppercase tracking-wider pt-1">Live depot · this frame</div>
        <div className="grid grid-cols-4 gap-2">
          <StatCard label="Deployed" value={deployed} />
          <StatCard label="In bays" value={inBays} />
          <StatCard label="Waiting" value={waiting} />
          <StatCard label="Ready" value={ready} />
        </div>
        <div className="text-[10px] text-ink-faint -mt-1">
          {fmt(inDepot)} of {fmt(total)} vehicles in the depot · ready = staged to depart; waiting = at the gate or staged for service
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label={`DCFC in use · ${num(c.charging_dcfc)} of ${dcfcStalls}`} value={dcfcUtil} variant="bar-gauge" barValue={dcfcUtil} barColor="#C8102E" />
          <StatCard label={`L2 in use · ${num(c.charging_l2)} of ${l2Stalls}`} value={l2Util} variant="bar-gauge" barValue={l2Util} barColor="#00B4A6" />
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

        {/* Grid & Environment */}
        <Accordion type="single" collapsible>
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
        </Accordion>
      </div>
    </ScrollArea>
  );
};
