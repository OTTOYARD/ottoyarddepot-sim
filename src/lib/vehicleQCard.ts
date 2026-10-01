// ============================================================================
// vehicleQCard — the "Q card": one car's OTTO-Q workflow, as the tap-on-a-car card shows it.
// ============================================================================
// Chase, 2026-10-01: "I just want each vehicle to be able to be tapped and a Q card to pop up and show its list of
// completed and needed services and time frames for each and any progress meters."
//
// His model: a car pings OTTO-Q on its way back; OTTO-Q answers with a needs-based sequence of stations (charge ->
// wash -> detail/service -> staging -> ready); the car works through it and each step is ticked off. OTTO-Q may
// re-assign a FUTURE step (another wash bay when the booked one goes down), never one that has begun, and can always
// fall back to a temporary hold until it re-orchestrates.
//
// Pure: no React, no client, no clock. It READS records and formats them; it decides nothing. Every field below comes
// from one of these, all already on the wire (no new RPC):
//
//   ottoq_depot_cards (contract 1.4)  the car's plan steps (its itinerary legs: the last 3 done, the current one with
//                                     progress_pct / expected_end / eta_source / over_plan_min, the next 5 with their
//                                     planned window and overdue_min), its needs (svc, status, done_at, performed_by,
//                                     awaiting_triage), its live bookings (purpose, stall_code, window, need_atom), its
//                                     state, SoC, target and stall.                         otto-q-core 0460/0506-0512
//   ottoq_twin_snapshot               the car's live state and SoC, its open visit (atoms with est_min, SoC on
//                                     arrival), its timed legs inside the +/-10 min window (to_stall per leg, and
//                                     'amended' legs a re-plan replaced), the stalls held for it (reserved_by), and its
//                                     open arm cycle.
//   ottoq_activity_feed_v2 (vehicle)  the car's own decisions: a re-booking (reservation_reopt / rebook), a bay
//                                     displacement (displace_and_bind), a re-timed plan (itinerary_amended) and a hold.
//
// The one rule: a missing number is null and is drawn "—", never 0. A missing list is `published: false`, never [].
// ============================================================================
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import type { TwinLeg, TwinSnapshot, TwinVehicle } from "@/lib/ottoTwin";
import { stateWord } from "@/lib/ottoqFunnel";
import { clockCT, placeName, serviceWord } from "@/lib/plainWords";

/** What a gap in a number or a time looks like on the card. */
export const DASH = "—";

// ── inputs: ottoq_depot_cards, contract 1.4 (only the keys the card reads) ────────────────────────────────────────
export interface QStepRecord {
  seq: number;
  leg_type: string;
  /** 'done' | 'current' | 'upcoming' (an open set: anything else reads as upcoming) */
  status: string;
  /** the service a leg was planned for (0506), e.g. readiness_check on an `inspect` leg */
  atom?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  /** current step only: 0..100 */
  progress_pct?: number | null;
  /** current step only (0507/0509): when it will end */
  expected_end?: string | null;
  /** 'charge_physics' (calibrated on the live session) or 'plan' */
  eta_source?: string | null;
  /** current step only: whole minutes past its planned duration, null until it is */
  over_plan_min?: number | null;
  /** upcoming step only: whole minutes its planned start is behind the clock */
  overdue_min?: number | null;
}
export interface QNeedRecord {
  svc: string;
  status?: string | null;
  done_at?: string | null;
  must_do?: boolean | null;
  performed_by?: string | null;
  awaiting_triage?: boolean | null;
  triage_verdict?: string | null;
}
export interface QBookingRecord {
  booking_id?: string | null;
  purpose?: string | null;
  state?: string | null;
  stall_code?: string | null;
  stall_kind?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  why?: string | null;
  need_atom?: string | null;
  booked_by?: string | null;
}
export interface QDepotCard {
  vehicle_id: string;
  display_name?: string | null;
  oem?: string | null;
  state?: string | null;
  soc?: number | null;
  target_soc?: number | null;
  stall?: { id?: string | null; code?: string | null; kind?: string | null } | null;
  reservations?: QBookingRecord[] | null;
  card?: {
    urgency?: string | null;
    dispatch_due_at?: string | null;
    needs?: QNeedRecord[] | null;
    steps?: QStepRecord[] | null;
    current_step?: QStepRecord | null;
    next_step?: QStepRecord | null;
  } | null;
}

