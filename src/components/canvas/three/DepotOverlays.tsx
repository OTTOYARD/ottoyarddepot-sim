import { forwardRef } from 'react';
import { Html } from '@react-three/drei';
import type { Group } from 'three';
import { useSimulationStore } from '@/store/simulationStore';
import { useKPIStore } from '@/store/kpiStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';

export const DepotOverlays = forwardRef<Group>(function DepotOverlays(_, ref) {
  const fleetUptimePct = useKPIStore((s) => s.fleetUptimePct);
  const avgTurnaroundMin = useKPIStore((s) => s.avgTurnaroundMin);
  const avgQueueWaitMin = useKPIStore((s) => s.avgQueueWaitMin);
  const peakPowerDraw = useKPIStore((s) => s.peakPowerDraw);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const stalls = useDepotStore((s) => s.stalls);
  const status = useSimulationStore((s) => s.status);

  if (status === 'idle') return null;

  const dcO = stalls.filter((s) => s.type === 'dcfc' && s.status !== 'available').length;
  const dcT = stalls.filter((s) => s.type === 'dcfc').length;
  const l2O = stalls.filter((s) => s.type === 'l2' && s.status !== 'available').length;
  const l2T = stalls.filter((s) => s.type === 'l2').length;
  const qc = vehicles.filter((v) => v.status === 'queued').length;

  return (
    <group ref={ref}>
      <Html position={[-118, 34, 92]} center>
        <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 border border-white/10 min-w-[180px]">
          <p className="text-[10px] font-bold text-otto-teal tracking-wider mb-2">Live Depot Status</p>
          <div className="space-y-1.5">
            <Kpi
              l="Fleet Uptime"
              v={`${fleetUptimePct.toFixed(1)}%`}
              c={fleetUptimePct > 95 ? '#00B4A6' : fleetUptimePct > 85 ? '#F59E0B' : '#EF4444'}
            />
            <Kpi l="Avg Turnaround" v={`${avgTurnaroundMin.toFixed(0)}m`} c="#00B4A6" />
            <Kpi
              l="Queue"
              v={`${qc} waiting (${avgQueueWaitMin.toFixed(0)}m avg)`}
              c={qc > 10 ? '#EF4444' : qc > 5 ? '#F59E0B' : '#00B4A6'}
            />
          </div>
          <div className="mt-2 space-y-1">
            <Bar l="DCFC" u={dcO} t={dcT} c="#C00000" />
            <Bar l="L2" u={l2O} t={l2T} c="#00B4A6" />
          </div>
        </div>
      </Html>
      <Html position={[130, 30, -80]} center>
        <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 border border-white/10 min-w-[120px]">
          <p className="text-[10px] font-bold text-otto-teal tracking-wider mb-1">Power</p>
          <div className="text-center">
            <span className="text-lg font-bold text-white">{peakPowerDraw.toFixed(0)}</span>
            <span className="text-[10px] text-otto-gray ml-1">kW</span>
          </div>
        </div>
      </Html>
    </group>
  );
});

function Kpi({ l, v, c }: { l: string; v: string; c: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[9px] text-otto-gray">{l}</span>
      <span className="text-[10px] font-mono font-bold" style={{ color: c }}>
        {v}
      </span>
    </div>
  );
}

function Bar({ l, u, t, c }: { l: string; u: number; t: number; c: string }) {
  const pct = t > 0 ? (u / t) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-[8px] text-otto-gray mb-0.5">
        <span>{l}</span>
        <span>
          {u}/{t}
        </span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: c }} />
      </div>
    </div>
  );
}
