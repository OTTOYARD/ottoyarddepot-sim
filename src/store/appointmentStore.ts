// ============================================================================
// appointmentStore — the OTTO-Q appointment / reservation / servicing seam,
// fed by the public RPC `ottoq_twin_appointments(p_sim_run_id)`. Polled by
// useAppointments while a run is active; consumed by TwinOrchestrationTab.
// Render ONLY what the RPC returns — no fabricated metrics or history.
// ============================================================================
import { create } from "zustand";

export interface ApptHeadline {
  fleet_total: number;
  charge_stalls: number;
  veh_per_charger: number;
  inbound_count: number;
  booked_before_arrival: number;
  reservations_held: number;
  unsafe_deploys_run: number;
}

export interface ApptPhases {
  deployed?: number;
  inbound?: number;
  charging?: number;
  washing?: number;
  servicing?: number;
  staged_ready?: number;
  at_gate?: number;
  other?: number;
  [k: string]: number | undefined;
}

export interface ApptReservation {
  stall_code: string;
  stall_type: string;
  av_id: string | null;
  veh_state: string | null;
  soc: number | null;
  expires_at: string | null;
  inbound: boolean;
  occupied: boolean;
  stall_id?: string;
}

export interface ApptInbound {
  av_id: string;
  soc: number | null;
  return_trigger: string | null;
  booked_stall_type: string | null;
  secured: boolean;
  eta_min: number | null;
  workflow: string[];
}

export interface ApptOvernight {
  window_active: boolean;
  hour_cst: number;
  recalled_tonight: number;
  holdout_still_out: number;
}

export interface AppointmentsData {
  sim_run_id: string;
  sim_clock: string;
  hour_cst: number;
  headline: ApptHeadline;
  phases: ApptPhases;
  reservations: ApptReservation[];
  inbound: ApptInbound[];
  overnight: ApptOvernight;
}

interface AppointmentState {
  data: AppointmentsData | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  setData: (d: AppointmentsData | null) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const useAppointmentStore = create<AppointmentState>((set) => ({
  data: null,
  loading: false,
  error: null,
  lastUpdatedAt: null,
  setData: (data) => set({ data, lastUpdatedAt: Date.now(), error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set({ data: null, loading: false, error: null, lastUpdatedAt: null }),
}));
