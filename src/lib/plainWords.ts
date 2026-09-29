// plainWords — the ONE glossary that turns OTTO-Q's internal terms into words anyone watching a run can follow.
//
// Chase, 2026-09-28: "I dont want it to look like a lot of technical jargon or slop. Just easy to understand reasoning
// and decision logic trail. Like scenario requested by vehicle, scanned, found best solution, proposed, passed,
// dispatched."
//
// Pure: no React, no stores, no imports. The twin carries it at src/lib/plainWords.ts and OTTO-PULSE and OrchestrAV
// carry it verbatim at src/lib/twin/plainWords.ts, so all three cockpits say the same thing about the same decision.
//
// Three rules every function here obeys:
//   1. Never show a tick number, a table name or a rule code. A rule is named by what it protects.
//   2. Every sentence is a template filled from real fields. Nothing here writes prose of its own.
//   3. Missing data shows as missing (MISSING), never guessed.

/** What a gap in the record says. One phrase, so a reader learns to recognise it. */
export const MISSING = "not recorded";

// ── terms ─────────────────────────────────────────────────────────────────────
/** Internal term -> the word a viewer sees. Keys are lower-case, with underscores. */
export const GLOSSARY: Record<string, string> = {
  need: "service",
  atom: "service",
  proposal: "plan",
  proposals: "plans",
  proposer: "planner",
  proposers: "planners",
  enacted: "chosen",
  superseded: "replaced by a better plan",
  refused: "turned down",
  expired: "ran out of time",
  abstained: "passed",
  shield: "safety check",
  rule_evaluation: "safety check",
  rule_evaluations: "safety checks",
  override: "safety change",
  overridden: "changed by a safety check",
  overridden_to_default: "changed by a safety check",
  dispatch: "sent",
  dispatched: "sent",
  soc: "battery",
  staging: "parking",
  staged: "parked",
  kernel: "final check",
  solver: "optimizer",
  itinerary: "plan",
  itinerary_amended: "plan re-timed",
  deploy: "leave",
  deployed: "left",
  redeployment: "leaving",
  noop_no_candidate: "nothing free",
  triage: "quick check",
  bess: "depot battery",
  dcfc: "fast charger",
  l2: "standard charger",
  service_bay: "service bay",
  wash_bay: "wash bay",
};

/** One internal term in plain words. Unknown terms read as their own words, underscores dropped. */
export function plain(term: string | null | undefined): string {
  if (!term) return "";
  const key = term.trim().toLowerCase();
  return GLOSSARY[key] ?? key.replace(/_/g, " ");
}

// ── services (need atoms and itinerary leg types) ────────────────────────────
export const SERVICE_WORD: Record<string, string> = {
  charge: "charge",
  charge_l2: "charge",
  charge_dcfc: "fast charge",
  inspect: "inspection",
  perimeter_walkaround: "walk-around check",
  wash: "wash",
  interior_tidy: "interior tidy",
  detail: "full detail",
  sensor_clean: "sensor clean",
  service: "repair",
  item_retrieval: "lost-item pickup",
  remote_diagnostics: "remote diagnostics",
  triage_check: "quick check",
  cell_balance: "battery balancing",
  mechanical_pm: "scheduled maintenance",
  readiness_check: "readiness check",
  interior_inspection: "interior inspection",
  exterior_wash: "exterior wash",
  tire_check: "tire check",
  taxi: "drive",
  stage: "park",
  depart: "leave",
};

export function serviceWord(atom: string | null | undefined): string {
  if (!atom) return "";
  return SERVICE_WORD[atom] ?? atom.replace(/_/g, " ");
}

