// ============================================================================
// useAppointments — polls the OTTO-Q appointment/reservation/servicing seam
// (RPC `ottoq_twin_appointments`) every POLL_MS while a run is active, and
// stores the raw result in appointmentStore. Mirrors useTwinFeed's shape:
// tracks whatever run the app is showing via twinStore.activeSimRunId.
// ============================================================================
import { useEffect } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { useTwinStore } from "@/store/twinStore";
import { useAppointmentStore, type AppointmentsData } from "@/store/appointmentStore";

const POLL_MS = 2000;

export function useAppointments() {
  const activeSimRunId = useTwinStore((s) => s.activeSimRunId);
  const setData = useAppointmentStore((s) => s.setData);
  const setLoading = useAppointmentStore((s) => s.setLoading);
  const setError = useAppointmentStore((s) => s.setError);
  const reset = useAppointmentStore((s) => s.reset);

  useEffect(() => {
    if (!activeSimRunId) {
      reset();
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const { data, error } = await ottoQ.rpc("ottoq_twin_appointments", {
          p_sim_run_id: activeSimRunId,
        });
        if (cancelled) return;
        if (error) {
          setError(error.message || "appointments RPC failed");
        } else if (data) {
          setData(data as AppointmentsData);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "appointments fetch failed");
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(poll, POLL_MS);
        }
      }
    };

    setLoading(true);
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeSimRunId, setData, setLoading, setError, reset]);
}
