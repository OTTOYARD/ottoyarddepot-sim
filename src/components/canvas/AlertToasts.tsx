import { useState, useEffect, useRef } from 'react';
import { X, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useAlertStore, type Alert } from '@/store/alertStore';

const SEVERITY_CONFIG = {
  critical: { bg: 'bg-otto-red', text: 'text-white', icon: AlertTriangle, duration: 8000 },
  warning: { bg: 'bg-otto-amber', text: 'text-otto-dark', icon: AlertCircle, duration: 5000 },
  info: { bg: 'bg-otto-teal', text: 'text-white', icon: Info, duration: 3000 },
} as const;

interface VisibleToast {
  alert: Alert;
  dismissAt: number;
}

export const AlertToasts = () => {
  const alerts = useAlertStore((s) => s.alerts);
  const [visibleToasts, setVisibleToasts] = useState<VisibleToast[]>([]);
  const seenIds = useRef(new Set<string>());

  // Watch for new alerts
  useEffect(() => {
    if (alerts.length === 0) {
      seenIds.current.clear();
      return;
    }
    const newest = alerts[0];
    if (!newest || seenIds.current.has(newest.id)) return;
    seenIds.current.add(newest.id);

    const config = SEVERITY_CONFIG[newest.severity];
    const dismissAt = Date.now() + config.duration;

    setVisibleToasts((prev) => [{ alert: newest, dismissAt }, ...prev].slice(0, 3));
  }, [alerts]);

  // Auto-dismiss timer
  useEffect(() => {
    if (visibleToasts.length === 0) return;
    const earliest = Math.min(...visibleToasts.map((t) => t.dismissAt));
    const delay = Math.max(100, earliest - Date.now());
    const timer = setTimeout(() => {
      const now = Date.now();
      setVisibleToasts((prev) => prev.filter((t) => t.dismissAt > now));
    }, delay);
    return () => clearTimeout(timer);
  }, [visibleToasts]);

  const dismiss = (id: string) => {
    setVisibleToasts((prev) => prev.filter((t) => t.alert.id !== id));
  };

  if (visibleToasts.length === 0) return null;

  return (
    <div className="absolute top-3 right-3 z-30 flex flex-col gap-2 w-72">
      {visibleToasts.map((toast, i) => {
        const cfg = SEVERITY_CONFIG[toast.alert.severity];
        const Icon = cfg.icon;
        return (
          <div
            key={toast.alert.id}
            className={`${cfg.bg} ${cfg.text} rounded-lg p-3 shadow-lg animate-in slide-in-from-right-5 duration-300`}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex items-start gap-2">
              <Icon size={16} className="shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold leading-tight">{toast.alert.title}</p>
                <p className="text-xs opacity-90 mt-0.5 line-clamp-2">{toast.alert.message}</p>
              </div>
              <button onClick={() => dismiss(toast.alert.id)} className="shrink-0 opacity-70 hover:opacity-100">
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
