import { create } from 'zustand';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  timestamp: number; // simTime
  severity: AlertSeverity;
  title: string;
  message: string;
  acknowledged: boolean;
}

interface AlertState {
  alerts: Alert[];
  addAlert: (alert: Omit<Alert, 'id' | 'acknowledged'>) => void;
  acknowledgeAlert: (id: string) => void;
  clearAlerts: () => void;
  reset: () => void;
}

let _alertId = 0;

export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: [],

  addAlert: (alert) => {
    const existing = get().alerts;
    // Dedup: same title within 60 sim-seconds
    const isDup = existing.some(
      (a) => a.title === alert.title && Math.abs(a.timestamp - alert.timestamp) < 60
    );
    if (isDup) return;

    const id = `alert-${++_alertId}`;
    set((s) => ({
      alerts: [{ ...alert, id, acknowledged: false }, ...s.alerts].slice(0, 200),
    }));
  },

  acknowledgeAlert: (id) =>
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)),
    })),

  clearAlerts: () => set({ alerts: [] }),

  reset: () => {
    _alertId = 0;
    set({ alerts: [] });
  },
}));
