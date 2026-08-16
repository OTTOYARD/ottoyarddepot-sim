// ============================================================================
// TwinRecallTab — send a vehicle home, and set the reserve that sends it home
// by itself.
//
// Two controls, one story. The button is the manual override; the slider is the
// per-vehicle policy that makes the override unnecessary. Both go through the
// same seam a real fleet API would use — this panel writes no vehicle state of
// its own, it only asks OTTO-Q, and OTTO-Q decides.
//
// The number under the slider is the one that matters. The return ladder does
// not fire at the reserve, it fires at reserve + reserve_margin_pct, so a
// reserve of 80 brings the vehicle home at 95. The backend reports that figure
// rather than letting the panel guess it.
//
// Data contract: migration
// 20260815234500_a_cockpit_can_recall_a_vehicle_and_set_its_reserve.sql
//   ottoq_hw_vehicle_status(uuid)             -> live status
//   ottoq_hw_recall_vehicle(uuid, text, text) -> queue a begin_charge command
//   ottoq_hw_set_return_threshold(uuid, int)  -> set vehicles.min_soc_threshold
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Home, Loader2, RadioTower, TriangleAlert } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/** The eufy RoboVac 30C registered by the hardware seam migration. */
const HARDWARE_VEHICLE_ID = 'e0000000-0000-4000-8000-00000000c30c';
const POLL_MS = 5000;

interface VehicleOption {
  id: string;
  display_name: string | null;
  is_hardware: boolean;
}

interface Status {
  ok: boolean;
  display_name?: string;
  make?: string;
  model?: string;
  is_hardware?: boolean;
  current_soc?: number | null;
  current_state?: string;
  target_soc?: number;
  threshold_pct?: number;
  effective_reserve_pct?: number;
  reserve_margin_pct?: number;
  effective_recall_pct?: number;
  live_run_armed?: boolean;
  pending_commands?: number;
  dispatch_status?: string | null;
  return_trigger?: string | null;
  last_packet_age_s?: number | null;
  last_packet_source?: string | null;
  bridge_live?: boolean;
  error?: string;
}

/** States in which a recall is meaningless — it is already home or on its way. */
const HOME_STATES = new Set([
  'en_route_to_depot',
  'charging_l2',
  'charging_dcfc',
  'charge_complete_holding',
  'arrived_at_gate',
]);

const STATE_LABEL: Record<string, string> = {
  deployed: 'Deployed',
  en_route_to_depot: 'Returning',
  charging_l2: 'Charging',
  charging_dcfc: 'Charging (fast)',
  charge_complete_holding: 'Charged · holding',
  staged_for_departure: 'Ready',
  staged_awaiting_service: 'Awaiting service',
  arrived_at_gate: 'At gate',
  offline: 'Offline',
};

