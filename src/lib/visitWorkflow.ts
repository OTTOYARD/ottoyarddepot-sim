// ============================================================================
// visitWorkflow — read OTTO-Q's per-visit service plan off the twin snapshot.
// ============================================================================
// This module DERIVES NOTHING about what a vehicle needs. `ottoq_visit_needs`
// already holds the decision — one row per depot visit, with an `atoms` array
// that OTTO-Q writes at planning time and advances as work happens
// (`ottoq_start_concurrent_atoms` stamps in_progress, `ottoq_mark_visit_atoms_done`
// stamps done). Everything here is classification and formatting of that
// published state, so the card can show a checklist instead of the renderer
// inventing one.
//
// TOTALITY is the whole point. Every function below is defined for every input
// the wire can carry — a missing field, a null, an unknown status string, a
// service name nobody has taught this file about. The failure mode of a
// renderer that guesses is a confident, wrong screen; the failure mode here is
// an honest "not published".
// ============================================================================
import type { TwinSnapshot, TwinVehicle, TwinVisitAtom, TwinVisitCard } from "@/lib/ottoTwin";

/** How one atom is drawn. Terminal states are 'done' and 'dropped'. */
export type AtomState = "done" | "active" | "pending" | "dropped";

export interface WorkflowItem {
  svc: string;
  /** human label; falls back to a prettified svc so an unknown service still reads */
  label: string;
  state: AtomState;
  mustDo: boolean;
  estMin: number | null;
  /**
   * The item the card highlights. TRUE for every atom OTTO-Q has actually
   * marked in_progress (services run concurrently, so there can be several).
   * When nothing is in progress this is false everywhere and `activeIndex` is -1;
   * at what is queued next — "next" and "happening now" are different claims.
   */
  current: boolean;
}

export type VisitWorkflow =
  /** The snapshot carried no `visit` field at all (older backend), or the
   *  vehicle is not in the snapshot's fleet. We know nothing. */
  | { kind: "unpublished" }
  /** Published, and this vehicle has no open visit for this run. */
  | { kind: "no_visit" }
  /** An open visit. `items` may legitimately be EMPTY — an opened visit with no
   *  work on it, which is a real state and not the same as "no visit". */
  | {
      kind: "visit";
      card: TwinVisitCard;
      items: WorkflowItem[];
      doneCount: number;
      /** items that are done or dropped — the denominator-side of "cleared" */
      clearedCount: number;
      totalCount: number;
      /** index into `items` of the next queued atom, or -1 when none is queued */
      activeIndex: number;
      /** true once every atom is terminal AND there was at least one atom */
      allComplete: boolean;
    };

/**
 * Service names OTTO-Q emits, in the wording an operator uses. Anything not
 * listed falls through to `prettifyService`, so a new service added backend-side
 * still renders — just without the hand-written wording.
 */
const SERVICE_LABELS: Record<string, string> = {
  charge: "Charge",
  readiness_check: "Readiness check",
  interior_inspection: "Interior inspection",
  interior_tidy: "Interior tidy",
  interior_deep_clean: "Interior deep clean",
  exterior_wash: "Exterior wash",
  perimeter_walkaround: "Perimeter walkaround",
  sensor_clean: "Sensor clean",
  sensor_calibration: "Sensor calibration",
  mechanical_pm: "Mechanical PM",
  fault_repair: "Fault repair",
  software_update: "Software update",
  item_retrieval: "Item retrieval",
  remote_diagnostics: "Remote diagnostics",
  triage_check: "Triage check",
  tire_service: "Tire service",
  brake_service: "Brake service",
};

