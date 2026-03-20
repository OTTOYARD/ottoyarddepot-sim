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

export const DepotLegend = () => (
  <div className="absolute bottom-14 left-2 bg-otto-charcoal/90 border border-otto-gray/20 rounded-md px-3 py-2 text-[10px] z-40 backdrop-blur-sm">
    <div className="text-otto-white font-bold mb-1.5 text-[11px]">Legend</div>
    <div className="flex gap-4">
      <div className="space-y-1">
        <div className="text-otto-gray font-semibold mb-0.5">Zones</div>
        {zones.map((z) => (
          <div key={z.label} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: z.color, opacity: 0.6 }} />
            <span className="text-otto-white/70">{z.label}</span>
          </div>
        ))}
      </div>
      <div className="space-y-1">
        <div className="text-otto-gray font-semibold mb-0.5">Status</div>
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
    </div>
  </div>
);