export interface QCardInputs {
  vehicleId: string;
  /** the renderer's label, used only when no record names the car */
  label?: string | null;
  /** the car's ottoq_depot_cards entry, or null when the cards have not answered for this run */
  card?: QDepotCard | null;
  snapshot?: TwinSnapshot | null;
  /** stall id -> stall code, from the twin layout (the snapshot names stalls by id only) */
  stallCodes?: ReadonlyMap<string, string> | null;
  /** the car's own decisions, any order (ottoq_activity_feed_v2, p_vehicle_id) */
  feed?: readonly ActivityFeedRow[] | null;
}

// ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────
export type QStepState = "done" | "current" | "upcoming";

export interface QStep {
  key: string;
  label: string;
  state: QStepState;
  /** where: "fast charger 04", or null when no record names the station */
  place: string | null;
  /** the station's window: a booking's, else the step's planned window */
  from: string | null;
  to: string | null;
  /** 'booked' when the window is a live reservation, 'planned' when it is the leg's own window */
  windowKind: "booked" | "planned" | null;
  /** done: when it finished */
  doneAt: string | null;
  /** current: 0..100 */
  progress: number | null;
  /** current: when it will end, and how that was worked out */
  eta: string | null;
  etaSource: "charge physics" | "plan" | null;
  overPlanMin: number | null;
  overdueMin: number | null;
  /** the car is driving to this step right now */
  enRoute: boolean;
  /** OTTO-Q moved this step to another station before it began; `was` names the old one when a record does */
  reassigned: { at: string | null; was: string | null } | null;
}

export interface QNeed {
  svc: string;
  label: string;
  state: "done" | "active" | "open" | "deferred" | "dropped";
  doneAt: string | null;
  estMin: number | null;
  mustDo: boolean;
  note: string | null;
}

export interface QCard {
  vehicleId: string;
  name: string;
  /** which records answered: the card needs at least one */
  sources: { card: boolean; snapshot: boolean; feed: boolean };
  state: { code: string | null; words: string };
  battery: {
    now: number | null;
    target: number | null;
    /** now as a share of target, 0..100, or null when either is missing */
    ofTarget: number | null;
    onArrival: number | null;
  };
  /** where the car is and what is happening there */
  now: {
    what: string;
    place: string | null;
    progress: number | null;
    eta: string | null;
    etaSource: "charge physics" | "plan" | null;
    overPlanMin: number | null;
    /** the OTTO-CHARGE ARM's phase on this car, when an arm cycle is open on it */
    arm: string | null;
  };
  next: QStep | null;
  /** the plan in order; `published: false` when no record carried the car's steps */
  steps: { published: boolean; items: QStep[]; earlierHidden: boolean };
  needs: { published: boolean; items: QNeed[] };
  hold: { words: string; place: string | null; until: string | null } | null;
  /** plan changes the car's own decisions record, newest first */
  changes: { at: string | null; words: string }[];
  /** rule 9: no car leaves below its charge target or with a service open */
  leave: { cleared: boolean | null; words: string };
  dueAt: string | null;
  urgency: string | null;
  asOf: string | null;
}

// ── vocabulary ────────────────────────────────────────────────────────────────────────────────────────────────────
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** "1:05 PM", or "—". */
export const clock = (iso: string | null | undefined): string => (iso && !Number.isNaN(Date.parse(iso)) ? clockCT(iso) : DASH);
/** "72%", or "—". */
export const pctText = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? `${Math.round(n)}%` : DASH);