/** snake_case -> "Sentence case". Formatting only; invents no meaning. */
export function prettifyService(svc: string): string {
  const words = String(svc ?? "").split(/[_\s]+/).filter(Boolean);
  if (!words.length) return "Service";
  const joined = words.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

export function serviceLabel(svc: string): string {
  return SERVICE_LABELS[svc] ?? prettifyService(svc);
}

/**
 * Classify one atom status. The backend lower-cases it, but the wire is not
 * ours to trust, so normalise again here.
 *
 * 'cancelled' and 'skipped' map to `dropped`: the work is off the plan, and the
 * card must not show it as a tick — nobody did it.
 * ANY unrecognised string maps to `pending`, matching the decision loop, which
 * treats everything that is not done/cancelled/skipped as still owed.
 */
export function classifyAtomStatus(status: string | null | undefined): AtomState {
  switch (String(status ?? "").trim().toLowerCase()) {
    case "done":
    case "complete":
    case "completed":
      return "done";
    case "in_progress":
    case "active":
      return "active";
    case "cancelled":
    case "canceled":
    case "skipped":
      return "dropped";
    default:
      return "pending";
  }
}

function toItem(atom: TwinVisitAtom | null | undefined): WorkflowItem {
  const svc = typeof atom?.svc === "string" && atom.svc ? atom.svc : "unknown";
  const state = classifyAtomStatus(atom?.status);
  const est = Number(atom?.est_min);
  return {
    svc,
    label: serviceLabel(svc),
    state,
    mustDo: atom?.must_do === true,
    estMin: Number.isFinite(est) ? est : null,
    current: state === "active",
  };
}

/**
 * Turn a published visit into the card's view model. Exported separately from
 * the snapshot lookup so it can be tested against a raw wire shape.
 */
export function readVisitCard(card: TwinVisitCard): Extract<VisitWorkflow, { kind: "visit" }> {
  const atoms = Array.isArray(card.atoms) ? card.atoms : [];
  const items = atoms.map(toItem);
  const doneCount = items.filter((i) => i.state === "done").length;
  const clearedCount = items.filter((i) => i.state === "done" || i.state === "dropped").length;
  // NO "NEXT". Deliberately removed rather than fixed.
  //
  // This computed first-pending-in-ARRAY-ORDER and the card rendered it as a "next"
  // chip. Array order is the order OTTO-Q PLANNED the atoms, not the order it will
  // WORK them — the engine picks by urgency, bay availability and the full-service
  // visit rules, and a review measured the array-order guess wrong on 83% of real
  // visits. A confident wrong claim about what the depot will do next is worse than
  // no claim, and it is the exact anti-pattern this renderer keeps being caught in:
  // inventing something OTTO-Q never published.
  //
  // What IS published and true: which atoms are done, which are still owed, and
  // which is ACTIVE right now. That is what the card shows.
  const activeIndex = items.findIndex((i) => i.state === "active");
  return {
    kind: "visit",
    card,
    items,
    doneCount,
    clearedCount,
    totalCount: items.length,
    activeIndex,
    // An EMPTY manifest is not a completed one. A visit with no atoms has
    // nothing to complete, so it never reports "all services complete".
    allComplete: items.length > 0 && clearedCount === items.length,
  };
}

/** Total over the whole wire: undefined snapshot, absent field, null visit. */
export function readVehicleWorkflow(vehicle: TwinVehicle | null | undefined): VisitWorkflow {
  if (!vehicle) return { kind: "unpublished" };
  // `undefined` = the backend never published the field. `null` = it published
  // that there is no open visit. Only the second is a statement about the car.
  if (vehicle.visit === undefined) return { kind: "unpublished" };
  if (vehicle.visit === null) return { kind: "no_visit" };
  return readVisitCard(vehicle.visit);
}

/**
 * Look a vehicle's workflow up by the id the renderer hovers on.
 *
 * `TwinMotionDriver` keys its entries — and therefore `vehicleStore.vehicles[].id`
 * and `hoveredVehicleId` — on `TwinVehicle.id`, so this join needs no mapping.
 * A vehicle the snapshot does not carry reads as `unpublished`, never as an
 * empty checklist.
 */
export function readWorkflowFromSnapshot(
  snapshot: TwinSnapshot | null | undefined,
  vehicleId: string | null | undefined,
): VisitWorkflow {
  if (!snapshot || !vehicleId) return { kind: "unpublished" };
  const fleet = snapshot.fleet?.vehicles;
  if (!Array.isArray(fleet)) return { kind: "unpublished" };
  return readVehicleWorkflow(fleet.find((v) => v?.id === vehicleId));
}

/** Header wording for a visit urgency. Unknown values fall back to prettified. */
export function urgencyLabel(urgency: string | null | undefined): string | null {
  if (!urgency) return null;
  return prettifyService(urgency);
}

/**
 * TRUE for the urgencies that should be drawn in the critical red. Anything
 * unrecognised is NOT critical — an unknown word must not escalate a card.
 */
export function isCriticalUrgency(urgency: string | null | undefined): boolean {
  const u = String(urgency ?? "").trim().toLowerCase();
  return u === "critical" || u === "overdue" || u === "urgent";
}
