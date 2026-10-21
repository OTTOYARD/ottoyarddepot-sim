// useVehicleQCard — the reads behind the tap-on-a-car Q card. Composed from reads that already exist; no RPC added:
//   the twin snapshot (twinStore)            the car's live state, SoC, visit, legs, arm cycle      as the cockpit polls
//   ottoq_depot_cards (useDepotCards)        its plan steps, needs, bookings, target (contract 1.4)  every 10 s
//   ottoq_activity_feed_v2 (p_vehicle_id)    its own decisions: re-bookings, re-timings, holds       every 8 s
//   the motion driver (cabinArmFor)          what its stall's cleaning arm is doing                  every 0.5 s
//   the motion driver (washBayFor)           what its wash bay's machine is doing                    every 0.5 s
// Both polls run only while a card is open, and pause with the sim (a paused cockpit keeps what it has).
import { useEffect, useMemo, useState } from "react";
import { useTwinStore } from "@/store/twinStore";
import { useVehicleStore } from "@/store/vehicleStore";
import { useDepotCards } from "@/hooks/useDepotCards";
import { readFeed } from "@/hooks/useDecisionTrail";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import { buildQCard, stallCodeMap, type QCard, type QCardInputs, type QDepotCard } from "@/lib/vehicleQCard";
import { twinMotionDriver } from "@/engine/TwinMotionDriver";

const CAR_FEED_MS = 8_000;
/** How often the open card reads the cleaning arm's phase off the motion driver (it changes every few seconds). */
const CABIN_ARM_MS = 500;

type CabinArm = NonNullable<QCardInputs["cabinArm"]>;
const sameArm = (a: CabinArm | null, b: CabinArm | null) =>
  a === b || (!!a && !!b && a.phase === b.phase && a.sideA === b.sideA && a.done === b.done);
type BayWash = NonNullable<QCardInputs["bayWash"]>;
const sameWash = (a: BayWash | null, b: BayWash | null) =>
  a === b || (!!a && !!b && a.phase === b.phase && a.interior === b.interior && a.done === b.done);

export interface VehicleQCardData {
  card: QCard | null;
  /** 'waiting' until the depot cards answer for this run; 'other_run' when they describe another */
  cardsStatus: "waiting" | "ok" | "other_run";
  error: string | null;
}

export function useVehicleQCard(vehicleId: string | null): VehicleQCardData {
  const enabled = !!vehicleId;
  const cards = useDepotCards(enabled);
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const paused = useTwinStore((s) => s.paused);
  const snapshot = useTwinStore((s) => s.snapshot);
  const layout = useTwinStore((s) => s.layout);
  const label = useVehicleStore((s) => (vehicleId ? s.vehicles.find((v) => v.id === vehicleId)?.label ?? null : null));
  const [feed, setFeed] = useState<ActivityFeedRow[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);

  useEffect(() => { setFeed([]); setFeedError(null); }, [vehicleId, simRunId]);

  // the stall's OTTO-CLEAN ARM, read off the motion driver while the card is open; a new value only when it changes
  const [cabinArm, setCabinArm] = useState<CabinArm | null>(null);
  // …and its wash bay's machine, the same way
  const [bayWash, setBayWash] = useState<BayWash | null>(null);
  useEffect(() => {
    if (!vehicleId) { setCabinArm(null); setBayWash(null); return; }
    const read = () => {
      const next = twinMotionDriver.cabinArmFor(vehicleId);
      setCabinArm((prev) => (sameArm(prev, next) ? prev : next));
      const wash = twinMotionDriver.washBayFor(vehicleId);
      const w = wash ? { phase: wash.phase, interior: wash.interior, done: wash.done } : null;
      setBayWash((prev) => (sameWash(prev, w) ? prev : w));
    };
    read();
    const t = setInterval(read, CABIN_ARM_MS);
    return () => clearInterval(t);
  }, [vehicleId]);

  useEffect(() => {
    if (!vehicleId || !simRunId || paused) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const rows = await readFeed({ p_sim_run_id: simRunId, p_vehicle_id: vehicleId, p_limit: 300, p_changes_only: true, p_window_ticks: 1_000_000 });
        if (!cancelled) { setFeed(rows); setFeedError(null); }
      } catch (e) {
        if (!cancelled) setFeedError(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    const t = setInterval(poll, CAR_FEED_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [vehicleId, simRunId, paused]);

  const codes = useMemo(() => stallCodeMap(layout?.stalls), [layout]);
  const depotCard = useMemo(
    () => (vehicleId ? ((cards.vehicles ?? []) as unknown as QDepotCard[]).find((c) => c?.vehicle_id === vehicleId) ?? null : null),
    [cards.vehicles, vehicleId],
  );
  const card = useMemo(
    () => (vehicleId ? buildQCard({ vehicleId, label, card: depotCard, snapshot, stallCodes: codes, feed, cabinArm, bayWash }) : null),
    [vehicleId, label, depotCard, snapshot, codes, feed, cabinArm, bayWash],
  );
  return { card, cardsStatus: cards.status, error: cards.error ?? feedError };
}
