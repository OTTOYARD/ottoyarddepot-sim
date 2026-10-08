// ============================================================================
// selfAssessment — the engine's own morning review of the kernel's check, and the charge clock it times charges by, in
// words. Pure: no React, no client.
//
// Chase, 2026-10-08: "Ideally, after a while, the system itself will pick up areas for self improvement."
//
// The engine side is otto-q-core 0621 and 0622. Each morning public.ottoq_arbiter_assess takes the agent's charge-line
// orders graded in the past week (each replayed 90 sim-minutes after it was sent, with what actually happened) and
// writes one row to public.ottoq_arbiter_assessments: how the kernel's check did on them, what made its forecasts
// wrong (each of five causes' exact share of the difference), and the places it falls short, in the engine's order,
// each with its finding and its evidence. The charge clock is refit each morning from the depot's own charges
// (public.ottoq_charge_clock_fits, 0622). This file draws both. They are findings for the research team: the production
// engine never changes its own rules or settings from them (otto-q-core CLAUDE.md rule 10); a person decides what to
// build. A missing number is "—", never 0.
// ============================================================================
import { sentenceCase } from "./publicNames";
import type { LearningTone } from "./runLearning";

/** One place the review says the check falls short (0621/0622 improvement_areas). */
export interface ImprovementArea {
  area?: string | null;
  /** capability_gap | calibration | forecast | threshold | agent */
  kind?: string | null;
  weight?: number | null;
  /** The engine's own sentence, with its numbers. */
  finding?: string | null;
  /** A short name, if the engine writes one: drawn in place of this file's own. */
  title?: string | null;
  evidence?: Record<string, unknown> | null;
}

/** How the check's calls on the week's orders came out in hindsight (assessment.verdicts). */
export interface ReviewVerdicts {
  right_take?: number | null;
  neutral_take?: number | null;
  wrong_take?: number | null;
  missed_win?: number | null;
  right_refusal?: number | null;
  no_decision?: number | null;
  no_decision_mattered?: number | null;
}

/** One cause's exact (Shapley) share of the difference between the check's forecast and what happened. */
export interface CausePart {
  verdict_share?: number | null;
  verdict_mass?: number | null;
  orders_moved?: number | null;
}

/** assessment.what_made_the_check_wrong. */
export interface ReviewAttribution {
  parts?: Record<string, CausePart> | null;
  orders_attributed?: number | null;
  verdicts_changed?: number | null;
}

/** The depot's latest row of public.ottoq_arbiter_assessments, with two blocks of `assessment` selected out. */
export interface SelfAssessmentRow {
  assessment_id?: number | null;
  assessed_at?: string | null;
  /** The graded orders read: graded since this instant. */
  since?: string | null;
  n_graded?: number | null;
  improvement_areas?: ImprovementArea[] | null;
  verdicts?: ReviewVerdicts | null;
  attribution?: ReviewAttribution | null;
}

/** One level of the charge clock: `off` is the log offset the fit settled on, after shrinking `raw` by its evidence. */
export interface ClockCell {
  off?: number | null;
  raw?: number | null;
  n?: number | null;
  n_eff?: number | null;
  k?: number | null;
  sd?: number | null;
}

/** The depot's latest usable row of public.ottoq_charge_clock_fits (0622), with the class levels selected out. */
export interface ClockFitRow {
  fit_id?: number | null;
  fitted_at?: string | null;
  n_evidence?: number | null;
  n_runs?: number | null;
  /** "kind|class" for a class on a charger kind; "kind|class|band" for one start-of-charge band of it. */
  class_cells?: Record<string, ClockCell> | null;
  half_life_days?: number | null;
}

export interface ReviewArea {
  key: string;
  kind: string;
  kindLabel: string;
  title: string;
  finding: string;
}

export interface ReviewCause {
  key: string;
  label: string;
  /** 0..100, for the bar. */
  pct: number;
  text: string;
  /** The hover line: what the share is of, and on how many orders the cause moved the verdict. */
  detail: string;
}

export interface ClockView {
  headline: string;
  /** One line per charger kind: each make's factor against the depot-wide clock. */
  facts: string[];
  note: string;
}

