// ============================================================================
// TwinKpisTab — KPIs computed live from the backend twin snapshot (replaces the
// legacy client-engine KPIsTab). Reuses StatCard + a recharts energy chart fed
// from twinStore.energyHistory.
// ============================================================================
import React, { useMemo } from "react";
import { AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StatCard } from "./StatCard";
import { useTwinStore } from "@/store/twinStore";
import { liveFleetMetrics } from "@/lib/liveFleetMetrics";

const num = (v: unknown, d = 0): number => (typeof v === "number" && isFinite(v) ? v : Number(v) || d);
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
        Press Play — energy curve builds as the sim ticks…
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

export const TwinKpisTab = () => {
  const snapshot = useTwinStore((s) => s.snapshot);
  const layout = useTwinStore((s) => s.layout);
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);

  if (!activeSimRunId || !snapshot) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <span className="text-ink-faint text-xs">Start a scenario in Run Control to see live KPIs.</span>
      </div>
    );
  }

  const c = (snapshot.fleet?.counts ?? {}) as Record<string, number>;
  const fleet = liveFleetMetrics(snapshot, layout);
  const energy = (snapshot.energy ?? {}) as Record<string, number | string>;
  const bess = (snapshot.bess ?? {}) as Record<string, number | string>;
  const grid = (snapshot.grid ?? {}) as Record<string, number | string | boolean | null>;
  const weather = (snapshot.weather ?? {}) as Record<string, number | string>;
  const counters = (snapshot.counters ?? {}) as Record<string, number>;

  const deployed = num(c.deployed);
  const charging = num(c.charging_dcfc) + num(c.charging_l2);
  const inService = num(c.in_wash_bay) + num(c.in_detail_bay) + num(c.in_service_bay);
  const gridImport = measured(energy.grid_import_kw);
  const gridExport = measured(energy.grid_export_kw);
  const netGrid = gridImport !== null && gridExport !== null ? gridImport - gridExport : null;
  const solar = measured(energy.solar_kw);
  const lmp = measured(grid.lmp_usd_mwh);

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        {/* Fleet */}
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Staged to depart" value={fleet.readinessPct === null ? "—" : `${fleet.readinessPct.toFixed(1)}%`} />
          <StatCard label="Deployed" value={deployed} />
          <StatCard label="In Service" value={inService} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="DCFC Utilization" value={fleet.dcfcUtil === null ? "—" : fleet.dcfcUtil} variant={fleet.dcfcUtil === null ? "default" : "bar-gauge"} barValue={fleet.dcfcUtil ?? 0} barColor="#C8102E" />
          <StatCard label="L2 Utilization" value={fleet.l2Util === null ? "—" : fleet.l2Util} variant={fleet.l2Util === null ? "default" : "bar-gauge"} barValue={fleet.l2Util ?? 0} barColor="#00B4A6" />
        </div>

        {/* Energy */}
        <div className="grid grid-cols-2 gap-2">
          <StatCard label={netGrid !== null && netGrid < 0 ? "Grid Export" : "Grid Import"} value={netGrid === null ? "—" : Math.abs(Math.round(netGrid))} unit="kW" />
          <StatCard label="Solar Output" value={solar === null ? "—" : Math.round(solar)} unit="kW" />
          <StatCard label="BESS SoC" value={num(bess.soc_pct)} variant="circular-progress" />
          <StatCard label="LMP" value={lmp === null ? "—" : `$${Math.round(lmp)}`} unit="/MWh" />
        </div>

        <EnergyChart />

        {/* Throughput */}
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Dispatches (active)" value={`${num(counters.dispatches_active)} / ${num(counters.dispatches_total)}`} />
          <StatCard label="Charge Sessions" value={num(counters.charge_sessions)} />
          <StatCard label="Telemetry Packets" value={num(counters.telemetry_packets)} />
          <StatCard label="Open Incidents" value={num(counters.open_incidents)} />
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
