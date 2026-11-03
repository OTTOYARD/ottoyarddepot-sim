// ============================================================================
// research — the words and numbers of the Research tab, from otto-q-core 0793's feed (public.ottoq_research_feed).
//
// RESEARCH, NOT LIVE. The research wing writes these findings about what it measured, built and recommends. Nothing in
// the engine reads them, and a recommendation changes nothing at the depot until a person ships it as a certified change
// (otto-q-core CLAUDE.md rule 10). The tab says so in its banner; this file only shapes what the tab draws.
//
// Every string the feed carries is text the app does not write, so it reaches the screen through publicText() (no
// vendor product name on screen, src/lib/publicNames.ts). Every time is US Central, never raw UTC (CLAUDE.md rule 7).
// `metrics` is whatever JSON the research wing wrote: numbers, [lo, hi] ranges, nested objects. metricLines() draws
// any of it, and never throws.
// ============================================================================
import type { ResearchFeed, ResearchFinding, ResearchKind, ResearchStatus } from "@/lib/ottoTwin";
import { publicText } from "@/lib/publicNames";

/** A value the feed did not give. Never a 0. */
export const MISSING = "—";

export const STATUS_LABEL: Readonly<Record<ResearchStatus, string>> = {
  in_progress: "In progress",
  measured: "Measured",
  built: "Built",
  recommended: "Recommended",
  shipped: "Shipped",
  not_verified: "Not verified",
};

export const KIND_LABEL: Readonly<Record<ResearchKind, string>> = {
  measurement: "Measurement",
  build: "Build",
  safety: "Safety",
  recommendation: "Recommendation",
  lab: "Lab",
};

const words = (key: string): string => {
  const s = key.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : MISSING;
};

/** A status the app has no word for is shown as its own words: never a guess. */
export const statusLabel = (status: string): string => STATUS_LABEL[status as ResearchStatus] ?? words(status);
export const kindLabel = (kind: string): string => KIND_LABEL[kind as ResearchKind] ?? words(kind);

// ── times ────────────────────────────────────────────────────────────────────
const CT_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * A UTC instant as US Central time: "Nov 3, 9:40 AM CT" (CST or CDT, as the date falls). Null when missing or
 * unreadable. Some ICU versions put a narrow no-break space before AM/PM; it is written as a plain space.
 */
export function ctTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return `${CT_FORMAT.format(ms).replace(/\s+/g, " ")} CT`;
}

/** An ISO 8601 instant with its offset, as Postgres writes a timestamptz into JSON. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A run id as the tab shows it: its first 8 characters (the full id is the chip's tooltip). */
export const shortRunId = (id: string): string => id.slice(0, 8);

// ── metrics ──────────────────────────────────────────────────────────────────
/** Words that are names or units, written their own way. A key's other words stay as written. */
const WORD: Readonly<Record<string, string>> = {
  auc: "AUC",
  brier: "Brier",
  ci: "CI",
  kpi: "KPI",
  kpis: "KPIs",
  sla: "SLA",
  mae: "MAE",
  rmse: "RMSE",
  kw: "kW",
  kwh: "kWh",
  mwh: "MWh",
  soc: "SoC",
  dcfc: "DCFC",
  l2: "L2",
  ev: "EV",
  bess: "BESS",
  ocpp: "OCPP",
  usd: "USD",
  id: "ID",
  ids: "IDs",
  pct: "%",
};

/**
 * A metric key in words: "brier_skill_ci95_by_key" -> "Brier skill 95% CI by key", "auc" -> "AUC",
 * "uptime_pct" -> "Uptime %". A product name in a key gets its public name, as any text from the feed does.
 */
export function humanizeKey(key: string): string {
  const parts = key.split(/[_\s]+/).filter(Boolean);
  if (parts.length === 0) return key;
  let named = false;
  const out = parts.map((w, i) => {
    const lower = w.toLowerCase();
    const ci = /^ci(\d{2})$/.exec(lower);
    const word = ci ? `${ci[1]}% CI` : WORD[lower];
    if (i === 0) named = word !== undefined;
    return word ?? w;
  });
  if (!named) out[0] = out[0].charAt(0).toUpperCase() + out[0].slice(1);
  return publicText(out.join(" "));
}

const MINUS = "−";

/**
 * A number as a reader reads it: grouped thousands, up to 4 decimals (3 significant digits below 0.001, so a small
 * number never reads as 0), and a real minus sign. 370 -> "370", 12345 -> "12,345", 0.6535 -> "0.6535".
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return MISSING;
  const abs = Math.abs(n);
  const options: Intl.NumberFormatOptions = Number.isInteger(n)
    ? { maximumFractionDigits: 0 }
    : abs >= 0.001
      ? { maximumFractionDigits: 4 }
      : { maximumSignificantDigits: 3 };
  const s = new Intl.NumberFormat("en-US", options).format(abs);
  return n < 0 && /[1-9]/.test(s) ? `${MINUS}${s}` : s;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A [lo, hi] pair: "0.5803–0.707". With a negative end it reads "−0.0608 to 0.0998", because a minus beside a range
 * dash is easy to misread.
 */
function rangeText(lo: number, hi: number): string {
  const a = formatNumber(lo);
  const b = formatNumber(hi);
  return lo < 0 || hi < 0 ? `${a} to ${b}` : `${a}–${b}`;
}

