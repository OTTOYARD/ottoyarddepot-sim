import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const zones = [
  { label: 'DCFC', color: '#C00000' },
  { label: 'L2', color: '#00B4A6' },
  { label: 'Wash', color: '#2196F3' },
  { label: 'Staging', color: '#F59E0B' },
];

const statuses = [
  { label: 'Available', color: '#ffffff26', border: '#ffffff' },
  { label: 'Occupied', color: '#ffffff80', border: '#ffffff' },
  { label: 'Charging', color: '#00B4A6CC', border: '#00B4A6' },
  { label: 'Servicing', color: '#2196F399', border: '#2196F3' },
  { label: 'Offline', color: '#C0000066', border: '#C00000' },
  { label: 'Reserved', color: 'transparent', border: '#F59E0B' },
];

// OEM dot colors — must match OEM_COLORS in VehicleDot.tsx / Vehicle3D.tsx
const oems = [
  { label: 'Waymo', color: '#5B9BFF' },
  { label: 'Tesla', color: '#FF453A' },
  { label: 'Zoox', color: '#B06BFF' },
];

export const DepotLegend = () => {
  const [expanded, setExpanded] = useState(false); // collapsed by default — expand on demand

  return (
    <div className="absolute bottom-14 left-2 z-40 flex items-end gap-0">
      {/* Toggle button — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-center w-5 h-10 bg-otto-charcoal/90 border border-otto-gray/20 rounded-r-md backdrop-blur-sm hover:bg-otto-charcoal transition-colors"
        style={{ marginLeft: expanded ? 0 : 0 }}
        title={expanded ? 'Collapse legend' : 'Expand legend'}
      >
        {expanded ? (
          <ChevronLeft className="w-3 h-3 text-otto-white/70" />
        ) : (
          <ChevronRight className="w-3 h-3 text-otto-white/70" />
        )}
      </button>

      {/* Legend panel */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          expanded ? 'max-w-[250px] opacity-100' : 'max-w-0 opacity-0'
        }`}
      >
        <div className="bg-otto-charcoal/90 border border-otto-gray/20 rounded-md px-3 py-2 text-[10px] backdrop-blur-sm whitespace-nowrap">
          <div className="text-otto-white font-bold mb-1.5 text-[11px]">Legend</div>
          <div className="flex gap-4">
            <div className="space-y-1">
              <div className="text-white font-semibold mb-0.5">Zones</div>
              {zones.map((z) => (
                <div key={z.label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: z.color, opacity: 0.6 }} />
                  <span className="text-otto-white/70">{z.label}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <div className="text-white font-semibold mb-0.5">Status</div>
              {statuses.map((s) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: s.color, border: `1px solid ${s.border}`, opacity: 0.8 }}
                  />
                  <span className="text-otto-white/70">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <div className="text-white font-semibold mb-0.5">OEM</div>
              {oems.map((o) => (
                <div key={o.label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: o.color }} />
                  <span className="text-otto-white/70">{o.label}</span>
                </div>
              ))}
            </div>
          </div>
          {/* the mark Stall.tsx draws on a charger the twin reports Faulted (ChargingField: a red beacon and an X) */}
          <div className="mt-1.5 flex items-center gap-1.5 border-t border-otto-gray/20 pt-1.5">
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-[#C00000] px-1 text-[8px] font-bold leading-[12px] text-white">
              <svg viewBox="0 0 10 9" width="8" height="7" aria-hidden><path d="M5 0.4 L9.6 8.6 L0.4 8.6 Z" fill="#fff" /><rect x="4.45" y="3" width="1.1" height="3" fill="#C00000" /><rect x="4.45" y="6.8" width="1.1" height="1" fill="#C00000" /></svg>
              FAULT
            </span>
            <span className="text-otto-white/70">Charger down. OTTO-Q sends no car to it.</span>
          </div>
          {/* the mark VehicleDot (outline) and OwnerMarkers (3D badge) draw on a car its owner's agent set something on */}
          <div className="mt-1.5 flex items-center gap-1.5 border-t border-otto-gray/20 pt-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ border: '1.5px solid #a78bfa', backgroundColor: '#8b5cf633' }} />
            <span className="text-otto-white/70">Set by its owner's agent. Tap the car.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
