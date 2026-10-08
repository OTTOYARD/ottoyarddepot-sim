// useSelfReview — the engine's latest morning review of its check (public.ottoq_arbiter_assessments, otto-q-core 0621)
// and the charge clock it times charges by (public.ottoq_charge_clock_fits, 0622), for the twin depot (CLAUDE.md rule 8).
//
// Both belong to the depot, not to a run: they are written once a morning, so they read whether or not a run is live,
// and a 5-minute poll is plenty. Two small reads: the review with two blocks of its assessment selected out (about 13 KB)
// and the clock's class levels only (about 3 KB, against 73 KB for the whole fit the engine reads).
//
// Pause follows the sim, as every other stream here: a paused cockpit issues no reads and keeps what it has.
import { useEffect, useState } from "react";
import { ottoQ } from "@/lib/ottoQClient";
import { NASHVILLE_DEPOT } from "@/lib/ottoTwin";
import { useTwinStore } from "@/store/twinStore";
import type { ClockFitRow, SelfAssessmentRow } from "@/lib/selfAssessment";

const POLL_MS = 5 * 60_000;

export const REVIEW_SELECT =
  "assessment_id,assessed_at,since,n_graded,improvement_areas,"
  + "verdicts:assessment->verdicts,attribution:assessment->what_made_the_check_wrong";
export const CLOCK_SELECT =
  "fit_id,fitted_at,n_evidence,n_runs,class_cells:params->class_cells,half_life_days:params->half_life_days";

export interface SelfReviewState {
  review: SelfAssessmentRow | null;
  clock: ClockFitRow | null;
  error: string | null;
  /** A read has answered: a null review is then "none written yet", not "still reading". */
  loaded: boolean;
}

const message = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);

export function useSelfReview(enabled = true, depotId: string = NASHVILLE_DEPOT): SelfReviewState {
  const paused = useTwinStore((s) => s.paused);
  const [review, setReview] = useState<SelfAssessmentRow | null>(null);
  const [clock, setClock] = useState<ClockFitRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || paused) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [a, c] = await Promise.all([
          ottoQ.from("ottoq_arbiter_assessments").select(REVIEW_SELECT)
            .eq("depot_id", depotId).order("assessment_id", { ascending: false }).limit(1).maybeSingle(),
          ottoQ.from("ottoq_charge_clock_fits").select(CLOCK_SELECT)
            .eq("depot_id", depotId).eq("usable", true).order("fit_id", { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (cancelled) return;
        if (a.error) { setError(message(a.error)); return; }
        setReview((a.data as SelfAssessmentRow | null) ?? null);
        // the clock is a second line on the card: a failed read of it hides the line and keeps the review
        setClock(c.error ? null : ((c.data as ClockFitRow | null) ?? null));
        setError(null);
        setLoaded(true);
      } catch (err: unknown) {
        if (!cancelled) setError(message(err));
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [enabled, paused, depotId]);

  return { review, clock, error, loaded };
}