/**
 * One metric value as text. number -> formatted; [lo, hi] -> "lo–hi"; a list -> its items, " · " between them;
 * true/false -> yes/no; null -> "—"; a timestamp -> US Central time; any other text -> as written (public names).
 * An object gets its own lines from metricLines(); given here, it reads as its entries in a row.
 */
export function formatMetricValue(v: unknown): string {
  if (v === null || v === undefined) return MISSING;
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return (ISO_INSTANT.test(v) ? ctTime(v) : null) ?? publicText(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "none";
    if (v.length === 2 && isFiniteNumber(v[0]) && isFiniteNumber(v[1])) return rangeText(v[0], v[1]);
    return v.map(formatMetricValue).join(" · ");
  }
  if (isRecord(v)) {
    const keys = Object.keys(v);
    return keys.length === 0 ? "none" : keys.map((k) => `${humanizeKey(k)}: ${formatMetricValue(v[k])}`).join(" · ");
  }
  return publicText(String(v));
}

/** One line of a finding's metrics. A nested object is a line with no value, its entries one level deeper. */
export interface MetricLine {
  label: string;
  /** Null on a line that heads a nested group. */
  value: string | null;
  depth: number;
}

// jsonb keeps an object's keys shortest first, which says nothing to a reader. Natural order puts related keys
// together: auc, auc_ci95_by_key, auc_ci95_independent.
const byKey = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

function addLines(out: MetricLine[], label: string, v: unknown, depth: number): void {
  if (isRecord(v)) {
    const keys = Object.keys(v).sort(byKey);
    if (keys.length === 0) {
      out.push({ label, value: "none", depth });
      return;
    }
    out.push({ label, value: null, depth });
    for (const k of keys) addLines(out, humanizeKey(k), v[k], depth + 1);
    return;
  }
  if (Array.isArray(v) && v.some((x) => typeof x === "object" && x !== null)) {
    out.push({ label, value: null, depth });
    v.forEach((x, i) => addLines(out, String(i + 1), x, depth + 1));
    return;
  }
  out.push({ label, value: formatMetricValue(v), depth });
}

/** A finding's metrics as indented "key: value" lines, keys in words and in natural order. Never throws. */
export function metricLines(metrics: unknown): MetricLine[] {
  if (!isRecord(metrics)) return [];
  const out: MetricLine[] = [];
  for (const k of Object.keys(metrics).sort(byKey)) addLines(out, humanizeKey(k), metrics[k], 0);
  return out;
}

// ── phases ───────────────────────────────────────────────────────────────────
const phaseNumber = (phase: string): number => {
  const m = /^P(\d+)$/i.exec(phase);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};

/** "P0" -> "Phase 0". */
export const phaseLabel = (phase: string): string => {
  const n = phaseNumber(phase);
  return Number.isFinite(n) ? `Phase ${n}` : phase || "No phase";
};

export interface PhaseGroup {
  phase: string;
  label: string;
  findings: ResearchFinding[];
}

const instant = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** The feed's own order inside a phase (0793: updated_at newest first, then slug). */
function newestFirst(a: ResearchFinding, b: ResearchFinding): number {
  const ta = instant(a.updated_at);
  const tb = instant(b.updated_at);
  if (ta !== tb) return tb > ta ? 1 : -1;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * Findings by phase, Phase 0 first, each phase newest first. The feed sends them in this order already; the tab sorts
 * again so what it draws does not depend on the order of the answer.
 */
export function groupByPhase(findings: readonly ResearchFinding[]): PhaseGroup[] {
  const byPhase = new Map<string, ResearchFinding[]>();
  for (const f of findings) {
    const list = byPhase.get(f.phase);
    if (list) list.push(f);
    else byPhase.set(f.phase, [f]);
  }
  return [...byPhase.entries()]
    .sort(([a], [b]) => phaseNumber(a) - phaseNumber(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([phase, list]) => ({ phase, label: phaseLabel(phase), findings: [...list].sort(newestFirst) }));
}

// ── the payload ──────────────────────────────────────────────────────────────
const text = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

function readFinding(f: Record<string, unknown>, i: number): ResearchFinding {
  return {
    slug: text(f.slug) || `finding-${i + 1}`,
    phase: text(f.phase),
    item: text(f.item),
    kind: text(f.kind) as ResearchKind,
    status: text(f.status) as ResearchStatus,
    title: text(f.title),
    summary: text(f.summary),
    metrics: isRecord(f.metrics) ? f.metrics : {},
    evidence: typeof f.evidence === "string" && f.evidence.trim() !== "" ? f.evidence : null,
    run_ids: Array.isArray(f.run_ids) ? f.run_ids.filter((r): r is string => typeof r === "string" && r !== "") : [],
    measured_at: typeof f.measured_at === "string" && f.measured_at !== "" ? f.measured_at : null,
    updated_at: text(f.updated_at),
  };
}

/**
 * The feed's answer, checked. An answer without a findings list is an error, never "no findings": an empty tab must
 * mean the research wing has written nothing. A retracted finding is left out, as the feed itself does.
 */
export function readResearchFeed(raw: unknown): ResearchFeed {
  if (!isRecord(raw) || !Array.isArray(raw.findings)) {
    throw new Error("The research feed sent data that this tab cannot read.");
  }
  const findings = raw.findings
    .filter(isRecord)
    .map(readFinding)
    .filter((f) => (f.status as string) !== "retracted");
  return { depot_id: text(raw.depot_id), read_at: text(raw.read_at), findings };
}