/** "charge, wash and inspection". Empty list -> "". */
export function listWords(words: string[]): string {
  const w = words.filter(Boolean);
  if (w.length <= 1) return w[0] ?? "";
  return `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
}

// ── places ───────────────────────────────────────────────────────────────────
export const STALL_KIND_WORD: Record<string, string> = {
  dcfc: "fast charger",
  l2: "standard charger",
  service_bay: "service bay",
  service: "service bay",
  svc: "service bay",
  wash: "wash bay",
  wash_bay: "wash bay",
  staging: "parking",
  stage: "parking",
  temp_staging: "parking",
  gate: "gate",
};

/** "NASH-DCFC-STALL-08" -> "fast charger 08"; "NASH-SVC-02" -> "service bay 02". Unknown shapes pass through. */
export function placeName(code: string | null | undefined, kind?: string | null): string {
  if (!code) return kind ? STALL_KIND_WORD[kind] ?? kind.replace(/_/g, " ") : "";
  const parts = code.toUpperCase().split("-").filter((p) => p && p !== "NASH" && p !== "STALL");
  const number = parts.find((p) => /^\d+[A-Z]?$/.test(p)) ?? "";
  const kindPart = parts.find((p) => !/^\d+[A-Z]?$/.test(p))?.toLowerCase() ?? "";
  const word =
    (kind ? STALL_KIND_WORD[kind] : undefined) ??
    STALL_KIND_WORD[kindPart] ??
    (kindPart.startsWith("stg") || kindPart.startsWith("p") ? "parking" : undefined);
  if (!word) return code;
  return number ? `${word} ${number}` : word;
}

// ── safety rules, by what they protect (never by code) ───────────────────────
export const RULE_WORD: Record<string, string> = {
  "EN.001": "the depot's power limit",
  "EN.002": "the charger's power limit",
  "EN.003": "the depot battery's limits",
  "EN.004": "a grid request to use less power",
  "EN.005": "a grid emergency stop",
  "HW.001": "the plug fits the car",
  "HW.002": "the charger is working",
  "HW.003": "the car's sensors are reporting",
  "HW.004": "one car per stall",
  "HW.005": "one job at a time per car",
  "SLA.001": "enough battery to leave",
  "SLA.003": "the visit time limit",
  "SLA.004": "required services are done",
  "SLA.005": "the fleet owner's hand-off time",
  "SLA.006": "the maintenance window",
  "SLA.007": "ready to leave",
  "SM.002": "a valid next step",
  "TW.001": "depot opening hours",
  "TW.003": "quiet hours",
  "TW.005": "the shift change",
};

/** A rule, named by what it protects. "HW.005.vehicle_one_active_task" -> "one job at a time per car". */
export function ruleWord(code: string | null | undefined): string {
  if (!code) return "a safety rule";
  const m = code.match(/^([A-Z]+\.\d{3})/);
  return (m && RULE_WORD[m[1]]) || "a safety rule";
}

/** Several rules, deduped, in plain words. */
export function ruleWords(codes: readonly string[] | null | undefined): string {
  return listWords([...new Set((codes ?? []).map(ruleWord))]);
}

// ── times ────────────────────────────────────────────────────────────────────
/** Every clock reads depot time (Nashville, Central). */
export const DEPOT_TZ = "America/Chicago";

/** "1:05 PM". Missing or unreadable -> MISSING. */
export function clockCT(iso: string | null | undefined): string {
  if (!iso) return MISSING;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return MISSING;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: DEPOT_TZ });
}

/** Whole minutes from a to b (b later is positive), or null if either is missing. */
export function minutesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  return Number.isFinite(ms) ? Math.round(ms / 60_000) : null;
}

/** "1 minute", "12 minutes", "1 hr 5 min". */
export function duration(min: number): string {
  const m = Math.abs(Math.round(min));
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

const capital = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);

export const pct = (n: number | null | undefined): string =>
  typeof n === "number" && Number.isFinite(n) ? `${Math.round(n)}%` : MISSING;

// ── the trail's sentences ────────────────────────────────────────────────────
// One template per step. Each takes only facts; a null fact prints MISSING in its place.

export type TrailStepKind =
  | "arrived" | "checked" | "options" | "picked" | "safety" | "sent" | "done"
  | "replanned" | "waited" | "service_added" | "owner_request" | "blocked";

/** The step names, in the order a visit runs. The branch kinds sit between them. */
export const STEP_LABEL: Record<TrailStepKind, string> = {
  arrived: "Arrived",
  checked: "Checked the depot",
  options: "Found ways to do it",
  picked: "Picked the best",
  safety: "Safety checks passed",
  sent: "Sent",
  done: "Done",
  replanned: "Re-planned",
  waited: "Waited",
  service_added: "Service added",
  owner_request: "Owner request",
  blocked: "Safety check stopped it",
};

export interface Sentence { title: string; detail: string | null }

export function arrivedText(f: { needs: string[]; targetBattery: number | null; readyBy: string | null }): Sentence {
  const needs = f.needs.map(serviceWord).filter(Boolean);
  const wants = [
    f.targetBattery != null ? `charge to ${pct(f.targetBattery)}` : null,
    ...needs.filter((n) => n !== "charge" && n !== "fast charge"),
  ].filter((x): x is string => !!x);
  return {
    title: "Arrived",
    detail: `Needs ${wants.length ? listWords(wants) : MISSING}. Must be ready by ${clockCT(f.readyBy)}.`,
  };
}

/** "3 fast chargers" / "1 car". */
const count = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

/** The depot at the moment of the choice. Counts come from the frame that tick decided on (otto-q-core 0590); without
 *  them the line says only what the car looked for. */
export function checkedText(f: {
  wanted: string | null; freeFast?: number | null; freeStandard?: number | null; waitingForCharge?: number | null;
}): Sentence {
  const what = f.wanted ? STALL_KIND_WORD[f.wanted] ?? plain(f.wanted) : null;
  const chargers = f.freeFast != null && f.freeStandard != null
    ? `${count(f.freeFast, "fast charger")} and ${count(f.freeStandard, "standard charger")} free`
    : null;
  const waiting = f.waitingForCharge != null ? `${count(f.waitingForCharge, "car")} waiting for a charge` : null;
  if (!chargers && !waiting) return { title: "Checked the depot", detail: what ? `Looked for a free ${what}.` : null };
  return { title: "Checked the depot", detail: `${capital([chargers, waiting].filter(Boolean).join(", "))}.` };
}

export function optionsText(n: number | null, best: string[] = []): Sentence {
  if (n == null) return { title: "Found ways to do it", detail: `Options compared: ${MISSING}.` };
  return {
    title: `Found ${n} ${n === 1 ? "way" : "ways"} to do it`,
    detail: n > 1 && best.length ? `Best ${best.length === 1 ? "one" : best.length}: ${listWords(best)}.` : null,
  };
}

// ── why a charger won (otto-q-core 0590: the key of the assigner's own ranking that separated it from the next) ──
export type PickWhy = "only_option" | "power_limit" | "booked" | "wanted_kind" | "row_order";
export type WantWhy = "low_battery" | "due_now" | "enough_battery";

export function whyPickedText(f: {
  why: PickWhy | string | null; wantWhy: WantWhy | string | null; soc: number | null;
  wantedKind: string | null; chosenKind: string | null;
  /** How many of the options were the kind it wanted (0590's options_by_kind); null when not known. */
  wantedKindOptions?: number | null;
}): string | null {
  const word = (k: string): string => STALL_KIND_WORD[k] ?? plain(k);
  const need =
    f.wantWhy === "low_battery" ? `It needed a fast charger: battery ${pct(f.soc)}`
    : f.wantWhy === "due_now" ? "It needed a fast charger: it is due out now"
    : f.wantWhy === "enough_battery" ? `A standard charger was enough: battery ${pct(f.soc)} and not due out now`
    : null;
  const reason =
    f.why === "only_option" ? "It was the only one it could use"
    : f.why === "power_limit" ? "The others would have gone over the depot's power limit"
    : f.why === "booked" ? "It was booked for this car"
    : f.why === "wanted_kind" ? need
    : f.why === "row_order" ? "The options were equal, so it took the first in the row"
    : null;
  if (!f.wantedKind || !f.chosenKind || f.wantedKind === f.chosenKind) return reason;
  // It took a kind it did not want. Say which of the three reasons it was, and claim "none free" only when counted.
  const wanted = word(f.wantedKind), chosen = word(f.chosenKind);
  if (f.why === "power_limit") return `A ${wanted} would have gone over the depot's power limit, so it took a ${chosen}`;
  if (f.why === "booked") return `It was booked for this car, so it took a ${chosen} over a ${wanted}`;
  const lead = f.wantedKindOptions === 0 ? `No ${wanted} was free for it, so it took a ${chosen}` : `It wanted a ${wanted} and took a ${chosen}`;
  return [lead, reason].filter((x): x is string => !!x).join(". ");
}