export interface SelfAssessmentView {
  tone: LearningTone;
  headline: string;
  facts: string[];
  /** What made the check's forecasts wrong, largest share first. Empty when no order could be split. */
  causes: ReviewCause[];
  causesLabel: string;
  /** The first areas, in the engine's order. */
  areas: ReviewArea[];
  /** The rest, in the engine's order. */
  more: ReviewArea[];
  clock: ClockView | null;
  basis: string;
}

/** How many areas are drawn before "the rest". */
export const AREAS_SHOWN = 5;
/** A review older than this is said to be so: the morning job may have missed a day. */
export const STALE_AFTER_MS = 36 * 3600_000;

const n = (x: number | null | undefined): string => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("en-US"));
const count = (x: number | null | undefined, one: string, many = `${one}s`): string => `${n(x)} ${x === 1 ? one : many}`;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A real-clock instant in the depot's own time, "Oct 8, 11:46 AM CT". Built from parts so every runtime writes the same. */
export function ctTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Chicago",
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()} CT`;
}

const MAKE: Record<string, string> = { waymo: "Waymo", tesla: "Tesla", zoox: "Zoox" };

/** A vehicle class code (zoox_robotaxi_2024) by its make, the name the twin gives a fleet everywhere else. */
export function classMake(code: string | null | undefined): string {
  if (!code) return "a class";
  return MAKE[code.split("_")[0] ?? ""] ?? code.replace(/_/g, " ");
}

const ON: Record<string, string> = { l2: "L2", dcfc: "fast chargers" };
const on = (kind: string): string => ON[kind] ?? kind;

/** The variables the clock's audit tests (0622 ottoq_charge_clock_audit), in words. */
const COVARIATE: Record<string, string> = {
  class: "the vehicle class",
  model: "make and model",
  vehicle: "each car",
  band: "the starting charge",
  run: "the run",
  charger: "the charger",
  ambient_c: "air temperature",
  sim_hour: "the hour of day",
  to_full: "charging to full",
};
const covariate = (c: string): string => COVARIATE[c] ?? c.replace(/_/g, " ");

/** What an agent order changed in the expected future (0621 ottoq_charge_order_moves), as a gerund. */
const MOVE: Record<string, string> = {
  due_rescue_fast: "making a late car ready on a fast charger",
  due_rescue: "making a late car ready on L2",
  low_battery_on_l2: "putting a low battery on L2",
  top_off_ahead: "seating a top-off ahead",
  late_car_first: "seating a car past due first",
  kind_swap: "moving a car to the other kind of charger",
  reorder_only: "reordering the line and nothing else",
};
const move = (tag: string): string => MOVE[tag] ?? tag.replace(/_/g, " ");

const KIND_LABEL: Record<string, string> = {
  capability_gap: "Can't model yet",
  calibration: "Off calibration",
  forecast: "Forecast",
  threshold: "A person's dial",
  agent: "Agent's move",
};
export const kindLabel = (k: string | null | undefined): string => (k ? KIND_LABEL[k] ?? k.replace(/_/g, " ") : "Finding");

/** "finish 9% sooner" or "take 9% longer", from actual over forecast; null when the factor is missing or about 1. */
function offBy(f: number | null): string | null {
  if (f == null || f <= 0) return null;
  const p = Math.round(Math.abs(f - 1) * 100);
  if (p === 0) return null;
  return f < 1 ? `finish ${p}% sooner` : `take ${p}% longer`;
}

/** A short name for an area: the engine's own when it writes one, else one made from its code and evidence. */
export function areaTitle(a: ImprovementArea): string {
  if (a.title) return a.title;
  const code = a.area ?? "";
  const ev = a.evidence ?? {};
  switch (code) {
    case "arrival_spread": return "Its arrival forecasts are surer than the arrivals";
    case "simulator_structure": {
      const m = num(ev.mae_min);
      return m != null ? `Its simulator places a plug-in ${m.toFixed(1)} min off, even given what happened` : "Its simulator is coarser than the depot";
    }
    case "outflow_return_cycle": return "It cannot see a car leave, work and come back";
    case "chargers_left_out": return "It never adds back a charger whose hold ends";
    case "futures_uninformative": return "Its odds of winning predict no better than the base rate";
    case "bar_stricter": return "A stricter bar would have done better on these orders";
    case "bar_looser": return "A looser bar would have done better on these orders";
    case "forecast_appeared": return "Cars it never saw coming moved its verdicts";
    case "forecast_running": return "Charges already under way moved its verdicts";
    case "forecast_arrivals": return "When cars really came home moved its verdicts";
    case "forecast_charge_times": return "How long charges really took moved its verdicts";
    case "forecast_faults": return "Charger faults it never sampled moved its verdicts";
  }
  let m: RegExpMatchArray | null;
  if ((m = code.match(/^charge_clock_misses_(.+)_(l2|dcfc)$/))) return `The charge clock ignores ${covariate(m[1])} on ${on(m[2])}`;
  if ((m = code.match(/^charge_clock_stale_(.+)_(l2|dcfc)$/))) return `The charge clock's level for ${covariate(m[1])} has drifted on ${on(m[2])}`;
  if ((m = code.match(/^charge_clock_worse_than_v1_(l2|dcfc)$/))) return `The charge clock trails the one before it on ${on(m[1])}`;
  if ((m = code.match(/^charge_clock_(l2|dcfc)_(.+)$/))) {
    const by = offBy(num(ev.factor_off_by));
    return by ? `${classMake(m[2])} charges on ${on(m[1])} ${by} than the clock says` : `${classMake(m[2])} charges on ${on(m[1])} run off the clock`;
  }
  if ((m = code.match(/^charge_clock_(l2|dcfc)$/))) {
    const by = offBy(num(ev.factor_off_by));
    return by ? `Charges on ${on(m[1])} ${by} than the clock says` : `Charges on ${on(m[1])} run off the clock`;
  }
  if ((m = code.match(/^agent_move_loses_(.+)$/))) return `The agent keeps losing by ${move(m[1])}`;
  if ((m = code.match(/^agent_move_wins_refused_(.+)$/))) return `The check keeps refusing orders that win by ${move(m[1])}`;
  return sentenceCase(code.replace(/_/g, " ")) || "A finding";
}

