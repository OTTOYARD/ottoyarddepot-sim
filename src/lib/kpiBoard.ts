// ============================================================================
// kpiBoard — the KPI tab's board, shaped from public.ottoq_twin_kpi_board (otto-q-core 0609/0610). Pure: no React.
//
// Chase, 2026-10-06: "the KPI tab is super weak and unclear and not reader friendly ... It should hang very heavily on
// Vehicle up time and any other autonomous vehicle or depot KPI's that are extremely relevant for revenue energy
// turnaround time service is completed, etc."
//
// Every figure is the run's own: the engine computes it from the run's rows inside sim_clock_start..sim_clock_current,
// and this file only names, orders and formats it. A missing figure prints "—", never 0.
// ============================================================================
import type { TwinKpiBoard } from "@/lib/ottoTwin";

const DEPOT_TZ = "America/Chicago";

// ── where fleet time went ───────────────────────────────────────────────────
// Colours validated for the cockpit's dark panel (#111317) with the dataviz validator in this order (lightness band,
// chroma floor, CVD separation and normal-vision floor between neighbours, 3:1 contrast: all pass). The order keeps the
// neighbours apart, so do not reorder without re-running it. "Other" is the neutral fold, not a categorical slot.
export interface TimeSegmentDef { key: string; label: string; color: string; parts: readonly string[]; means: string }
export const TIME_SEGMENTS: readonly TimeSegmentDef[] = [
  { key: "road", label: "On the road", color: "#008300", parts: ["on_road", "leaving"], means: "out at work, or on its way out" },
  { key: "ready", label: "Ready", color: "#2aa9a0", parts: ["ready"], means: "staged to leave, nothing open" },
  { key: "charging", label: "Charging", color: "#3987e5", parts: ["charging_dcfc", "charging_l2"], means: "on a DCFC or an L2 charger" },
  { key: "queue", label: "Waiting after arrival", color: "#d95926", parts: ["queue"], means: "in the depot, no first stall or bay yet" },
  { key: "bay", label: "In a bay", color: "#9085e9", parts: ["in_bay"], means: "wash, detail or service bay" },
  { key: "between", label: "Between steps", color: "#c98500", parts: ["between_steps"], means: "one step done, the next not started" },
  { key: "other", label: "Driving back, or down", color: "#5b616e", parts: ["returning", "down", "offline", "other"], means: "on the way in, or out of service" },
] as const;

export interface TimeSegment extends TimeSegmentDef { hours: number; pct: number }

/** Fleet time by segment, in TIME_SEGMENTS order. Percent of the fleet time the segments add up to. */
export function timeSplit(b: TwinKpiBoard | null | undefined): TimeSegment[] {
  const s = b?.split_hours;
  if (!s) return [];
  const rows = TIME_SEGMENTS.map((d) => ({ ...d, hours: d.parts.reduce((a, p) => a + (Number(s[p]) || 0), 0), pct: 0 }));
  const total = rows.reduce((a, r) => a + r.hours, 0);
  for (const r of rows) r.pct = total > 0 ? (100 * r.hours) / total : 0;
  return rows;
}

/** The share of fleet time cars waited in the depot: after arrival plus between steps. */
export function waitingShare(seg: readonly TimeSegment[]): number | null {
  if (!seg.length) return null;
  return seg.filter((x) => x.key === "queue" || x.key === "between").reduce((a, x) => a + x.pct, 0);
}

// ── formatting ──────────────────────────────────────────────────────────────
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const fmtInt = (v: number | null | undefined): string => (isNum(v) ? Math.round(v).toLocaleString("en-US") : "—");

export function fmtPct(v: number | null | undefined, digits = 0): string {
  return isNum(v) ? `${v.toFixed(digits)}%` : "—";
}