/** "Charges in 42 minutes here, against 1 hr 55 min at standard charger 07." Minutes from the moment of the choice, by
 *  the twin's own charge estimate; a clock time would not hold once a visit plan starts the charge later. */
export function chargeCompareText(f: { minutes: number | null; next: { place: string; minutes: number | null } | null }): string | null {
  if (f.minutes == null) return null;
  const here = `Charges in ${duration(f.minutes)} here`;
  return f.next && f.next.minutes != null ? `${here}, against ${duration(f.next.minutes)} at ${f.next.place}.` : `${here}.`;
}

export function pickedText(f: {
  place: string; why?: string | null; charge?: string | null; ready?: string | null; nextBest?: string | null;
}): Sentence {
  const parts: string[] = [];
  if (f.why) parts.push(`${f.why}.`);
  if (f.charge) parts.push(f.charge);
  else if (f.ready) parts.push(`Ready ${clockCT(f.ready)}${f.nextBest ? `, against ${clockCT(f.nextBest)} for the next best` : ""}.`);
  return { title: `Picked ${f.place}`, detail: parts.length ? parts.join(" ") : `Why it was picked: ${MISSING}.` };
}

export function safetyText(f: { passed: number | null; failed: string[] }): Sentence {
  if (f.failed.length) {
    return { title: "Safety check stopped it", detail: `Failed: ${ruleWords(f.failed)}.` };
  }
  if (f.passed == null) return { title: "Safety checks passed", detail: `Checks run: ${MISSING}.` };
  return { title: `${f.passed} safety ${f.passed === 1 ? "check" : "checks"} passed`, detail: null };
}