/** The step names a card shows. Founder's words for the stations; plainWords for the services. */
const STEP_WORD: Record<string, string> = {
  stage: "staging",
  depart: "ready to leave",
  arrive: "arrive",
  charge_dcfc: "fast charge",
  charge_l2: "charge",
};
export function stepLabel(s: Pick<QStepRecord, "leg_type" | "atom">): string {
  const k = s.atom || s.leg_type;
  return cap(STEP_WORD[k] ?? STEP_WORD[s.leg_type] ?? serviceWord(k));
}

/** Booking purposes that can serve a leg type (ottoq_stall_bookings.purpose). */
const PURPOSES: Record<string, readonly string[]> = {
  charge_dcfc: ["charge_dcfc"],
  charge_l2: ["charge_l2"],
  wash: ["wash"],
  detail: ["detail"],
  service: ["service"],
  inspect: ["inspect"],
  stage: ["staging", "temp_hold", "perimeter_hold"],
};
const HOLD_PURPOSES = new Set(["temp_hold", "perimeter_hold"]);
const TRAVEL = new Set(["taxi"]);

/** need status -> how the card draws it. Anything unknown is still owed (the conservative reading of rule 9). */
export function needState(status: string | null | undefined): QNeed["state"] {
  switch (String(status ?? "").trim().toLowerCase()) {
    case "done": case "complete": case "completed": return "done";
    case "in_progress": case "active": return "active";
    case "deferred": return "deferred";
    case "cancelled": case "canceled": case "skipped": return "dropped";
    default: return "open";
  }
}

const verbOf = (r: ActivityFeedRow): string => (typeof r.rationale?.verb === "string" ? (r.rationale.verb as string) : "");
const HOLD_WHY: Record<string, string> = {
  hold_in_queue: "service bays busy",
  hold_no_space: "no free space",
  hold_no_bay: "no free bay",
  hold_in_staging: "kept parked until it can leave",
};
const ARM_WORD: Record<string, string> = { mate: "plugging in", demate: "unplugging", charging: "plugged in" };

/** The car's rows since its last departure, oldest first: the visit it is on. */
export function currentVisitRows(rows: readonly ActivityFeedRow[]): ActivityFeedRow[] {
  const sorted = [...rows].sort((a, b) =>
    Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || (a.decision_seq ?? 0) - (b.decision_seq ?? 0));
  let start = 0;
  sorted.forEach((r, i) => {
    if (r.action === "redeployment" && verbOf(r) === "deploy" && r.outcome === "enacted") start = i + 1;
  });
  return sorted.slice(start);
}

