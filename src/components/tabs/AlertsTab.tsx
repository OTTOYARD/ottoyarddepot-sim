import { useState } from 'react';
import { AlertTriangle, AlertCircle, Info, Check } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAlertStore, type AlertSeverity } from '@/store/alertStore';

const SEVERITY_META: Record<AlertSeverity, { icon: React.ElementType; color: string; border: string; badge: string }> = {
  critical: { icon: AlertTriangle, color: 'text-otto-red', border: 'border-l-otto-red', badge: 'bg-otto-red text-white' },
  warning: { icon: AlertCircle, color: 'text-otto-amber', border: 'border-l-otto-amber', badge: 'bg-otto-amber text-otto-dark' },
  info: { icon: Info, color: 'text-otto-teal', border: 'border-l-otto-teal', badge: 'bg-otto-teal text-white' },
};

function formatSimTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const AlertsTab = () => {
  const { alerts, acknowledgeAlert } = useAlertStore();
  const [filters, setFilters] = useState<Record<AlertSeverity, boolean>>({
    critical: true,
    warning: true,
    info: true,
  });

  const counts = {
    critical: alerts.filter((a) => a.severity === 'critical').length,
    warning: alerts.filter((a) => a.severity === 'warning').length,
    info: alerts.filter((a) => a.severity === 'info').length,
  };

  const toggleFilter = (sev: AlertSeverity) =>
    setFilters((f) => ({ ...f, [sev]: !f[sev] }));

  const filtered = alerts.filter((a) => filters[a.severity]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Summary bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        {(['critical', 'warning', 'info'] as AlertSeverity[]).map((sev) => {
          const meta = SEVERITY_META[sev];
          return (
            <button
              key={sev}
              onClick={() => toggleFilter(sev)}
              className={`transition-opacity ${filters[sev] ? 'opacity-100' : 'opacity-40'}`}
            >
              <Badge className={`${meta.badge} text-[10px] px-2 py-0.5 cursor-pointer`}>
                {counts[sev]} {sev.charAt(0).toUpperCase() + sev.slice(1)}
              </Badge>
            </button>
          );
        })}
      </div>

      {/* Alert list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {filtered.length === 0 && (
            <div className="flex items-center justify-center py-12 text-otto-gray text-xs">
              No alerts — system operating normally
            </div>
          )}
          {filtered.map((alert) => {
            const meta = SEVERITY_META[alert.severity];
            const Icon = meta.icon;
            return (
              <div
                key={alert.id}
                className={`border-l-[3px] ${meta.border} bg-otto-charcoal/60 rounded-r-md p-2 transition-opacity ${
                  alert.acknowledged ? 'opacity-50' : ''
                } ${
                  !alert.acknowledged && alert.severity === 'critical' ? 'animate-pulse' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  <Icon size={14} className={`${meta.color} shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-xs font-bold">{alert.title}</span>
                      <span className="text-otto-gray text-[10px] tabular-nums">
                        {formatSimTime(alert.timestamp)}
                      </span>
                    </div>
                    <p className="text-otto-gray text-[11px] mt-0.5 leading-tight">{alert.message}</p>
                  </div>
                  {!alert.acknowledged && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-otto-gray hover:text-white shrink-0"
                      onClick={() => acknowledgeAlert(alert.id)}
                    >
                      <Check size={12} />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};