/** Minutes as people say them: "15 min", "1 h 57 min", "26 h". */
export function fmtMin(v: number | null | undefined): string {
  if (!isNum(v)) return "—";
  const m = Math.round(v);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h >= 24) return `${h} h`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function fmtHours(v: number | null | undefined): string {
  if (!isNum(v)) return "—";
  return v >= 10 ? `${Math.round(v).toLocaleString("en-US")} h` : `${v.toFixed(1)} h`;
}

export function fmtUsd(v: number | null | undefined): string {
  if (!isNum(v)) return "—";
  return v >= 100 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v.toFixed(2)}`;
}

export const fmtKwh = (v: number | null | undefined): string => (isNum(v) ? `${Math.round(v).toLocaleString("en-US")} kWh` : "—");
export const fmtKw = (v: number | null | undefined): string => (isNum(v) ? `${Math.round(v).toLocaleString("en-US")} kW` : "—");

/** The run's window on the sim clock, in the depot's time: "sim 8:00 AM – 1:50 PM CT", with dates when it spans days. */
export function windowLabel(w: { from: string; to: string } | null | undefined): string {
  if (!w) return "—";
  const a = new Date(w.from), b = new Date(w.to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "—";
  const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: DEPOT_TZ });
  const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: DEPOT_TZ });
  return day(a) === day(b)
    ? `sim ${time(a)} – ${time(b)} CT`
    : `sim ${day(a)} ${time(a)} – ${day(b)} ${time(b)} CT`;
}

// ── the headline tiles ──────────────────────────────────────────────────────
export interface Tile { key: string; label: string; value: string; sub: string; tone?: "good" | "warn" | "bad" | null }

/** The four tiles under the uptime figure: turnaround, charge at departure, on time, and cars sent out. */
export function headlineTiles(b: TwinKpiBoard | null | undefined): Tile[] {
  const t = b?.turnaround, d = b?.departures, o = b?.on_time, f = b?.flow;
  const due = o && isNum(o.on_time) ? (o.on_time ?? 0) + (o.late ?? 0) + (o.stranded ?? 0) : null;
  const allFull = d && d.dispatched > 0 ? d.at_99_or_more === d.dispatched : null;
  return [
    {
      key: "turnaround", label: "Turnaround",
      value: fmtMin(t?.p50_min),
      sub: t ? `median, arrival to ready · ${fmtInt(t.finished)} of ${fmtInt(t.arrivals)} visits done` : "—",
    },
    {
      key: "charged", label: "Left fully charged",
      value: d ? (d.dispatched ? `${fmtInt(d.at_99_or_more)} of ${fmtInt(d.dispatched)}` : "—") : "—",
      sub: d && d.dispatched ? `battery at dispatch: average ${fmtPct(d.soc_avg)}, lowest ${fmtPct(d.soc_min)}` : "no car left yet",
      tone: allFull == null ? null : allFull ? "good" : "bad",
    },
    {
      key: "on_time", label: "Ready on time",
      value: fmtPct(o?.pct ?? null),
      sub: due ? `${fmtInt(o?.on_time)} of ${fmtInt(due)} visits with a due time` : "no visit with a due time yet",
    },
    {
      key: "out", label: "Cars sent out",
      value: fmtInt(f?.departures),
      sub: f ? `${isNum(f.departures_per_hour) ? f.departures_per_hour.toFixed(1) : "—"} an hour · ${fmtInt(f.arrivals)} came in` : "—",
    },
  ];
}

// ── the sections ────────────────────────────────────────────────────────────
export interface Row { label: string; value: string; detail?: string }

export function turnaroundRows(b: TwinKpiBoard | null | undefined): Row[] {
  const t = b?.turnaround, w = b?.charger_wait, f = b?.flow;
  if (!t) return [];
  const rows: Row[] = [
    { label: "Arrival to first service", value: fmtMin(t.first_service_p50_min), detail: `median · 90% within ${fmtMin(t.first_service_p90_min)} · ${fmtInt(t.served)} of ${fmtInt(t.arrivals)} visits started` },
    { label: "Arrival to ready", value: fmtMin(t.p50_min), detail: `median · 90% within ${fmtMin(t.p90_min)} · over ${fmtInt(t.finished)} visits done` },
    { label: "Still in the depot at the end", value: fmtInt(t.still_in_depot), detail: t.still_in_depot ? `visits · median ${fmtMin(t.open_so_far_p50_min)} so far` : "visits" },
  ];
  if (w) {
    rows.push({
      label: "Wait for a charger", value: fmtMin(w.p50_min),
      detail: `median · 95% within ${fmtMin(w.p95_min)}${w.waiting_at_end ? ` · ${fmtInt(w.waiting_at_end)} still waiting at the end` : ""}`,
    });
  }
  if (f) rows.push({ label: "Sent back to finish before leaving", value: fmtInt(f.sent_back_before_leaving), detail: "times a car staged to leave had work open" });
  return rows;
}

export function serviceRows(b: TwinKpiBoard | null | undefined): Row[] {
  const s = b?.service;
  if (!s) return [];
  return [
    { label: "Service steps done", value: `${fmtInt(s.done)} of ${fmtInt(s.steps)}`, detail: s.required_open ? `${fmtInt(s.required_open)} still open at the end, on cars still in the depot` : "none open at the end" },
  ];
}

export function energyRows(b: TwinKpiBoard | null | undefined): Row[] {
  const e = b?.energy;
  if (!e) return [];
  const shaved = isNum(e.peak_load_kw_15min) && isNum(e.peak_grid_kw_15min) ? e.peak_load_kw_15min - e.peak_grid_kw_15min : null;
  return [
    { label: "Energy to cars", value: fmtKwh(e.to_cars_kwh) },
    { label: "Grid energy bought", value: fmtUsd(e.grid_cost_usd), detail: `${fmtKwh(e.grid_import_kwh)} at ${isNum(e.grid_price_usd_kwh) ? `$${e.grid_price_usd_kwh.toFixed(3)}` : "—"} a kWh` },
    { label: "Solar", value: fmtPct(e.solar_share_pct), detail: `${fmtKwh(e.solar_kwh)}, share of the site's energy` },
    {
      label: "Peak grid draw (15 min)", value: fmtKw(e.peak_grid_kw_15min),
      detail: shaved != null && shaved > 0 ? `the battery cut ${fmtKw(shaved)} off a site peak of ${fmtKw(e.peak_load_kw_15min)}` : "this peak sets the demand charge",
    },
  ];
}