/**
 * The engine's sentence for a viewer: its internal ids in parentheses go ("(0619 return_v1)", "(track_record.moves)"),
 * a class code reads as its make, a charger kind and a covariate key read as words. The numbers stay as written.
 */
export function plainFinding(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\s*\((?:\d{4}\s+)?[a-z0-9]+(?:[._][a-z0-9]+)+\)/g, "")
    .replace(/\b0619's\b/g, "the earlier clock's")
    .replace(/\b([a-z]+)_[a-z0-9_]*?_20\d\d\b/g, (code) => classMake(code))
    .replace(/\bambient_c\b/g, "air temperature")
    .replace(/\bsim_hour\b/g, "the hour of day")
    .replace(/\bto_full\b/g, "charging to full")
    .replace(/\bdcfc\b/g, "DCFC")
    .replace(/\bl2\b/g, "L2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The five causes the review splits the forecast's error across (0621 ottoq_charge_order_attribution). */
const CAUSE: Record<string, string> = {
  appeared: "Cars it never saw coming",
  running: "Charges already under way",
  arrivals: "When cars came home",
  charge_times: "How long charges took",
  faults: "Chargers that faulted",
};
export const causeLabel = (k: string): string => CAUSE[k] ?? sentenceCase(k.replace(/_/g, " "));

function causesOf(att: ReviewAttribution | null | undefined): ReviewCause[] {
  const total = att?.orders_attributed ?? null;
  return Object.entries(att?.parts ?? {})
    .map(([k, p]) => ({ k, share: num(p?.verdict_share), moved: num(p?.orders_moved) }))
    .filter((c): c is { k: string; share: number; moved: number | null } => c.share != null && c.share > 0)
    .sort((a, b) => b.share - a.share || a.k.localeCompare(b.k))
    .map(({ k, share, moved }) => {
      const pct = Math.round(share * 100);
      return {
        key: k,
        label: causeLabel(k),
        pct,
        text: `${pct}%`,
        detail: `${causeLabel(k)}: ${pct}% of the difference between its forecasts and what happened`
          + (moved != null ? `; it shifted the verdict on ${count(moved, "order")}${total != null ? ` of ${n(total)}` : ""}` : ""),
      };
    });
}

function areaOf(a: ImprovementArea, i: number): ReviewArea {
  return {
    key: `${a.area ?? "area"}:${i}`,
    kind: a.kind ?? "",
    kindLabel: kindLabel(a.kind),
    title: areaTitle(a),
    finding: plainFinding(a.finding),
  };
}

function gradesLine(v: ReviewVerdicts | null | undefined, graded: number | null | undefined): string | null {
  if (!v) return null;
  const rt = v.right_take ?? 0, nt = v.neutral_take ?? 0, wt = v.wrong_take ?? 0;
  const rr = v.right_refusal ?? 0, mw = v.missed_win ?? 0;
  const nd = v.no_decision ?? 0, ndm = v.no_decision_mattered ?? 0;
  return `Graded ${n(graded)}: took ${n(rt + nt + wt)} (won ${n(rt)}, tied ${n(nt)}, lost ${n(wt)})`
    + ` · refused ${n(rr + mw)} (rightly ${n(rr)}, a winner ${n(mw)})`
    + ` · nothing to decide ${n(nd + ndm)} (mattered in fact ${n(ndm)})`;
}

/** The charge clock's line, or null when the depot has no fit to show. */
export function clockView(c: ClockFitRow | null | undefined): ClockView | null {
  if (!c || c.fit_id == null) return null;
  const byKind = new Map<string, { make: string; factor: number }[]>();
  for (const [key, cell] of Object.entries(c.class_cells ?? {})) {
    const parts = key.split("|");
    const off = num(cell?.off);
    if (parts.length !== 2 || off == null) continue;
    const list = byKind.get(parts[0]) ?? [];
    list.push({ make: classMake(parts[1]), factor: Math.exp(off) });
    byKind.set(parts[0], list);
  }
  const facts: string[] = [];
  for (const [kind, label] of [["dcfc", "Fast charge"], ["l2", "L2"]] as const) {
    const list = (byKind.get(kind) ?? []).sort((a, b) => a.make.localeCompare(b.make));
    if (list.length) facts.push(`${label}: ${list.map((x) => `${x.make} ×${x.factor.toFixed(2)}`).join(" · ")}`);
  }
  const half = num(c.half_life_days);
  return {
    headline: `Learned from ${count(c.n_evidence, "charge")} across ${count(c.n_runs, "run")}, refit ${ctTime(c.fitted_at)}`
      + (half != null ? `. Recent charges count more: a charge ${count(half, "day")} old counts half.` : "."),
    facts,
    note: "×1.00 is the depot-wide clock for the same battery, charge range and charger. "
      + "Each make's factor comes from its own charges, pulled toward ×1.00 the fewer it has.",
  };
}

/** The review's words, or null when there is no review to draw (none read yet, or a read that failed). */
export function selfAssessmentView(
  r: SelfAssessmentRow | null | undefined,
  clock: ClockFitRow | null | undefined,
  now: number = Date.now(),
): SelfAssessmentView | null {
  if (!r || r.assessment_id == null) return null;
  const all = (r.improvement_areas ?? []).map(areaOf);
  const areas = all.slice(0, AREAS_SHOWN);
  const more = all.slice(AREAS_SHOWN);
  const graded = r.n_graded ?? 0;
  const at = r.assessed_at ? Date.parse(r.assessed_at) : NaN;
  const from = r.since ? Date.parse(r.since) : NaN;
  const days = Number.isFinite(at) && Number.isFinite(from) ? Math.max(1, Math.round((at - from) / 86_400_000)) : null;
  const span = days != null ? `the past ${count(days, "day")}` : "the past week";

  let tone: LearningTone;
  let headline: string;
  if (graded === 0) {
    tone = "idle";
    headline = `No agent order from ${span} has been replayed with what happened yet, so the review has nothing to grade.`;
  } else {
    tone = all.length ? "held" : "ok";
    headline = `It replayed ${count(graded, "agent order")} from ${span} with what actually happened and graded its own check on each. `
      + (all.length ? `It names ${count(all.length, "place")} the check falls short.` : "It names no place the check falls short.");
  }

  const facts: string[] = [];
  const g = graded > 0 ? gradesLine(r.verdicts, graded) : null;
  if (g) facts.push(g);

  const causes = causesOf(r.attribution);
  const split = r.attribution?.orders_attributed;
  const causesLabel = `What made its forecasts wrong${split != null ? `, over ${count(split, "order")}` : ""}`;

  const stale = Number.isFinite(at) && now - at > STALE_AFTER_MS;
  const basis = `Reviewed ${ctTime(r.assessed_at)}`
    + (stale ? " · older than a day: the morning review may have missed a run" : " · a review runs each morning");

  return { tone, headline, facts, causes, causesLabel, areas, more, clock: clockView(clock), basis };
}
