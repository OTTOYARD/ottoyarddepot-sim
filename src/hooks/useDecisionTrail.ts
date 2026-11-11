// useDecisionTrail — the reads behind one car's plain-English decision trail (src/components/tabs/ottoq/CarTrail.tsx).
//
// Composed from reads that already exist; no RPC was added for this:
//   ottoq_depot_cards(depot)                 every car's needs, due time and plan steps       every 10 s
//   ottoq_activity_feed_v2(run, vehicle)     the picked car's decisions                        every 8 s
//   ottoq_decisions (vehicle)                their safety-check results                         every 8 s
//   ottoq_external_proposals (vehicle)       the planners' offers for the car                   every 8 s
//   ottoq_decision_options(run, vehicle)     what each charger choice had to choose from (0590) every 8 s
//
// It used to read the whole run's feed too (up to 5,000 rows, then every 20 s) for the old Intelligence tab's depot
// funnel. Nothing has drawn that funnel since 2026-09-30, and the read went with its source on 2026-11-10. A car's
// trail never used it.
//
// Pause follows the sim, exactly as useActivityFeed: a paused cockpit issues no reads and keeps what it has.
// A depot card goes null once its car leaves, which would take the car's due time with it, so the last card seen for
// each car is kept for this run: "left 12 minutes before due" needs the due time the car had while it was here.
import { useEffect, useRef, useState } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { useTwinStore } from "@/store/twinStore";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import type { TrailCard, TrailChoice, TrailDecision, TrailProposal } from "@/lib/decisionTrail";

export const TWIN_DEPOT_ID = "11111111-1111-1111-1111-111111111111";
const CARDS_MS = 10_000;
const CAR_MS = 8_000;

export interface DecisionTrailData {
  simRunId: string | null;
  simClock: string | null;
  cards: TrailCard[];
  /** Last card seen per car this run (see above). */
  cardMemory: Map<string, TrailCard>;
  carRows: ActivityFeedRow[];
  decisions: TrailDecision[];
  proposals: TrailProposal[];
  /** Empty until otto-q-core 0590 is applied; the trail then says "not recorded" where it would use them. */
  choices: TrailChoice[];
  /** The last read that failed, until the picked car's reads answer again. */
  error: string | null;
}

const errText = (e: unknown): string =>
  e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);

/** The feed, falling back to the plain feed on a backend without 0536 (as useActivityFeed does). */
export async function readFeed(args: Record<string, unknown>): Promise<ActivityFeedRow[]> {
  let { data, error } = await ottoQ.rpc("ottoq_activity_feed_v2", args);
  if (error && (error as { code?: string }).code === "PGRST202") ({ data, error } = await ottoQ.rpc("ottoq_activity_feed", args));
  if (error) throw error;
  // the feed is a set-returning function: any other answer is one this reader cannot use, not an empty feed
  if (data != null && !Array.isArray(data)) throw new Error("The activity feed did not answer with a list of rows.");
  return (data as ActivityFeedRow[] | null) ?? [];
}