export function blockedText(f: { failed: string[]; then: string | null }): Sentence {
  return {
    title: "Safety check stopped it",
    detail: `${f.failed.length ? `Failed: ${ruleWords(f.failed)}.` : `Rule ${MISSING}.`}${f.then ? ` ${f.then}` : ""}`,
  };
}

export function sentText(f: { place: string | null; at: string | null }): Sentence {
  return { title: `Sent to ${f.place || MISSING}`, detail: `at ${clockCT(f.at)}` };
}

export function doneText(f: {
  battery: number | null; servicesDone: string[]; servicesCarried: string[]; leftAt: string | null; due: string | null;
}): Sentence {
  const early = minutesBetween(f.leftAt, f.due);
  const timing =
    early == null ? `due time ${MISSING}` : early >= 0 ? `${duration(early)} before due` : `${duration(early)} after due`;
  const services = f.servicesDone.length ? `${listWords(f.servicesDone.map(serviceWord))} done` : null;
  const carried = f.servicesCarried.length ? `${listWords(f.servicesCarried.map(serviceWord))} moved to next visit` : null;
  return {
    title: "Done",
    detail: [`Battery ${pct(f.battery)}`, services, carried, `left ${clockCT(f.leftAt)}, ${timing}`]
      .filter((x): x is string => !!x).map(capital).join(". ") + ".",
  };
}

export function replannedText(f: { minutes: number | null; cause: string | null }): Sentence {
  const shift =
    f.minutes == null ? null : f.minutes === 0 ? "same time" : `${duration(f.minutes)} ${f.minutes > 0 ? "later" : "earlier"}`;
  return { title: "Re-planned", detail: [f.cause, shift].filter(Boolean).join(": ") || null };
}

export function waitedText(f: { why: string; minutes: number | null }): Sentence {
  return { title: "Waited", detail: f.minutes != null && f.minutes > 0 ? `${f.why}, for ${duration(f.minutes)}` : f.why };
}

export function serviceAddedText(f: { service: string | null; verdict: "confirm" | "escalate" | "clear" | null }): Sentence {
  const s = serviceWord(f.service) || "service";
  if (f.verdict === "clear") return { title: "Service not needed", detail: `Quick check cleared the ${s}.` };
  if (f.verdict === "escalate") return { title: "Service added", detail: `Quick check found more: ${s} needs a technician.` };
  return { title: "Service added", detail: `Quick check confirmed the ${s}.` };
}

export function ownerRequestText(f: { what: string | null; at: string | null }): Sentence {
  return { title: "Owner request", detail: `${f.what ? `${f.what}, ` : ""}booked ${clockCT(f.at)}` };
}