const Row = ({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) => (
  <div className="flex items-baseline justify-between py-1.5 border-b border-white/[0.04] last:border-0">
    <span className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</span>
    <span
      className="text-xs font-display tabular-nums"
      style={{ color: tone === 'good' ? '#00B4A6' : tone === 'bad' ? '#C8102E' : tone === 'warn' ? '#F59E0B' : '#E7EAF0' }}
    >
      {value}
    </span>
  </div>
);

export const TwinRecallTab = () => {
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [vehicleId, setVehicleId] = useState<string>(HARDWARE_VEHICLE_ID);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalling, setRecalling] = useState(false);
  const [savingThreshold, setSavingThreshold] = useState(false);

  // Local slider position, so dragging stays smooth while polling continues.
  const [sliderPct, setSliderPct] = useState<number | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // vehicles is not in the generated types (they cover simulation_runs only),
      // so the table name is cast — the same workaround the other twin tabs use.
      const { data } = await (supabase.from as any)('vehicles')
        .select('id, display_name, config')
        .eq('is_active', true)
        .order('display_name');
      if (!alive || !data) return;
      const opts: VehicleOption[] = (data as Record<string, unknown>[]).map((v) => ({
        id: String(v.id),
        display_name: (v.display_name as string | null) ?? null,
        is_hardware: Boolean((v.config as Record<string, unknown> | null)?.hardware),
      }));
      // Real machines first — this panel exists for them.
      opts.sort((a, b) => Number(b.is_hardware) - Number(a.is_hardware));
      setVehicles(opts);
      if (!opts.some((o) => o.id === vehicleId) && opts.length) setVehicleId(opts[0].id);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('ottoq_hw_vehicle_status' as never, {
      p_vehicle_id: vehicleId,
    } as never);
    if (error) {
      setStatus({ ok: false, error: error.message });
      setLoading(false);
      return;
    }
    const s = data as unknown as Status;
    setStatus(s);
    if (!dirty.current && typeof s.threshold_pct === 'number') setSliderPct(s.threshold_pct);
    setLoading(false);
  }, [vehicleId]);

  useEffect(() => {
    setLoading(true);
    dirty.current = false;
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const onRecall = async () => {
    setRecalling(true);
    try {
      const { data, error } = await supabase.rpc('ottoq_hw_recall_vehicle' as never, {
        p_vehicle_id: vehicleId,
        p_reason: 'operator pressed recall in the cockpit',
        p_actor: 'twin_cockpit',
      } as never);
      if (error) throw new Error(error.message);
      const res = data as unknown as { ok: boolean; error?: string; note?: string };
      if (!res.ok) {
        toast.error('Recall not sent', { description: humanError(res.error) });
      } else if (res.note?.includes('no live run')) {
        toast.warning('Recall queued, but nothing is listening', {
          description: 'No live run is armed for this depot, so no bridge will pick it up.',
        });
      } else {
        toast.success('Recall sent', { description: 'The vehicle will turn for its charging point.' });
      }
      await refresh();
    } catch (e) {
      toast.error('Recall failed', { description: e instanceof Error ? e.message : 'unknown error' });
    } finally {
      setRecalling(false);
    }
  };

  const onApplyThreshold = async () => {
    if (sliderPct === null) return;
    setSavingThreshold(true);
    try {
      const { data, error } = await supabase.rpc('ottoq_hw_set_return_threshold' as never, {
        p_vehicle_id: vehicleId,
        p_threshold: sliderPct,
        p_actor: 'twin_cockpit',
      } as never);
      if (error) throw new Error(error.message);
      const res = data as unknown as { ok: boolean; error?: string; effective_recall_pct?: number };
      if (!res.ok) {
        toast.error('Reserve not changed', { description: res.error });
      } else {
        toast.success(`Reserve set to ${sliderPct}%`, {
          description: `This vehicle now turns for a charger at ${res.effective_recall_pct}%.`,
        });
        dirty.current = false;
      }
      await refresh();
    } catch (e) {
      toast.error('Could not set reserve', { description: e instanceof Error ? e.message : 'unknown error' });
    } finally {
      setSavingThreshold(false);
    }
  };

  const margin = status?.reserve_margin_pct ?? 15;
  const projectedRecall = sliderPct === null ? null : sliderPct + margin;
  const thresholdChanged = sliderPct !== null && sliderPct !== status?.threshold_pct;
  const canRecall =
    !!status?.ok && !recalling && !HOME_STATES.has(status?.current_state ?? '') && (status?.pending_commands ?? 0) === 0;

  const linkTone = useMemo(() => {
    if (!status?.ok) return { label: 'unknown', color: '#4A4E57' };
    if (status.bridge_live) return { label: 'bridge live', color: '#00B4A6' };
    if (status.last_packet_age_s == null) return { label: 'no telemetry', color: '#C8102E' };
    return { label: `last packet ${status.last_packet_age_s}s ago`, color: '#F59E0B' };
  }, [status]);

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-4">
        {/* ── who ── */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1.5">Vehicle</div>
          <Select value={vehicleId} onValueChange={setVehicleId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a vehicle" />
            </SelectTrigger>
            <SelectContent>
              {vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id} className="text-xs">
                  {v.is_hardware ? '● ' : ''}
                  {v.display_name ?? v.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading && !status ? (
          <div className="flex items-center gap-2 text-xs text-ink-dim py-8 justify-center">
            <Loader2 size={14} className="animate-spin" /> reading vehicle…
          </div>
        ) : status?.ok === false ? (
          <div className="text-xs text-brand-red py-4">{status.error}</div>
        ) : (
          <>
            {/* ── state of charge ── */}
            <div className="rounded-md border border-white/[0.06] bg-canvas-panel p-3">
              <div className="flex items-end justify-between mb-2">
                <div>
                  <div className="text-3xl font-display tabular-nums text-ink leading-none">
                    {status?.current_soc ?? '—'}
                    <span className="text-base text-ink-dim">%</span>
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-faint mt-1">state of charge</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-display text-ink">
                    {STATE_LABEL[status?.current_state ?? ''] ?? status?.current_state ?? '—'}
                  </div>
                  <div className="flex items-center gap-1.5 justify-end mt-1">
                    <RadioTower size={10} style={{ color: linkTone.color }} />
                    <span className="text-[10px]" style={{ color: linkTone.color }}>
                      {linkTone.label}
                    </span>
                  </div>
                </div>
              </div>

              <Row
                label="turns for a charger at"
                value={`${status?.effective_recall_pct ?? '—'}%`}
                tone="warn"
              />
              <Row label="reserve (this vehicle)" value={`${status?.threshold_pct ?? '—'}%`} />
              <Row label="charge target" value={`${status?.target_soc ?? '—'}%`} />
              {status?.dispatch_status && (
                <Row label="deployment" value={status.dispatch_status} tone="good" />
              )}
              {status?.return_trigger && <Row label="return trigger" value={status.return_trigger} tone="warn" />}
            </div>

            {/* ── the thing that makes it real ── */}
            {status?.live_run_armed === false && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2.5 flex gap-2">
                <TriangleAlert size={13} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="text-[11px] text-ink-dim leading-relaxed">
                  No live run is armed for this depot. OTTO-Q will not evaluate returns and nothing will
                  execute a recall. Arm one with <code className="text-ink">arm_robovac_run.sql</code>.
                </div>
              </div>
            )}

            {/* ── manual override ── */}
            <div>
              <Button
                onClick={onRecall}
                disabled={!canRecall}
                className="w-full h-10 bg-brand-red hover:bg-brand-hot text-white font-display uppercase tracking-[0.06em] text-xs disabled:opacity-40"
              >
                {recalling ? <Loader2 size={14} className="animate-spin mr-2" /> : <Home size={14} className="mr-2" />}
                Recall to charging point
              </Button>
              <div className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
                {HOME_STATES.has(status?.current_state ?? '')
                  ? 'Already home or on its way — nothing to recall.'
                  : (status?.pending_commands ?? 0) > 0
                    ? `${status?.pending_commands} command already queued and unexecuted.`
                    : 'Queues a begin_charge command. The vehicle picks it up on its next poll — under 15 seconds.'}
              </div>
            </div>

            {/* ── the policy that makes the override unnecessary ── */}
            <div className="rounded-md border border-white/[0.06] bg-canvas-panel p-3">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wide text-ink-faint">Return reserve</span>
                <span className="text-xs font-display tabular-nums text-ink">{sliderPct ?? '—'}%</span>
              </div>

              <Slider
                value={[sliderPct ?? 20]}
                min={5}
                max={95}
                step={1}
                onValueChange={(v) => {
                  dirty.current = true;
                  setSliderPct(v[0]);
                }}
                className="my-3"
              />

              <div className="text-[11px] text-ink-dim leading-relaxed">
                Turns for a charger at{' '}
                <span className="text-ink font-display tabular-nums">{projectedRecall ?? '—'}%</span>
                <span className="text-ink-faint"> — the reserve plus a {margin}% margin to get home on.</span>
              </div>

              <Button
                onClick={onApplyThreshold}
                disabled={!thresholdChanged || savingThreshold}
                variant="outline"
                className="w-full h-8 mt-3 text-xs disabled:opacity-40"
              >
                {savingThreshold && <Loader2 size={12} className="animate-spin mr-2" />}
                {thresholdChanged ? `Apply ${sliderPct}%` : 'Applied'}
              </Button>
            </div>

            <div className="text-[10px] text-ink-faint leading-relaxed">
              The reserve is per vehicle. A fleet operator's SLA can only pull a vehicle home{' '}
              <span className="text-ink-dim">earlier</span> than its owner asked, never later — OTTO-Q takes
              whichever reserve is higher. Neither control moves the vehicle directly: both write to the seam,
              and OTTO-Q decides.
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );
};

function humanError(code?: string): string {
  switch (code) {
    case 'already_returning_or_home':
      return 'This vehicle is already at its depot or on the way.';
    case 'recall_already_pending':
      return 'A recall is already queued and has not been executed yet.';
    case 'vehicle_inactive':
      return 'This vehicle is not active.';
    case 'vehicle_not_found':
      return 'That vehicle no longer exists.';
    default:
      return code ?? 'unknown error';
  }
}
