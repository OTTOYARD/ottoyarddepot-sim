import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useKPIStore } from '@/store/kpiStore';
import { StatCard } from './StatCard';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

const EnergyChart = React.memo(function EnergyChart() {
  const energyTimeSeries = useKPIStore((s) => s.energyTimeSeries);

  const chartData = useMemo(
    () =>
      energyTimeSeries.map((p) => ({
        time: formatTime(p.time),
        DCFC: p.dcfc,
        L2: p.l2,
        Building: p.building,
        BESS: p.bessDischarge,
        utilityLimit: p.utilityLimit,
      })),
    [energyTimeSeries],
  );

  const utilityLimit = energyTimeSeries.length > 0 ? energyTimeSeries[0].utilityLimit : 4000;

  if (chartData.length < 2) {
    return (
      <div className="h-[180px] bg-otto-dark rounded-lg border border-white/10 flex items-center justify-center text-otto-gray text-xs">
        Waiting for energy data…
      </div>
    );
  }

  return (
    <div className="bg-otto-dark rounded-lg border border-white/10 p-3">
      <span className="text-[10px] text-otto-gray uppercase tracking-wider">
        Energy Demand Curve (kW)
      </span>
      <div className="h-[160px] mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="dcfcGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C00000" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#C00000" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="l2Grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00B4A6" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#00B4A6" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="bldgGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#666666" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#666666" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tick={{ fill: '#666', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: '#666', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: '#1A1A2E',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 11,
                color: '#fff',
              }}
            />
            <Area
              type="monotone"
              dataKey="Building"
              stackId="1"
              stroke="#666"
              fill="url(#bldgGrad)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="L2"
              stackId="1"
              stroke="#00B4A6"
              fill="url(#l2Grad)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="DCFC"
              stackId="1"
              stroke="#C00000"
              fill="url(#dcfcGrad)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="BESS"
              stroke="#F59E0B"
              fill="none"
              strokeDasharray="4 2"
              isAnimationActive={false}
            />
            <ReferenceLine
              y={utilityLimit}
              stroke="#fff"
              strokeDasharray="6 3"
              strokeOpacity={0.4}
              label={{
                value: 'Utility Limit',
                fill: '#666',
                fontSize: 9,
                position: 'right',
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

export const KPIsTab = () => {
  const fleetUptimePct = useKPIStore((s) => s.fleetUptimePct);
  const avgTurnaroundMin = useKPIStore((s) => s.avgTurnaroundMin);
  const dcfcUtilization = useKPIStore((s) => s.dcfcUtilization);
  const l2Utilization = useKPIStore((s) => s.l2Utilization);
  const avgQueueWaitMin = useKPIStore((s) => s.avgQueueWaitMin);
  const queueWaitHistory = useKPIStore((s) => s.queueWaitHistory);
  const revenuePerBayPerHour = useKPIStore((s) => s.revenuePerBayPerHour);
  const bessSOC = useKPIStore((s) => s.bessSOC);
  const solarSelfConsumption = useKPIStore((s) => s.solarSelfConsumption);
  const ottoQAccuracy = useKPIStore((s) => s.ottoQAccuracy);
  const serviceCompletionRate = useKPIStore((s) => s.serviceCompletionRate);
  const bayIdleTime = useKPIStore((s) => s.bayIdleTime);
  const costPerVehicle = useKPIStore((s) => s.costPerVehicle);
  const monthlyEBITDA = useKPIStore((s) => s.monthlyEBITDA);
  const paybackYears = useKPIStore((s) => s.paybackYears);
  const revenuePerMember = useKPIStore((s) => s.revenuePerMember);
  const energyCostPerKwh = useKPIStore((s) => s.energyCostPerKwh);
  const maintenanceScore = useKPIStore((s) => s.maintenanceScore);
  const carbonOffsetKg = useKPIStore((s) => s.carbonOffsetKg);
  const vehiclesProcessed = useKPIStore((s) => s.vehiclesProcessed);

  // Optimal charger mix recommendation
  const chargerRec = useMemo(() => {
    if (dcfcUtilization > 0.9)
      return `High DCFC demand. Consider adding 2 more DCFC stalls.`;
    if (l2Utilization < 0.3 && dcfcUtilization > 0.6)
      return `L2 underutilized. Consider converting 2 L2 → DCFC.`;
    return `Current charger mix is well-balanced.`;
  }, [dcfcUtilization, l2Utilization]);

  // Max vehicles at SLA
  const maxVehiclesAtSLA = useMemo(() => {
    const slaLimit = Math.round((dcfcUtilization > 0 ? 10 / dcfcUtilization : 50) * 1.5);
    return Math.min(slaLimit, 200);
  }, [dcfcUtilization]);

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        {/* Tier 1 — Always Visible */}
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            label="Fleet Uptime"
            value={fleetUptimePct}
            variant="circular-progress"
          />
          <StatCard
            label="Avg Turnaround"
            value={avgTurnaroundMin}
            unit="min"
            trend={{
              direction: avgTurnaroundMin > 30 ? 'up' : 'down',
              value: avgTurnaroundMin > 0 ? ((avgTurnaroundMin - 25) / 25) * 100 : 0,
              goodDirection: 'down',
            }}
          />
          <StatCard
            label="Queue Wait"
            value={avgQueueWaitMin}
            unit="min"
            sparklineData={queueWaitHistory}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatCard
            label="DCFC Utilization"
            value={dcfcUtilization}
            variant="bar-gauge"
            barValue={dcfcUtilization}
            barColor="#C00000"
          />
          <StatCard
            label="L2 Utilization"
            value={l2Utilization}
            variant="bar-gauge"
            barValue={l2Utilization}
            barColor="#00B4A6"
          />
        </div>

        <StatCard
          label="Revenue / Bay / Hour"
          value={`$${revenuePerBayPerHour.toFixed(2)}`}
        />

        <EnergyChart />

        {/* Tier 2 — Detailed Metrics */}
        <Accordion type="single" collapsible>
          <AccordionItem value="detailed" className="border-white/10">
            <AccordionTrigger className="text-xs text-otto-gray hover:no-underline py-2">
              Detailed Metrics
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Charger Mix" value={chargerRec} className="col-span-2 text-xs" />
                <StatCard label="Max Vehicles @ SLA" value={maxVehiclesAtSLA} />
                <StatCard
                  label="Bay Idle — DCFC"
                  value={bayIdleTime.dcfc}
                  unit="%"
                />
                <StatCard
                  label="Bay Idle — L2"
                  value={bayIdleTime.l2}
                  unit="%"
                />
                <StatCard
                  label="Bay Idle — Wash"
                  value={bayIdleTime.wash}
                  unit="%"
                />
                <StatCard
                  label="Cost / Vehicle"
                  value={costPerVehicle > 0 ? `$${costPerVehicle.toFixed(0)}` : '—'}
                />
                <StatCard
                  label="Vehicles Processed"
                  value={vehiclesProcessed}
                />
                <StatCard
                  label="BESS SoC"
                  value={bessSOC}
                  variant="circular-progress"
                />
                <StatCard
                  label="Solar Self-Consumption"
                  value={solarSelfConsumption}
                  unit="%"
                />
                <StatCard
                  label="OTTO-Q Accuracy"
                  value={ottoQAccuracy}
                  unit="%"
                />
                <StatCard
                  label="Service Completion"
                  value={serviceCompletionRate}
                  unit="%"
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Tier 3 — Financial Projections */}
        <Accordion type="single" collapsible>
          <AccordionItem value="financial" className="border-white/10">
            <AccordionTrigger className="text-xs text-otto-gray hover:no-underline py-2">
              Financial Projections
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  label="Monthly EBITDA"
                  value={`$${(monthlyEBITDA / 1000).toFixed(0)}k`}
                />
                <StatCard
                  label="Payback Period"
                  value={paybackYears < 50 ? `${paybackYears.toFixed(1)} yr` : '—'}
                />
                <StatCard
                  label="Revenue / Member"
                  value={`$${revenuePerMember.toFixed(0)}`}
                  unit="/mo"
                />
                <StatCard
                  label="Energy Cost"
                  value={`$${energyCostPerKwh.toFixed(3)}`}
                  unit="/kWh"
                />
                <StatCard
                  label="Maintenance Score"
                  value={maintenanceScore}
                  variant="circular-progress"
                />
                <StatCard
                  label="Carbon Offset"
                  value={carbonOffsetKg > 1000 ? `${(carbonOffsetKg / 1000).toFixed(1)}t` : `${carbonOffsetKg.toFixed(0)}kg`}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </ScrollArea>
  );
};
