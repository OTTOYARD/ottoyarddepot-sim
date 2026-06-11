import { forwardRef } from 'react';
import { useDepotStore } from '@/store/depotStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useSimulationStore } from '@/store/simulationStore';
import { Stall } from './Stall';
import { VehicleDot } from './VehicleDot';
import { ZoneBadges } from './ZoneBadges';
import {
  LOT, BESS_YARD, BUILDING, WASH, CANOPIES, PARK_RUNS, GATE_W,
  INGRESS, EGRESS,
  WEST_AISLE_X, EAST_AISLE_X, TEMP_LANE_X, WEST_LINK_X, GAP_LANES,
} from '@/lib/sitePlan';

/**
 * 2D operations board. Every zone graphic derives from the shared site plan —
 * the same coordinates the engine routes on and the 3D scene renders, so the
 * 2D and 3D views can never drift apart.
 */
export const DepotSVG = forwardRef<SVGSVGElement>((_, ref) => {
  const stalls = useDepotStore((s) => s.stalls);
  const selectStall = useDepotStore((s) => s.selectStall);
  const vehicles = useVehicleStore((s) => s.vehicles);
  const status = useSimulationStore((s) => s.status);

  const isRunning = status === 'running';

  return (
    <svg
      ref={ref}
      viewBox="0 0 300 220"
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
      onClick={() => selectStall(null)}
    >
      <defs>
        <linearGradient id="borderGlow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00B4A6" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#00B4A6" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#00B4A6" stopOpacity="0.6" />
        </linearGradient>
      </defs>

      <rect width="300" height="220" fill="#14141f" />

      {/* grid */}
      {Array.from({ length: 31 }, (_, i) => (
        <line key={`gv${i}`} x1={i * 10} y1={0} x2={i * 10} y2={220} stroke="#ffffff" strokeWidth={0.2} opacity={0.04} />
      ))}
      {Array.from({ length: 23 }, (_, i) => (
        <line key={`gh${i}`} x1={0} y1={i * 10} x2={300} y2={i * 10} stroke="#ffffff" strokeWidth={0.2} opacity={0.04} />
      ))}

      {isRunning && (
        <rect x={2} y={2} width={296} height={216} rx={2} fill="none" stroke="url(#borderGlow)" strokeWidth={1.5}
          className="animate-[border-glow_3s_ease-in-out_infinite]" />
      )}

      {/* ---- lot + fence ---- */}
      <rect x={LOT.x} y={LOT.y} width={LOT.w} height={LOT.h} fill="#1c1c28" stroke="#3a3f4d" strokeWidth={0.8} />

      {/* public road */}
      <rect x={0} y={210} width={300} height={10} fill="#2a2a32" />
      <line x1={0} y1={215} x2={300} y2={215} stroke="#F59E0B" strokeWidth={0.3} strokeDasharray="6,4" />

      {/* ---- circulation (tinted lanes from the plan) ---- */}
      {/* rear apron */}
      <rect x={64} y={LOT.y} width={LOT.x + LOT.w - 64 - 6} height={20} fill="#23232f" />
      {/* forecourt (concrete) */}
      <rect x={64} y={56} width={156} height={12} fill="#3a3d42" opacity={0.8} />
      {/* north + south collectors */}
      <rect x={LOT.x} y={68} width={LOT.w} height={12} fill="#262635" />
      <rect x={LOT.x} y={166} width={LOT.w} height={12} fill="#262635" />
      {/* west/east aisles */}
      <rect x={WEST_AISLE_X - 6} y={56} width={12} height={150} fill="#262635" />
      <rect x={EAST_AISLE_X - 6} y={26} width={12} height={180} fill="#262635" />
      {/* canopy pull-out lanes */}
      {[GAP_LANES.westOfA, GAP_LANES.AB, GAP_LANES.BC, GAP_LANES.eastOfC].map((x) => (
        <rect key={`gl${x}`} x={x - 4.5} y={80} width={9} height={84} fill="#262635" opacity={0.8} />
      ))}
      {/* temp block aisle + west link */}
      <rect x={TEMP_LANE_X - 5} y={80} width={10} height={84} fill="#262635" opacity={0.8} />
      <rect x={WEST_LINK_X - 4} y={16} width={8} height={52} fill="#262635" opacity={0.8} />

      {/* one-way arrows on the aisles */}
      {[100, 130, 160].map((y) => (
        <polygon key={`wa${y}`} points={`${WEST_AISLE_X},${y} ${WEST_AISLE_X - 2},${y + 4} ${WEST_AISLE_X + 2},${y + 4}`} fill="#ffffff" opacity={0.18} />
      ))}
      {[60, 100, 140].map((y) => (
        <polygon key={`ea${y}`} points={`${EAST_AISLE_X},${y + 4} ${EAST_AISLE_X - 2},${y} ${EAST_AISLE_X + 2},${y}`} fill="#ffffff" opacity={0.18} />
      ))}

      {/* ---- structures ---- */}
      {/* BESS yard */}
      <rect x={BESS_YARD.x} y={BESS_YARD.y} width={BESS_YARD.w} height={BESS_YARD.h} fill="#23262e" stroke="#9E9E9E" strokeWidth={0.4} strokeDasharray="2,1.5" rx={1} />
      {[0, 1, 2].map((i) => (
        <rect key={`bc${i}`} x={BESS_YARD.x + 5 + i * 15} y={BESS_YARD.y + 8} width={11} height={20} fill="#30343e" stroke="#9E9E9E" strokeWidth={0.3} rx={0.5} />
      ))}
      <text x={BESS_YARD.x + BESS_YARD.w / 2} y={BESS_YARD.y + 5.5} textAnchor="middle" fontSize={3.2} fill="#9E9E9E" fontWeight="bold">BESS · SWGR</text>

      {/* office + service bays */}
      <rect x={BUILDING.x} y={BUILDING.y} width={BUILDING.w} height={BUILDING.h} fill="#33343c" stroke="#ffffff" strokeWidth={0.4} rx={1} />
      <rect x={BUILDING.x} y={BUILDING.y} width={40} height={BUILDING.h} fill="#3a3b45" opacity={0.7} />
      <text x={BUILDING.x + 20} y={BUILDING.y + 13} textAnchor="middle" fontSize={3} fill="#ffffff" opacity={0.65}>OPERATIONS</text>
      <text x={BUILDING.x + 20} y={BUILDING.y + 18} textAnchor="middle" fontSize={2.2} fill="#87CEEB" opacity={0.6}>CONTROL ROOM</text>
      {[120, 138].map((x, i) => (
        <g key={`svc${i}`}>
          <rect x={x - 8} y={BUILDING.y + 2} width={16} height={BUILDING.h - 4} fill="none" stroke="#ffffff" strokeWidth={0.3} opacity={0.5} strokeDasharray="1.5,1" />
          <text x={x} y={BUILDING.y + BUILDING.h / 2 + 1} textAnchor="middle" fontSize={2.6} fill="#ffffff" opacity={0.6}>{`SVC ${i + 1}`}</text>
        </g>
      ))}

      {/* wash bays */}
      <rect x={WASH.x} y={WASH.y} width={WASH.w} height={WASH.h} fill="#2e3340" stroke="#2196F3" strokeWidth={0.4} rx={1} />
      {[168, 186, 204].map((x, i) => (
        <g key={`wb${i}`}>
          <rect x={x - 8} y={WASH.y + 2} width={16} height={WASH.h - 4} fill="none" stroke="#2196F3" strokeWidth={0.3} opacity={0.55} strokeDasharray="1.5,1" />
          <text x={x} y={WASH.y + WASH.h / 2 + 1} textAnchor="middle" fontSize={2.6} fill="#2196F3" opacity={0.7}>{`W${i + 1}`}</text>
        </g>
      ))}
      {/* pull-through arrows out the bay rears */}
      {[120, 138, 168, 186, 204].map((x) => (
        <polygon key={`pt${x}`} points={`${x},${BUILDING.y - 2.5} ${x - 1.6},${BUILDING.y + 0.5} ${x + 1.6},${BUILDING.y + 0.5}`} fill="#ffffff" opacity={0.35} />
      ))}

      {/* ---- canopies ---- */}
      {CANOPIES.map((c) => (
        <g key={c.id}>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} fill={c.kind === 'dcfc' ? '#C0000014' : '#00B4A614'}
            stroke={c.kind === 'dcfc' ? '#C00000' : '#00B4A6'} strokeWidth={0.4} strokeDasharray="3,2" opacity={0.9} rx={1} />
          <line x1={c.cx} y1={c.y + 2} x2={c.cx} y2={c.y + c.h - 2} stroke="#ffffff" strokeWidth={0.3} opacity={0.15} />
        </g>
      ))}
      <text x={CANOPIES[0].cx} y={CANOPIES[0].y - 2} textAnchor="middle" fontSize={3.6} fill="#C00000" fontWeight="bold" opacity={0.75}>DCFC</text>
      <text x={(CANOPIES[1].cx + CANOPIES[2].cx) / 2} y={CANOPIES[1].y - 2} textAnchor="middle" fontSize={3.6} fill="#00B4A6" fontWeight="bold" opacity={0.75}>L2 CHARGING</text>

      {/* ---- carports over perimeter parking ---- */}
      {PARK_RUNS.filter((r) => r.carport).map((r) => (
        <rect key={`cp${r.id}`} x={r.carport!.x} y={r.carport!.y} width={r.carport!.w} height={r.carport!.h}
          fill="#1f2a3d" stroke="#3d4f6b" strokeWidth={0.3} opacity={0.65} rx={0.8} />
      ))}
      {/* temp block label */}
      <text x={TEMP_LANE_X} y={77} textAnchor="middle" fontSize={2.8} fill="#F59E0B" opacity={0.7} fontWeight="bold">TEMP / OVERFLOW</text>

      {/* ---- gates ---- */}
      <rect x={INGRESS.x - GATE_W / 2} y={206} width={GATE_W} height={4} fill="#00B4A6" opacity={0.35} rx={1} />
      <text x={INGRESS.x} y={204.5} textAnchor="middle" fontSize={3.5} fill="#00B4A6" fontWeight="bold">INGRESS</text>
      <polygon points={`${INGRESS.x},${206.5} ${INGRESS.x - 2},${209} ${INGRESS.x + 2},${209}`} fill="#00B4A6" />
      <rect x={EGRESS.x - GATE_W / 2} y={206} width={GATE_W} height={4} fill="#C00000" opacity={0.35} rx={1} />
      <text x={EGRESS.x} y={204.5} textAnchor="middle" fontSize={3.5} fill="#C00000" fontWeight="bold">EGRESS</text>
      <polygon points={`${EGRESS.x},${209} ${EGRESS.x - 2},${206.5} ${EGRESS.x + 2},${206.5}`} fill="#C00000" />

      {/* ---- live layers (store-driven) ---- */}
      {stalls.map((stall) => (
        <Stall key={stall.id} stall={stall} />
      ))}
      {vehicles.map((v) => (
        <VehicleDot key={v.id} vehicle={v} />
      ))}
      <ZoneBadges />

      {/* watermark */}
      <g opacity={0.04} transform="translate(130, 105)">
        <svg viewBox="0 0 100 100" width="40" height="40">
          <path d="M50 5 L93 27.5 L93 72.5 L50 95 L7 72.5 L7 27.5 Z" fill="#C00000" />
          <path d="M50 20 L78 35 L78 65 L50 80 L22 65 L22 35 Z" fill="none" stroke="white" strokeWidth="3" />
        </svg>
      </g>
    </svg>
  );
});

DepotSVG.displayName = 'DepotSVG';