export function useDecisionTrail(vehicleId: string | null, enabled = true): DecisionTrailData {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  const paused = useTwinStore((s) => s.paused);
  const [cards, setCards] = useState<TrailCard[]>([]);
  const [simClock, setSimClock] = useState<string | null>(null);
  const [carRows, setCarRows] = useState<ActivityFeedRow[]>([]);
  const [decisions, setDecisions] = useState<TrailDecision[]>([]);
  const [proposals, setProposals] = useState<TrailProposal[]>([]);
  const [choices, setChoices] = useState<TrailChoice[]>([]);
  /** A backend without 0590 answers PGRST202; stop asking it for this run. */
  const noOptionsRpc = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const memory = useRef(new Map<string, TrailCard>());

  // A new run starts clean.
  useEffect(() => {
    memory.current = new Map();
    setCards([]); setCarRows([]); setDecisions([]); setProposals([]); setChoices([]); setError(null); setSimClock(null);
    noOptionsRpc.current = false;
  }, [simRunId]);

  const live = enabled && !!simRunId && !paused;

  // Depot cards.
  useEffect(() => {
    if (!live || !simRunId) return;
    let cancelled = false;
    const pollCards = async () => {
      try {
        const { data, error: e } = await ottoQ.rpc("ottoq_depot_cards", { p_depot_id: TWIN_DEPOT_ID, p_fleet_operator_id: null });
        if (e) throw e;
        if (cancelled) return;
        const body = (data ?? {}) as { sim_run_id?: string | null; sim_clock?: string | null; vehicles?: TrailCard[] };
        // The cards answer for the depot's live run; a different run's cards are not this run's.
        if (body.sim_run_id && body.sim_run_id !== simRunId) return;
        const vs = Array.isArray(body.vehicles) ? body.vehicles : [];
        for (const v of vs) if (v.card) memory.current.set(v.vehicle_id, v);
        setCards(vs);
        setSimClock(body.sim_clock ?? null);
      } catch (e) {
        if (!cancelled) setError(errText(e));
      }
    };
    pollCards();
    const a = setInterval(pollCards, CARDS_MS);
    return () => { cancelled = true; clearInterval(a); };
  }, [live, simRunId]);

  // The picked car.
  useEffect(() => {
    setCarRows([]); setDecisions([]); setProposals([]); setChoices([]);
  }, [vehicleId, simRunId]);

  useEffect(() => {
    if (!live || !simRunId || !vehicleId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [rows, dec, prop, opts] = await Promise.all([
          readFeed({ p_sim_run_id: simRunId, p_vehicle_id: vehicleId, p_limit: 1000, p_changes_only: true, p_window_ticks: 1_000_000 }),
          ottoQ
            .from("ottoq_decisions")
            .select("decision_seq,tick_seq,sim_clock,overridden,override_rule_codes,rule_results,stall_id:enacted_action->>stall_id")
            .eq("sim_run_id", simRunId)
            .eq("entity_id", vehicleId)
            // A waiting car's verdict is restated every tick; only the decisions that place, send off or were
            // changed by a safety check carry results the trail reads.
            .or("overridden.eq.true,resolved_action_context.in.(stall_assignment,redeployment),enacted_action->>verb.in.(admit_service,admit_wash)")
            .order("decision_seq", { ascending: false })
            .limit(500),
          ottoQ
            .from("ottoq_external_proposals")
            .select("tick_seq,status,stall_id:proposal->>stall_id,abstain:proposal->>abstain,end_min:proposal->rationale->>planned_end_min")
            .eq("sim_run_id", simRunId)
            .eq("entity_id", vehicleId)
            .order("tick_seq", { ascending: false })
            .limit(500),
          noOptionsRpc.current
            ? Promise.resolve({ data: null, error: null })
            : ottoQ.rpc("ottoq_decision_options", { p_sim_run_id: simRunId, p_vehicle_id: vehicleId }),
        ]);
        if (cancelled) return;
        if (dec.error) throw dec.error;
        if (prop.error) throw prop.error;
        if (opts.error) {
          if ((opts.error as { code?: string }).code === "PGRST202") noOptionsRpc.current = true;
          else throw opts.error;
        }
        setCarRows(rows);
        // These reads answered, so an earlier failure is over. (The whole-run read used to clear it, on its own
        // clock, whether or not the car's reads had recovered.)
        setError(null);
        const body = (opts.data ?? null) as { choices?: TrailChoice[] } | null;
        setChoices(Array.isArray(body?.choices) ? body!.choices : []);
        setDecisions(((dec.data ?? []) as unknown as TrailDecision[]).map((d) => ({ ...d, decision_seq: Number(d.decision_seq) })));
        setProposals(
          ((prop.data ?? []) as unknown as { tick_seq: number | null; status: string | null; stall_id: string | null; abstain: string | null; end_min: string | null }[])
            .map((p) => ({
              tick_seq: p.tick_seq,
              status: p.status,
              stall_id: p.stall_id,
              abstain: p.abstain === "true",
              end_min: p.end_min == null || p.end_min === "" ? null : Number(p.end_min),
            })),
        );
      } catch (e) {
        if (!cancelled) setError(errText(e));
      }
    };
    poll();
    const t = setInterval(poll, CAR_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [live, simRunId, vehicleId]);

  return { simRunId, simClock, cards, cardMemory: memory.current, carRows, decisions, proposals, choices, error };
}
