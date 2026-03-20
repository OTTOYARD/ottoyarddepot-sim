import { forwardRef } from 'react';
import { useDepotStore } from '@/store/depotStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useSimulationStore } from '@/store/simulationStore';
import { Stall } from './Stall';
import { VehicleDot } from './VehicleDot';
import { ZoneBadges } from './ZoneBadges';

export const DepotSVG = forwardRef<SVGSVGElement>((_, ref) => {
  const stalls = useDepotStore((s) => s.stalls);
  const selectStall = useDepotStore((s) => s.selectStall);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const status = useSimulationStore((s) => s.status);
  const simTime = useSimulationStore((s) => s.simTime);

  const isRunning = status === 'running';
  const isDaytime = simTime >= 21600 && simTime < 64800; // 6AM-6PM

  return (
    <svg
      ref={ref}
      viewBox="0 0 300 220"
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
      onClick={() => selectStall(null)}
    >
      <defs>
        <pattern id="crosshatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#C0000033" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="#C00000" strokeWidth="1" opacity="0.5" />
        </pattern>
        {/* Animated gradient for border glow */}
        <linearGradient id="borderGlow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00B4A6" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#00B4A6" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#00B4A6" stopOpacity="0.6" />
        </linearGradient>
      </defs>

      <rect width="300" height="220" fill="#1A1A2E" />

      {Array.from({ length: 31 }, (_, i) => (
        <line key={`gv${i}`} x1={i * 10} y1={0} x2={i * 10} y2={220} stroke="#ffffff" strokeWidth={0.2} opacity={0.05} />
      ))}
      {Array.from({ length: 23 }, (_, i) => (
        <line key={`gh${i}`} x1={0} y1={i * 10} x2={300} y2={i * 10} stroke="#ffffff" strokeWidth={0.2} opacity={0.05} />
      ))}

      {/* Animated border glow when running */}
      {isRunning && (
        <rect
          x={2} y={2} width={296} height={216} rx={2}
          fill="none" stroke="url(#borderGlow)" strokeWidth={1.5}
          className="animate-[border-glow_3s_ease-in-out_infinite]"
        />
      )}

      <rect x={0} y={215} width={300} height={5} fill="#444444" />
      <line x1={0} y1={217.5} x2={300} y2={217.5} stroke="#F59E0B" strokeWidth={0.3} strokeDasharray="6,4" />

      <rect x={95} y={210} width={10} height={5} fill="#00B4A6" opacity={0.4} rx={1} />
      <text x={100} y={209} textAnchor="middle" fontSize={3.5} fill="#00B4A6" fontWeight="bold">INGRESS</text>
      <polygon points="100,213 98,211 102,211" fill="#00B4A6" />

      <rect x={195} y={210} width={10} height={5} fill="#C00000" opacity={0.4} rx={1} />
      <text x={200} y={209} textAnchor="middle" fontSize={3.5} fill="#C00000" fontWeight="bold">EGRESS</text>
      <polygon points="200,211 198,213 202,213" fill="#C00000" />

      {/* Solar canopy with shimmer during daytime */}
      <rect
        x={0} y={190} width={300} height={10}
        fill="#2D5A2D" opacity={0.3}
        className={isDaytime ? 'animate-[shimmer_4s_ease-in-out_infinite]' : ''}
      />

      <rect x={20} y={40} width={20} height={160} fill="#333333" opacity={0.5} />
      <rect x={265} y={40} width={20} height={160} fill="#333333" opacity={0.5} />

      {[60, 100, 140, 180].map((y) => (
        <polygon key={`au${y}`} points={`30,${y} 28,${y + 5} 32,${y + 5}`} fill="#ffffff" opacity={0.15} />
      ))}
      {[60, 100, 140, 180].map((y) => (
        <polygon key={`ad${y}`} points={`275,${y + 5} 273,${y} 277,${y}`} fill="#ffffff" opacity={0.15} />
      ))}

      <rect x={40} y={75} width={220} height={80} fill="none" stroke="#00B4A6" strokeWidth={0.4} strokeDasharray="4,2" opacity={0.3} />

      <rect x={60} y={5} width={120} height={35} fill="#3A3A3A" stroke="#ffffff" strokeWidth={0.5} rx={1} />
      <rect x={60} y={5} width={40} height={35} fill="#3A3A3A" stroke="#ffffff" strokeWidth={0.3} opacity={0.5} />
      <line x1={60} y1={22} x2={100} y2={22} stroke="#ffffff" strokeWidth={0.2} opacity={0.3} />
      <text x={80} y={15} textAnchor="middle" fontSize={3} fill="#ffffff" opacity={0.5}>SERVICE</text>
      <text x={80} y={30} textAnchor="middle" fontSize={2.5} fill="#ffffff" opacity={0.4}>2 BAYS</text>
      <text x={140} y={25} textAnchor="middle" fontSize={3} fill="#ffffff" opacity={0.5}>CONTROL ROOM</text>
      <rect x={60} y={5} width={15} height={12} fill="#3A3A3A" stroke="#87CEEB" strokeWidth={0.3} opacity={0.4} />
      <text x={67} y={12} textAnchor="middle" fontSize={2} fill="#87CEEB" opacity={0.5}>LOUNGE</text>

      <rect x={245} y={5} width={20} height={10} fill="#9E9E9E" opacity={0.3} stroke="#9E9E9E" strokeWidth={0.3} rx={0.5} />
      <text x={255} y={12} textAnchor="middle" fontSize={2.5} fill="#9E9E9E">BESS</text>
      <rect x={245} y={17} width={20} height={8} fill="#9E9E9E" opacity={0.3} stroke="#9E9E9E" strokeWidth={0.3} rx={0.5} />
      <text x={255} y={22.5} textAnchor="middle" fontSize={2} fill="#9E9E9E">XFMR</text>
      <rect x={270} y={5} width={18} height={8} fill="#9E9E9E" opacity={0.3} stroke="#9E9E9E" strokeWidth={0.3} rx={0.5} />
      <text x={279} y={10.5} textAnchor="middle" fontSize={2} fill="#9E9E9E">SWGR</text>

      {stalls.map((stall) => (
        <Stall key={stall.id} stall={stall} />
      ))}

      {vehicles.map((v) => (
        <VehicleDot key={v.id} vehicle={v} />
      ))}

      <ZoneBadges />

      {/* Watermark hexagon */}
      <g opacity={0.04} transform="translate(130, 85)">
        <svg viewBox="0 0 100 100" width="40" height="40">
          <path d="M50 5 L93 27.5 L93 72.5 L50 95 L7 72.5 L7 27.5 Z" fill="#C00000" />
          <path d="M50 20 L78 35 L78 65 L50 80 L22 65 L22 35 Z" fill="none" stroke="white" strokeWidth="3" />
        </svg>
      </g>

      <text x={150} y={50} textAnchor="middle" fontSize={5} fill="#C00000" fontWeight="bold" opacity={0.6}>DCFC CHARGING</text>
      <text x={150} y={115} textAnchor="middle" fontSize={5} fill="#00B4A6" fontWeight="bold" opacity={0.6}>L2 CHARGING</text>
      <text x={215} y={28} textAnchor="middle" fontSize={3.5} fill="#2196F3" fontWeight="bold" opacity={0.6}>WASH</text>
      <text x={150} y={167} textAnchor="middle" fontSize={5} fill="#F59E0B" fontWeight="bold" opacity={0.6}>STAGING</text>
      <text x={120} y={2.5} textAnchor="middle" fontSize={3.5} fill="#ffffff" fontWeight="bold" opacity={0.5}>OPERATIONS</text>
    </svg>
  );
});

DepotSVG.displayName = 'DepotSVG';