export function chargerRows(b: TwinKpiBoard | null | undefined): Row[] {
  const c = b?.chargers;
  if (!c) return [];
  return [
    { label: "DCFC busy", value: fmtPct(c.dcfc_busy_pct), detail: `of the time, over ${fmtInt(c.dcfc_stalls)} fast chargers` },
    { label: "L2 busy", value: fmtPct(c.l2_busy_pct), detail: `of the time, over ${fmtInt(c.l2_stalls)} standard chargers` },
    { label: "Charge sessions", value: fmtInt(c.sessions_started), detail: `${fmtInt(c.sessions_completed)} done · ${fmtInt(c.sessions_faulted)} stopped by a charger fault` },
  ];
}

/** The services with the most steps done, for the bars under "Service". */
export function topServices(b: TwinKpiBoard | null | undefined, n = 5) {
  return (b?.service?.by_service ?? []).slice(0, n).map((x) => ({ ...x, pct: x.total ? (100 * x.done) / x.total : 0 }));
}

/** One line under the board: which run, which day, how many cars. */
export function boardCaption(b: TwinKpiBoard | null | undefined): string {
  if (!b?.ok) return "";
  return [b.sim_run_id ? `Run ${b.sim_run_id.slice(0, 8)}` : null, b.scenario ?? null, windowLabel(b.window), b.cars != null ? `${b.cars} cars` : null]
    .filter(Boolean).join(" · ");
}