// ── the card ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function buildQCard(inp: QCardInputs): QCard {
  const id = inp.vehicleId;
  const dc = inp.card ?? null;
  const work = dc?.card ?? null;
  const snap = inp.snapshot ?? null;
  const tv: TwinVehicle | null = snap?.fleet?.vehicles?.find((v) => v?.id === id) ?? null;
  const visit = tv?.visit ?? null;
  const codes = inp.stallCodes ?? null;
  const codeOf = (stallId: string | null | undefined): string | null => (stallId ? codes?.get(stallId) ?? null : null);
  const legs: TwinLeg[] = (snap?.legs ?? []).filter((l) => l?.vehicle_id === id);
  const visitRows = currentVisitRows(inp.feed ?? []);

  // ── who and what state ──
  const name = dc?.display_name || inp.label?.split(" · ")[0] || tv?.av_id || id;
  const stateCode = tv?.state ?? dc?.state ?? null;

  // ── battery: the twin's live SoC first (it polls faster), the card's otherwise; target from the engine ──
  const now = num(tv?.soc) ?? num(dc?.soc);
  const target = num(dc?.target_soc) ?? num(visit?.target_soc);
  const ofTarget = now !== null && target !== null && target > 0 ? Math.max(0, Math.min(100, (now / target) * 100)) : null;

  // ── re-assignments the records carry ──
  // (1) the car's own decisions: a re-booking onto a better stall, a bay displacement
  const rebooks = visitRows.filter((r) =>
    r.outcome === "enacted" && (r.action === "reservation_reopt" || verbOf(r) === "rebook" || verbOf(r) === "displace_and_bind"));
  // (2) the snapshot's amended legs: a dwell leg a re-plan replaced, still inside the +/-10 min window
  const amended = legs.filter((l) => l.status === "amended" && l.kind !== "travel");

  // ── steps ──
  const stepRecs = Array.isArray(work?.steps) ? [...work!.steps!].sort((a, b) => a.seq - b.seq) : null;
  const bookings = (dc?.reservations ?? []).filter((b) => b && (b.state == null || b.state === "held" || b.state === "active"));
  const used = new Set<QBookingRecord>();
  const bookingFor = (s: QStepRecord): QBookingRecord | null => {
    const fits = bookings.filter((b) => !used.has(b) && (
      (s.atom && b.need_atom === s.atom) || (b.purpose && (PURPOSES[s.leg_type] ?? []).includes(b.purpose))));
    if (!fits.length) return null;
    const t = Date.parse(s.planned_start ?? "");
    fits.sort((a, b) => Math.abs(Date.parse(a.starts_at ?? "") - t) - Math.abs(Date.parse(b.starts_at ?? "") - t) || 0);
    used.add(fits[0]);
    return fits[0];
  };
  const legFor = (s: QStepRecord): TwinLeg | null =>
    legs.find((l) => l.status !== "amended" && l.seq === s.seq && l.leg_type === s.leg_type) ?? null;

  const isCurrent = (s: QStepRecord) => s.status === "current";
  const currentRec = stepRecs?.find(isCurrent) ?? work?.current_step ?? null;
  const drivingNow = !!currentRec && TRAVEL.has(currentRec.leg_type);

  const items: QStep[] = [];
  let enRouteMarked = false;
  for (const s of stepRecs ?? []) {
    if (TRAVEL.has(s.leg_type)) continue; // a drive between stations is shown as "on the way to" the next one
    const state: QStepState = s.status === "done" ? "done" : s.status === "current" ? "current" : "upcoming";
    const leg = legFor(s);
    const booking = state === "done" ? null : bookingFor(s);
    const stallCode = (state === "current" ? dc?.stall?.code ?? codeOf(tv?.stall_id) : null)
      ?? codeOf(leg?.to_stall ?? leg?.from_stall) ?? booking?.stall_code ?? null;
    const place = stallCode ? placeName(stallCode, state === "current" ? dc?.stall?.kind ?? null : booking?.stall_kind ?? null) : null;
    const stallId = leg?.to_stall ?? (state === "current" ? tv?.stall_id ?? dc?.stall?.id ?? null : null);

    // re-assigned: a re-booking that names this station, or an amended leg of this type that went somewhere else
    let reassigned: QStep["reassigned"] = null;
    if (state !== "done") {
      const hit = rebooks.filter((r) => (stallCode && r.target === stallCode)
        || (stallId && typeof r.rationale?.stall_id === "string" && r.rationale.stall_id === stallId)).pop();
      if (hit) reassigned = { at: hit.occurred_at, was: null };
      const old = stallId ? amended.find((l) => l.leg_type === s.leg_type && !!l.to_stall && l.to_stall !== stallId) : undefined;
      if (old) reassigned = { at: reassigned?.at ?? null, was: codeOf(old.to_stall) ? placeName(codeOf(old.to_stall)) : null };
    }

    const enRoute = drivingNow && !enRouteMarked && state === "upcoming";
    if (enRoute) enRouteMarked = true;
    const es = s.eta_source === "charge_physics" ? "charge physics" : s.eta_source === "plan" ? "plan" : null;
    items.push({
      key: `${s.seq}-${s.leg_type}`,
      label: stepLabel(s),
      state,
      place,
      from: booking?.starts_at ?? (state === "done" ? s.actual_start ?? s.planned_start : state === "current" ? s.actual_start ?? s.planned_start : s.planned_start) ?? null,
      to: booking?.ends_at ?? (state === "current" ? s.expected_end ?? s.planned_end : state === "done" ? s.actual_end ?? s.planned_end : s.planned_end) ?? null,
      windowKind: booking ? "booked" : (s.planned_start || s.planned_end) ? "planned" : null,
      doneAt: state === "done" ? s.actual_end ?? null : null,
      progress: state === "current" ? num(s.progress_pct) : null,
      eta: state === "current" ? s.expected_end ?? null : null,
      etaSource: state === "current" ? es : null,
      overPlanMin: state === "current" ? num(s.over_plan_min) : null,
      overdueMin: state === "upcoming" ? num(s.overdue_min) : null,
      enRoute,
      reassigned,
    });
  }
  const doneShown = (stepRecs ?? []).filter((s) => s.status === "done").length;

  // ── needs: the card's (with done_at), else the snapshot visit's atoms; est_min joins from the snapshot ──
  const estBySvc = new Map<string, number>();
  for (const a of visit?.atoms ?? []) { const e = num(a?.est_min); if (a?.svc && e !== null && !estBySvc.has(a.svc)) estBySvc.set(a.svc, e); }
  const needRecs: QNeedRecord[] | null = Array.isArray(work?.needs) ? work!.needs! : Array.isArray(visit?.atoms) ? visit!.atoms : null;
  const needs: QNeed[] = (needRecs ?? []).filter((n) => n && n.svc).map((n) => {
    const st = needState(n.status);
    const note = n.awaiting_triage ? "waiting on the quick check"
      : n.performed_by === "charger_sensors" ? "by the charger's sensors"
      : n.triage_verdict ? `quick check: ${n.triage_verdict}`
      : st === "deferred" ? "moved to next visit" : null;
    return {
      svc: n.svc, label: cap(serviceWord(n.svc)), state: st,
      doneAt: st === "done" ? n.done_at ?? null : null,
      estMin: estBySvc.get(n.svc) ?? null, mustDo: n.must_do === true, note,
    };
  });

  // ── now ──
  const cur = items.find((s) => s.state === "current") ?? null;
  const nextStep = items.find((s) => s.state === "upcoming") ?? null;
  const cycle = (snap?.arm?.cycles ?? []).find((c) => c?.vehicle_id === id) ?? null;
  const arm = cycle ? `Charge arm ${ARM_WORD[cycle.direction] ?? cycle.direction.replace(/_/g, " ")}${cycle.retry_count > 0 ? ` (retry ${cycle.retry_count})` : ""}` : null;
  const herePlace = dc?.stall?.code ? placeName(dc.stall.code, dc.stall.kind ?? null) : codeOf(tv?.stall_id) ? placeName(codeOf(tv?.stall_id)) : null;
  const nowBlock: QCard["now"] = drivingNow
    ? { what: nextStep ? `On the way to ${nextStep.label.toLowerCase()}` : "Driving", place: nextStep?.place ?? null,
        progress: num(currentRec?.progress_pct), eta: currentRec?.expected_end ?? currentRec?.planned_end ?? null,
        etaSource: currentRec?.eta_source === "plan" ? "plan" : null, overPlanMin: num(currentRec?.over_plan_min), arm }
    : cur
      ? { what: cur.label, place: cur.place ?? herePlace, progress: cur.progress, eta: cur.eta, etaSource: cur.etaSource, overPlanMin: cur.overPlanMin, arm }
      : { what: cap(stateWord(stateCode)), place: herePlace, progress: null, eta: null, etaSource: null, overPlanMin: null, arm };

  // ── hold: a temporary-hold booking, a standing wait, or parked in staging with no step under way ──
  let hold: QCard["hold"] = null;
  const holdBooking = bookings.find((b) => b.purpose && HOLD_PURPOSES.has(b.purpose));
  const last = visitRows[visitRows.length - 1];
  const waiting = last && last.standing !== false && (last.outcome === "noop_no_candidate" || Object.prototype.hasOwnProperty.call(HOLD_WHY, verbOf(last)));
  if (holdBooking) {
    hold = { words: "Temporary hold until OTTO-Q re-orchestrates", place: holdBooking.stall_code ? placeName(holdBooking.stall_code, holdBooking.stall_kind ?? null) : null, until: holdBooking.ends_at ?? null };
  } else if (waiting) {
    const why = HOLD_WHY[verbOf(last)] ?? "no compatible stall free";
    hold = { words: `Holding: ${why}`, place: herePlace, until: null };
  } else if ((stateCode === "staged_awaiting_service" || stateCode === "emergency_staged") && !cur && !drivingNow) {
    hold = { words: "In temporary staging, waiting for its next assignment", place: herePlace, until: null };
  }

  // ── plan changes, from the car's own decisions ──
  const changes: QCard["changes"] = [];
  for (const r of visitRows) {
    if (r.outcome !== "enacted") continue;
    if (r.action === "reservation_reopt" || verbOf(r) === "rebook") {
      changes.push({ at: r.occurred_at, words: `Re-booked to ${placeName(r.target) || "another stall"}` });
    } else if (verbOf(r) === "displace_and_bind") {
      changes.push({ at: r.occurred_at, words: `Moved to ${placeName(r.target) || "another bay"}` });
    } else if (r.action === "itinerary_amended") {
      const s = num(r.rationale?.shift_s);
      changes.push({ at: r.occurred_at, words: s === null ? "Plan re-timed" : `Plan re-timed ${Math.round(s / 60)} min` });
    }
  }
  changes.reverse();

  // ── rule 9: no car leaves below its charge target or with a service open ──
  const open = needs.filter((n) => n.state === "open" || n.state === "active");
  const needsKnown = needRecs !== null;
  const batteryOk = now !== null && target !== null ? now >= target : null;
  let leave: QCard["leave"];
  if (batteryOk === null || !needsKnown) {
    const parts = [batteryOk === null ? "battery or target not published" : null, !needsKnown ? "services not published" : null].filter(Boolean);
    leave = { cleared: null, words: `Leave check: ${DASH} (${parts.join(", ")})` };
  } else if (batteryOk && open.length === 0) {
    leave = { cleared: true, words: "Cleared to leave: battery at target, every service done" };
  } else {
    const parts = [
      batteryOk ? null : `battery ${pctText(now)} of ${pctText(target)}`,
      open.length ? `${open.length} ${open.length === 1 ? "service" : "services"} open (${open.map((n) => n.label.toLowerCase()).join(", ")})` : null,
    ].filter(Boolean);
    leave = { cleared: false, words: `Not cleared to leave: ${parts.join(", ")}` };
  }

  return {
    vehicleId: id,
    name,
    sources: { card: !!dc, snapshot: !!tv, feed: (inp.feed?.length ?? 0) > 0 },
    state: { code: stateCode, words: cap(stateWord(stateCode)) },
    battery: { now, target, ofTarget, onArrival: num(visit?.soc_at_arrival) },
    now: nowBlock,
    next: nextStep,
    steps: { published: stepRecs !== null, items, earlierHidden: doneShown >= 3 },
    needs: { published: needsKnown, items: needs },
    hold,
    changes,
    leave,
    dueAt: work?.dispatch_due_at ?? null,
    urgency: work?.urgency ?? visit?.urgency ?? null,
    asOf: snap?.run?.sim_clock ?? null,
  };
}

/** stall id -> code from the twin layout. */
export function stallCodeMap(stalls: readonly { id: string; code: string }[] | null | undefined): Map<string, string> {
  return new Map((stalls ?? []).filter((s) => s?.id && s?.code).map((s) => [s.id, s.code]));
}
